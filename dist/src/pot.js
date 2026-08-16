/**
 * ポットとサイドポット
 *
 * ここはポーカーエンジンで最もバグが出やすい箇所。
 * 「誰がいくら出したか」だけを入力に、レイヤー構造のポットを組み立てる純粋関数にしてある。
 * ハンド進行の状態を一切参照しないので、単体テストで総当たり検証できる。
 */
/**
 * コールされなかったベットの返却額を計算する。
 *
 * 例：A が 1000 ベット、B が 300 でオールインし他は全員フォールド。
 * このとき A の 700 は誰にもコールされていないので A に返す。
 * これを忘れるとチップが消滅する（＝プレイヤーからは「盗まれた」ように見える）。
 *
 * 注意：フォールドしたプレイヤーの出資も「コールした額」として数える。
 *       降りる前に出したチップはポットに残るため。
 */
export function computeUncalledReturn(contributions) {
    let top = -1;
    let topSeat = -1;
    let second = -1;
    for (let i = 0; i < contributions.length; i++) {
        const c = contributions[i];
        if (c > top) {
            second = top;
            top = c;
            topSeat = i;
        }
        else if (c > second) {
            second = c;
        }
    }
    if (topSeat < 0 || second < 0)
        return null;
    if (top <= second)
        return null;
    return { seat: topSeat, amount: top - second };
}
/**
 * 出資額とフォールド状態からポット（メイン + サイド）を構築する。
 *
 * アルゴリズム：
 *   出資額のユニーク値を昇順に並べ、それを「水位」として層を積み上げる。
 *   各層の金額は「全員がその水位まで出した分の合計」、
 *   その層を取れるのは「降りておらず、かつその水位以上を出したプレイヤー」。
 *
 * @param contributions 席ごとの、このハンドでの総出資額（返却分は差し引き済みであること）
 * @param folded        席ごとのフォールド状態
 */
export function buildPots(contributions, folded) {
    const n = contributions.length;
    if (folded.length !== n)
        throw new Error('contributions と folded の長さが一致していません');
    const levels = Array.from(new Set(contributions.filter((c) => c > 0))).sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
        let amount = 0;
        for (let i = 0; i < n; i++) {
            const c = contributions[i];
            amount += Math.min(c, level) - Math.min(c, prev);
        }
        if (amount <= 0) {
            prev = level;
            continue;
        }
        const eligible = [];
        for (let i = 0; i < n; i++) {
            if (!folded[i] && contributions[i] >= level)
                eligible.push(i);
        }
        if (eligible.length === 0) {
            // 全員フォールドした層。直前のポットに合算する（起こりにくいが理論上ありうる）
            if (pots.length > 0)
                pots[pots.length - 1].amount += amount;
            else
                pots.push({ amount, eligible: [], level: 0 });
            prev = level;
            continue;
        }
        // 直前の層と権利者が同一なら、分ける意味がないのでまとめる
        const last = pots[pots.length - 1];
        if (last && sameSeats(last.eligible, eligible)) {
            last.amount += amount;
        }
        else {
            pots.push({ amount, eligible, level: pots.length });
        }
        prev = level;
    }
    // level を振り直す
    pots.forEach((p, i) => (p.level = i));
    return pots;
}
function sameSeats(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            return false;
    return true;
}
/**
 * 1 つのポットを勝者間で分配する。
 *
 * 端数の扱い：ボタンの左隣（最初にアクションする席）から時計回りに、勝者の中で最初に見つかった
 * プレイヤーに与える。これはライブポーカーの標準ルールで、実装ごとにブレやすいので明示的に固定した。
 *
 * @param winners       この ポットの勝者（席インデックス）
 * @param buttonIndex   ボタンの席インデックス
 * @param seatCount     テーブルの席数
 */
export function awardPot(pot, winners, buttonIndex, seatCount) {
    const shares = new Map();
    if (winners.length === 0)
        return { pot, shares, oddChipSeat: null };
    const base = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - base * winners.length;
    for (const w of winners)
        shares.set(w, base);
    let oddChipSeat = null;
    if (remainder > 0) {
        // ボタンの左隣から時計回りに走査
        const ordered = [];
        for (let i = 1; i <= seatCount; i++) {
            const seat = (buttonIndex + i) % seatCount;
            if (winners.includes(seat))
                ordered.push(seat);
        }
        for (const seat of ordered) {
            if (remainder <= 0)
                break;
            shares.set(seat, (shares.get(seat) ?? 0) + 1);
            if (oddChipSeat === null)
                oddChipSeat = seat;
            remainder--;
        }
    }
    return { pot, shares, oddChipSeat };
}
/**
 * レーキを計算する。
 *
 * ソーシャルポーカーにおけるレーキは収益ではなく、チップ経済のインフレを抑える
 * 「シンク（消滅装置）」である。仕様書では低レート帯をノーレーキにして
 * 新規プレイヤーの初期残高を保護する設計にしている。
 *
 * @param potAmount   レーキ対象のポット額
 * @param percent     レーキ率（0.03 = 3%）
 * @param cap         上限額（チップ単位）
 * @param sawFlop     フロップを見たか。false なら "no flop, no drop" でレーキ 0
 */
export function computeRake(potAmount, percent, cap, sawFlop) {
    if (!sawFlop || percent <= 0)
        return 0;
    return Math.min(Math.floor(potAmount * percent), cap);
}
//# sourceMappingURL=pot.js.map