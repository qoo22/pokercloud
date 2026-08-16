/**
 * 役判定
 *
 * 設計方針：
 *   5枚の判定を「絶対に間違えない形」で書き、7枚は 21 通りの組み合わせの最大値を取る。
 *   ビット演算で 7枚を直接判定する高速版も書けるが、P0 では正しさを優先した。
 *   （テストでは高速化前提の性質——例えば役の出現頻度が理論値と一致すること——を検証している）
 */
import { rankOf, suitOf, cardToDisplay } from './cards.js';
export var HandCategory;
(function (HandCategory) {
    HandCategory[HandCategory["HighCard"] = 0] = "HighCard";
    HandCategory[HandCategory["Pair"] = 1] = "Pair";
    HandCategory[HandCategory["TwoPair"] = 2] = "TwoPair";
    HandCategory[HandCategory["Trips"] = 3] = "Trips";
    HandCategory[HandCategory["Straight"] = 4] = "Straight";
    HandCategory[HandCategory["Flush"] = 5] = "Flush";
    HandCategory[HandCategory["FullHouse"] = 6] = "FullHouse";
    HandCategory[HandCategory["Quads"] = 7] = "Quads";
    HandCategory[HandCategory["StraightFlush"] = 8] = "StraightFlush";
})(HandCategory || (HandCategory = {}));
const CATEGORY_NAMES_JA = {
    [HandCategory.HighCard]: 'ハイカード',
    [HandCategory.Pair]: 'ワンペア',
    [HandCategory.TwoPair]: 'ツーペア',
    [HandCategory.Trips]: 'スリーカード',
    [HandCategory.Straight]: 'ストレート',
    [HandCategory.Flush]: 'フラッシュ',
    [HandCategory.FullHouse]: 'フルハウス',
    [HandCategory.Quads]: 'フォーカード',
    [HandCategory.StraightFlush]: 'ストレートフラッシュ',
};
const RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const label = (r) => RANK_LABEL[r - 2];
/** 日本語の役名（キッカーまで含む説明） */
export function describeHand(hv) {
    const base = CATEGORY_NAMES_JA[hv.category];
    switch (hv.category) {
        case HandCategory.StraightFlush:
            return hv.ranks[0] === 14 ? 'ロイヤルフラッシュ' : `${base}（${label(hv.ranks[0])}ハイ）`;
        case HandCategory.Quads:
            return `${base}（${label(hv.ranks[0])}）`;
        case HandCategory.FullHouse:
            return `${base}（${label(hv.ranks[0])} over ${label(hv.ranks[1])}）`;
        case HandCategory.Flush:
            return `${base}（${label(hv.ranks[0])}ハイ）`;
        case HandCategory.Straight:
            return `${base}（${label(hv.ranks[0])}ハイ）`;
        case HandCategory.Trips:
            return `${base}（${label(hv.ranks[0])}）`;
        case HandCategory.TwoPair:
            return `${base}（${label(hv.ranks[0])} & ${label(hv.ranks[1])}）`;
        case HandCategory.Pair:
            return `${base}（${label(hv.ranks[0])}）`;
        default:
            return `${base}（${label(hv.ranks[0])}ハイ）`;
    }
}
export function handToString(hv) {
    return `${describeHand(hv)} [${hv.cards.map(cardToDisplay).join(' ')}]`;
}
/**
 * ちょうど 5 枚の役を判定する。
 */
