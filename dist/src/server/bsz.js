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
export const BSZ_SYMS = [
    'blank',
    'cherry', 'orange', 'plum', 'melon', 'bell', 'eight', 'bar', 'red7', 'blue7', 'joker',
];
/** ダブルダウンの強さ比べに使う序列(大きいほど強い) */
export const BSZ_RANK = {
    blank: 0,
    cherry: 1, orange: 2, plum: 3, melon: 4, bell: 5, eight: 6, bar: 7, red7: 8, blue7: 9, joker: 10,
};
/**
 * 1マスの抽選重み。合計 1000。
 *
 * ブランク(何も描かれていないマス)は実機にもある最弱の図柄で、**これが無いと
 * 8ラインとANYが同時に当たりすぎる**(ブランク抜きで測ったら RTP 205%)。
 * ライン・ANYのどちらにも数えないので、ここが実質的な調整つまみになっている。
 * ジョーカーは中央に来るとフリーなので、他より大幅に薄い。
 */
export const BSZ_WEIGHTS = {
    /**
     * 実測(15万スピン×3シード)でRTPを合わせた値。
     *   60→114.5% / 90→101.4% / 95→約100% / 120→89.8% / 300→46.3%
     * GOLD RUSH の目標(約100%)に揃えてある。触ったら必ず測り直すこと
     */
    blank: 95,
    cherry: 118, orange: 112, plum: 104, melon: 92, bell: 83,
    eight: 70, bar: 55, red7: 36, blue7: 22, joker: 8,
};
/** 8ライン。マスの番号は 0..8(左上→右下) */
export const BSZ_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // 横
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // 縦
    [0, 4, 8], [2, 4, 6], // 斜め
];
/** ライン配当(3つ並び)。賭け金の何倍か */
export const BSZ_LINE_PAY = {
    joker: 100, blue7: 40, red7: 30, any7: 20, bar: 8, eight: 5,
    bell: 4, melon: 3, plum: 2, orange: 1, cherry: 1,
};
/** ANY配当。画面内の個数(3〜9個)で決まる。列=個数 */
export const BSZ_ANY_PAY = {
    cherry: { 4: 1, 5: 2, 6: 10, 7: 40, 8: 200, 9: 1000 },
    orange: { 4: 1, 5: 2, 6: 15, 7: 60, 8: 300, 9: 1500 },
    plum: { 4: 1, 5: 4, 6: 20, 7: 80, 8: 400, 9: 2000 },
    melon: { 4: 2, 5: 6, 6: 30, 7: 120, 8: 600, 9: 3000 },
    bell: { 3: 1, 4: 2, 5: 8, 6: 40, 7: 160, 8: 800, 9: 4000 },
    eight: { 3: 1, 4: 2, 5: 10, 6: 50, 7: 200, 8: 1000, 9: 5000 },
    bar: { 3: 1, 4: 3, 5: 15, 6: 60, 7: 240, 8: 1200, 9: 6000 },
    any7: { 3: 1, 4: 4, 5: 20, 6: 80, 7: 320, 8: 2000, 9: 8000 },
};
/**
 * 「ジョーカー戻り(リバース)」の出し方(第162弾)。
 *
 * 中央リールだけを逆回転させてジョーカーを中央へ引き戻す演出。
 * **これはボーナス確定演出ではない**。戻ってきても中央を外す「戻りガセ」があり、
 * 逆回転が始まった時点では当たりかガセか分からない、というのが肝。
 *
 * 大事なのは**結果を先に決めてから、それに合う演出を選ぶ**こと。
 * 演出が抽選をやり直すわけではないので、戻り方で確率は1ミリも変わらない。
 *   ・中央がジョーカー(=フリー) … reverseHit の割合で「戻って当たり」を見せる
 *     (残りは最初から中央に止まる「直停止」)
 *   ・中央がジョーカーでない     … gaseRate の割合で「戻ったのに外す」を見せる
 * この2つの比が P(当たり|逆回転) を決める。全部当たりにすると
 * 逆回転した瞬間に結果が割れてしまうので、ガセを多めに混ぜている
 */
