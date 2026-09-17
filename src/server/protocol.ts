/**
 * クライアント ↔ サーバー のプロトコル定義
 *
 * 設計方針：
 *   1. サーバーは常に権威。クライアントは「意図」を送るだけで、結果は必ずサーバーが決める。
 *      クライアントが送るのは「フォールドしたい」であって「私はフォールドした」ではない。
 *   2. 状態はスナップショット送信を基本にする。差分同期は速いが、1 個のイベントを取りこぼすと
 *      永久にズレたままになり、しかもそれに気づけない。ポーカーの通信量なら全量送って問題ない。
 *   3. 送るのは「その席から見える状態」だけ。他人のホールカードはサーバーから出さない。
 *   4. すべてのメッセージに v（プロトコル版）を持たせる。クライアント更新は必ず遅れるので、
 *      版が違うことを検出できないと原因不明の不具合になる。
 */

import type { ActionType, LegalAction, Street } from '../table.js';
import type { HandEvent } from '../table.js';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// クライアント → サーバー
// ---------------------------------------------------------------------------

export type ClientMessage =
  /** 接続直後の認証。resumeToken があれば以前のセッションを引き継ぐ */
  | { t: 'hello'; v: number; userId?: string; name?: string; resumeToken?: string }
  /** ロビーのテーブル一覧を要求 */
  | { t: 'lobby.list' }
  | { t: 'table.create'; bigBlind: number; maxSeats: number; name?: string }
  | { t: 'code.redeem'; code: string }
  | { t: 'ledger.get' }
  /** テーブルに入室（観戦者として）*/
  | { t: 'table.watch'; tableId: string }
  /** 退室 */
  | { t: 'table.leave'; tableId: string }
  /** 着席。seat 省略なら空席へ自動割当 */
  | { t: 'table.sit'; tableId: string; seat?: number; buyIn: number }
  /** 離席（チップを持って卓を降りる） */
  | { t: 'table.stand'; tableId: string }
  /** 次のハンドを待機（Sit Out の解除／設定） */
  | { t: 'table.sitOut'; tableId: string; sitOut: boolean }
  /** チップの追加購入（トップオフ） */
  | { t: 'table.rebuy'; tableId: string; amount: number }
  /** アクション。handId を必ず添えて、古いハンドへの遅延アクションを弾く */
  | { t: 'hand.act'; tableId: string; handId: string; action: ActionType; toAmount?: number }
  /** クライアントシードの提出。コミットメント公開後・配牌前の窓でのみ受け付ける */
  | { t: 'fair.seed'; tableId: string; seed: string }
  /** 死活確認 */
  | { t: 'ping'; ts: number }
  // --- トーナメント ---
  | { t: 'tour.list' }
  | { t: 'tour.watch'; tournamentId: string }
  | { t: 'tour.register'; tournamentId: string }
  | { t: 'tour.unregister'; tournamentId: string }
  | { t: 'tour.addon'; tournamentId: string }
  /** ストラドルの予約（次に UTG になったハンドで自動的に置く） */
  | { t: 'table.straddle'; tableId: string; enabled: boolean }
  // --- 経済 ---
  | { t: 'shop.list' }
  | { t: 'shop.purchase'; sku: string; receipt: string }
  | { t: 'daily.claim' }
  | { t: 'mission.claim'; missionId: string }
  | { t: 'pass.claim' }
  | { t: 'profile.get' }
  // --- ゴールドスロット ---
  | { t: 'slot.state' }
  | { t: 'slot.spin'; bet: number; ante?: boolean; mode?: 'many' | 'few' }
  /** 2台目「WINNING TUNNEL」(第161弾)。台を増やせるよう slot とは別のメッセージにした */
  | { t: 'tunnel.spin'; bet: number }
  /** ダブルダウン。half=true ならハーフ(半分を確保)。pick はめくる前に選ぶリール(0〜2) */
  | { t: 'tunnel.double'; half?: boolean; pick?: number }
  /** ダブル開始。ディーラーだけ先に決めて見せる(第168弾) */
  | { t: 'tunnel.double.deal'; half?: boolean }
  /** 回っている3本から1本を選ぶ。勝敗はここで確定する */
  | { t: 'tunnel.double.pick'; pick?: number }
  /** ダブルをやめて獲得を確定する */
  | { t: 'tunnel.collect' }
  | { t: 'baccarat.deal'; bets: { p: number; b: number; tie: number }; declare?: 'H' | 'L' }
  // --- 引き継ぎ(端末を変えてもアカウントを持ち出すため) ---
  | { t: 'transfer.issue' }
  | { t: 'transfer.redeem'; code: string; pin: string }
  /** ニックネーム変更・ブレスレット装着（コスメ） */
  | { t: 'user.style'; name?: string; bracelet?: string | null };

