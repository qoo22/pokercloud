/**
 * ゴールドスロットの抽選エンジン(第58弾で全面刷新)。
 *
 * 設計方針は現行オンラインスロットの主流に合わせた「ルールは単純に、結果は極端に」。
 *   - 5リール×3段の **25固定ペイライン**(左から連続で揃えば配当)。当たった形が見えるので納得感がある
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
export const REELS = 5;
export const ROWS = 3;
/**
 * 25固定ペイライン(第65弾で243waysから20本へ、第66弾で25本へ)。
 * 数値は「左のリールから順に通過する段」。**0=上段 / 1=中段 / 2=下段**。
 * (仕様書の 1/2/3 表記から 1 を引いた値。直線・V字・山型・ジグザグを万遍なく入れてある)
 * 業界共通の規格は無く、タイトルごとに決めるもの。
 */
export const PAYLINES = [
    [1, 1, 1, 1, 1], // 01 中段一直線
    [0, 0, 0, 0, 0], // 02 上段一直線
    [2, 2, 2, 2, 2], // 03 下段一直線
    [0, 1, 2, 1, 0], // 04 V字
    [2, 1, 0, 1, 2], // 05 山型
    [0, 0, 1, 0, 0], // 06 上段・中央くぼみ
    [2, 2, 1, 2, 2], // 07 下段・中央山
    [1, 2, 2, 2, 1], // 08 下側U字
    [1, 0, 0, 0, 1], // 09 上側山型
    [1, 0, 1, 0, 1], // 10 上側ジグザグ
    [1, 2, 1, 2, 1], // 11 下側ジグザグ
    [0, 1, 0, 1, 0], // 12 上段始まりW字
    [2, 1, 2, 1, 2], // 13 下段始まりW字
    [1, 1, 0, 1, 1], // 14 中段・中央だけ上
    [1, 1, 2, 1, 1], // 15 中段・中央だけ下
    [0, 1, 1, 1, 0], // 16 上段始終・中央通過
    [2, 1, 1, 1, 2], // 17 下段始終・中央通過
    [0, 1, 2, 2, 2], // 18 左上から右下
    [2, 1, 0, 0, 0], // 19 左下から右上
    [0, 2, 0, 2, 0], // 20 上段始まり大ジグザグ
    [2, 0, 2, 0, 2], // 21 下段始まり大ジグザグ(20の上下反転)
    [0, 0, 1, 2, 2], // 22 上段から下段へ下降
    [2, 2, 1, 0, 0], // 23 下段から上段へ上昇
    [0, 1, 2, 1, 2], // 24 上段始まり二段ジグザグ
    [2, 1, 0, 1, 0], // 25 下段始まり二段ジグザグ
];
export const LINES = PAYLINES.length;
/**
 * 配当表と重み。
 * 重みは sim-slot.mjs の実測でRTP・ヒット率・突入率が目標帯に入るよう調整してある。
 * 触ると期待値が動くので、必ずシミュレーションを回し直すこと。
 */
export const PAY_SYMBOLS = [
    // 下位3種は「4個から配当」。3個で当たる絵柄を絞ることでヒット率を業界水準(20〜30%)まで
    // 落としつつ、1回の当たりの価値を残している(243waysは放っておくと当たりすぎる)
    // 第76弾: **全リールにスタックドWILDを配置**したことでWILDが大幅に増え、素の期待値が
    // 218% まで上がった。そこで全体を約0.432倍に再調整し、目標RTP 99.99% に合わせてある。
    // (第69弾で0.63倍、第75弾で0.81倍にした経緯の続き。当たりの体験は絵柄の配当よりWILDイベントに寄る)
    // **触ったら必ず 6〜10シード × 30万スピン以上で検算すること**。
    // tune-slot.mjs の N=160,000 はフリーゲームの分散に対して足りず、数pt単位で誤判定する。
    { key: 'chip', name: 'チップ', pay: [0.0, 0.1175, 0.4359], weight: 100 },
    { key: 'club', name: 'クラブ', pay: [0.0, 0.1758, 0.6117], weight: 88 },
    { key: 'diamond', name: 'ダイヤ', pay: [0.0, 0.264, 0.8549], weight: 76 },
    { key: 'heart', name: 'ハート', pay: [0.0, 0.3478, 1.3159], weight: 62 },
    { key: 'spade', name: 'スペード', pay: [0.1382, 0.5992, 2.3423], weight: 48 },
    { key: 'crown', name: '王冠', pay: [0.264, 1.2027, 4.4712], weight: 32 },
    { key: 'seven', name: 'セブン', pay: [0.6998, 3.2854, 14.8841], weight: 18 },
];
/**
 * 抽選パラメータ。**オブジェクトにしてあるのは調整スクリプトから差し替えるため**
 * (scripts/tune-slot.mjs が数値を振ってRTPを合わせる)。実運用では書き換えないこと。
 * ワイルドは中3リールのみ(端に出ると当たりすぎる)。スキャッターは全リール。
 */