export function evaluate5(cards) {
    if (cards.length !== 5)
        throw new Error(`evaluate5 には 5 枚必要です（${cards.length} 枚渡されました）`);
    // ランクごとの枚数
    const counts = new Array(15).fill(0);
    let suitMask = 0;
    for (const c of cards) {
        counts[rankOf(c)]++;
        suitMask |= 1 << suitOf(c);
    }
    const isFlush = (suitMask & (suitMask - 1)) === 0; // 1ビットだけ立っている＝全部同スート
    // ランクを枚数降順 → ランク降順で並べる。
    // これで [3,3,3,K,K] は [3,K]、[A,A,K,K,Q] は [A,K,Q] という順序になる。
    const grouped = [];
    for (let r = 14; r >= 2; r--) {
        if (counts[r] > 0)
            grouped.push({ rank: r, count: counts[r] });
    }
    grouped.sort((a, b) => b.count - a.count || b.rank - a.rank);
    // ストレート判定（5 枚なのでランクが全部異なる場合のみ成立しうる）
    let straightHigh = 0;
    if (grouped.length === 5) {
        const rs = grouped.map((g) => g.rank); // 降順
        if (rs[0] - rs[4] === 4) {
            straightHigh = rs[0];
        }
        else if (rs[0] === 14 && rs[1] === 5 && rs[2] === 4 && rs[3] === 3 && rs[4] === 2) {
            // ホイール（A-2-3-4-5）。A は 1 として扱うので 5 ハイ
            straightHigh = 5;
        }
    }
    const sortedCards = sortForDisplay(cards, grouped, straightHigh);
    if (isFlush && straightHigh) {
        return { category: HandCategory.StraightFlush, ranks: [straightHigh], cards: sortedCards };
    }
    if (grouped[0].count === 4) {
        return { category: HandCategory.Quads, ranks: [grouped[0].rank, grouped[1].rank], cards: sortedCards };
    }
    if (grouped[0].count === 3 && grouped[1].count === 2) {
        return { category: HandCategory.FullHouse, ranks: [grouped[0].rank, grouped[1].rank], cards: sortedCards };
    }
    if (isFlush) {
        return { category: HandCategory.Flush, ranks: grouped.map((g) => g.rank), cards: sortedCards };
    }
    if (straightHigh) {
        return { category: HandCategory.Straight, ranks: [straightHigh], cards: sortedCards };
    }
    if (grouped[0].count === 3) {
        return {
            category: HandCategory.Trips,
            ranks: [grouped[0].rank, grouped[1].rank, grouped[2].rank],
            cards: sortedCards,
        };
    }
    if (grouped[0].count === 2 && grouped[1].count === 2) {
        return {
            category: HandCategory.TwoPair,
            ranks: [grouped[0].rank, grouped[1].rank, grouped[2].rank],
            cards: sortedCards,
        };
    }
    if (grouped[0].count === 2) {
        return {
            category: HandCategory.Pair,
            ranks: [grouped[0].rank, grouped[1].rank, grouped[2].rank, grouped[3].rank],
            cards: sortedCards,
        };
    }
    return { category: HandCategory.HighCard, ranks: grouped.map((g) => g.rank), cards: sortedCards };
}
/** 表示用にカードを役の重要度順に並べ替える（A-5 ストレートは 5 を先頭にする） */
function sortForDisplay(cards, grouped, straightHigh) {
    if (straightHigh === 5) {
        // ホイールは 5 4 3 2 A の順に見せる
        const order = [5, 4, 3, 2, 14];
        return order.map((r) => cards.find((c) => rankOf(c) === r));
    }
    const priority = new Map();
    grouped.forEach((g, i) => priority.set(g.rank, i));
    return cards.slice().sort((a, b) => priority.get(rankOf(a)) - priority.get(rankOf(b)));
}
// ---------------------------------------------------------------------------
// 高速スコアリング
// ---------------------------------------------------------------------------
/**
 * 5 枚の役を「比較可能な 1 個の整数」に変換する。メモリ確保を一切しない。
 *
 * evaluate5 は HandValue オブジェクトを返すため、7 枚判定で 21 回呼ぶと
 * 1 ハンドあたり数十個のオブジェクトが生成される。数十万ハンドを回すシミュレーションでは
 * これが支配的なコストになるので、勝ち組み合わせの選択にはこちらを使う。
 *
 * エンコード： category * 15^5 + d0 * 15^4 + d1 * 15^3 + ... （d は 0〜14）
 */
const _counts = new Int32Array(15);
const _ordered = new Int32Array(5);
export function rank5(c0, c1, c2, c3, c4) {
    _counts.fill(0);
    _counts[(c0 >> 2) + 2]++;
    _counts[(c1 >> 2) + 2]++;
    _counts[(c2 >> 2) + 2]++;
    _counts[(c3 >> 2) + 2]++;
    _counts[(c4 >> 2) + 2]++;
    const suitMask = (1 << (c0 & 3)) | (1 << (c1 & 3)) | (1 << (c2 & 3)) | (1 << (c3 & 3)) | (1 << (c4 & 3));
    const isFlush = (suitMask & (suitMask - 1)) === 0;
    // 枚数の多い順 → ランクの高い順に並べる
    let k = 0;
    for (let cnt = 4; cnt >= 1; cnt--) {
        for (let r = 14; r >= 2; r--) {
            if (_counts[r] === cnt)
                _ordered[k++] = r;
        }
    }
    const distinct = k;
    let straightHigh = 0;
    if (distinct === 5) {
        if (_ordered[0] - _ordered[4] === 4)
            straightHigh = _ordered[0];
        else if (_ordered[0] === 14 && _ordered[1] === 5)
            straightHigh = 5; // ホイール
    }
    const topCount = _counts[_ordered[0]];
    let cat;
    let d0 = 0, d1 = 0, d2 = 0, d3 = 0, d4 = 0;
    if (isFlush && straightHigh) {
        cat = HandCategory.StraightFlush;
        d0 = straightHigh;
    }
    else if (topCount === 4) {
        cat = HandCategory.Quads;
        d0 = _ordered[0];
        d1 = _ordered[1];
    }
    else if (topCount === 3 && distinct === 2) {
        cat = HandCategory.FullHouse;
        d0 = _ordered[0];
        d1 = _ordered[1];
    }
    else if (isFlush) {
        cat = HandCategory.Flush;
        d0 = _ordered[0];
        d1 = _ordered[1];
        d2 = _ordered[2];
        d3 = _ordered[3];
        d4 = _ordered[4];
    }
    else if (straightHigh) {
        cat = HandCategory.Straight;
        d0 = straightHigh;
    }
    else if (topCount === 3) {
        cat = HandCategory.Trips;
        d0 = _ordered[0];
        d1 = _ordered[1];
        d2 = _ordered[2];
    }
    else if (topCount === 2 && distinct === 3) {
        cat = HandCategory.TwoPair;
        d0 = _ordered[0];
        d1 = _ordered[1];
        d2 = _ordered[2];
    }
    else if (topCount === 2) {
        cat = HandCategory.Pair;
        d0 = _ordered[0];
        d1 = _ordered[1];
        d2 = _ordered[2];
        d3 = _ordered[3];
    }
    else {
        cat = HandCategory.HighCard;
        d0 = _ordered[0];
        d1 = _ordered[1];
        d2 = _ordered[2];
        d3 = _ordered[3];
        d4 = _ordered[4];
    }
    return ((((cat * 15 + d0) * 15 + d1) * 15 + d2) * 15 + d3) * 15 + d4;
}
// 7 枚から 5 枚を選ぶ 21 通りのインデックス
const COMBOS_7C5 = (() => {
    const out = [];
    for (let a = 0; a < 7; a++)
        for (let b = a + 1; b < 7; b++)
            for (let c = b + 1; c < 7; c++)
                for (let d = c + 1; d < 7; d++)
                    for (let e = d + 1; e < 7; e++)
                        out.push([a, b, c, d, e]);
    return out;
})();
/**
 * 5〜7 枚のベストハンドを整数スコアで返す。オブジェクトを作らない版。
 * 勝敗判定だけが必要な場面（シミュレーション、エクイティ計算）ではこちらを使う。
 */
