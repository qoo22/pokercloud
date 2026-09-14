/**
 * 2台目のスロット「WINNING TUNNEL」(第161弾)。
 *
 * シグマの BONUS SPIN Z を遊んだ記憶をもとに再構成した、3×3・8ラインの台。
 * 公式の配列や確率は公開されていないので、**配当表の形だけを合わせ、
 * 重みはこちらで RTP を見ながら決めている**(実機の内部値ではない)。
 *
 * ここは GOLD RUSH と同じく**純粋関数だけ**。抽選・判定・倍率計算をして
 * 「賭け金の何倍か」を返す。支払い・上限・台帳は economy.ts が持つ。
 *
 * 台の骨格:
 *   ・3×3 の9マス。マスごとに独立した抽選
 *   ・8ライン(横3・縦3・斜め2)に同じ絵柄が3つ並べばライン配当
 *   ・並んでいなくても、画面内の個数で決まる ANY 配当が別に付く
 *   ・中央にジョーカーが止まるとトンネル抽選(×1/×2/×3/×5)→ 中央固定で5回のフリー
 *   ・獲得後はダブルダウン(任意)。プレイヤー3リールが揃うとスペシャルボーナス
 */
/** 弱い順。ANY判定では赤7と青7をまとめて「7」として数える */
export type BszSym = 'blank' | 'cherry' | 'orange' | 'plum' | 'melon' | 'bell' | 'eight' | 'bar' | 'red7' | 'blue7' | 'joker';
export declare const BSZ_SYMS: BszSym[];
/** ダブルダウンの強さ比べに使う序列(大きいほど強い) */
export declare const BSZ_RANK: Record<BszSym, number>;
/**
 * 1マスの抽選重み。合計 1000。
 *
 * ブランク(何も描かれていないマス)は実機にもある最弱の図柄で、**これが無いと
 * 8ラインとANYが同時に当たりすぎる**(ブランク抜きで測ったら RTP 205%)。
 * ライン・ANYのどちらにも数えないので、ここが実質的な調整つまみになっている。
 * ジョーカーは中央に来るとフリーなので、他より大幅に薄い。
 */
export declare const BSZ_WEIGHTS: Record<BszSym, number>;
/** 8ライン。マスの番号は 0..8(左上→右下) */
export declare const BSZ_LINES: number[][];
/** ライン配当(3つ並び)。賭け金の何倍か */
export declare const BSZ_LINE_PAY: Record<string, number>;
/** ANY配当。画面内の個数(3〜9個)で決まる。列=個数 */
export declare const BSZ_ANY_PAY: Record<string, Record<number, number>>;
/** トンネルの倍率と重み */
export declare const BSZ_TUNNEL: Array<{
    x: number;
    w: number;
}>;
/** フリーの回数(実機と同じ固定5回。リトリガーは無い) */
export declare const BSZ_FREE_SPINS = 5;
/** 1スピンで払う上限(賭け金の何倍か)。実機の10万枚上限に相当する歯止め */
export declare const BSZ_MAX_WIN_X = 100000;
/** ダブルダウンに進める上限(賭け金の何倍か)。超えると自動で確定=実機の「振り切り」 */
export declare const BSZ_DOUBLE_CAP_X = 5000;
/** スペシャルボーナス(ダブル中にプレイヤー3リールが揃う)。賭け金の何倍か */
export declare const BSZ_SPECIAL: Record<string, number>;
export type BszGrid = BszSym[];
/** 1マスずつ引いて盤面を作る。hold に入れたマスは残す(フリーの中央固定) */
export declare function bszSpinGrid(rnd: () => number, hold?: Partial<Record<number, BszSym>>): BszGrid;
export interface BszLineHit {
    line: number;
    key: string;
    x: number;
    cells: number[];
}
export interface BszAnyHit {
    key: string;
    count: number;
    x: number;
}
/** 盤面の判定。ライン配当と ANY 配当を別々に返す(実機と同じく両方とも足す) */
export declare function bszEvaluate(g: BszGrid): {
    lines: BszLineHit[];
    anys: BszAnyHit[];
    payX: number;
};
export declare const bszPickTunnel: (rnd: () => number) => number;
export interface BszStep {
    grid: BszGrid;
    lines: BszLineHit[];
    anys: BszAnyHit[];
    payX: number;
}
export interface BszOutcome {
    /** 最初の盤面(当たりが無くても必ず入れる) */
    grid0: BszGrid;
    base: BszStep;
    /** 中央がジョーカーだったか(=フリー突入) */
    freeEntered: boolean;
    /** トンネル倍率。フリーに入ったときだけ */
    tunnel: number;
    /** フリー5回ぶん */
    free: BszStep[];
    /** 賭け金の何倍払うか(上限適用後) */
    totalPayX: number;
    /** 上限で頭打ちになったか */
    maxWin: boolean;
    /** ダブルダウンに進めるか(獲得があり、上限以内) */
    canDouble: boolean;
}
/**
 * 1スピン。
 * 中央がジョーカーなら、その盤面の配当も含めてトンネル倍率がかかる(実機と同じ)。
 */
export declare function bszSpin(rnd?: () => number): BszOutcome;
export interface BszDoubleResult {
    dealer: BszSym;
    player: [BszSym, BszSym, BszSym];
    /** プレイヤーが選んだリール(0〜2)。勝敗はこの1枚だけで決まる */
    pick: number;
    /** 勝敗。tie は賭けたぶんがそのまま残る */
    result: 'win' | 'tie' | 'lose';
    /** プレイヤー3つ揃いのスペシャルボーナス(賭け金の何倍か。無ければ0) */
    specialX: number;
    /** プレイヤーにジョーカーが出たときのトンネル倍率(無ければ0) */
    tunnel: number;
    /** このダブルの後に手元に残る額(賭け金の何倍か) */
    payX: number;
    /** さらにダブルを続けられるか */
    canDouble: boolean;
}
/**
 * ダブルダウンを1回。
 * @param stakeX  賭ける額(賭け金の何倍か)
 * @param keepX   賭けずに確保しておく額(ハーフダブルのとき)
 * @param pick    プレイヤーが**めくる前に選ぶ**リール(0〜2)
 *
 * 実機の "If selected reel beats dealer's, player wins" どおり、勝敗は
 * **選んだ1枚**とディーラーの1枚を比べる。3枚の中で一番強いものを自動で
 * 採用すると勝率が7割に偏ってしまうので、そうはしない(実測で確認済み)。
 * 3つ揃いのスペシャルは勝敗と別に加算され、ジョーカーが出ればトンネル倍率が乗る。
 */
export declare function bszDouble(stakeX: number, keepX: number, rnd?: () => number, pick?: number): BszDoubleResult;