export const BSZ_REVERSE = {
    /** フリーのうち、戻り演出で見せる割合(残りは直停止) */
    hitRate: 0.55,
    /**
     * 中央がブランクで止まったハズレのうち、戻りガセを見せる割合(第170弾)。
     *
     * リールはブランクの上下をジョーカーで挟んである。だから中央がブランクなら、
     * 「さっき通り過ぎたジョーカーが戻ってくるかもしれない」が常に成り立つ。
     * 逆に中央が果物や7で止まったときに戻り演出を出すと、リールの並びと
     * 合わない動きになるので出さない。
     *
     * 以前は中央の絵柄を問わず 1.03% だったので、ほとんど出会えなかった。
     * 中央ブランク(実測12.0%)に限ったうえで割合を上げ、実測で
     * **37回に1回**逆回転が出るようにした(以前は約60回に1回)。
     * 上げすぎると逆回転が当たり前になって焦らしが死ぬ。この値で
     * 「逆回転したときに本当に当たる率」は20%に収まる。
     */
    gaseRate: 0.18,
};
/** トンネルの倍率と重み */
export const BSZ_TUNNEL = [
    { x: 1, w: 46 }, { x: 2, w: 32 }, { x: 3, w: 16 }, { x: 5, w: 6 },
];
/** フリーの回数(実機と同じ固定5回。リトリガーは無い) */
export const BSZ_FREE_SPINS = 5;
/** 1スピンで払う上限(賭け金の何倍か)。実機の10万枚上限に相当する歯止め */
export const BSZ_MAX_WIN_X = 100_000;
/** ダブルダウンに進める上限(賭け金の何倍か)。超えると自動で確定=実機の「振り切り」 */
export const BSZ_DOUBLE_CAP_X = 5_000;
/** スペシャルボーナス(ダブル中にプレイヤー3リールが揃う)。賭け金の何倍か */
export const BSZ_SPECIAL = {
    joker: 800, blue7: 30, red7: 20, any7: 10, bar: 5, eight: 4,
    bell: 3, melon: 2, plum: 2, orange: 1, cherry: 1,
};
const pickSym = (rnd) => {
    const total = BSZ_SYMS.reduce((a, k) => a + BSZ_WEIGHTS[k], 0);
    let r = rnd() * total;
    for (const k of BSZ_SYMS) {
        r -= BSZ_WEIGHTS[k];
        if (r < 0)
            return k;
    }
    return 'cherry';
};
/** 1マスずつ引いて盤面を作る。hold に入れたマスは残す(フリーの中央固定) */
export function bszSpinGrid(rnd, hold) {
    const g = [];
    for (let i = 0; i < 9; i++)
        g.push(hold?.[i] ?? pickSym(rnd));
    return g;
}
/** ライン配当の1本ぶん。ジョーカーは代用。揃わなければ null */
function lineWin(a, b, c) {
    const cells = [a, b, c];
    if (cells.includes('blank'))
        return null; // ブランクが1つでもあればラインは切れる
    const real = cells.filter((s) => s !== 'joker');
    // 3つともジョーカー
    if (real.length === 0)
        return { key: 'joker', x: BSZ_LINE_PAY.joker };
    const first = real[0];
    if (real.every((s) => s === first))
        return { key: first, x: BSZ_LINE_PAY[first] };
    // 赤7と青7の混在は ANY 7 として成立する(実機と同じ)
    if (real.every((s) => s === 'red7' || s === 'blue7'))
        return { key: 'any7', x: BSZ_LINE_PAY.any7 };
    return null;
}
/** 盤面の判定。ライン配当と ANY 配当を別々に返す(実機と同じく両方とも足す) */
export function bszEvaluate(g) {
    const lines = [];
    BSZ_LINES.forEach((cells, i) => {
        const w = lineWin(g[cells[0]], g[cells[1]], g[cells[2]]);
        if (w)
            lines.push({ line: i, key: w.key, x: w.x, cells });
    });
    // ANY は画面内の個数で数える。7は赤青をまとめる。
    // **ジョーカーはここでは数えない**(WILDはライン専用)。数えると同じ1枚で
    // ライン配当と全種のANYを二重取りしてしまい、配当が跳ね上がる
    const anys = [];
    for (const key of Object.keys(BSZ_ANY_PAY)) {
        const n = key === 'any7'
            ? g.filter((s) => s === 'red7' || s === 'blue7').length
            : g.filter((s) => s === key).length;
        const x = BSZ_ANY_PAY[key][Math.min(9, n)];
        if (n >= 3 && x)
            anys.push({ key, count: n, x });
    }
    const payX = lines.reduce((a, l) => a + l.x, 0) + anys.reduce((a, b) => a + b.x, 0);
    return { lines, anys, payX };
}
export const bszPickTunnel = (rnd) => {
    const total = BSZ_TUNNEL.reduce((a, t) => a + t.w, 0);
    let r = rnd() * total;
    for (const t of BSZ_TUNNEL) {
        r -= t.w;
        if (r < 0)
            return t.x;
    }
    return 1;
};
/**
 * 1スピン。
 * 中央がジョーカーなら、その盤面の配当も含めてトンネル倍率がかかる(実機と同じ)。
 */