// ---------------------------------------------------------------------------
// サーバー → クライアント
// ---------------------------------------------------------------------------

export interface LobbyTableInfo {
  tableId: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  seatedCount: number;
  watchingCount: number;
  minBuyIn: number;
  maxBuyIn: number;
  avgPot: number;
  handsPerHour: number;
}

export interface PublicSeatView {
  seat: number;
  userId: string | null;
  name: string | null;
  stack: number;
  streetBet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  lastAction: ActionType | null;
  /** 自分の席、またはショーダウンで公開された席のみ入る */
  holeCards: string[] | null;
  /** 手番のとき、残り思考時間（ms） */
  timeLeftMs: number | null;
  timeBankMs: number;
  /** 装着中のブレスレット（コスメ） */
  bracelet: string | null;
}

export interface TableStateView {
  tableId: string;
  name: string;
  handId: string | null;
  handNumber: number;
  street: Street | 'waiting';
  board: string[];
  pot: number;
  pots: Array<{ amount: number; eligible: number[] }>;
  currentBet: number;
  buttonIndex: number;
  actingSeat: number | null;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  seats: PublicSeatView[];
  /** この接続が座っている席。観戦中は null */
  yourSeat: number | null;
  /** ストラドルが許可されている卓か */
  straddleAllowed: boolean;
  /** 自分がストラドルを予約しているか */
  straddleArmed: boolean;
  /** 自分の手番のときだけ入る */
  legalActions: LegalAction[];
  /** 配牌前に公開されるコミットメント */
  fairness: {
    commitment: string | null;
    clientSeed: string | null;
    nonce: number | null;
    /** ハンド終了後にのみ入る */
    serverSeed: string | null;
    /** シード提出を受け付けている間だけ true */
    acceptingSeeds: boolean;
  };
  /** オールインの段階公開中だけ入る、各席の勝率・アウツ・首位（勝負がついていない席のみ） */
  revealStats?: RevealStat[];
  /** 見ている本人の現在の最強役（「ストレート」等）。ハンド中だけ入る */
  yourHand?: string | null;
  /** 自分の現在の勝率(0..1)。未知の相手へのモンテカルロ推定。ハンド中のみ */
  yourEquity?: number | null;
  /** 現在の手番の基本持ち時間(ms)。全卓一律60秒(ACTION_MS) */
  baseActionMs?: number;
  /**
   * 現在の手番に実際に与えられた総時間(ms)。残り時間バーの分母はこれを使う。
   * 通常は baseActionMs と同じだが、切断中の席(3秒)やタイムバンク付与時は変わる。
   */
  actionTotalMs?: number;
}

/** オールイン公開中に見せる、席ごとの勝率とアウツ */
export interface RevealStat {
  seat: number;
  /** 分け合いを考慮した取り分（0〜1） */
  equity: number;
  /** 次の 1 枚で単独首位になる札の枚数（首位の席は 0） */
  outs: number;
  /** いま首位か */
  leading: boolean;
}

