/**
 * バカラ(第117弾)。
 *
 * ここは**純粋関数だけ**: 8デックのシューから1ハンド配り、標準の三枚目規則で
 * 勝敗を出し、払い戻しを計算する。支払い・上限・台帳は economy.ts が持つ
 * (スロットと同じ分担。抽選と金銭を分けるとテストで出目を固定できる)。
 *
 * 絞り(スクイーズ)はクライアントの演出であって、結果には一切影響しない。
 * サーバーは配った瞬間に全カードと払い戻しを確定して返す。
 */
/** バカラの数え方: 10・絵札は0、Aは1 */
export const bacValue = (r) => (r >= 10 ? 0 : r);
const tot = (cs) => cs.reduce((a, c) => a + bacValue(c.r), 0) % 10;
/**
 * バンカーが三枚目を引くか(標準規則)。
 * p3 はプレイヤー三枚目の**値**(引いていなければ null → バンカーは 0-5 で引く)
 */
export const bankerDraws = (bt, p3) => {
    if (p3 === null)
        return bt <= 5;
    if (bt <= 2)
        return true;
    if (bt === 3)
        return p3 !== 8;
    if (bt === 4)
        return p3 >= 2 && p3 <= 7;
    if (bt === 5)
        return p3 >= 4 && p3 <= 7;
    if (bt === 6)
        return p3 === 6 || p3 === 7;
    return false;
};
/**
 * 先頭から順にカードを供給する next で1ハンド進める。
 * テストはここに固定の並びを渡して三枚目規則を検証する
 */
export function dealFromCards(next) {
    const p = [next()];
    const b = [next()];
    p.push(next());
    b.push(next());
    const order = [
        { s: 'p', i: 0 },
        { s: 'b', i: 0 },
        { s: 'p', i: 1 },
        { s: 'b', i: 1 },
    ];
    const pt2 = tot(p);
    const bt2 = tot(b);
    if (pt2 < 8 && bt2 < 8) {
        let p3 = null;
        if (pt2 <= 5) {
            const c = next();
            p.push(c);
            order.push({ s: 'p', i: 2 });
            p3 = bacValue(c.r);
        }
        if (bankerDraws(bt2, p3)) {
            b.push(next());
            order.push({ s: 'b', i: 2 });
        }
    }
    const pt = tot(p);
    const bt = tot(b);
    return { p, b, order, pt, bt, res: pt > bt ? 'P' : bt > pt ? 'B' : 'T' };
}
/** 本番の入り口: 8デックを混ぜて配る。rnd 差し替えはテスト用 */
export function dealBaccarat(rnd = Math.random) {
    const shoe = [];
    for (let d = 0; d < 8; d++)
        for (let s = 0; s < 4; s++)
            for (let r = 1; r <= 13; r++)
                shoe.push({ r, s });
    for (let i = shoe.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
    let k = 0;
    return dealFromCards(() => shoe[k++]);
}
/**
 * 払い戻し(賭け金込みの戻り)。
 * PLAYER 1:1 / BANKER 0.95:1(5%コミッション・端数切り捨て) / TIE 8:1。
 * TIE のときの PLAYER・BANKER 賭けはプッシュ(返金)
 */
export function baccaratReturn(bets, res) {
    if (res === 'P')
        return bets.p * 2;
    if (res === 'B')
        return Math.floor(bets.b * 1.95);
    return bets.tie * 9 + bets.p + bets.b;
}
/**
 * 読み宣言(絞る最後の1枚が HIGH 5-9 か LOW 0-4 か)のボーナス率。
 * 値0は 10/J/Q/K の4ランクを含むため LOW(8/13≈62%) と HIGH(5/13≈38%) の
 * 的中率が大きく違う。率を変えて期待値を揃える:
 *   HIGH +25% × 5/13 ≈ +9.6% / LOW +15% × 8/13 ≈ +9.2%
 * (どちらを選んでも同じくらい。プロトタイプの一律20%は LOW 一択になるので不採用)
 */
export const BAC_DECLARE_RATE = { H: 0.25, L: 0.15 };
/** 宣言が的中したか。card は配り順で最後の1枚(=絞る札) */
export function declareHit(declare, card) {
    if (!declare)
        return false;
    const v = bacValue(card.r);
    return declare === 'H' ? v >= 5 : v <= 4;
}
//# sourceMappingURL=baccarat.js.map