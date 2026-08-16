/**
 * GTOベースのボット頭脳 — poker_gto 調査パッケージ(第1〜3部)の軽量TypeScript移植。
 *
 * プリフロップ: ポジション別レンジ表(RFI / BB防御 / 3ベット / 4ベット / コールドコール)、
 *   短スタックの Push/Fold と シャブへのコールレンジ、AA/KKは浅くてもジャムせずミニレイズ。
 * ポストフロップ: MDF は必ず リスク/(リスク+リターン)、IPはMDF通り・OOPはオーバーフォールド、
 *   マルチウェイは α^(1/n) でタイト化、ボードテクスチャ別のCベット頻度とサイズ
 *   (エースハイはKハイより低頻度・モノトーンは激減・ペアボードは高頻度小サイズ)、
 *   セミブラフ階層(FD/OESD > ガット > バックドア)、リバーのブラフ率 s/(1+2s)。
 */
import { type Card } from '../cards.js';
/**
 * 意思決定の主要ノブ。既定値=これまで理論から較正した値。
 * self_improve.mjs が自己対戦で最適化し、tuned_params.json 経由で本番botに反映される。
 * 各値の意味と探索範囲は TUNING_BOUNDS を参照。
 */
export declare const TUNE: {
    preLoose: number;
    threeBetScale: number;
    bbCallBonus: number;
    cbetAggr: number;
    cbetNon: number;
    oopPenalty: number;
    smallBetDef: number;
    valueThr: number;
    valueThrRiver: number;
    semibluffF: number;
    bluffBase: number;
    xrFreq: number;
    onePairTurnCheck: number;
    probeBoost: number;
    solverGate: number;
    valueRaiseSize: number;
};
export type Tuning = typeof TUNE;
export declare const TUNING_BOUNDS: Record<keyof Tuning, [number, number]>;
/** 部分更新(境界へクランプ)。トレーナーが席ごとに切り替えるのにも使う */
export declare function setTuning(partial: Partial<Tuning>): void;
export declare function getTuning(): Tuning;
/**
 * 自己学習の成果(tuned_params.json)があれば読み込む。
 * dist/src/server/ から見て3つ上 = poker-engine/ (または poker-cloud/) 直下を探す。
 * 無ければ既定値のまま(エラーにしない)。
 */
export declare function loadTunedParams(): Promise<string | null>;
/** 2枚のカード → "AKs"/"AKo"/"TT" */
export declare function handTypeOf(a: Card, b: Card): string;
/**
 * モンテカルロで「自分のハンド vs 相手レンジ」の実エクイティを求める。
 * Raw Equity > Pot Odds 判定の基礎(V2 §8/§10)。ドローの完成もランアウトに含まれる。
 * tighten: 相手がポストフロップで攻めた回数。トーナメント選択(候補をtighten+1個
 * 引いて現時点で最強のものを採用)でレンジ上位へ寄せる — ベイズ更新(§6.3)の軽量近似。
 */
export declare function equityVsRange(hole: Card[], board: Card[], spec: string, opts?: {
    iters?: number;
    tighten?: number;
    rnd?: () => number;
}): number | null;
type Pos = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
/** 相手のプリフロップの行動から割り当てるレンジ(V2 §6.3 の初期信念。bots側が参照) */
export declare const VILLAIN_PRE: Record<string, string>;
export interface RiverSolveCtx {
    heroHole: Card[];
    board: Card[];
    heroSpec: string;
    villSpec: string;
    heroTighten?: number;
    villTighten?: number;
    heroIP: boolean;
    pot: number;
    effStack: number;
    facingBet: number;
    rnd?: () => number;
    iters?: number;
}
/** リバーをその場で解き、自分の実ハンドの混合戦略から1アクションを引く。失敗時null */
export declare function solveRiver(ctx: RiverSolveCtx): GtoAction | null;
/**
 * ターンをその場で解く(V2 Phase6 の軽量版)。
 *
 * リバーとの違いは勝率の定義だけ:
 *   リバー = 現在のスコアで確定
 *   ターン = 「リバーを配りきってショーダウンした時の勝率」
 * そこで残りのリバー候補から R_SAMPLES 枚をサンプリングし、各リバーで厳密に
 * 勝敗分布を計り、その平均でコンボの強さ(=対レンジ勝率)とバケット間勝率行列を作る。
 * ドロー(フラッシュドロー等)はリバーで完成する分だけ自然に強さへ織り込まれるので、
 * 「今は最弱だが降りないハンド」としてセミブラフ・コール継続が均衡から出てくる。
 * ツリーはリバーと同じ(check/50%/100%/jam)。葉はチェックダウン相当のショーダウン評価
 * (=深さ制限探索の単純継続)なので、リバーでのさらなるベットの価値は含まない近似。
 */