export function bszSpin(rnd = Math.random) {
    const grid0 = bszSpinGrid(rnd);
    const ev = bszEvaluate(grid0);
    const base = { grid: grid0, lines: ev.lines, anys: ev.anys, payX: ev.payX };
    const freeEntered = grid0[4] === 'joker';
    let tunnel = 0;
    const free = [];
    let sum = base.payX;
    if (freeEntered) {
        tunnel = bszPickTunnel(rnd);
        for (let i = 0; i < BSZ_FREE_SPINS; i++) {
            const g = bszSpinGrid(rnd, { 4: 'joker' }); // 中央は固定
            const e = bszEvaluate(g);
            free.push({ grid: g, lines: e.lines, anys: e.anys, payX: e.payX });
            sum += e.payX;
        }
        sum *= tunnel; // 突入時の配当にも倍率がかかる
    }
    // 結果が決まったあとで、中央リールの見せ方だけを選ぶ
    const reverse = freeEntered
        ? (rnd() < BSZ_REVERSE.hitRate ? { hit: true } : null)
        // ガセは中央がブランクのときだけ。リールの並び(ブランクの上下がジョーカー)と
        // 合う動きにしないと、戻ってきたジョーカーが宙から湧いたように見える
        : (grid0[4] === 'blank' && rnd() < BSZ_REVERSE.gaseRate ? { hit: false } : null);
    const capped = Math.min(sum, BSZ_MAX_WIN_X);
    return {
        grid0, base, freeEntered, tunnel, free, reverse,
        totalPayX: capped,
        maxWin: sum > BSZ_MAX_WIN_X,
        canDouble: capped > 0 && capped <= BSZ_DOUBLE_CAP_X,
    };
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
export function bszDouble(stakeX, keepX, rnd = Math.random, pick = 0) {
    return bszResolveDouble(bszDealDouble(rnd), stakeX, keepX, pick);
}
export function bszDealDouble(rnd = Math.random) {
    const dealer = pickSym(rnd);
    const player = [pickSym(rnd), pickSym(rnd), pickSym(rnd)];
    const tunnel = player.includes('joker') ? bszPickTunnel(rnd) : 0;
    return { dealer, player, tunnel };
}
/** 決めておいた4本と、プレイヤーが選んだ1本から勝敗を出す */
export function bszResolveDouble(deal, stakeX, keepX, pick = 0) {
    const { dealer, player } = deal;
    const idx = pick === 1 || pick === 2 ? pick : 0;
    const mine = player[idx];
    const result = BSZ_RANK[mine] > BSZ_RANK[dealer] ? 'win' : BSZ_RANK[mine] === BSZ_RANK[dealer] ? 'tie' : 'lose';
    // 3つ揃いのスペシャル(赤7と青7の混在は ANY 7 扱い)。
    // ブランク3つは配当表に無いので付かない(ここを見落とすと NaN になる)
    let specialKey = null;
    if (player[0] === player[1] && player[1] === player[2])
        specialKey = player[0];
    else if (player.every((s) => s === 'red7' || s === 'blue7'))
        specialKey = 'any7';
    let specialX = specialKey && BSZ_SPECIAL[specialKey] ? stakeX * BSZ_SPECIAL[specialKey] : 0;
    // ジョーカーが出たらトンネル倍率がスペシャルに乗る(倍率は配り時に決めてある)
    const tunnel = deal.tunnel;
    if (tunnel)
        specialX *= tunnel;
    const won = result === 'win' ? stakeX * 2 : result === 'tie' ? stakeX : 0;
    const payX = Math.min(keepX + won + specialX, BSZ_MAX_WIN_X);
    return {
        dealer, player, pick: idx, result, specialX, tunnel, payX,
        canDouble: payX > 0 && payX <= BSZ_DOUBLE_CAP_X,
    };
}
//# sourceMappingURL=bsz.js.map