export interface HandSummary {
  handId: string;
  handNumber: number;
  board: string[];
  pots: Array<{ amount: number; rake: number; winners: number[] }>;
  netChange: Record<number, number>;
  showdown: boolean;
  hands: Array<{
    seat: number;
    cards: string[];
    description: string;
    /** 役を構成した 5 枚。勝ち札をハイライトするために使う */
    best: string[];
  }>;
  fairness: {
    commitment: string;
    serverSeed: string;
    clientSeed: string;
    nonce: number;
    deck: string[];
  };
}

export interface TournamentSummaryView {
  /** 開始予定時刻(エポックms)。SNGなど非スケジュール制は null */
  startsAt?: number | null;
  /** レイトレジ受付中か */
  lateRegOpen?: boolean;
  /** リエントリー上限(0=フリーズアウト) */
  reEntryMax?: number;
  /** アドオンありか */
  hasAddOn?: boolean;
  /** 開催に必要な最低人数(MTT)。SNGは定員=開始人数 */
  minPlayers?: number;
  tournamentId: string;
  name: string;
  type: 'sng' | 'mtt';
  /** バウンティ方式（表示用） */
  bountyMode: 'none' | 'classic' | 'progressive' | 'mystery';
  speed: 'normal' | 'turbo' | 'hyper';
  state: 'registering' | 'running' | 'finished' | 'cancelled';
  buyIn: number;
  fee: number;
  entrants: number;
  maxPlayers: number;
  remaining: number;
  prizePool: number;
  startsWhen: string;
}

export interface BountyView {
  mode: 'none' | 'classic' | 'progressive' | 'mystery';
  /** 1 エントリーあたりの賞金首 */
  perEntry: number;
  pool: number;
  /** 自分の現在の賞金首（mystery では常に 0） */
  yourBounty: number;
  /** 自分がこれまでに獲得した賞金首の合計 */
  yourEarned: number;
  yourKnockouts: number;
  /** mystery: 封筒が有効になっているか */
  active: boolean;
  /** mystery: 残っている封筒の金額（降順） */
  remainingEnvelopes: number[];
  /** mystery: 封筒の並びのコミットメント */
  commitment: string | null;
  /** mystery: 終了後に開示されるシード */
  serverSeed: string | null;
  /** 直近の撃墜（演出用） */
  recent: Array<{ winner: string; victim: string; cash: number; label: string | null }>;
}

export interface TournamentView extends TournamentSummaryView {
  bounty: BountyView;
  /** リエントリー可能な残り回数（0 なら不可） */
  reEntriesLeft: number;
  /** アドオンが買えるか */
  addOnAvailable: boolean;
  addOnPrice: number;
  addOnChips: number;
  lateRegOpen: boolean;
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  isBreak: boolean;
  nextLevelInMs: number | null;
  /** 次のレベルのブラインド(最終レベルなら null)(第107弾) */
  nextSmallBlind?: number | null;
  nextBigBlind?: number | null;
  nextAnte?: number | null;
  /** 1レベルの長さ(ms)。カウントダウンの母数 */
  levelDurationMs?: number;
  averageStack: number;
  paidPlaces: number;
  payouts: Array<{ place: number; amount: number }>;
  yourTableId: string | null;
  yourStack: number | null;
  yourRank: number | null;
  yourFinishPosition: number | null;
  yourPrize: number | null;
  registered: boolean;
  leaderboard: Array<{ rank: number; name: string; stack: number }>;
}

export interface ShopView {
  chipPacks: Array<{ sku: string; name: string; priceJpy: number; chips: number; perYen: number }>;
  goldPacks: Array<{ sku: string; name: string; priceJpy: number; gold: number }>;
  offers: Array<{
    id: string;
    sku: string;
    name: string;
    description: string;
    priceJpy: number;
    reason: string;
    multiplier: number | null;
    expiresAt: number | null;
  }>;
  passPremium: { sku: string; name: string; priceJpy: number; owned: boolean };
  /** 現在の VIP ティアによる購入増量率(0.03 なら +3%)。購入確認画面での明示に使う */
  vipPurchaseBonus: number;
  /** 直近の購入履歴(新しい順)。「ちゃんと買えた」ことを見せるため */
  recentPurchases: Array<{ sku: string; name: string; priceJpy: number; at: number }>;
}