export const SLOT_CFG = {
    wildWeight: 26,
    scatterWeight: 11,
    /**
     * アンティベット時のスキャッター重み。
     * 第71弾でアンティのUIを撤去したので**現在は使われていない(休眠)**。
     * 戻すときは必ず tune-slot を回し直すこと(フリー寄与が大きいので釣り合いが崩れやすい)
     */
    scatterWeightAnte: 14,
    /** アンティベットの賭け金倍率 */
    anteCost: 1.5,
    /**
     * リール1(左端)の内部帯の長さ(第69弾: スタックドWILD)。
     * 帯には3連WILDブロックが1つだけ入っている。窓(3マス)が完全に重なる停止位置は
     * 帯上に1つしか無いので、フル出現率は 1/stackedStripLen。半端に見える(1〜2個)位置が
     * その4倍あり、これが「惜しい!」の予告になる。
     */
    stackedStripLen: 64,
    /**
     * フリーゲーム中のリール1帯の伸び(実機の「フリー専用リール帯」に相当)。
     * 固定WILDは永続マルチプライヤーと掛け算になるため、通常時と同じ頻度で出すと
     * RTP が数倍に爆発する(実測)。頻度を落として「事件」にする
     */
    freeStripScale: 4,
    /**
     * フリーゲームの固定WILDの持続スピン数(停止したスピンを含む)。
     * 無制限に残すと 1回の固定化で平均2000x超(実測)になり、フリーゲームが
     * 「7.5%の宝くじと92.5%の消化試合」に割れてしまうため、3スピンで解除する
     */
    stickySpins: 3,
};
/** フリーゲームでWILDが絡んだ当選に掛かる倍率の抽選(値と重み)。同一ラインには1回だけ */
export const WILD_MULT_TABLE = [
    { m: 2, w: 50 },
    { m: 3, w: 30 },
    { m: 4, w: 14 },
    { m: 5, w: 6 },
];
/** スキャッター3/4/5個そのものの配当(×賭け金) */
export const SCATTER_PAY = { 3: 2, 4: 5, 5: 20 };
/** 通常時のタンブル倍率のはしご。連鎖するほど上がる */
export const TUMBLE_LADDER = [1, 2, 3, 5, 10];
export const FREE_MODES = [
    { key: 'many', name: '回数多め', desc: '15回 / ×1から+3ずつ', spins: 15, startMult: 1, step: 3 },
    { key: 'few', name: '一撃高倍率', desc: '8回 / ×5から+7ずつ', spins: 8, startMult: 5, step: 7 },
];
/** 最大配当(賭け金に対する倍率)。ここで頭打ちにする */
export const MAX_WIN_X = 5000;
/** 3つ以上のスキャッターで再抽選(リトリガー)。追加されるスピン数 */
export const RETRIGGER_SPINS = 3;
/** リールごとの抽選テーブルを作る。ワイルドは中3リールのみ */
function reelTable(reel, scatterWeight) {
    const t = PAY_SYMBOLS.map((s) => ({ key: s.key, w: s.weight }));
    if (reel >= 1 && reel <= 3)
        t.push({ key: 'wild', w: SLOT_CFG.wildWeight });
    t.push({ key: 'scatter', w: scatterWeight });
    return t;
}
function drawFrom(table, rnd) {
    const total = table.reduce((a, b) => a + b.w, 0);
    let x = rnd() * total;
    for (const e of table) {
        x -= e.w;
        if (x <= 0)
            return e.key;
    }
    return table[table.length - 1].key;
}
function newGrid(rnd, scatterWeight) {
    const g = [];
    for (let r = 0; r < REELS; r++) {
        const table = reelTable(r, scatterWeight);
        const col = [];
        for (let y = 0; y < ROWS; y++)
            col.push(drawFrom(table, rnd));
        g.push(col);
    }
    return g;
}
const PAY_BY_KEY = new Map(PAY_SYMBOLS.map((s) => [s.key, s]));
/**
 * **全リール**の帯(3連WILDブロック入り)を盤面に重ねる。戻り値はフル停止したリール番号。
 * 帯のどこで止まったかで 0〜3 個が決まる:
 *   フル(3個) … 1箇所 / 2個 … 2箇所 / 1個 … 2箇所 / なし … 残り全部
 * 3個そろったリールだけ特別扱い(通常時はロック+リスピン、フリーは固定WILD)。1〜2個はただのWILD。
 *
 * 第76弾で全リールに広げたので、**理論上は5リール全部がWILDになる**(確率 (1/L)^5)。
 * 各リールは独立に引くので、L=64 なら全面WILDは約 1/10億。出れば MAX WIN に届く。
 */
