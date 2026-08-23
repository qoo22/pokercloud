/**
 * ゴールドスロットの抽選エンジン(第58弾で全面刷新)。
 *
 * 設計方針は現行オンラインスロットの主流に合わせた「ルールは単純に、結果は極端に」。
 *   - 5リール×3段の **25固定ペイライン**(左から連続で揃えば配当)。当たった形が見えるので納得感がある
 *   - **1スピン=1回判定**(第79弾で連鎖を廃止。止まった盤面がそのまま結果)
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
 * 25固定ペイライン(第65弾で243waysから20本へ、第66弾で25本へ)。
 * 数値は「左のリールから順に通過する段」。**0=上段 / 1=中段 / 2=下段**。
 * (仕様書の 1/2/3 表記から 1 を引いた値。直線・V字・山型・ジグザグを万遍なく入れてある)
 * 業界共通の規格は無く、タイトルごとに決めるもの。
 */
export declare const PAYLINES: number[][];
export declare const LINES: number;
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
    /**
     * アンティベット時のスキャッター重み。
     * 第71弾でアンティのUIを撤去したので**現在は使われていない(休眠)**。
     * 戻すときは必ず tune-slot を回し直すこと(フリー寄与が大きいので釣り合いが崩れやすい)
     */
    scatterWeightAnte: number;
    /** アンティベットの賭け金倍率 */
    anteCost: number;
    /**
     * リール1(左端)の内部帯の長さ(第69弾: スタックドWILD)。
     * 帯には3連WILDブロックが1つだけ入っている。窓(3マス)が完全に重なる停止位置は
     * 帯上に1つしか無いので、フル出現率は 1/stackedStripLen。半端に見える(1〜2個)位置が
     * その4倍あり、これが「惜しい!」の予告になる。
     */
    stackedStripLen: number;
    /**
     * フリーゲーム中のリール1帯の伸び(実機の「フリー専用リール帯」に相当)。
     * 固定WILDは永続マルチプライヤーと掛け算になるため、通常時と同じ頻度で出すと
     * RTP が数倍に爆発する(実測)。頻度を落として「事件」にする
     */
    freeStripScale: number;
    /**
     * フリーゲームの固定WILDの持続スピン数(停止したスピンを含む)。
     * 無制限に残すと 1回の固定化で平均2000x超(実測)になり、フリーゲームが
     * 「7.5%の宝くじと92.5%の消化試合」に割れてしまうため、3スピンで解除する
     */
    stickySpins: number;
    /**
     * 突入時のフリーゲーム回数(第89弾・オーナー指定)。スキャッターの個数で決まる。
     * 固定WILDが溜まるほど後半の1回が重くなるため、10/15/20 ではなく 8/12/16 に据える。
     */
    freeSpinsByScatter: Record<number, number>;
    /**
     * フリーゲーム中の上乗せ(第89弾・オーナー指定)。突入と同じ「3個以上」で成立するが、
     * **回数は突入より小さい**(固定WILDが載った状態で回せるぶん1回の価値が高いため)。
     * 再トリガー回数に上限は設けない。
     */
    freeRetriggerByScatter: Record<number, number>;
    /**
     * 暴走止め。**仕様上の上限ではない**(オーナー指定で再トリガーに上限は無い)。
     * 3個以上が出る確率は1スピンあたり 0.5% 前後、期待上乗せは +0.02 回/スピンなので
     * 収束する。ここに張り付くのは抽選が壊れたときだけ。
     */
    freeSpinsGuard: number;
};
/** フリーゲームでWILDが絡んだ当選に掛かる倍率の抽選(値と重み)。同一ラインには1回だけ */
export declare const WILD_MULT_TABLE: {
    m: number;
    w: number;
}[];
/** スキャッター3/4/5個そのものの配当(×賭け金) */
export declare const SCATTER_PAY: Record<number, number>;
/**
 * 通常時の倍率のはしご。**第79弾で連鎖を廃止したため未使用(休眠)**。
 * クライアントの配当表表示が参照しているので値だけ残してある。
 */
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
    /** 当たったスピンごとの倍率の増分(連鎖廃止で「1スピンごと」になった) */
    step: number;
}
export declare const FREE_MODES: FreeMode[];
/**
 * MAX WIN の称号を出すしきい値(×賭け金)。
 * **第80弾で配当の頭打ちを撤廃した**(オーナー判断)。チップは現金化されず、
 * 1日の回転数に上限があるため、発行量はそこで抑えられる。
 * この値はもう配当を切り詰めず、演出の格付けにだけ使う。
 */