export function scoreBest(cards) {
    const n = cards.length;
    if (n === 5)
        return rank5(cards[0], cards[1], cards[2], cards[3], cards[4]);
    if (n === 7) {
        let best = -1;
        for (let i = 0; i < 21; i++) {
            const c = COMBOS_7C5[i];
            const s = rank5(cards[c[0]], cards[c[1]], cards[c[2]], cards[c[3]], cards[c[4]]);
            if (s > best)
                best = s;
        }
        return best;
    }
    if (n === 6) {
        let best = -1;
        for (let skip = 0; skip < 6; skip++) {
            const idx = [];
            for (let i = 0; i < 6; i++)
                if (i !== skip)
                    idx.push(i);
            const s = rank5(cards[idx[0]], cards[idx[1]], cards[idx[2]], cards[idx[3]], cards[idx[4]]);
            if (s > best)
                best = s;
        }
        return best;
    }
    throw new Error(`scoreBest は 5〜7 枚に対応しています（${n} 枚渡されました）`);
}
/**
 * 5〜7 枚から最強の 5 枚を選ぶ。
 * ホールカード 2 枚 + ボード 5 枚 = 7 枚が通常の入力。
 */
export function evaluateBest(cards) {
    if (cards.length === 5)
        return evaluate5(cards);
    // まず整数スコアで最強の組み合わせを特定し、その 1 通りだけ HandValue を組み立てる。
    // 21 回すべてでオブジェクトを作るのに比べて 1 桁以上速い。
    let best = -1;
    let bestCombo = null;
    if (cards.length === 7) {
        for (let i = 0; i < 21; i++) {
            const c = COMBOS_7C5[i];
            const s = rank5(cards[c[0]], cards[c[1]], cards[c[2]], cards[c[3]], cards[c[4]]);
            if (s > best) {
                best = s;
                bestCombo = c;
            }
        }
    }
    else if (cards.length === 6) {
        for (let skip = 0; skip < 6; skip++) {
            const idx = [];
            for (let i = 0; i < 6; i++)
                if (i !== skip)
                    idx.push(i);
            const s = rank5(cards[idx[0]], cards[idx[1]], cards[idx[2]], cards[idx[3]], cards[idx[4]]);
            if (s > best) {
                best = s;
                bestCombo = idx;
            }
        }
    }
    else {
        throw new Error(`evaluateBest は 5〜7 枚に対応しています（${cards.length} 枚渡されました）`);
    }
    return evaluate5(bestCombo.map((i) => cards[i]));
}
/** a が強ければ正、b が強ければ負、完全同値なら 0 */
export function compareHands(a, b) {
    if (a.category !== b.category)
        return a.category - b.category;
    const n = Math.min(a.ranks.length, b.ranks.length);
    for (let i = 0; i < n; i++) {
        if (a.ranks[i] !== b.ranks[i])
            return a.ranks[i] - b.ranks[i];
    }
    return 0;
}
/**
 * 複数プレイヤーのハンドを比較し、勝者のインデックス配列を返す（同点なら複数）。
 * hands の要素が null のプレイヤー（フォールド済みなど）は無視される。
 */
export function findWinners(hands) {
    let best = null;
    let winners = [];
    for (let i = 0; i < hands.length; i++) {
        const h = hands[i];
        if (!h)
            continue;
        if (!best) {
            best = h;
            winners = [i];
            continue;
        }
        const cmp = compareHands(h, best);
        if (cmp > 0) {
            best = h;
            winners = [i];
        }
        else if (cmp === 0) {
            winners.push(i);
        }
    }
    return winners;
}
//# sourceMappingURL=evaluator.js.map