/**
 * ハンド進行ステートマシン（ノーリミット・テキサスホールデム）
 *
 * 重要な前提：
 *   このクラスはサーバー側でのみ動く。クライアントには getStateFor(seat) で
 *   「その席から見える情報だけ」を返す。他人のホールカードを絶対に送らないこと。
 *   （クライアントに全カードを送って表示側で隠す実装は、通信を覗くだけで破られる）
 *
 * ベット額の表記について：
 *   bet / raise の amount は「このストリートで最終的にいくらまで出すか（raise to）」で統一している。
 *   "raise by"（上乗せ額）と混同するのが定番のバグなので、API 全体で to に固定した。
 */
import { type Card, type Rng } from './cards.js';
import { type HandValue } from './evaluator.js';
import { type Pot, type UncalledReturn } from './pot.js';
import { type FairnessCommitment, type FairnessReveal, FairnessSession } from './fair.js';
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export interface SeatConfig {
    id: string;
    name?: string;
    stack: number;
}
export interface HandOptions {
    seats: SeatConfig[];
    buttonIndex: number;
    smallBlind: number;
    bigBlind: number;
    /** 全員が毎ハンド払うアンティ（0 なら無し） */
    ante?: number;
    /**
     * ストラドル（BB の左隣から順に置く追加の強制ベット）。
     *
     * ボタンストラドル／ミシシッピストラドルは、アクション順の扱いがカジノごとに違い
     * （UTG から始めてボタンを最後に回す等）、統一された標準が存在しないため実装していない。
     * ここで扱うのは、オンラインで標準的な「BB の左隣から連続して置く」形だけ。
     */
    straddles?: Array<{
        seat: number;
        amount: number;
    }>;
    /** レーキ率。0.03 = 3%。0 ならノーレーキ */
    rakePercent?: number;
    /** レーキ上限（チップ単位）。仕様書の「4BB」なら bigBlind * 4 を渡す */
    rakeCap?: number;
    rng?: Rng;
    /** テスト用。指定した順序でカードを配る */
    presetDeck?: Card[];
    /**
     * Provably Fair のセッション。指定するとデッキはシードから決定論的に導出される。
     * この場合 rng はシャッフルには使われない。
     */
    fairness?: FairnessSession;
}
export interface PlayerState {
    seat: number;
    id: string;
    name: string;
    stack: number;
    startingStack: number;
    holeCards: Card[];
    folded: boolean;
    allIn: boolean;
    /** 現ストリートでの出資額 */
    streetBet: number;
    /** ハンド全体での出資額 */
    totalBet: number;
    /** このベッティングラウンドでまだアクションが必要か */
    mustAct: boolean;
    /** レイズが許されるか（ショートオールイン後は false になりうる） */
    canRaise: boolean;
    lastAction: ActionType | null;
}
export interface LegalAction {
    type: ActionType;
    /** call の必要額、bet/raise の最小 to 額 */
    min?: number;
    /** bet/raise の最大 to 額（＝オールイン） */
    max?: number;
    /** call の場合の実際の支払額 */
    amount?: number;
}
export type HandEvent = {
    type: 'hand_start';
    button: number;
    sbSeat: number;
    bbSeat: number;
} | {
    type: 'ante';
    seat: number;
    amount: number;
} | {
    type: 'blind';
    seat: number;
    amount: number;
    blind: 'sb' | 'bb';
} | {
    type: 'straddle';
    seat: number;
    amount: number;
    order: number;
} | {
    type: 'deal_hole';
    seat: number;
    cards: Card[];
} | {
    type: 'street';
    street: Street;
    board: Card[];
} | {
    type: 'action';
    seat: number;
    action: ActionType;
    amount: number;
    toAmount: number;
    stack: number;
    allIn: boolean;
} | {
    type: 'uncalled_return';
    seat: number;
    amount: number;
} | {
    type: 'pots';
    pots: Pot[];
} | {
    type: 'showdown';
    seat: number;
    cards: Card[];
    hand: string;
} | {
    type: 'award';
    seat: number;
    amount: number;
    potLevel: number;
} | {
    type: 'rake';
    amount: number;
} | {
    type: 'hand_end';
};
export interface PotResult {
    pot: Pot;
    rake: number;
    winners: number[];
    shares: Map<number, number>;
}
export interface HandResult {
    pots: PotResult[];
    uncalledReturn: UncalledReturn | null;
    totalRake: number;
    /** ショーダウンまで行ったか（false = 全員フォールドで決着） */
    showdown: boolean;
    /** 席ごとの成立役。フォールド済み・非ショーダウンは null */
    hands: Array<HandValue | null>;
    /** 席ごとのハンド収支（＋なら勝ち） */
    netChange: number[];
}
export declare class Hand {
    readonly players: PlayerState[];
    readonly buttonIndex: number;
    readonly smallBlind: number;
    readonly bigBlind: number;
    readonly ante: number;
    readonly straddles: Array<{
        seat: number;
        amount: number;
    }>;
    readonly rakePercent: number;
    readonly rakeCap: number;
    board: Card[];
    street: Street;
    currentBet: number;
    /** 直近の「フルレイズ」の上乗せ幅。最小レイズ額の計算に使う */
    lastRaiseSize: number;
    actingSeat: number | null;
    events: HandEvent[];
    result: HandResult | null;
    /** Provably Fair を有効にしている場合のセッション */
    readonly fairness: FairnessSession | null;
    private deck;
    private deckOrder;
    private sbSeat;
    private bbSeat;
    constructor(opts: HandOptions);
    private begin;
    /** チップをスタックからポットへ移す。オールイン判定もここで行う */
    private commit;
    private nextOccupied;
    private beginBettingRound;
    /** 次にアクションすべき席を探す。見つからなければストリートを終了する */
    private advanceFrom;
    private countNotFolded;
    private countCanAct;
    /** 現在アクション権のあるプレイヤーの合法手 */
    getLegalActions(seat?: number): LegalAction[];
    /**
     * アクションを適用する。
     * @param seat   アクションする席（サーバーでは必ず認証済みの席と照合すること）
     * @param action 種別
     * @param toAmount bet / raise のときの「このストリートでの最終出資額（raise to）」
     */
    act(seat: number, action: ActionType, toAmount?: number): void;
    private endStreet;
    private dealNextStreet;
    private finish;
    get totalPot(): number;
    get isComplete(): boolean;
    /**
     * 指定席から見える状態。他人のホールカードは含まない。
     * ショーダウン後は公開された手札のみ含める。
     */
    getStateFor(seat: number | null): {
        street: Street;
        board: number[];
        pot: number;
        currentBet: number;
        minRaiseSize: number;
        actingSeat: number | null;
        buttonIndex: number;
        smallBlind: number;
        bigBlind: number;
        legalActions: LegalAction[];
        players: {
            seat: number;
            id: string;
            name: string;
            stack: number;
            streetBet: number;
            totalBet: number;
            folded: boolean;
            allIn: boolean;
            lastAction: ActionType | null;
            holeCards: number[] | null;
        }[];
        result: HandResult | null;
    };
    /**
     * 配牌前にクライアントへ送るコミットメント。
     * Provably Fair を有効にしていない場合は null。
     *
     * サーバー実装では、これを送ってからでなければカードを配ってはいけない。
     * 順序を逆にすると仕組み全体が意味を失う。
     */
    getFairnessCommitment(): FairnessCommitment | null;
    /**
     * ハンド終了後に serverSeed を開示する。
     * 進行中に呼ぶと、そのハンドの残りのカードが計算できてしまうため例外にしている。
     */
    revealFairness(): FairnessReveal;
    /** ハンド履歴（配布順のデッキ全体を含む）。Provably Fair の検証に使う */
    getHandHistory(): {
        button: number;
        blinds: {
            sb: number;
            bb: number;
            ante: number;
            straddles: {
                seat: number;
                amount: number;
            }[];
        };
        seats: {
            seat: number;
            id: string;
            startingStack: number;
            holeCards: string[];
        }[];
        board: string[];
        deckOrder: string[];
        events: HandEvent[];
        result: HandResult | null;
        fairness: FairnessCommitment | null;
    };
}