export interface ProfileView {
  userId: string;
  name: string;
  chips: number;
  gold: number;
  vip: {
    points: number;
    tier: string;
    tierName: string;
    perks: string[];
    purchaseBonus: number;
    dailyMultiplier: number;
    nextTierName: string | null;
    pointsToNext: number | null;
  };
  daily: { available: boolean; streak: number };
  missions: Array<{
    id: string;
    name: string;
    target: number;
    progress: number;
    rewardChips: number;
    rewardXp: number;
    claimed: boolean;
  }>;
  /** ウィークリーミッション(週ごとにリセット) */
  weekly: ProfileView['missions'];
  /** シーズンミッション(28日通しの長期目標) */
  seasonal: ProfileView['missions'];
  pass: {
    seasonId: string;
    xp: number;
    tier: number;
    premium: boolean;
    nextTierXp: number | null;
    claimable: boolean;
    /** 段階数と完走に必要な経験値 */
    tierCount: number;
    completeXp: number;
    /** シーズンの残り日数と終了時刻 */
    daysLeft: number;
    endsAt: number;
    /** 最終週(獲得経験値が増える) */
    finalWeek: boolean;
    /** 完走後の周回報酬 */
    boxesEarned: number;
    boxesClaimed: number;
    boxChips: number;
    /** 今プレミアムを買うと即時受け取れる内容(未購入のときだけ意味がある) */
    preview: { chips: number; gold: number; tiers: number };
  };
  piggyBank: number;
  /** 引き継ぎコードを発行済みか。未発行なら警告を出して発行を促す */
  hasTransferCode: boolean;
}

export type ServerMessage =
  | { t: 'hello.ok'; v: number; userId: string; name: string; resumeToken: string; balance: number; gold: number; resumed: boolean }
  | { t: 'lobby.tables'; tables: LobbyTableInfo[] }
  | { t: 'table.created'; code: string; table: LobbyTableInfo }
  | { t: 'code.table'; table: LobbyTableInfo }
  | { t: 'ledger.history'; entries: { at: number; currency: string; delta: number; reason: string; ref: string | null; balanceAfter: number }[] }
  | { t: 'table.state'; state: TableStateView }
  /** 演出用の増分イベント。状態の正は table.state のほうで、こちらはアニメーション指示 */
  | { t: 'table.events'; tableId: string; handId: string; events: HandEvent[] }
  | { t: 'hand.result'; tableId: string; summary: HandSummary }
  | { t: 'balance'; balance: number; gold?: number }
  | { t: 'error'; code: ErrorCode; message: string; ref?: string }
  | { t: 'pong'; ts: number }
  // --- トーナメント ---
  | { t: 'tour.tournaments'; tournaments: TournamentSummaryView[] }
  | { t: 'tournament.state'; view: TournamentView }
  // --- 経済 ---
  | { t: 'shop.state'; shop: ShopView }
  | { t: 'profile'; profile: ProfileView }
  | { t: 'reward'; title: string; chips: number; gold: number; detail?: string }
  // --- ゴールドスロット ---
  | { t: 'slot.info'; slot: SlotView }
  | { t: 'slot.result'; result: SlotResultView }
  | { t: 'tunnel.result'; result: TunnelResultView }
  | { t: 'tunnel.double'; result: TunnelDoubleView }
  /** ディーラーだけ先に見せる。プレイヤー3本はまだ伏せたまま(第168弾) */
  | { t: 'tunnel.double.dealt'; dealer: string; stakeX: number; keepX: number }
  | { t: 'tunnel.collected'; won: number }
  | { t: 'baccarat.result'; result: BaccaratResultView }
  // --- 引き継ぎ ---
  /** 発行結果。生の PIN が返るのはこの一度きり(サーバーは保存しない) */
  | { t: 'transfer.issued'; code: string; pin: string }
  /** 引き継ぎ成立。クライアントは resumeToken を保存し直して再読み込みする */
  | { t: 'transfer.done'; resumeToken: string; name: string; balance: number; gold: number };