function overlayStackedWilds(grid, rnd, stripScale = 1) {
    const L = SLOT_CFG.stackedStripLen * stripScale;
    const full = [];
    for (let r = 0; r < REELS; r++) {
        const pos = Math.floor(rnd() * L);
        // WILDブロックを帯の 0,1,2 に置いたとして、窓は strip[pos+y] (y=0..2) を見せる
        let n = 0;
        for (let y = 0; y < ROWS; y++) {
            if ((pos + y) % L <= 2) {
                grid[r][y] = 'wild';
                n++;
            }
        }
        if (n >= ROWS)
            full.push(r);
    }
    return full;
}
/** WILD絡み当選の倍率を引く(フリーゲーム用) */
function drawWildMult(rnd) {
    const total = WILD_MULT_TABLE.reduce((a, b) => a + b.w, 0);
    let x = rnd() * total;
    for (const e of WILD_MULT_TABLE) {
        x -= e.w;
        if (x <= 0)
            return e.m;
    }
    return WILD_MULT_TABLE[WILD_MULT_TABLE.length - 1].m;
}
/**
 * 20固定ペイラインの判定。
 *   - 必ず左端(リール1)から連続していること
 *   - 3個以上そろえば当選。ワイルドは代用になる
 *   - **同じラインでは一番高い組み合わせだけ**を払う
 *   - 複数ラインが成立したらすべて加算する
 */
function evaluate(grid) {
    const wins = [];
    const hitSet = new Set();
    for (let li = 0; li < PAYLINES.length; li++) {
        const line = PAYLINES[li];
        let best = null;
        for (const sym of PAY_SYMBOLS) {
            // 左から連続して「その絵柄 or ワイルド」が並ぶ長さ
            let len = 0;
            for (let r = 0; r < REELS; r++) {
                const c = grid[r][line[r]];
                if (c === sym.key || c === 'wild')
                    len++;
                else
                    break;
            }
            if (len < 3)
                continue;
            const pay = sym.pay[len - 3];
            if (pay <= 0)
                continue;
            if (!best || pay > best.pay)
                best = { key: sym.key, count: len, pay };
        }
        if (best) {
            // 当選区間に「その絵柄そのもの」が1つでもあるか。無ければ全部WILDで成立している
            let natural = false;
            for (let r = 0; r < best.count; r++)
                if (grid[r][line[r]] === best.key)
                    natural = true;
            wins.push({
                key: best.key, count: best.count, ways: 1, pay: best.pay, line: li,
                ...(natural ? {} : { allWild: true }),
            });
            for (let r = 0; r < best.count; r++)
                hitSet.add(`${r},${line[r]}`);
        }
    }
    const hits = [...hitSet].map((k) => {
        const [a, b] = k.split(',');
        return [Number(a), Number(b)];
    });
    return { wins, hits };
}
function countScatter(grid) {
    let n = 0;
    for (let r = 0; r < REELS; r++)
        for (let y = 0; y < ROWS; y++)
            if (grid[r][y] === 'scatter')
                n++;
    return n;
}
/**
 * 当たった位置を消して上から詰め、空きを新しい絵柄で埋める。
 * lockReels に入っているリール(スタックドWILD)には手を付けない — WILDは消えずに残り続ける
 */
