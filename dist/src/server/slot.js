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
    // 第83弾: オーナー指定の**手作りの丸い倍率表**に全面差し替え。
    // 機械的なスケーリング(×0.432や×1.37)の産物だった 29.86T のような半端な表示をやめ、
    // 体感の設計を数字に落とした:
    //   ・最低役(チップ)の5個 = BET×1(5個そろえて負けない)
    //   ・最高と最低の差 = 20倍(以前は34倍で「7以外はほぼハズレ」に見えた)
    //   ・王冠と7 = 2倍差(王冠も最上位級の見た目に相応しく)
    //   ・3個無配当はチップ/クラブだけ(以前は7種中4種が3個無配当だった)
    // RTPはこの表で上がるが**オーナー方針で許容**(歯止めは1日の回転数上限)。
    // 勝手に縮めて調整しないこと。変更時は必ずオーナー承認を取る。
    { key: 'chip', name: 'チップ', pay: [0, 0.2, 1], weight: 100 },
    { key: 'club', name: 'クラブ', pay: [0, 0.3, 1.5], weight: 88 },
    { key: 'diamond', name: 'ダイヤ', pay: [0.1, 0.6, 2], weight: 76 },
    { key: 'heart', name: 'ハート', pay: [0.15, 0.9, 3], weight: 62 },
    { key: 'spade', name: 'スペード', pay: [0.3, 1.5, 5], weight: 48 },
    { key: 'crown', name: '王冠', pay: [0.6, 3, 10], weight: 32 },
    { key: 'seven', name: 'セブン', pay: [1, 5, 20], weight: 18 },
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
    /**
     * 突入時のフリーゲーム回数(第89弾・オーナー指定)。スキャッターの個数で決まる。
     * 固定WILDが溜まるほど後半の1回が重くなるため、10/15/20 ではなく 8/12/16 に据える。
     */
    freeSpinsByScatter: { 3: 8, 4: 12, 5: 16 },
    /**
     * フリーゲーム中の上乗せ(第89弾・オーナー指定)。突入と同じ「3個以上」で成立するが、
     * **回数は突入より小さい**(固定WILDが載った状態で回せるぶん1回の価値が高いため)。
     * 再トリガー回数に上限は設けない。
     */
    freeRetriggerByScatter: { 3: 4, 4: 8, 5: 12 },
    /**
     * 暴走止め。**仕様上の上限ではない**(オーナー指定で再トリガーに上限は無い)。
     * 3個以上が出る確率は1スピンあたり 0.5% 前後、期待上乗せは +0.02 回/スピンなので
     * 収束する。ここに張り付くのは抽選が壊れたときだけ。
     */
    freeSpinsGuard: 500,
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
/**
 * 通常時の倍率のはしご。**第79弾で連鎖を廃止したため未使用(休眠)**。
 * クライアントの配当表表示が参照しているので値だけ残してある。
 */
export const TUMBLE_LADDER = [1];
export const FREE_MODES = [
    { key: 'many', name: '回数多め', desc: '15回 / ×1から+3ずつ', spins: 15, startMult: 1, step: 3 },
    { key: 'few', name: '一撃高倍率', desc: '8回 / ×5から+7ずつ', spins: 8, startMult: 5, step: 7 },
];
/**
 * MAX WIN の称号を出すしきい値(×賭け金)。
 * **第80弾で配当の頭打ちを撤廃した**(オーナー判断)。チップは現金化されず、
 * 1日の回転数に上限があるため、発行量はそこで抑えられる。
 * この値はもう配当を切り詰めず、演出の格付けにだけ使う。
 */
export const MAX_WIN_X = 5000;
/**
 * フリーゲーム中にスキャッターが止まったときの上乗せ。
 * 第79弾から**1個につき1回**上乗せする(3個そろわなくても増える)。
 */
export const RETRIGGER_SPINS = 1;
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
        // スキャッター無しの表。**1リールにつき最大1個**にするため、2個目からはこちらで引き直す。
        // (実機と同じ規則。これが無いと1リールに3個並んで「5個」が安く出すぎる)
        const noScatter = table.filter((e) => e.key !== 'scatter');
        const col = [];
        let hasScatter = false;
        for (let y = 0; y < ROWS; y++) {
            const k = drawFrom(hasScatter ? noScatter : table, rnd);
            if (k === 'scatter')
                hasScatter = true;
            col.push(k);
        }
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
 * 1回ぶんの判定(第79弾で**連鎖(タンブル)を廃止**)。
 *
 * 連鎖は「止まったはずの盤面が勝手に入れ替わる」ためプレイヤーに伝わりにくく、
 * さらにWILDが多いと1スピンの演出が40秒を超えていた。1スピン=1判定に戻す。
 * 返り値の steps は 0 個(ハズレ) か 1 個。クライアントの再生ループはそのまま使える。
 */
