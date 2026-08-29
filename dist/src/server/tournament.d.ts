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
import { Room, type RoomIO, type RoomBank, type Scheduler } from './room.js';
import { BountyPool, type BountyConfig } from './bounty.js';
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
    /** バウンティ（賞金首）。参加費とは別に perEntry がバウンティプールへ入る */
    bounty?: BountyConfig;
    /**
     * リエントリー上限。0 ならフリーズアウト。
     * 脱落してもレイトレジ期間内なら、もう一度参加費を払って新しいスタックで戻れる。
     */
    reEntryMax?: number;
    /** アドオン。レイトレジ終了時に 1 度だけ買えるチップ */
    addOn?: {
        price: number;
        chips: number;
    };
    /** 進行速度。レベルの長さを倍率で調整する */
    speed?: 'normal' | 'turbo' | 'hyper';
}
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
/**
 * 標準的なブラインド構造を生成する。
 * 1 レベルあたり約 1.4〜1.5 倍で上げるのが定番で、これより急だと運ゲーになり、
 * 緩いと終わらない。アンティはレベル 4 以降に入れて中盤以降のポットを膨らませる。
 */
export declare function standardBlindLevels(startingBb: number, count?: number): BlindLevel[];
/**
 * 入賞人数と配分を決める。
 *
 * 実際のトーナメントの慣例に合わせて、参加者の約 15% が入賞する形にしている。
 * 上位に寄せすぎると「9 人中 1 人しか嬉しくない」ゲームになり、
 * 平らにしすぎると勝つ意味が薄れる。下の配分はその折衷。
 */
export declare function payoutStructure(players: number): number[];
export interface TournamentHooks {
    /** 賞金の支払い。ウォレットへの入金はここで行う */
    payPrize(userId: string, amount: number, ref: string): void;
    /** 参加費の徴収。残高が足りなければ false */
    collectEntry(userId: string, amount: number, ref: string): boolean;
    /** 参加者へ通知を送る */
    notify(userId: string, msg: ServerMessage): void;
    onEntered?(userId: string): void;
}
export declare class Tournament {
    private io;
    private bank;
    private hooks;
    private clock;
    readonly cfg: Required<Omit<TournamentConfig, 'scheduledStart'>> & {
        scheduledStart: number | null;
    };
    state: TournamentState;
    private entrants;
    private tables;
    private levelIndex;
    /** 現在のレベルが始まった時刻。「次のレベルまで残り何秒」の計算に使う(第107弾) */
    private levelStartedAt;
    private startedAt;
    private timers;
    private nextTableSeq;
    /** 脱落者を後ろから順に積む。最後に反転して順位にする */
    private eliminationOrder;
    private prizePool;
    private tableCounter;
    private ftBonusGranted;
    readonly bounty: BountyPool;
    /** 撃墜の記録（表示・検証用） */
    private bountyLog;
    constructor(cfg: TournamentConfig, io: RoomIO, bank: RoomBank, hooks: TournamentHooks, clock?: Scheduler);
    /** 1 エントリーの総額（参加費 + 賞金首 + 手数料） */
    get entryCost(): number;
    register(userId: string, name: string): ErrorCode | null;
    /**
     * リエントリー。脱落した人が、もう一度参加費を払って新しいスタックで戻る。
     *
     * 注意：リエントリーは賞金プールもバウンティプールも増やす。
     * 「1 人が複数の賞金首を持つ」ことになるので、会計は必ず addEntry を通す。
     */
    private reEntry;
    /**
     * アドオン。レイトレジ終了のタイミングで 1 度だけチップを買い足せる。
     * 買った分は賞金プールにも入る（現実の大会と同じ）。
     */
    addOn(userId: string): ErrorCode | null;
    private inLateRegWindow;
    /** 実人数（リエントリーを 1 人として数える） */
    private entrantCount;
    /** 総エントリー数（リエントリーを含む）。賞金の入賞人数計算に使う */
    private totalEntries;
    unregister(userId: string): ErrorCode | null;
    private shouldAutoStart;
    start(): void;
    /** コスメ（ニックネーム・ブレスレット）を全卓に反映 */
    setStyle(userId: string, name: string | undefined, bracelet: string | null | undefined): void;
    private createTable;
    private seatLateEntrant;
    currentLevel(): BlindLevel;
    private scheduleLevelTimer;
    private onTableSettled;
    private aliveEntrants;
    /**
     * 卓のバランス調整。
     *
     *   ステップ 1: 卓をまとめられるなら潰す（テーブルブレイク）
     *   ステップ 2: 卓間の人数差が 2 以上なら 1 人動かす
     *
     * 動かす人数を最小にするのが原則。プレイヤーにとって卓移動は不快なので、
     * 「差が 2 以上」になるまで動かさない（1 の差は許容する）のが標準的な運用です。
     */
    private rebalance;
    private finish;
    /** 開催中止（人数不足など）。参加費を全額返す */
    cancel(): void;
    view(userId?: string): TournamentView;
    /** スケジュール開始のティック。定刻を過ぎていて2人以上いれば開始する(botが下限を担保する) */
    tickSchedule(): void;
    summary(): TournamentSummaryView;
    private broadcast;
    getTable(tableId: string): Room | undefined;
    allTables(): Room[];
    isRegistered(userId: string): boolean;
    tableOf(userId: string): string | null;
    dispose(): void;
}
