/**
 * ゴールドスロットの抽選エンジン(第58弾で全面刷新)。
 *
 * 設計方針は現行オンラインスロットの主流に合わせた「ルールは単純に、結果は極端に」。
 *   - 5リール×3段の **243 ways**(左から連続で揃えば配当)。ペイライン概念が無く理解が速い
 *   - **タンブル**(当たった絵柄が消えて上から落ちる)。1スピンが複数イベントに分解される
 *   - タンブル連鎖ごとに **倍率が上がる**(通常時 x1→x2→x3→x5→x10)
 *   - スキャッター3つで **フリーゲーム**。フリーゲーム中は倍率が
 *     **スピンをまたいで持ち越される(永続マルチプライヤー)**。これが現行機の中核
 *   - 突入時に **回数多め×低倍率 / 回数少なめ×高倍率** を選べる(意思決定の演出)
 *   - Bonus Buy は規制リスクが高いので採用せず、代わりに **アンティベット**
 *     (1.5倍賭けで突入率2倍)を用意する
 *
 * このファイルは store にも時計にも依存しない純粋関数群にしてある。
 * 期待値の検証は scripts/sim-slot.mjs が数百万スピン回して行う。
 */
/** 絵柄キー。wild/scatter 以外は配当表を持つ */
export type SlotSymKey = 'chip' | 'club' | 'diamond' | 'heart' | 'spade' | 'crown' | 'seven' | 'wild' | 'scatter';
export interface SlotPaySymbol {
    key: SlotSymKey;
    name: string;
    /** 3個/4個/5個そろったときの配当(賭け金に対する倍率) */
    pay: [number, number, number];
    /** 抽選の重み */
    weight: number;
}
export declare const REELS = 5;
export declare const ROWS = 3;
/**
 * 配当表と重み。
 * 重みは sim-slot.mjs の実測でRTP・ヒット率・突入率が目標帯に入るよう調整してある。
 * 触ると期待値が動くので、必ずシミュレーションを回し直すこと。
 */
export declare const PAY_SYMBOLS: SlotPaySymbol[];
/**
 * 抽選パラメータ。**オブジェクトにしてあるのは調整スクリプトから差し替えるため**
 * (scripts/tune-slot.mjs が数値を振ってRTPを合わせる)。実運用では書き換えないこと。
 * ワイルドは中3リールのみ(端に出ると当たりすぎる)。スキャッターは全リール。
 */
export declare const SLOT_CFG: {
    wildWeight: number;
    scatterWeight: number;
    /** アンティベット時のスキャッター重み(突入率がおよそ2倍になる) */
    scatterWeightAnte: number;
    /** アンティベットの賭け金倍率 */
    anteCost: number;
};
/** スキャッター3/4/5個そのものの配当(×賭け金) */
export declare const SCATTER_PAY: Record<number, number>;
/** 通常時のタンブル倍率のはしご。連鎖するほど上がる */
export declare const TUMBLE_LADDER: number[];
/** フリーゲームのモード。RTPがほぼ等しくなるよう調整してある(選択は演出) */
export interface FreeMode {
    key: 'many' | 'few';
    name: string;
    desc: string;
    /** 初期スピン数 */
    spins: number;
    /** 永続マルチプライヤーの初期値 */
    startMult: number;
    /** タンブル1連鎖ごとの倍率の増分 */
    step: number;
}
export declare const FREE_MODES: FreeMode[];
/** 最大配当(賭け金に対する倍率)。ここで頭打ちにする */
export declare const MAX_WIN_X = 5000;
/** 3つ以上のスキャッターで再抽選(リトリガー)。追加されるスピン数 */
export declare const RETRIGGER_SPINS = 3;
export type Grid = SlotSymKey[][];
/** 1連鎖ぶんの結果。クライアントの演出用にそのまま送る */
export interface TumbleStep {
    /** この連鎖の開始時点の盤面 */
    grid: Grid;
    /** 当たった位置 [reel, row][] */
    hits: [number, number][];
    /** 内訳(絵柄・個数・ways・素の配当) */
    wins: {
        key: SlotSymKey;
        count: number;
        ways: number;
        pay: number;
    }[];
    /** この連鎖に適用された倍率 */
    mult: number;
    /** 倍率適用後の配当(×賭け金) */
    payX: number;
}
export interface FreeSpinStep {
    /** そのスピンの初期盤面(ハズレでも描けるように) */
    grid0: Grid;
    steps: TumbleStep[];
    /** このスピン終了時点の永続マルチプライヤー */
    multAfter: number;
    payX: number;
    /** リトリガーしたか */
    retrigger: boolean;
}
export interface SlotOutcome {
    /** 最初に出た盤面。**当たりが1つも無いスピンでも盤面を描けるように必ず入れる** */
    grid0: Grid;
    /** 通常時の連鎖 */
    base: TumbleStep[];
    /** 通常時の配当(×賭け金。スキャッター配当込み) */
    basePayX: number;
    /** スキャッター個数 */
    scatters: number;
    /** フリーゲームに入ったか */
    freeEntered: boolean;
    free?: {
        mode: FreeMode['key'];
        spinsTotal: number;
        spins: FreeSpinStep[];
        /** 最終的な永続マルチプライヤー */
        finalMult: number;
        payX: number;
    };
    /** 合計配当(×賭け金)。MAX_WIN_X で頭打ち */
    totalPayX: number;
    /** 上限に到達したか(演出用) */
    maxWin: boolean;
}
type Rnd = () => number;
export interface SpinOptions {
    /** アンティベット(1.5倍賭けで突入率2倍) */
    ante?: boolean;
    /** フリーゲームのモード。未指定なら 'many' */
    mode?: FreeMode['key'];
}
/**
 * 1スピンぶんを最後まで(フリーゲーム込みで)抽選する。
 * 返り値の totalPayX は「賭け金に対する倍率」。チップへの換算は呼び出し側の責任。
 */
export declare function spin(rnd: Rnd, opts?: SpinOptions): SlotOutcome;
export {};