export declare function solveTurn(ctx: RiverSolveCtx): GtoAction | null;
/**
 * フロップをその場で解く。ターンと同じ仕組みで、ランアウトが「ターン+リバーの2枚」になるだけ。
 * サイズメニューは理論(第3部)に合わせて小さめ(33%/75%)を使う。
 * 葉がチェックダウン相当の近似はフロップでは2ストリート分粗くなるが、
 * レンジ対レンジの均衡からCベット頻度・ドローの継続・チェックレイズが出る。
 */
export declare function solveFlop(ctx: RiverSolveCtx): GtoAction | null;
/** 参加者の席順からチャート用ポジションラベルを求める */
export declare function positionLabel(mySeat: number, buttonIndex: number, dealtSeats: number[], maxSeats: number): Pos;
export interface PreCtx {
    hole: [Card, Card];
    pos: Pos;
    headsUp: boolean;
    bb: number;
    myStack: number;
    myStreetBet: number;
    toCall: number;
    currentBet: number;
    pot: number;
    limpers: number;
    /** 最大の相手ベットをしている席のポジション(いなければnull) */
    openerPos: Pos | null;
    opponentAllIn: boolean;
    tourMode: boolean;
    rnd: () => number;
    aggr: number;
    loose: number;
}
export interface GtoAction {
    action: 'fold' | 'check' | 'call' | 'raise' | 'allin';
    /** raise のときのポット/BB基準の目標額(絶対額) */
    to?: number;
}
export declare function gtoPreflop(c: PreCtx): GtoAction;
/**
 * ターンカードの分類(第5部§3.3)。フロップ3枚に対する4枚目の性質で、
 * バレル頻度が大きく変わる: オーバーカード/スケア=60〜80%、ブランク=約50%、
 * ボードペア=大半チェック、ドロー完成=ナッツ+ブロッカーのみ。
 */
export declare function turnCardClass(board: Card[]): 'overcard' | 'board-pair' | 'draw-complete' | 'blank' | null;
export interface PostCtx {
    hole: Card[];
    board: Card[];
    street: 'flop' | 'turn' | 'river';
    pot: number;
    toCall: number;
    currentBet: number;
    bb: number;
    myStack: number;
    inPosition: boolean;
    nActive: number;
    wasAggressor: boolean;
    tourMode: boolean;
    rnd: () => number;
    aggr: number;
    bluff: number;
    tight: number;
    tier: number;
    /** 相手傾向(観測統計)。0.5=平均。confidence=0なら無視される(§39-42) */
    oppFold?: number;
    oppAggr?: number;
    oppRaisey?: number;
    conf?: number;
    /** 主対戦相手のプリフロップレンジ(V2 §6)。あればMCで実エクイティを計算する */
    villainSpec?: string | null;
    /** 主対戦相手がポストフロップで攻めた回数(レンジを上位へ寄せる) */
    villainAggStreets?: number;
    /** 自分のレンジ(自分のプリフロップの行動から。リバーソルバー用) */
    heroSpec?: string | null;
    /** 自分がポストフロップで攻めた回数 */
    heroAggStreets?: number;
    /** このストリートで自分が既に入れた額(>0ならレイズを受けた状態 → ソルバー適用外) */
    heroStreetBet?: number;
}
export declare function gtoPostflop(c: PostCtx): GtoAction;
export {};
