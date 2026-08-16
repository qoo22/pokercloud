/**
 * テーブルルーム：1 卓分の状態と、ハンドを回し続けるループ
 *
 * ここが「エンジン（1 ハンドの純粋なルール）」と「サーバー（時間・接続・お金）」の境界。
 * Hand クラスは時間を知らないしプレイヤーの接続状態も知らない。
 * その外側の面倒ごと——手番のタイムアウト、切断、バイイン、次のハンドの開始——を全部ここで見る。
 *
 * Provably Fair の順序保証：
 *   waiting → seed_window（コミットメント公開・シード受付）→ hand（配牌）→ settling（シード開示）
 *   この順序は状態機械で強制する。「うっかり配牌後にシードを受け付ける」ことが起きないよう、
 *   受付は phase === 'seed_window' のときだけ通す。
 */
import { type ActionType } from '../table.js';
import type { ServerMessage, HandSummary, LobbyTableInfo, ErrorCode } from './protocol.js';
export interface Scheduler {
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}
export declare const realScheduler: Scheduler;
export interface TableConfig {
    tableId: string;
    name: string;
    smallBlind: number;
    bigBlind: number;
    maxSeats: number;
    /** バイイン下限・上限（BB 単位）。仕様書のとおり 20〜100BB */
    minBuyInBB?: number;
    maxBuyInBB?: number;
    rakePercent?: number;
    rakeCapBB?: number;
    /** 1 アクションあたりの持ち時間 */
    actionTimeoutMs?: number;
    /** タイムバンクの初期値 */
    timeBankMs?: number;
    /** クライアントシードの受付時間 */
    seedWindowMs?: number;
    /** ハンド終了から次のハンドまでの間（結果を見せる時間） */
    handIntervalMs?: number;
    /** 切断してから自動 Sit Out にするまでの猶予 */
    disconnectGraceMs?: number;
    /**
     * cash: 通常のキャッシュゲーム（財布からバイイン）
     * tournament: トーナメント（チップは主催側が配る。着席・追加購入・離席は不可）
     */
    mode?: 'cash' | 'tournament';
    /** トーナメント用。ハンド開始時に現在のブラインドを問い合わせる */
    blindsProvider?: () => {
        smallBlind: number;
        bigBlind: number;
        ante: number;
    };
    /**
     * ストラドルを許可するか（キャッシュゲームのみ）。
     * トーナメントでは通常認められないので、mode が tournament のときは無視される。
     */
    straddleAllowed?: boolean;
    /** ストラドルの上限段数。1 なら通常の 2BB ストラドルだけ */
    maxStraddles?: number;
}
export interface BustInfo {
    userId: string;
    seat: number;
    /**
     * 撃墜したプレイヤー（複数人でポットを分けた場合は全員）。
     * ブラインドに削られて 0 になった場合など、誰の手柄でもないときは空配列。
     */
    eliminatedBy: string[];
    /** ハンド開始時のスタック。同時脱落の順位付けに使う */
    stackAtStart: number;
}
export interface RoomHooks {
    /** ハンドの精算が終わり、次のハンドが始まる前に呼ばれる。卓の再編成に使う */
    onSettled?(room: Room, busted: BustInfo[]): void;
    /** ハンドの結果。統計・ミッション・永続化に使う */
    onHandResult?(room: Room, summary: HandSummary, seats: Array<{
        seat: number;
        userId: string;
    }>): void;
}
export interface RoomIO {
    send(sessionId: string, msg: ServerMessage): void;
}
export interface RoomBank {
    /** テーブルへの持ち込み。残高が足りなければ false */
    withdraw(userId: string, amount: number, ref: string): boolean;
    /** テーブルからの持ち出し */
    deposit(userId: string, amount: number, ref: string): void;
    balanceOf(userId: string): number;
}
type Phase = 'waiting' | 'seed_window' | 'hand' | 'settling';
export declare class Room {
    private io;
    private bank;
    private clock;
    readonly cfg: Required<TableConfig>;
    private seats;
    private members;
    /** userId → 装着ブレスレット。着席前に届いても sit 時に反映できるよう卓側で保持 */
    private cosmetics;
    private phase;
    private hand;
    private handId;
    private handNumber;
    private buttonIndex;
    private fairness;
    /** 今のハンドで席 → クライアントシード提出済みか */
    private seedSubmitted;
    private lastReveal;
    private actionDeadline;
    /** 現在の手番の基本持ち時間(Triton Tempo: ストリートで変わる) */
    private actionBaseMs;
    private actionStartedAt;
    private timers;
    private eventCursor;
    private potHistory;
    private handTimestamps;
    /** 直近のハンドで飛んだ席と、その撃墜者 */
    private lastBusts;
    /** 現在のブラインド。トーナメントではレベルごとに書き換わる */
    private blinds;
    hooks: RoomHooks;
    constructor(cfg: TableConfig, io: RoomIO, bank: RoomBank, clock?: Scheduler);
    get isTournament(): boolean;
    /** 現在のブラインド（トーナメントではレベルに応じて変わる） */
    get currentBlinds(): {
        smallBlind: number;
        bigBlind: number;
        ante: number;
    };
    get minBuyIn(): number;
    get maxBuyIn(): number;
    /** ニックネーム・装着ブレスレットの更新（コスメ。着席中なら即反映して配信） */
    setStyle(userId: string, name: string | undefined, bracelet: string | null | undefined): void;
    join(sessionId: string, userId: string, name: string): void;
    leave(sessionId: string): void;
    /** 接続は生きているがユーザーが明示的に卓を降りる */
    stand(sessionId: string): ErrorCode | null;
    private cashOut;
    sit(sessionId: string, seatIndex: number | undefined, buyIn: number): ErrorCode | null;
    rebuy(sessionId: string, amount: number): ErrorCode | null;
    setSitOut(sessionId: string, sitOut: boolean): ErrorCode | null;
    /** 財布を経由せずに席へ座らせる。チップはトーナメントが配る */
    seatDirect(userId: string, name: string, stack: number, seatIndex?: number): number | null;
    /** 席から外してスタックを返す（卓のバランス調整・脱落処理に使う） */
    removeDirect(userId: string): number | null;
    /** 現在この卓にいるプレイヤー（スタック付き） */
    playersInSeats(): Array<{
        userId: string;
        name: string;
        seat: number;
        stack: number;
    }>;
    /** 席にチップを足す（トーナメントのアドオン用）。適用は次のハンドから */
    addChips(userId: string, amount: number): boolean;
    /** ブラインドを更新する（レベルアップ時に呼ぶ）。適用は次のハンドから */
    setBlinds(b: {
        smallBlind: number;
        bigBlind: number;
        ante: number;
    }): void;
    /** 進行を一時停止する（卓の再編成中など） */
    paused: boolean;
    /**
     * ストラドルの予約。UTG に回ってきたハンドで自動的に置かれる。
     *
     * 実装しているのは「BB の左隣から連続して置く」形だけ。
     * ボタンストラドル／ミシシッピストラドルはアクション順の扱いがカジノごとに違い、
     * 統一された標準が無いため対象外にしている。
     */
    setStraddle(sessionId: string, enabled: boolean): ErrorCode | null;
    get straddleEnabled(): boolean;
    submitSeed(sessionId: string, seed: string): ErrorCode | null;
    private eligibleSeats;
    private isDisconnectExpired;
    /** 条件が揃っていれば次のハンドを開始する */
    maybeStartHand(): void;
    /**
     * コミットメントを公開し、クライアントシードの受付を開始する。
     * ここではまだカードを配らない。この順序が Provably Fair の核心。
     */
    private beginSeedWindow;
    private startHand;
    private engineToTable;
    private boardRevealLimit;
    private resultRevealed;
    private revealStats;
    private equityCacheKey;
    private equityCacheVal;
    private nextButton;
    private tableSeatOf;
    private engineSeatOf;
    private isInCurrentHand;
    act(sessionId: string, handId: string, action: ActionType, toAmount?: number): ErrorCode | null;
    private afterAction;
    /** オールインで残りの場札が一度に配られた（＝焦らし演出をする価値がある）決着か */
    private shouldStageRunout;
    /**
     * オールイン後の場札を、全員同期で 1 段ずつ開く。
     * サーバーが board を小出しに送るだけで、各クライアントは新しい札を配布アニメで描く
     * （クライアント改造は不要）。テレビ中継のようにリバー前を一番長く取り、
     * 演出が終わってから finishHand（結果表示 → 次ハンド）へ進む。
     */
    private startRunoutReveal;
    /** いま公開されている場札での、勝負がついていない席の勝率・アウツを計算する */
    private computeRevealStats;
    /**
     * Triton Tempo 方式の基本持ち時間。ストリートが深いほど判断が重いので長くする。
     * cfg.actionTimeoutMs を既定値(15000)から変えている卓は、その値を全ストリートに使う。
     */
    private tempoBaseMs;
    /** タイムバンクを全席に加算する(トーナメントの FT 到達ボーナス等) */
    grantTimeBank(ms: number): void;
    /** 手番のタイマーを張り直す。基本時間を使い切ると、タイムバンクを1秒単位で消費する(Tempo方式) */
    private armActionTimer;
    private onActionTimeout;
    private finishHand;
    /** 結果表示の待ち時間が終わったあとの後片付けと、次のハンドの開始 */
    private settle;
    private pushEvents;
    private broadcast;
    broadcastState(): void;
    private sendBalanceTo;
    sendStateTo(sessionId: string): void;
    /**
     * 指定ユーザーから見える状態を組み立てる。
     *
     * ここが情報漏洩の最終防衛線。他人のホールカードは、ショーダウンで公開された場合を除いて
     * 絶対に入れない。「クライアント側で伏せる」実装は通信を覗くだけで破られる。
     */
    private buildState;
    lobbyInfo(): LobbyTableInfo;
    private seatOfUser;
    private schedule;
    private clearTimers;
    /** 卓を停止する（サーバー終了時など） */
    dispose(): void;
    /**
     * テスト・監視用：卓上にあるチップの総量。
     * ハンド中は席の stack が古いので、エンジン側（手札のスタック + ポットへの出資）を見る。
     */
    chipsOnTable(): number;
    get currentPhase(): Phase;
    get currentHandId(): string | null;
    get seatedCount(): number;
}
export {};