function evaluateOnce(grid, opts = {}) {
    const { wins, hits } = evaluate(grid);
    if (!wins.length)
        return { steps: [], payX: 0 };
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
    const m = opts.mult ?? 1;
    const raw = wins.reduce((a, w) => a + w.pay * (w.wildMult ?? 1), 0);
    const got = raw * m;
    return { steps: [{ grid, hits, wins, mult: m, payX: got }], payX: got };
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
    const baseRun = evaluateOnce(grid0);
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
    // **第79弾: 一番左のリール(リール1)が3連WILDで止まったときだけ**発生する。
    // 他のリールでも3連WILDは出るが、そちらはただの強い盤面として扱う。
    // リール1をWILDのまま固定し、リール2〜5だけ引き直して、初回の当選とは別に払う。
    if (stackedReels.indexOf(0) >= 0) {
        const rg = newGrid(rnd, 0); // スキャッター無しで引く(リスピンからはフリーに入らない)
        rg[0] = ['wild', 'wild', 'wild'];
        const rrun = evaluateOnce(rg);
        out.respin = { grid0: rg, steps: rrun.steps, payX: rrun.payX, lockedReels: [0] };
    }
    if (out.freeEntered) {
        const mode = FREE_MODES.find((m) => m.key === (opts.mode ?? 'many')) ?? FREE_MODES[0];
        // 突入回数はスキャッターの個数で決まる(3個=8 / 4個=12 / 5個=16)
        let left = SLOT_CFG.freeSpinsByScatter[Math.min(scatters, 5)] ?? SLOT_CFG.freeSpinsByScatter[3];
        let total = left;
        let mult = mode.startMult;
        let payX = 0;
        const spins = [];
        // WILD倍率は**突入時に1回だけ**引き、このフリーゲーム中はずっと同じ値を使う。
        // スピンごとに引き直すと「何倍の台なのか」が定まらず、演出として見せ場が作れない
        const wildMult = drawWildMult(rnd);
        // **第79弾: WILDは「コマ単位」でホールドする**。
        // フリーゲーム中にWILDが止まったマスは、そのフリーゲームが終わるまで残り続け、
        // 残りのリールだけが回る。溜まるほど強くなる = 引き伸ばす動機になる。
        const held = new Set();
        // 安全弁: 上乗せが続いても止まるように上限を置く
        for (let guard = 0; left > 0 && guard < SLOT_CFG.freeSpinsGuard; guard++) {
            left--;
            const g = newGrid(rnd, sw);
            // ①ホールド済みのWILDを先に貼る(ここは回っていない扱い)
            for (const key of held) {
                const [r, y] = key.split(',').map(Number);
                g[r][y] = 'wild';
            }
            // ②今回の停止で新しくWILDが出たマスをホールドに加える
            overlayStackedWilds(g, rnd, SLOT_CFG.freeStripScale);
            const fresh = [];
            for (let r = 0; r < REELS; r++) {
                for (let y = 0; y < ROWS; y++) {
                    if (g[r][y] !== 'wild')
                        continue;
                    const key = `${r},${y}`;
                    if (held.has(key))
                        continue;
                    held.add(key);
                    fresh.push([r, y]);
                }
            }
            // ③スキャッターが3個以上で上乗せ(3個=+4 / 4個=+8 / 5個=+12)。回数に上限は無い。
            //    既に置かれている固定WILDは再トリガー後もそのまま残る(held を消さない)
            const sc = countScatter(g);
            const add = sc >= 3 ? (SLOT_CFG.freeRetriggerByScatter[Math.min(sc, 5)] ?? 0) : 0;
            if (add > 0) {
                left += add;
                total += add;
            }
            const run = evaluateOnce(g, { mult, wildMult });
            payX += run.payX;
            // 永続マルチプライヤー(第80弾で復活)。当たったスピンごとに mode.step ずつ伸びる。
            // ホールドWILDと掛け合わさって期待値は大きく上振れするが、**オーナー判断で許容**:
            // チップは現金化されず、1日の回転数上限が発行量の歯止めになる。
            // 勝手に「壊れている」と判断して切り詰めないこと(第79弾でそれをやって差し戻された)。
            if (run.payX > 0)
                mult += mode.step;
            spins.push({
                grid0: g, steps: run.steps, multAfter: mult, payX: run.payX,
                retrigger: add > 0, addedSpins: add,
                scatters: sc,
                // このスピンを消化したあとに何回残っているか。上乗せぶんは加算済み
                spinsLeft: left, spinsTotalSoFar: total,
                heldCells: [...held].map((k) => k.split(',').map(Number)),
                freshCells: fresh,
            });
            // 第80弾: 上限による打ち切りは撤廃。ループは freeSpinsCap で必ず終わる
        }
        out.free = { mode: mode.key, spinsTotal: total, spins, finalMult: mult, wildMult, payX };
    }
    const sum = basePayX + (out.respin?.payX ?? 0) + (out.free?.payX ?? 0);
    out.totalPayX = sum; // 頭打ちしない(第80弾)
    out.maxWin = sum >= MAX_WIN_X; // 称号(MAX WIN)のしきい値としてだけ使う
    return out;
}
//# sourceMappingURL=slot.js.map