/** スロット画面の表示情報 */
export interface SlotView {
  gold: number;
  bets: number[];
  /** 配当表。pay[0]=3個 pay[1]=4個 pay[2]=5個(×賭け金)。0 は「その個数では配当なし」 */
  symbols: Array<{ key: string; name: string; pay: [number, number, number] }>;
  /** 現在の払い出し倍率(VIPランク×連続ログイン) */
  multiplier: number;
  vipTierName: string;
  vipPart: number;
  streak: number;
  streakPart: number;
  chipsPerGold: number;
  spinsLeft: number;
  dailySpins: number;
  /** --- チップ建て(第59弾)。倍率は掛からない代わりに残高に応じた大きな額で回せる --- */
  chips: number;
  chipBets: number[];
  /** 賭け金の上限(第88弾: 50兆) */
  chipMaxBet?: number;
  chipMinBet: number;
  chipSpinsLeft: number;
  chipDailySpins: number;
  /** 盤面の形(5リール×3段=20固定ペイライン) */
  reels: number;
  rows: number;
  lines: number;
  /** 各ラインが通過する段(0=上/1=中/2=下)。当選ラインの描画に使う */
  paylines: number[][];
  /** 通常時のタンブル倍率のはしご */
  tumbleLadder: number[];
  /** スキャッター3/4/5個の配当 */
  scatterPay: Record<number, number>;
  /** フリーゲームのモード(突入時に選ばせる) */
  freeModes: Array<{ key: string; name: string; desc: string; spins: number; startMult: number; step: number }>;
  /** アンティベットの賭け金倍率 */
  anteCost: number;
  /** 最大配当(×賭け金) */
  maxWinX: number;
}

/** スロット 1 回分の結果。outcome を順に再生すると演出になる */
/** バカラ1ハンドの結果(第117弾)。配った瞬間に全カード・払い戻しが確定している */
export type BaccaratResultView = {
  hand: {
    p: { r: number; s: number }[];
    b: { r: number; s: number }[];
    order: { s: 'p' | 'b'; i: number }[];
    pt: number;
    bt: number;
    res: 'P' | 'B' | 'T';
  };
  bets: { p: number; b: number; tie: number };
  stake: number;
  /** 払い戻し合計(賭け金込みの戻り + 読み宣言ボーナス) */
  won: number;
  bonus: number;
  declare: 'H' | 'L' | null;
  balance: number;
};

/** WINNING TUNNEL の1スピン(第161弾)。盤面と判定は bsz.ts の結果をそのまま渡す */
export interface TunnelResultView {
  outcome: import('./bsz.js').BszOutcome;
  bet: number;
  cost: number;
  /** ダブルに行かず確定したときに支払われる額 */
  won: number;
  /** いま手元に持ち越している額(ダブルの元手) */
  pending: number;
}

/** ダブルダウン1回の結果 */
export interface TunnelDoubleView {
  result: import('./bsz.js').BszDoubleResult;
  /** このダブルの後に持ち越している額 */
  pending: number;
  /** 続けてダブルできるか */
  canDouble: boolean;
}

export interface SlotResultView {
  /** 盤面・連鎖・フリーゲームの全記録(slot.ts の SlotOutcome をそのまま) */
  outcome: unknown;
  bet: number;
  /** 賭けた通貨 */
  currency: 'gold' | 'chips';
  /** 実際に支払った額(アンティなら bet の1.5倍) */
  cost: number;
  won: number;
  multiplier: number;
  kind: 'none' | 'small' | 'big' | 'mega' | 'max';
  goldLeft: number;
  spinsLeft: number;
}

