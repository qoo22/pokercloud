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
export const REELS = 5;
export const ROWS = 3;
/**
 * 配当表と重み。
 * 重みは sim-slot.mjs の実測でRTP・ヒット率・突入率が目標帯に入るよう調整してある。
 * 触ると期待値が動くので、必ずシミュレーションを回し直すこと。
 */
export const PAY_SYMBOLS = [
    // 下位3種は「4個から配当」。3個で当たる絵柄を絞ることでヒット率を業界水準(20〜30%)まで
    // 落としつつ、1回の当たりの価値を残している(243waysは放っておくと当たりすぎる)
    { key: 'chip', name: 'チップ', pay: [0, 0.075, 0.27], weight: 100 },
    { key: 'club', name: 'クラブ', pay: [0, 0.105, 0.38], weight: 88 },
    { key: 'diamond', name: 'ダイヤ', pay: [0, 0.16, 0.53], weight: 76 },
    { key: 'heart', name: 'ハート', pay: [0, 0.21, 0.80], weight: 62 },
    { key: 'spade', name: 'スペード', pay: [0.085, 0.37, 1.43], weight: 48 },
    { key: 'crown', name: '王冠', pay: [0.16, 0.74, 2.76], weight: 32 },
    { key: 'seven', name: 'セブン', pay: [0.43, 2.02, 9.14], weight: 18 },
];
/**
 * 抽選パラメータ。**オブジェクトにしてあるのは調整スクリプトから差し替えるため**
 * (scripts/tune-slot.mjs が数値を振ってRTPを合わせる)。実運用では書き換えないこと。
 * ワイルドは中3リールのみ(端に出ると当たりすぎる)。スキャッターは全リール。
 */
export const SLOT_CFG = {
    wildWeight: 26,
    scatterWeight: 11,
    /** アンティベット時のスキャッター重み(突入率がおよそ2倍になる) */
    scatterWeightAnte: 15,
    /** アンティベットの賭け金倍率 */
    anteCost: 1.5,
};
/** スキャッター3/4/5個そのものの配当(×賭け金) */
export const SCATTER_PAY = { 3: 2, 4: 5, 5: 20 };
/** 通常時のタンブル倍率のはしご。連鎖するほど上がる */
export const TUMBLE_LADDER = [1, 2, 3, 5, 10];
export const FREE_MODES = [
    { key: 'many', name: '回数多め', desc: '15回 / ×1から+3ずつ', spins: 15, startMult: 1, step: 3 },
    { key: 'few', name: '一撃高倍率', desc: '8回 / ×7から+8ずつ', spins: 8, startMult: 7, step: 8 },
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
 * 243ways の判定。左のリールから連続して同じ絵柄(ワイルド代用可)が並ぶ数だけ配当。
 * ways = 各リールの該当個数の積。
 */
function evaluate(grid) {
    const wins = [];
    const hitSet = new Set();
    for (const sym of PAY_SYMBOLS) {
        // 各リールで「その絵柄 or ワイルド」の位置を集める
        const perReel = [];
        for (let r = 0; r < REELS; r++) {
            const rows = [];
            for (let y = 0; y < ROWS; y++) {
                const c = grid[r][y];
                if (c === sym.key || c === 'wild')
                    rows.push(y);
            }
            perReel.push(rows);
        }
        // 左から連続している長さ
        let len = 0;
        while (len < REELS && perReel[len].length > 0)
            len++;
        if (len < 3)
            continue;
        let ways = 1;
        for (let r = 0; r < len; r++)
            ways *= perReel[r].length;
        const pay = sym.pay[len - 3] * ways;
        if (pay <= 0)
            continue;
        wins.push({ key: sym.key, count: len, ways, pay });
        for (let r = 0; r < len; r++)
            for (const y of perReel[r])
                hitSet.add(`${r},${y}`);
    }
    const hits = [...hitSet].map((s) => {
        const [a, b] = s.split(',');
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
/** 当たった位置を消して上から詰め、空きを新しい絵柄で埋める */
function tumble(grid, hits, rnd, scatterWeight) {
    const dead = new Set(hits.map(([r, y]) => `${r},${y}`));
    const out = [];
    for (let r = 0; r < REELS; r++) {
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
        const raw = wins.reduce((a, w) => a + w.pay, 0);
        const m = opts.persistent ? mult : (opts.ladder ?? TUMBLE_LADDER)[Math.min(chain, (opts.ladder ?? TUMBLE_LADDER).length - 1)];
        const got = raw * m;
        steps.push({ grid, hits, wins, mult: m, payX: got });
        payX += got;
        // フリーゲームは当たるたびに永続マルチプライヤーが伸びる
        if (opts.persistent)
            mult += opts.persistent.step;
        grid = tumble(grid, hits, rnd, scatterWeight);
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
    const scatters = countScatter(grid0);
    const baseRun = runTumbles(grid0, rnd, sw, { ladder: TUMBLE_LADDER });
    let basePayX = baseRun.payX + (SCATTER_PAY[Math.min(scatters, 5)] ?? 0);
    const out = {
        grid0,
        base: baseRun.steps,
        basePayX,
        scatters,
        freeEntered: scatters >= 3,
        totalPayX: 0,
        maxWin: false,
    };
    if (out.freeEntered) {
        const mode = FREE_MODES.find((m) => m.key === (opts.mode ?? 'many')) ?? FREE_MODES[0];
        // 4個/5個で追加スピン
        let left = mode.spins + (scatters >= 5 ? 6 : scatters === 4 ? 3 : 0);
        let total = left;
        let mult = mode.startMult;
        let payX = 0;
        const spins = [];
        // 安全弁: リトリガーが続いても止まるように上限を置く
        for (let guard = 0; left > 0 && guard < 200; guard++) {
            left--;
            const g = newGrid(rnd, sw);
            const sc = countScatter(g);
            const run = runTumbles(g, rnd, sw, { persistent: { mult, step: mode.step } });
            mult = run.multAfter;
            payX += run.payX;
            const retrigger = sc >= 3;
            if (retrigger) {
                left += RETRIGGER_SPINS;
                total += RETRIGGER_SPINS;
            }
            spins.push({ grid0: g, steps: run.steps, multAfter: mult, payX: run.payX, retrigger });
            if (payX + basePayX >= MAX_WIN_X)
                break; // 上限到達で打ち切り
        }
        out.free = { mode: mode.key, spinsTotal: total, spins, finalMult: mult, payX };
    }
    const sum = basePayX + (out.free?.payX ?? 0);
    out.totalPayX = Math.min(sum, MAX_WIN_X);
    out.maxWin = sum >= MAX_WIN_X;
    return out;
}
//# sourceMappingURL=slot.js.map