function tumble(grid, hits, rnd, scatterWeight, lockReels) {
    const dead = new Set(hits.map(([r, y]) => `${r},${y}`));
    const out = [];
    for (let r = 0; r < REELS; r++) {
        if (lockReels && lockReels.indexOf(r) >= 0) {
            out.push([...grid[r]]);
            continue;
        }
        const keep = [];
        for (let y = 0; y < ROWS; y++)
            if (!dead.has(`${r},${y}`))
                keep.push(grid[r][y]);
        const table = reelTable(r, scatterWeight);
        const fill = [];
        while (fill.length + keep.length < ROWS)
            fill.push(drawFrom(table, rnd));
        out.push([...fill, ...keep]); // 上に新しい絵柄が入る
    }
    return out;
}
/**
 * 連鎖を最後まで回す。
 * ladder が渡されればそれに沿って倍率が上がり(通常時)、
 * persistent が渡されればスピンをまたいで積み上がる(フリーゲーム)。
 */
function runTumbles(grid0, rnd, scatterWeight, opts) {
    const steps = [];
    let grid = grid0;
    let payX = 0;
    let chain = 0;
    let mult = opts.persistent ? opts.persistent.mult : 1;
    // 連鎖が続く限り。理論上は無限になり得ないが、安全弁として上限を置く
    for (let guard = 0; guard < 40; guard++) {
        const { wins, hits } = evaluate(grid);
        if (!wins.length)
            break;
        // WILD絡みの当選に倍率(フリーゲームだけ)。**ライン単位で1回**であり、
        // 同じラインにWILDが2個以上あっても倍率は1回しか掛からない。
        // 倍率はスピンごとに引き直さず、突入時に決めた値をフリー中ずっと使う。
        if (opts.wildMult) {
            for (const w of wins) {
                const line = PAYLINES[w.line ?? 0];
                for (let r = 0; r < w.count; r++) {
                    if (grid[r][line[r]] === 'wild') {
                        w.wildMult = opts.wildMult;
                        break;
                    }
                }
            }
        }
        const raw = wins.reduce((a, w) => a + w.pay * (w.wildMult ?? 1), 0);
        const m = opts.persistent ? mult : (opts.ladder ?? TUMBLE_LADDER)[Math.min(chain, (opts.ladder ?? TUMBLE_LADDER).length - 1)];
        const got = raw * m;
        steps.push({ grid, hits, wins, mult: m, payX: got });
        payX += got;
        // フリーゲームは当たるたびに永続マルチプライヤーが伸びる
        if (opts.persistent)
            mult += opts.persistent.step;
        grid = tumble(grid, hits, rnd, scatterWeight, opts.lockReels);
        chain++;
    }
    return { steps, payX, multAfter: mult };
}
/**
 * 1スピンぶんを最後まで(フリーゲーム込みで)抽選する。
 * 返り値の totalPayX は「賭け金に対する倍率」。チップへの換算は呼び出し側の責任。
 */