export type ErrorCode =
  | 'BAD_MESSAGE'
  | 'VERSION_MISMATCH'
  | 'NOT_AUTHENTICATED'
  | 'RATE_LIMITED'
  | 'NO_SUCH_TABLE'
  | 'SEAT_TAKEN'
  | 'ALREADY_SEATED'
  | 'NOT_SEATED'
  | 'INVALID_BUYIN'
  | 'INSUFFICIENT_FUNDS'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_ACTION'
  | 'STALE_HAND'
  | 'SEED_WINDOW_CLOSED'
  | 'INTERNAL';

// ---------------------------------------------------------------------------
// 受信メッセージの検証
// ---------------------------------------------------------------------------

/**
 * 受信メッセージを検証する。
 *
 * クライアントから来る値は一切信用しない。型が合っていても範囲が異常なら弾く。
 * 特に数値は NaN / Infinity / 非整数 / 負値をすべて潰しておかないと、
 * 「バイイン -1000000」のような入力でチップが増える。
 */
export function parseClientMessage(raw: unknown): { ok: true; msg: ClientMessage } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'メッセージがオブジェクトではありません' };
  const m = raw as Record<string, unknown>;
  const t = m.t;
  if (typeof t !== 'string') return { ok: false, reason: 't（メッセージ種別）がありません' };

  const str = (k: string, max = 64): string | null => {
    const v = m[k];
    return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
  };
  const posInt = (k: string): number | null => {
    const v = m[k];
    return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  };
  /**
   * 金額用(第150弾)。秘密卓のバイインは 50京 まであり 2^53 を超えるので
   * isSafeInteger では弾かれてしまう。整数であること・上限(100京)だけを見る。
   * この規模では double の刻みが 1 を超えるが、表せる値は必ず整数なので
   * Number.isInteger が正しい判定になる
   */
  // 上限の役目は「NaN・負・桁違いのゴミを弾く」ことだけ。本当の上限は
  // エンジンの合法手判定(スタック以下)と台帳の残高が担保する。
  // 極卓は最大ポットが300京なので、それを勝った人のオールインが通る必要がある
  // (1e18=100京だと弾かれてオールインできなくなる)。分割記帳の回数が
  // 現実的な範囲に収まる 1000京 を上限にする
  const MONEY_MAX = 1e19;
  const money = (k: string): number | null => {
    const v = m[k];
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MONEY_MAX ? v : null;
  };

  switch (t) {
    case 'hello': {
      const v = m.v;
      if (typeof v !== 'number') return { ok: false, reason: 'v がありません' };
      return {
        ok: true,
        msg: {
          t: 'hello',
          v,
          userId: str('userId') ?? undefined,
          name: str('name', 24) ?? undefined,
          resumeToken: str('resumeToken', 128) ?? undefined,
        },
      };
    }
    case 'lobby.list':
      return { ok: true, msg: { t: 'lobby.list' } };

    case 'table.create': {
      const bigBlind = posInt('bigBlind');
      if (bigBlind === null || bigBlind < 2) return { ok: false, reason: 'bigBlind が不正です' };
      if (bigBlind > 2_500_000_000_000) return { ok: false, reason: 'bigBlind が大きすぎます' };
      const seatsRaw = m.maxSeats;
      const maxSeats =
        typeof seatsRaw === 'number' && Number.isInteger(seatsRaw) && seatsRaw >= 2 && seatsRaw <= 9 ? seatsRaw : 6;
      return { ok: true, msg: { t: 'table.create', bigBlind, maxSeats, name: str('name', 20) ?? undefined } };
    }

    case 'code.redeem': {
      const code = str('code', 32);
      if (!code) return { ok: false, reason: 'code がありません' };
      return { ok: true, msg: { t: 'code.redeem', code } };
    }

    case 'ledger.get':
      return { ok: true, msg: { t: 'ledger.get' } };

    case 'table.watch':
    case 'table.leave':
    case 'table.stand': {
      const tableId = str('tableId');
      if (!tableId) return { ok: false, reason: 'tableId がありません' };
      return { ok: true, msg: { t, tableId } as ClientMessage };
    }

    case 'table.sit': {
      const tableId = str('tableId');
      const buyIn = money('buyIn');
      if (!tableId) return { ok: false, reason: 'tableId がありません' };
      if (buyIn === null || buyIn === 0) return { ok: false, reason: 'buyIn が不正です' };
      const seatRaw = m.seat;
      const seat =
        typeof seatRaw === 'number' && Number.isInteger(seatRaw) && seatRaw >= 0 && seatRaw < 9 ? seatRaw : undefined;
      return { ok: true, msg: { t: 'table.sit', tableId, seat, buyIn } };
    }

    case 'table.straddle': {
      const tableId = str('tableId');
      if (!tableId) return { ok: false, reason: 'tableId がありません' };
      if (typeof m.enabled !== 'boolean') return { ok: false, reason: 'enabled が真偽値ではありません' };
      return { ok: true, msg: { t: 'table.straddle', tableId, enabled: m.enabled } };
    }

    case 'table.sitOut': {
      const tableId = str('tableId');
      if (!tableId) return { ok: false, reason: 'tableId がありません' };
      if (typeof m.sitOut !== 'boolean') return { ok: false, reason: 'sitOut が真偽値ではありません' };
      return { ok: true, msg: { t: 'table.sitOut', tableId, sitOut: m.sitOut } };
    }

    case 'table.rebuy': {
      const tableId = str('tableId');
      const amount = money('amount');
      if (!tableId) return { ok: false, reason: 'tableId がありません' };
      if (amount === null || amount === 0) return { ok: false, reason: 'amount が不正です' };
      return { ok: true, msg: { t: 'table.rebuy', tableId, amount } };
    }

    case 'hand.act': {
      const tableId = str('tableId');
      const handId = str('handId', 64);
      const action = m.action;
      if (!tableId || !handId) return { ok: false, reason: 'tableId / handId がありません' };
      if (
        action !== 'fold' &&
        action !== 'check' &&
        action !== 'call' &&
        action !== 'bet' &&
        action !== 'raise'
      ) {
        return { ok: false, reason: 'action が不正です' };
      }
      // ベット額も秘密卓では 2^53 を超えうるので money と同じ判定にする(第150弾)
      const toRaw = m.toAmount;
      const toAmount =
        typeof toRaw === 'number' && Number.isInteger(toRaw) && toRaw >= 0 && toRaw <= MONEY_MAX
          ? toRaw
          : undefined;
      return { ok: true, msg: { t: 'hand.act', tableId, handId, action, toAmount } };
    }

    case 'fair.seed': {
      const tableId = str('tableId');
      const seed = str('seed', 64);
      if (!tableId) return { ok: false, reason: 'tableId がありません' };
      if (!seed) return { ok: false, reason: 'seed がありません' };
      // 区切り文字はシード合成で使うので受け付けない（サーバー側でも無害化するが二重で防ぐ）
      if (!/^[\w.-]{1,64}$/.test(seed)) return { ok: false, reason: 'seed に使える文字は英数字と . _ - だけです' };
      return { ok: true, msg: { t: 'fair.seed', tableId, seed } };
    }

    case 'tour.list':
    case 'shop.list':
    case 'daily.claim':
    case 'pass.claim':
    case 'profile.get':
    case 'slot.state':
    case 'transfer.issue':
      return { ok: true, msg: { t } as ClientMessage };

    case 'transfer.redeem': {
      // 形式の細かい検証はサーバー側(redeemTransferCode)で行う。ここは長さの上限だけ
      const code = str('code', 32);
      const pin = str('pin', 8);
      if (!code) return { ok: false, reason: 'code がありません' };
      if (!pin) return { ok: false, reason: 'pin がありません' };
      return { ok: true, msg: { t: 'transfer.redeem', code, pin } };
    }

    case 'baccarat.deal': {
      // 賭け金は3口とも非負整数。合計や残高は経済側(dealBaccaratHand)で最終判定する
      const n = (v: unknown) => {
        const x = Math.floor(Number(v));
        return Number.isFinite(x) && x > 0 ? x : 0;
      };
      const src = (m.bets ?? {}) as Record<string, unknown>;
      const bets = { p: n(src.p), b: n(src.b), tie: n(src.tie) };
      if (bets.p + bets.b + bets.tie <= 0) return { ok: false, reason: 'bets がありません' };
      // 宣言は既知の2種のみ。未知の値は「宣言なし」に落とす
      const declare = m.declare === 'H' || m.declare === 'L' ? m.declare : undefined;
      return { ok: true, msg: { t: 'baccarat.deal', bets, declare } };
    }

    case 'tunnel.spin': {
      const bet = money('bet');
      if (bet === null || bet === 0) return { ok: false, reason: 'bet が不正です' };
      return { ok: true, msg: { t: 'tunnel.spin', bet } };
    }

    case 'tunnel.double': {
      const half = m.half === true;
      const raw = m.pick;
      const pick = typeof raw === 'number' && (raw === 0 || raw === 1 || raw === 2) ? raw : 0;
      return { ok: true, msg: { t: 'tunnel.double', half, pick } };
    }

    case 'tunnel.double.deal':
      return { ok: true, msg: { t: 'tunnel.double.deal', half: m.half === true } };

    case 'tunnel.double.pick': {
      const raw = m.pick;
      const pick = raw === 1 || raw === 2 ? raw : 0;
      return { ok: true, msg: { t: 'tunnel.double.pick', pick } };
    }

    case 'tunnel.collect':
      return { ok: true, msg: { t: 'tunnel.collect' } };

    case 'slot.spin': {
      // 賭け金は整数のみ。使える額かどうかは経済側(SLOT_BETS)で最終判定する
      const bet = Math.floor(Number(m.bet));
      if (!Number.isFinite(bet) || bet <= 0) return { ok: false, reason: 'bet が不正です' };
      const ante = m.ante === true;
      // モードは既知の2種のみ。未知の値は既定に落とす(クライアント任せにしない)
      const mode = m.mode === 'few' ? 'few' : 'many';
      return { ok: true, msg: { t: 'slot.spin', bet, ante, mode } };
    }

    case 'user.style': {
      // どちらも任意。bracelet は null（外す）を許可し、それ以外は b1〜b6 のみ
      const name = str('name', 24) ?? undefined;
      const bracelet =
        m.bracelet === null ? null : typeof m.bracelet === 'string' && /^b[1-6]$/.test(m.bracelet) ? m.bracelet : undefined;
      return { ok: true, msg: { t: 'user.style', name, bracelet } };
    }

    case 'tour.watch':
    case 'tour.register':
    case 'tour.unregister':
    case 'tour.addon': {
      const tournamentId = str('tournamentId');
      if (!tournamentId) return { ok: false, reason: 'tournamentId がありません' };
      return { ok: true, msg: { t, tournamentId } as ClientMessage };
    }

    case 'shop.purchase': {
      const sku = str('sku');
      const receipt = str('receipt', 128);
      if (!sku || !/^[\w.-]{1,64}$/.test(sku)) return { ok: false, reason: 'sku が不正です' };
      if (!receipt || receipt.length < 8) return { ok: false, reason: 'receipt が不正です' };
      return { ok: true, msg: { t: 'shop.purchase', sku, receipt } };
    }

    case 'mission.claim': {
      const missionId = str('missionId');
      if (!missionId) return { ok: false, reason: 'missionId がありません' };
      return { ok: true, msg: { t: 'mission.claim', missionId } };
    }

    case 'ping': {
      const ts = typeof m.ts === 'number' && Number.isFinite(m.ts) ? m.ts : 0;
      return { ok: true, msg: { t: 'ping', ts } };
    }

    default:
      return { ok: false, reason: `未知のメッセージ種別: ${t}` };
  }
}
