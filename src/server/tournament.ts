/**
 * トーナメント（Sit & Go / マルチテーブル）
 *
 * キャッシュゲームとの本質的な違いは 3 つで、実装の難所もそこに集中しています。
 *
 *   1. ブラインドが上がる     … 時間でレベルが進み、スタックの相対価値が下がり続ける
 *   2. 卓を再編成する         … 人が減るたびに席を詰め、最後は 1 卓に集約する
 *   3. 順位で賞金が決まる     … 脱落順を正確に記録する必要がある。同時脱落の扱いが罠になる
 *
 * 卓の再編成は「動かす人数を最小にする」のが原則です。
 * プレイヤーからすると卓移動は不快なので、必要以上に動かしてはいけません。
 */

import {
  Room,
  type TableConfig,
  type RoomIO,
  type RoomBank,
  type Scheduler,
  type BustInfo,
  realScheduler,
} from './room.js';
import { BountyPool, type BountyConfig, type BountyAward } from './bounty.js';
import type { ServerMessage, ErrorCode, TournamentView, TournamentSummaryView } from './protocol.js';

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  /** 休憩レベルなら true（ブラインドは据え置き、プレイを止める） */
  isBreak?: boolean;
}

export interface TournamentConfig {
  tournamentId: string;
  name: string;
  type: 'sng' | 'mtt';
  /** 賞金プールに入る額 */
  buyIn: number;
  /** 主催側の取り分（賞金プールに入らない） */
  fee: number;
  startingStack: number;
  seatsPerTable: number;
  /** SNG はこの人数が集まった時点で開始。MTT は上限 */
  maxPlayers: number;
  /** MTT の最低開催人数 */
  minPlayers?: number;
  levels?: BlindLevel[];
  levelDurationMs?: number;
  /** 開始後、この時間まで参加登録を受け付ける（MTT のレイトレジ） */
  lateRegMs?: number;
  /** 予定開始時刻（MTT）。未指定なら人数が揃い次第 */
  scheduledStart?: number;

  // --- WSOP でよく使われる追加フォーマット ---

  /** バウンティ（賞金首）。参加費とは別に perEntry がバウンティプールへ入る */
  bounty?: BountyConfig;
  /**
   * リエントリー上限。0 ならフリーズアウト。
   * 脱落してもレイトレジ期間内なら、もう一度参加費を払って新しいスタックで戻れる。
   */
  reEntryMax?: number;
  /** アドオン。レイトレジ終了時に 1 度だけ買えるチップ */
  addOn?: { price: number; chips: number };
  /** 進行速度。レベルの長さを倍率で調整する */
  speed?: 'normal' | 'turbo' | 'hyper';
}

const SPEED_FACTOR: Record<'normal' | 'turbo' | 'hyper', number> = {
  normal: 1,
  turbo: 0.4,
  hyper: 0.2,
};

export type TournamentState = 'registering' | 'running' | 'finished' | 'cancelled';

export interface Entrant {
  userId: string;
  name: string;
  /** 現在の卓。脱落後は null */
  tableId: string | null;
  stack: number;
  /** 脱落した順位（1 が優勝）。生存中は null */
  finishPosition: number | null;
  prize: number;
  eliminatedAt: number | null;
  /** 使用したリエントリー回数 */
  reEntries: number;
  /** アドオン購入済みか */
  addOnUsed: boolean;
  /** 撃墜数 */
  knockouts: number;
}

// ---------------------------------------------------------------------------
// ブラインド構造
// ---------------------------------------------------------------------------

/**
 * 標準的なブラインド構造を生成する。
 * 1 レベルあたり約 1.4〜1.5 倍で上げるのが定番で、これより急だと運ゲーになり、
 * 緩いと終わらない。アンティはレベル 4 以降に入れて中盤以降のポットを膨らませる。
 */
export function standardBlindLevels(startingBb: number, count = 24): BlindLevel[] {
  const levels: BlindLevel[] = [];
  let bb = startingBb;
  for (let i = 1; i <= count; i++) {
    if (i > 1 && i % 6 === 1) {
      levels.push({ level: i, smallBlind: Math.round(bb / 2), bigBlind: bb, ante: 0, isBreak: true });
      continue;
    }
    levels.push({
      level: i,
      smallBlind: Math.round(bb / 2),
      bigBlind: bb,
      ante: i >= 4 ? Math.round(bb * 0.125) : 0,
    });
    bb = Math.round((bb * 1.45) / 5) * 5;
  }
  return levels;
}