export function spin(rnd, opts = {}) {
    const sw = opts.ante ? SLOT_CFG.scatterWeightAnte : SLOT_CFG.scatterWeight;
    const grid0 = newGrid(rnd, sw);
    // リール1の帯にWILDブロックが重なったか。3個フルで停止したときだけ「スタックドWILD」
    const stackedReels = overlayStackedWilds(grid0, rnd);
    const scatters = countScatter(grid0);
    const baseRun = runTumbles(grid0, rnd, sw, { ladder: TUMBLE_LADDER, lockReels: stackedReels });
    let basePayX = baseRun.payX + (SCATTER_PAY[Math.min(scatters, 5)] ?? 0);
    const out = {
        grid0,
        base: baseRun.steps,
        basePayX,
        scatters,
        stackedReels,
        freeEntered: scatters >= 3,
        totalPayX: 0,
        maxWin: false,
    };
    // スタックドWILDのリスピン(通常時のみ・必ず1回で終わり)。
    // リール1をWILDのまま固定し、リール2〜5だけ引き直す。初回の当選とは別に払う。
    // 上限を設けないと同じWILDから何度も発生し得るため、仕様として1回に固定してある。
    // 全リールがWILDのときは引き直す相手がいないのでリスピンしない
    if (stackedReels.length > 0 && stackedReels.length < REELS) {
        const rg = newGrid(rnd, 0); // スキャッター無しで引く(リスピンからはフリーに入らない)
        for (const r of stackedReels)
            rg[r] = ['wild', 'wild', 'wild'];
        const rrun = runTumbles(rg, rnd, 0, { ladder: TUMBLE_LADDER, lockReels: stackedReels });
        out.respin = { grid0: rg, steps: rrun.steps, payX: rrun.payX, lockedReels: stackedReels };
    }
    if (out.freeEntered) {
        const mode = FREE_MODES.find((m) => m.key === (opts.mode ?? 'many')) ?? FREE_MODES[0];
        // 4個/5個で追加スピン
        let left = mode.spins + (scatters >= 5 ? 6 : scatters === 4 ? 3 : 0);
        let total = left;
        let mult = mode.startMult;
        let payX = 0;
        const spins = [];
        // WILD倍率は**突入時に1回だけ**引き、このフリーゲーム中はずっと同じ値を使う。
        // スピンごとに引き直すと「何倍の台なのか」が定まらず、演出として見せ場が作れない
        const wildMult = drawWildMult(rnd);
        // フリーゲーム中に3連WILDが停止すると、リール1が3スピンのあいだ固定WILDになる。
        // リスピンはさせず「固定WILD+WILD絡み×2〜×5」で通常時と役割を分ける
        const stickyLeft = new Array(REELS).fill(0);
        // 安全弁: リトリガーが続いても止まるように上限を置く
        for (let guard = 0; left > 0 && guard < 200; guard++) {
            left--;
            const g = newGrid(rnd, sw);
            // 継続中の固定を先に貼ってから、新しくフル停止したリールを固定に加える
            for (let r = 0; r < REELS; r++)
                if (stickyLeft[r] > 0)
                    g[r] = ['wild', 'wild', 'wild'];
            for (const r of overlayStackedWilds(g, rnd, SLOT_CFG.freeStripScale)) {
                if (stickyLeft[r] <= 0)
                    stickyLeft[r] = SLOT_CFG.stickySpins;
            }
            const stickyReels = [];
            for (let r = 0; r < REELS; r++)
                if (stickyLeft[r] > 0) {
                    stickyReels.push(r);
                    stickyLeft[r]--;
                }
            const sc = countScatter(g);
            const run = runTumbles(g, rnd, sw, {
                persistent: { mult, step: mode.step },
                lockReels: stickyReels,
                wildMult,
            });
            mult = run.multAfter;
            payX += run.payX;
            const retrigger = sc >= 3;
            if (retrigger) {
                left += RETRIGGER_SPINS;
                total += RETRIGGER_SPINS;
            }
            spins.push({ grid0: g, steps: run.steps, multAfter: mult, payX: run.payX, retrigger, stickyReels });
            if (payX + basePayX + (out.respin?.payX ?? 0) >= MAX_WIN_X)
                break; // 上限到達で打ち切り
        }
        out.free = { mode: mode.key, spinsTotal: total, spins, finalMult: mult, wildMult, payX };
    }
    const sum = basePayX + (out.respin?.payX ?? 0) + (out.free?.payX ?? 0);
    out.totalPayX = Math.min(sum, MAX_WIN_X);
    out.maxWin = sum >= MAX_WIN_X;
    return out;
}
//# sourceMappingURL=slot.js.map