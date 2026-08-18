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
/**
 * ブループリント表の形式バージョン。
 * v1 = `flopClass|role` + face 1種類 / v2 = potType・sprBand を加え、face をサイズ別に持つ。
 * 形式を変えたら必ず上げること(古い表を読み込んで挙動が混ざるのを防ぐ)。
 */
export declare const BLUEPRINT_VERSION = 2;
export type BpDist = Partial<Record<string, number>>;
export interface BpNode {
    firstIn: BpDist;
    faceS: BpDist;
    faceB: BpDist;
    faceJam: BpDist;
}
export interface BlueprintTable {
    version: number;
    sizes: {
        betS: number;
        betB: number;
    };
    nodes: Record<string, Record<string, BpNode>>;
}
/**
 * ポットの種類。3ベットポットはレンジ構成もSPRもSRPと別物なので分けて持つ。
 * 判定はプリフロップのレンジ記述(heroSpec/villainSpec)が3ベット系かどうかで行う——
 * bots 側が実際の行動から割り当てたレンジなので、これがそのまま局面の種類になる。
 */
export declare function flopPotType(heroSpec?: string | null, villSpec?: string | null): string;
/**
 * SPR(スタック/ポット比)の帯。低SPRではコミット判断が別物になるので分けて解く。
 * 境界は 3 と 8。3ベットポットは概ね low、SRPは mid〜high に落ちる。
 */
export declare function flopSprBand(spr: number): string;
/** 表のキーを組み立てる(オフライン生成と実行時参照で必ず同じ関数を使う) */
export declare function blueprintKey(flopCls: string, role: string, potType: string, sprBand: string): string;
export declare function setBlueprint(bp: BlueprintTable | null): void;
export declare function getBlueprint(): BlueprintTable | null;
/**
 * フロップのテクスチャを少数の戦略クラスへ写す(スート同型を吸収)。
 * ペア/モノトーン/ハイカード階層 × ウェット(2トーン or コネクト)で ~11 クラス。
 */
export declare function flopClass(board: Card[]): string;
/** ポジション×プリフロップアグレッサーの役割ラベル(4種) */
export declare function flopRole(inPosition: boolean, wasAggressor: boolean): string;
/**
 * ハンドをフロップ上で決定的な強さバケットへ写す(madeScore + ドローのアウツ)。
 * オフライン蒸留と実行時ルックアップで完全に一致する(サンプリング非依存)。
 */
export declare function flopHandBucket(hole: Card[], board: Card[]): string;
/**
 * ブループリントを引いてアクションをサンプルする。表に無ければ null(→通常経路へ)。
 *
 * ベットに直面しているときは、相手のベットサイズ(ポット比)に一番近い応答分布を選ぶ。
 * 小さいベットには広く受け、大きいベットには絞る——という MDF の効き方を表で再現するため。
 */
export declare function blueprintAction(c: PostCtx): GtoAction | null;
/**
 * ブループリント(flop_blueprint.json)があれば読み込む。tuned_params.json と同じ場所を探す。
 * 無ければ null(エラーにしない)。読み込めた場合はファイルパスを返す。
 */
export declare function loadBlueprint(): Promise<string | null>;
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
    /**
     * ブループリント蒸留の出力チャネル(フロップ need===2 のみ)。指定すると、CFRを1回解いて
     * 全バケットの firstIn/faceS/faceB/faceJam 分布と、
     * 自陣コンボの (solverバケット, 決定的handBucket, 重み) を書き込む。
     * これで「1回の解でその盤面・役割の全ハンドの戦略」を取り出せる(蒸留を高速化)。
     */
    bpOut?: {
        firstIn: BpDist[];
        faceS: BpDist[];
        faceB: BpDist[];
        faceJam: BpDist[];
        items: Array<{
            bucket: number;
            hb: string;
            w: number;
        }>;
    };
    /** DCFR で解く(オフライン蒸留用) */
    discount?: boolean;
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
/**
 * ブループリント蒸留用: 1つのフロップ・役割(ヒーローのレンジ/ポジション)についてCFRを1回解き、
 * 決定的handBucketごとの firstIn / face 戦略分布を返す。build_blueprint.mjs から呼ぶ。
 * 通常のプレイには使わない(重い代わりに全ハンドを一括で取り出す)。
 * heroHole はダミー(ソルバー内部のバケット割当を邪魔しない盤外の1枚組を渡す想定)。
 */
export declare function solveFlopBlueprint(ctx: RiverSolveCtx): Record<string, BpNode> | null;
/**
 * 3人のリバーをバケットCFRで解く(マルチウェイの簡易ソルバー)。
 * 資料第3部§3.8の通りマルチウェイは「タイト・小さいサイズ・純ブラフ激減」が均衡なので、
 * ツリーは意図的に小さい: 1ベットサイズ(66%ポット)・レイズなし・fold/callのみ。
 * ショーダウンは「自分のスコアが両者のバケット分布を同時に上回る確率」(CDFの積)で近似し、
 * タイの残差は勝率比で正規化して分配する。サイドポットは扱わない(均等スタック近似)。
 */
export interface River3Ctx {
    heroHole: Card[];
    board: Card[];
    heroIdx: 0 | 1 | 2;
    specs: [string, string, string];
    tightens: [number, number, number];
    pot: number;
    bettorIdx: number | null;
    facingBet: number;
    rnd?: () => number;
    iters?: number;
}
export declare function solveRiver3(ctx: River3Ctx): GtoAction | null;
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
    /** 3人残りリバー用: アクション順(先に打つ順)の全員のレンジ。3件なら3wayソルバーを使う */
    multiwaySpecs?: string[];
    /** 上の並びでの自分のindex(0..2) */
    heroOrder?: number;
    /** 上の並びでのベット者のindex。まだ誰も打っていなければ null */
    bettorOrder?: number | null;
    /** 上の並びでの各人のポストフロップ攻撃回数(レンジを上位へ寄せる) */
    multiwayTightens?: number[];
}
export declare function gtoPostflop(c: PostCtx): GtoAction;
export {};