export declare const MAX_WIN_X = 5000;
/**
 * フリーゲーム中にスキャッターが止まったときの上乗せ。
 * 第79弾から**1個につき1回**上乗せする(3個そろわなくても増える)。
 */
export declare const RETRIGGER_SPINS = 1;
export type Grid = SlotSymKey[][];
/** 1回の判定の結果。クライアントの演出用にそのまま送る(連鎖廃止後は最大1個) */
export interface TumbleStep {
    /** 判定した盤面 */
    grid: Grid;
    /** 当たった位置 [reel, row][] */
    hits: [number, number][];
    /**
     * 内訳(絵柄・個数・ways・素の配当)。wildMult はフリーゲームでWILDが絡んだ当選だけに付く。
     * allWild は「当選区間が全部WILDで、key の絵柄が盤面に1つも無い」場合に立つ。
     * 業界標準どおり最高配当の絵柄として払うが、**画面にその絵柄が見えない**ので、
     * クライアントは「WILD×3(セブン扱い)」と明示するために使う。
     */
    wins: {
        key: SlotSymKey;
        count: number;
        ways: number;
        pay: number;
        line?: number;
        wildMult?: number;
        allWild?: boolean;
    }[];
    /** この判定に適用された倍率(フリーゲームの永続マルチプライヤー) */
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
    /** スキャッターで回数が上乗せされたか */
    retrigger: boolean;
    /** このスピンで上乗せされた回数(3個=+4 / 4個=+8 / 5個=+12) */
    addedSpins: number;
    /** このスピンで止まったスキャッターの数(再トリガー演出の出し分けに使う) */
    scatters: number;
    /** このスピンを消化したあとの残り回数(上乗せ加算後) */
    spinsLeft: number;
    /** その時点での総回数(上乗せ込み) */
    spinsTotalSoFar: number;
    /**
     * このスピン時点でホールドされているWILDのマス(第79弾でコマ単位に変更)。
     * フリーゲーム中にWILDが止まったマスは、そのフリーゲームが終わるまで残り続ける。
     */
    heldCells: [number, number][];
    /** そのうち「このスピンで新しくホールドされた」マス(演出用) */
    freshCells: [number, number][];
}
export interface SlotOutcome {
    /** 最初に出た盤面。**当たりが1つも無いスピンでも盤面を描けるように必ず入れる** */
    grid0: Grid;
    /** 通常時の判定結果(0個=ハズレ / 1個=当たり) */
    base: TumbleStep[];
    /** 通常時の配当(×賭け金。スキャッター配当込み) */
    basePayX: number;
    /** スキャッター個数 */
    scatters: number;
    /**
     * 3連WILDがフル停止したリールの番号(第76弾で全リール対象に拡張)。
     * 空なら通常のスピン。全リール(5本)そろうと盤面すべてがWILDになる
     */
    stackedReels: number[];
    /**
     * スタックドWILDのリスピン(通常時のみ・1スピンにつき最大1回)。
     * リール1をWILDで固定したままリール2〜5だけ引き直した結果。初回分とは別に払う。
     * リスピン中はスキャッターを抽選しない(演出の渋滞と期待値の暴れを避けるため)
     */
    respin?: {
        grid0: Grid;
        steps: TumbleStep[];
        payX: number;
        lockedReels: number[];
    };
    /** フリーゲームに入ったか */
    freeEntered: boolean;
    free?: {
        mode: FreeMode['key'];
        spinsTotal: number;
        spins: FreeSpinStep[];
        /** 最終的な永続マルチプライヤー */
        finalMult: number;
        /** 突入時に1回だけ抽選した WILD 倍率(×2〜×5)。フリー中ずっとこの値 */
        wildMult: number;
        payX: number;
    };
    /** 合計配当(×賭け金)。第80弾から頭打ちなし */
    totalPayX: number;
    /** MAX WIN の称号しきい値(5000x)を超えたか(演出用。もう配当は切り詰めない) */
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