// ---------------------------------------------------------------------------
// ペイテーブル
// ---------------------------------------------------------------------------

/**
 * 入賞人数と配分を決める。
 *
 * 実際のトーナメントの慣例に合わせて、参加者の約 15% が入賞する形にしている。
 * 上位に寄せすぎると「9 人中 1 人しか嬉しくない」ゲームになり、
 * 平らにしすぎると勝つ意味が薄れる。下の配分はその折衷。
 */
export function payoutStructure(players: number): number[] {
  if (players <= 2) return [1.0];
  if (players <= 5) return [0.65, 0.35];
  if (players <= 9) return [0.5, 0.3, 0.2];
  if (players <= 18) return [0.4, 0.25, 0.16, 0.11, 0.08];
  if (players <= 45) return [0.3, 0.2, 0.135, 0.1, 0.075, 0.06, 0.05, 0.04, 0.04];

  const paid = Math.max(9, Math.round(players * 0.15));
  const weights: number[] = [];
  for (let i = 0; i < paid; i++) weights.push(1 / Math.pow(i + 1, 0.9));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

// ---------------------------------------------------------------------------

export interface TournamentHooks {
  /** 賞金の支払い。ウォレットへの入金はここで行う */
  payPrize(userId: string, amount: number, ref: string): void;
  /** 参加費の徴収。残高が足りなければ false */
  collectEntry(userId: string, amount: number, ref: string): boolean;
  /** 参加者へ通知を送る */
  notify(userId: string, msg: ServerMessage): void;
  onEntered?(userId: string): void;
}

export class Tournament {
  readonly cfg: Required<Omit<TournamentConfig, 'scheduledStart'>> & { scheduledStart: number | null };
  state: TournamentState = 'registering';
  private entrants = new Map<string, Entrant>();
  private tables = new Map<string, Room>();
  private levelIndex = 0;
  /** 現在のレベルが始まった時刻。「次のレベルまで残り何秒」の計算に使う(第107弾) */
  private levelStartedAt = 0;
  private startedAt: number | null = null;
  private timers: unknown[] = [];
  private nextTableSeq = 1;
  /** 脱落者を後ろから順に積む。最後に反転して順位にする */
  private eliminationOrder: string[] = [];
  private prizePool = 0;
  private tableCounter = 0;
  private ftBonusGranted = false;
  readonly bounty: BountyPool;
  /** 撃墜の記録（表示・検証用） */
  private bountyLog: BountyAward[] = [];

  constructor(
    cfg: TournamentConfig,
    private io: RoomIO,
    private bank: RoomBank,
    private hooks: TournamentHooks,
    private clock: Scheduler = realScheduler,
  ) {
    this.cfg = {
      minPlayers: cfg.type === 'sng' ? cfg.maxPlayers : 4,
      levels: standardBlindLevels(Math.max(20, Math.round(cfg.startingStack / 100))),
      levelDurationMs: 5 * 60 * 1000,
      lateRegMs: cfg.type === 'mtt' ? 10 * 60 * 1000 : 0,
      scheduledStart: cfg.scheduledStart ?? null,
      bounty: cfg.bounty ?? { mode: 'none', perEntry: 0 },
      reEntryMax: cfg.reEntryMax ?? 0,
      addOn: cfg.addOn ?? null,
      speed: cfg.speed ?? 'normal',
      ...cfg,
    } as Tournament['cfg'];

    // 速度設定はレベルの長さに掛ける。ターボ＝2.5倍速、ハイパー＝5倍速
    const factor = SPEED_FACTOR[this.cfg.speed ?? 'normal'];
    this.cfg.levelDurationMs = Math.max(1000, Math.round(this.cfg.levelDurationMs * factor));

    this.bounty = new BountyPool(this.cfg.bounty ?? { mode: 'none', perEntry: 0 });
  }

  /** 1 エントリーの総額（参加費 + 賞金首 + 手数料） */
  get entryCost(): number {
    return this.cfg.buyIn + this.bounty.perEntry + this.cfg.fee;
  }

  // -------------------------------------------------------------------------
  // 参加登録
  // -------------------------------------------------------------------------

  register(userId: string, name: string): ErrorCode | null {
    if (this.state === 'finished' || this.state === 'cancelled') return 'ILLEGAL_ACTION';

    const existing = this.entrants.get(userId);
    if (existing) {
      // 脱落済みで、リエントリーが残っていて、レイトレジ期間内ならもう一度参加できる
      if (existing.eliminatedAt === null) return 'ALREADY_SEATED';
      return this.reEntry(existing);
    }
    if (this.entrantCount() >= this.cfg.maxPlayers) return 'SEAT_TAKEN';

    // レイトレジの締切を過ぎていたら受け付けない
    if (this.state === 'running' && !this.inLateRegWindow()) return 'ILLEGAL_ACTION';

    if (!this.hooks.collectEntry(userId, this.entryCost, `tournament:${this.cfg.tournamentId}`)) {
      return 'INSUFFICIENT_FUNDS';
    }
    this.prizePool += this.cfg.buyIn;
    this.bounty.addEntry(userId);

    this.entrants.set(userId, {
      userId,
      name,
      tableId: null,
      stack: this.cfg.startingStack,
      finishPosition: null,
      prize: 0,
      eliminatedAt: null,
      reEntries: 0,
      addOnUsed: false,
      knockouts: 0,
    });
    this.hooks.onEntered?.(userId);

    if (this.state === 'running') {
      this.seatLateEntrant(userId);
    } else if (this.entrantCount() >= this.cfg.minPlayers && this.shouldAutoStart()) {
      this.start();
    }
    this.broadcast();
    return null;
  }

  /**
   * リエントリー。脱落した人が、もう一度参加費を払って新しいスタックで戻る。
   *
   * 注意：リエントリーは賞金プールもバウンティプールも増やす。
   * 「1 人が複数の賞金首を持つ」ことになるので、会計は必ず addEntry を通す。
   */
  private reEntry(e: Entrant): ErrorCode | null {
    if (this.cfg.reEntryMax <= 0) return 'ILLEGAL_ACTION';
    if (e.reEntries >= this.cfg.reEntryMax) return 'ILLEGAL_ACTION';
    if (this.state !== 'running' || !this.inLateRegWindow()) return 'ILLEGAL_ACTION';

    if (!this.hooks.collectEntry(e.userId, this.entryCost, `tournament_reentry:${this.cfg.tournamentId}`)) {
      return 'INSUFFICIENT_FUNDS';
    }
    this.prizePool += this.cfg.buyIn;
    this.bounty.addEntry(e.userId);

    e.reEntries++;
    e.eliminatedAt = null;
    e.finishPosition = null;
    e.stack = this.cfg.startingStack;
    // 脱落記録から外す。順位は「最後に飛んだとき」で決まる
    const idx = this.eliminationOrder.lastIndexOf(e.userId);
    if (idx >= 0) this.eliminationOrder.splice(idx, 1);

    this.seatLateEntrant(e.userId);
    this.broadcast();
    return null;
  }

  /**
   * アドオン。レイトレジ終了のタイミングで 1 度だけチップを買い足せる。
   * 買った分は賞金プールにも入る（現実の大会と同じ）。
   */
  addOn(userId: string): ErrorCode | null {
    const cfg = this.cfg.addOn;
    if (!cfg) return 'ILLEGAL_ACTION';
    const e = this.entrants.get(userId);
    if (!e || e.eliminatedAt !== null) return 'NOT_SEATED';
    if (e.addOnUsed) return 'ILLEGAL_ACTION';
    // アドオンはレイトレジ期間内のみ（現実の大会では休憩時間だけ）
    if (this.state !== 'running' || !this.inLateRegWindow()) return 'ILLEGAL_ACTION';
    if (!this.hooks.collectEntry(userId, cfg.price, `tournament_addon:${this.cfg.tournamentId}`)) {
      return 'INSUFFICIENT_FUNDS';
    }
    this.prizePool += cfg.price;
    e.addOnUsed = true;

    const room = e.tableId ? this.tables.get(e.tableId) : undefined;
    if (room) room.addChips(userId, cfg.chips);
    e.stack += cfg.chips;
    this.broadcast();
    return null;
  }

  private inLateRegWindow(): boolean {
    if (this.state === 'registering') return true;
    if (this.startedAt === null) return false;
    return this.clock.now() - this.startedAt <= this.cfg.lateRegMs;
  }

  /** 実人数（リエントリーを 1 人として数える） */
  private entrantCount(): number {
    return this.entrants.size;
  }

  /** 総エントリー数（リエントリーを含む）。賞金の入賞人数計算に使う */
  private totalEntries(): number {
    let n = 0;
    for (const e of this.entrants.values()) n += 1 + e.reEntries;
    return n;
  }

  unregister(userId: string): ErrorCode | null {
    if (this.state !== 'registering') return 'ILLEGAL_ACTION';
    const e = this.entrants.get(userId);
    if (!e) return 'NOT_SEATED';
    this.entrants.delete(userId);
    this.prizePool -= this.cfg.buyIn;
    this.hooks.payPrize(userId, this.entryCost, `tournament_refund:${this.cfg.tournamentId}`);
    this.broadcast();
    return null;
  }

  private shouldAutoStart(): boolean {
    if (this.cfg.type === 'sng') return this.entrantCount() >= this.cfg.maxPlayers;
    if (this.cfg.scheduledStart === null) return this.entrantCount() >= this.cfg.minPlayers;
    return this.clock.now() >= this.cfg.scheduledStart;
  }

  // -------------------------------------------------------------------------
  // 開始と卓の割り当て
  // -------------------------------------------------------------------------

  start(): void {
    if (this.state !== 'registering') return;
    if (this.entrants.size < 2) return;

    this.state = 'running';
    this.startedAt = this.clock.now();
    this.levelIndex = 0;
    this.levelStartedAt = this.clock.now();

    // 席順はランダム。事前に並びが分かると結託の余地が生まれる
    const players = [...this.entrants.values()];
    shuffleInPlace(players, () => Math.random());

    const tableCount = Math.max(1, Math.ceil(players.length / this.cfg.seatsPerTable));
    for (let i = 0; i < tableCount; i++) this.createTable();

    const tableList = [...this.tables.values()];
    players.forEach((p, i) => {
      const room = tableList[i % tableList.length];
      const seat = room.seatDirect(p.userId, p.name, this.cfg.startingStack);
      if (seat !== null) p.tableId = room.cfg.tableId;
    });

    this.scheduleLevelTimer();
    for (const r of this.tables.values()) r.maybeStartHand();
    this.broadcast();
  }

  /** コスメ（ニックネーム・ブレスレット）を全卓に反映 */
  setStyle(userId: string, name: string | undefined, bracelet: string | null | undefined): void {
    for (const r of this.tables.values()) r.setStyle(userId, name, bracelet);
  }

  private createTable(): Room {
    const tableId = `${this.cfg.tournamentId}-t${this.nextTableSeq++}`;
    const level = this.currentLevel();
    const cfg: TableConfig = {
      tableId,
      name: `${this.cfg.name} 卓${this.tableCounter + 1}`,
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
      maxSeats: this.cfg.seatsPerTable,
      mode: 'tournament',
      blindsProvider: () => {
        const l = this.currentLevel();
        return { smallBlind: l.smallBlind, bigBlind: l.bigBlind, ante: l.ante };
      },
      // アクション時間はキャッシュ卓と同じ一律60秒(ACTION_MS)。
      // ファイナルテーブル到達時だけ grantTimeBank で予備時間を配る
      seedWindowMs: 800,
      handIntervalMs: 1800,
    };
    this.tableCounter++;
    const room = new Room(cfg, this.io, this.bank, this.clock);
    room.hooks.onSettled = (r, busted) => this.onTableSettled(r, busted);
    this.tables.set(tableId, room);
    return room;
  }

  private seatLateEntrant(userId: string): void {
    const e = this.entrants.get(userId);
    if (!e) return;
    // 最も人数の少ない卓へ入れる
    const target = [...this.tables.values()].sort((a, b) => a.seatedCount - b.seatedCount)[0];
    if (!target || target.seatedCount >= this.cfg.seatsPerTable) {
      const room = this.createTable();
      room.seatDirect(userId, e.name, this.cfg.startingStack);
      e.tableId = room.cfg.tableId;
      room.maybeStartHand();
      return;
    }
    target.seatDirect(userId, e.name, this.cfg.startingStack);
    e.tableId = target.cfg.tableId;
    target.maybeStartHand();
  }

  // -------------------------------------------------------------------------
  // レベル進行
  // -------------------------------------------------------------------------

  currentLevel(): BlindLevel {
    return this.cfg.levels[Math.min(this.levelIndex, this.cfg.levels.length - 1)];
  }

  private scheduleLevelTimer(): void {
    this.timers.push(
      this.clock.setTimeout(() => {
        if (this.state !== 'running') return;
        this.levelIndex = Math.min(this.levelIndex + 1, this.cfg.levels.length - 1);
        this.levelStartedAt = this.clock.now();
        const l = this.currentLevel();
        for (const r of this.tables.values()) r.setBlinds({ smallBlind: l.smallBlind, bigBlind: l.bigBlind, ante: l.ante });
        this.broadcast();
        this.scheduleLevelTimer();
      }, this.cfg.levelDurationMs),
    );
  }

  // -------------------------------------------------------------------------
  // 脱落と卓の再編成
  // -------------------------------------------------------------------------

  private onTableSettled(room: Room, busted: BustInfo[]): void {
    if (this.state !== 'running') return;

    // 1) 脱落処理。同一ハンドで複数人が飛んだ場合は、スタックが大きかった方を上位にする
    //    （実際のトーナメントの慣例。開始スタックが同じなら同着扱いだが、ここでは簡単のため
    //     ハンド開始時のスタック順で決める）
    if (busted.length > 0) {
      // ハンド開始時のスタックが少なかった方を先に脱落した扱いにする（実際の大会の慣例）
      const ordered = [...busted].sort((a, b) => a.stackAtStart - b.stackAtStart);
      for (const b of ordered) {
        const e = this.entrants.get(b.userId);
        if (!e || e.eliminatedAt !== null) continue;
        room.removeDirect(b.userId);
        e.tableId = null;
        e.stack = 0;
        e.eliminatedAt = this.clock.now();
        this.eliminationOrder.push(b.userId);

        // バウンティ：撃墜した側へ支払う
        if (this.bounty.isActive) {
          const awards = this.bounty.knockoutSplit(b.eliminatedBy, b.userId);
          for (const a of awards) {
            this.bountyLog.push(a);
            const killer = this.entrants.get(a.winnerId);
            if (killer) killer.knockouts++;
            if (a.cash > 0) {
              this.hooks.payPrize(a.winnerId, a.cash, `bounty:${this.cfg.tournamentId}`);
            }
          }
        }
      }
    }

    // 2) 生存者のスタックを更新（表示とバランス判断に使う）
    for (const r of this.tables.values()) {
      for (const p of r.playersInSeats()) {
        const e = this.entrants.get(p.userId);
        if (e) e.stack = p.stack;
      }
    }

    // 3) ミステリーバウンティの有効化判定（残り人数が閾値を切ったら）
    const aliveNow = this.aliveEntrants();
    if (this.bounty.shouldActivateMystery(aliveNow.length, this.totalEntries())) {
      // 封筒の並びは配牌と同じ仕組みでコミットする。
      // 有効化した瞬間のプール額と残り人数で束を作り、以降は引くだけ
      this.bounty.activateMystery(aliveNow.length, `${this.cfg.tournamentId}:${aliveNow.length}`);
    }

    // 4) 終了判定
    const alive = this.aliveEntrants();
    if (alive.length <= 1) {
      this.finish();
      return;
    }

    // 5) 卓の再編成
    this.rebalance();
    this.broadcast();
  }

  private aliveEntrants(): Entrant[] {
    return [...this.entrants.values()].filter((e) => e.eliminatedAt === null);
  }

  /**
   * 卓のバランス調整。
   *
   *   ステップ 1: 卓をまとめられるなら潰す（テーブルブレイク）
   *   ステップ 2: 卓間の人数差が 2 以上なら 1 人動かす
   *
   * 動かす人数を最小にするのが原則。プレイヤーにとって卓移動は不快なので、
   * 「差が 2 以上」になるまで動かさない（1 の差は許容する）のが標準的な運用です。
   */
  private rebalance(): void {
    const tables = [...this.tables.values()].filter((t) => t.seatedCount > 0);
    const alive = tables.reduce((a, t) => a + t.seatedCount, 0);
    const capacity = this.cfg.seatsPerTable;

    // --- テーブルブレイク ---
    // 1 卓減らしても全員座れるなら、最も人数の少ない卓を解散させる
    if (tables.length > 1 && alive <= (tables.length - 1) * capacity) {
      const sorted = [...tables].sort((a, b) => a.seatedCount - b.seatedCount);
      const victim = sorted[0];
      const others = sorted.slice(1);

      for (const p of victim.playersInSeats()) {
        const stack = victim.removeDirect(p.userId);
        if (stack === null) continue;
        // 空きのある卓のうち、最も人数が少ないところへ
        const target = others.filter((t) => t.seatedCount < capacity).sort((a, b) => a.seatedCount - b.seatedCount)[0];
        if (!target) break;
        target.seatDirect(p.userId, p.name, stack);
        const e = this.entrants.get(p.userId);
        if (e) e.tableId = target.cfg.tableId;
      }
      if (victim.seatedCount === 0) {
        victim.dispose();
        this.tables.delete(victim.cfg.tableId);
      }
      // ファイナルテーブル成立: タイムバンク +90秒(WPT/Tritonの FT ボーナスに相当)
      if (!this.ftBonusGranted && this.tables.size === 1) {
        this.ftBonusGranted = true;
        for (const t of this.tables.values()) t.grantTimeBank(90_000);
      }
      for (const t of this.tables.values()) t.maybeStartHand();
      return;
    }

    // --- 人数差の均し ---
    if (tables.length < 2) return;
    const sorted = [...tables].sort((a, b) => b.seatedCount - a.seatedCount);
    const big = sorted[0];
    const small = sorted[sorted.length - 1];
    if (big.seatedCount - small.seatedCount >= 2) {
      const movers = big.playersInSeats();
      const mover = movers[movers.length - 1];
      const stack = big.removeDirect(mover.userId);
      if (stack !== null) {
        small.seatDirect(mover.userId, mover.name, stack);
        const e = this.entrants.get(mover.userId);
        if (e) e.tableId = small.cfg.tableId;
      }
    }
    for (const t of this.tables.values()) t.maybeStartHand();
  }

  // -------------------------------------------------------------------------
  // 終了と賞金
  // -------------------------------------------------------------------------

  private finish(): void {
    if (this.state !== 'running') return;
    this.state = 'finished';
    for (const t of this.timers) this.clock.clearTimeout(t);
    this.timers = [];

    const alive = this.aliveEntrants();
    // 生存者（通常 1 人）を優勝として最後に積む
    for (const e of alive) this.eliminationOrder.push(e.userId);

    // 脱落順の逆が最終順位
    const ranking = [...this.eliminationOrder].reverse();
    const structure = payoutStructure(this.totalEntries());

    // 優勝者のバウンティ処理（PKO なら自分の賞金首を回収、ミステリーなら封筒を 1 枚引く）
    const championId = ranking[0];
    if (this.bounty.isActive && championId) {
      const award = this.bounty.finish(championId);
      if (award) {
        this.bountyLog.push(award);
        this.hooks.payPrize(championId, award.cash, `bounty_final:${this.cfg.tournamentId}`);
      }
      // 使われずに残ったバウンティ（誰の手柄でもない脱落など）は優勝者へ
      const leftover = this.bounty.sweepRemainder();
      if (leftover > 0 && championId) {
        this.hooks.payPrize(championId, leftover, `bounty_leftover:${this.cfg.tournamentId}`);
      }
    }

    // 端数は 1 位に寄せる（配分の合計がプールと必ず一致するようにする）
    let distributed = 0;
    ranking.forEach((userId, i) => {
      const e = this.entrants.get(userId);
      if (!e) return;
      e.finishPosition = i + 1;
      const share = structure[i] ?? 0;
      const prize = i === 0 ? 0 : Math.floor(this.prizePool * share);
      e.prize = prize;
      distributed += prize;
    });
    const champion = this.entrants.get(ranking[0]);
    if (champion) champion.prize = this.prizePool - distributed;

    for (const e of this.entrants.values()) {
      if (e.prize > 0) this.hooks.payPrize(e.userId, e.prize, `tournament_prize:${this.cfg.tournamentId}`);
    }

    // 卓上のチップは「順位を決めるための点数」であって通貨ではない。
    // 大会が終わったら回収する（残しておくと総量の監査で二重計上になる）
    for (const t of this.tables.values()) {
      for (const p of t.playersInSeats()) t.removeDirect(p.userId);
      t.dispose();
    }
    for (const e of this.entrants.values()) e.tableId = null;
    this.broadcast();
  }

  /** 開催中止（人数不足など）。参加費を全額返す */
  cancel(): void {
    if (this.state === 'finished' || this.state === 'cancelled') return;
    this.state = 'cancelled';
    for (const t of this.timers) this.clock.clearTimeout(t);
    for (const e of this.entrants.values()) {
      const refund = this.entryCost * (1 + e.reEntries) + (e.addOnUsed && this.cfg.addOn ? this.cfg.addOn.price : 0);
      this.hooks.payPrize(e.userId, refund, `tournament_refund:${this.cfg.tournamentId}`);
    }
    for (const t of this.tables.values()) t.dispose();
    this.tables.clear();
    this.broadcast();
  }

  // -------------------------------------------------------------------------
  // 表示用
  // -------------------------------------------------------------------------

  view(userId?: string): TournamentView {
    const alive = this.aliveEntrants();
    const sorted = [...alive].sort((a, b) => b.stack - a.stack);
    const me = userId ? this.entrants.get(userId) : undefined;
    const paidPlaces = payoutStructure(this.totalEntries()).length;
    const level = this.currentLevel();

    const chest = this.bounty.mysteryChest;
    return {
      tournamentId: this.cfg.tournamentId,
      name: this.cfg.name,
      type: this.cfg.type,
      bountyMode: this.bounty.mode,
      speed: this.cfg.speed ?? 'normal',
      state: this.state,
      buyIn: this.cfg.buyIn,
      fee: this.cfg.fee,
      prizePool: this.prizePool,
      startsAt: this.cfg.scheduledStart,
      minPlayers: this.cfg.minPlayers,
      reEntryMax: this.cfg.reEntryMax,
      hasAddOn: !!this.cfg.addOn,
      startsWhen: this.cfg.type === 'sng' ? `${this.cfg.maxPlayers}人集まり次第` : '定刻',
      bounty: {
        mode: this.bounty.mode,
        perEntry: this.bounty.perEntry,
        pool: this.bounty.poolTotal,
        yourBounty: me ? this.bounty.bountyOf(me.userId) : 0,
        yourEarned: me ? this.bounty.earnedBy(me.userId) : 0,
        yourKnockouts: me?.knockouts ?? 0,
        active: this.bounty.mode !== 'mystery' ? this.bounty.isActive : this.bounty.mysteryActive,
        remainingEnvelopes: chest ? chest.remainingAmounts() : [],
        commitment: chest?.commitment ?? null,
        serverSeed: this.state === 'finished' && chest ? chest.reveal().serverSeed : null,
        recent: this.bountyLog.slice(-8).map((a) => ({
          winner: this.entrants.get(a.winnerId)?.name ?? a.winnerId,
          victim: this.entrants.get(a.victimId)?.name ?? a.victimId,
          cash: a.cash,
          label: a.envelope?.label ?? null,
        })),
      },
      reEntriesLeft: me ? Math.max(0, this.cfg.reEntryMax - me.reEntries) : this.cfg.reEntryMax,
      addOnAvailable: !!this.cfg.addOn && !!me && !me.addOnUsed && me.eliminatedAt === null && this.inLateRegWindow(),
      addOnPrice: this.cfg.addOn?.price ?? 0,
      addOnChips: this.cfg.addOn?.chips ?? 0,
      lateRegOpen: this.inLateRegWindow(),
      entrants: this.entrants.size,
      maxPlayers: this.cfg.maxPlayers,
      remaining: alive.length,
      level: level.level,
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
      ante: level.ante,
      isBreak: !!level.isBreak,
      // 次のレベルまでの残り時間と、上がった後のブラインド(第107弾)。
      // 最終レベルに到達していたら null(もう上がらない)
      nextLevelInMs:
        this.state === 'running' && this.levelIndex < this.cfg.levels.length - 1
          ? Math.max(0, this.cfg.levelDurationMs - (this.clock.now() - this.levelStartedAt))
          : null,
      nextSmallBlind: this.levelIndex < this.cfg.levels.length - 1
        ? this.cfg.levels[this.levelIndex + 1].smallBlind : null,
      nextBigBlind: this.levelIndex < this.cfg.levels.length - 1
        ? this.cfg.levels[this.levelIndex + 1].bigBlind : null,
      nextAnte: this.levelIndex < this.cfg.levels.length - 1
        ? (this.cfg.levels[this.levelIndex + 1].ante ?? 0) : null,
      levelDurationMs: this.cfg.levelDurationMs,
      averageStack: alive.length ? Math.round(alive.reduce((a, e) => a + e.stack, 0) / alive.length) : 0,
      paidPlaces,
      payouts: payoutStructure(this.totalEntries()).map((p, i) => ({
        place: i + 1,
        amount: Math.floor(this.prizePool * p),
      })),
      yourTableId: me?.tableId ?? null,
      yourStack: me?.stack ?? null,
      yourRank: me ? sorted.findIndex((e) => e.userId === me.userId) + 1 || null : null,
      yourFinishPosition: me?.finishPosition ?? null,
      yourPrize: me?.prize ?? null,
      registered: !!me,
      leaderboard: sorted.slice(0, 10).map((e, i) => ({ rank: i + 1, name: e.name, stack: e.stack })),
    };
  }

  /** スケジュール開始のティック。定刻を過ぎていて2人以上いれば開始する(botが下限を担保する) */
  tickSchedule(): void {
    if (this.state !== 'registering') return;
    if (this.cfg.scheduledStart === null) return;
    if (this.clock.now() < this.cfg.scheduledStart) return;
    if (this.entrantCount() < Math.max(2, this.cfg.minPlayers)) return;
    this.start();
  }

  summary(): TournamentSummaryView {
    return {
      minPlayers: this.cfg.minPlayers,
      startsAt: this.cfg.scheduledStart,
      lateRegOpen: this.inLateRegWindow(),
      reEntryMax: this.cfg.reEntryMax,
      hasAddOn: !!this.cfg.addOn,
      tournamentId: this.cfg.tournamentId,
      name: this.cfg.name,
      type: this.cfg.type,
      bountyMode: this.bounty.mode,
      speed: this.cfg.speed ?? 'normal',
      state: this.state,
      buyIn: this.cfg.buyIn,
      fee: this.cfg.fee,
      entrants: this.entrants.size,
      maxPlayers: this.cfg.maxPlayers,
      remaining: this.aliveEntrants().length,
      prizePool: this.prizePool,
      startsWhen: this.cfg.type === 'sng' ? `${this.cfg.maxPlayers}人集まり次第` : '定刻',
    };
  }

  private broadcast(): void {
    for (const e of this.entrants.values()) {
      this.hooks.notify(e.userId, { t: 'tournament.state', view: this.view(e.userId) });
    }
  }

  getTable(tableId: string): Room | undefined {
    return this.tables.get(tableId);
  }
  allTables(): Room[] {
    return [...this.tables.values()];
  }
  isRegistered(userId: string): boolean {
    return this.entrants.has(userId);
  }
  tableOf(userId: string): string | null {
    return this.entrants.get(userId)?.tableId ?? null;
  }
  dispose(): void {
    for (const t of this.timers) this.clock.clearTimeout(t);
    for (const t of this.tables.values()) t.dispose();
  }
}

function shuffleInPlace<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
