import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, freshDeck, cardToString, shuffle, createSeededRng } from '../src/cards.js';
import { evaluate5, evaluateBest, compareHands, findWinners, HandCategory, describeHand, rank5, scoreBest, } from '../src/evaluator.js';
const ev = (s) => evaluate5(parseCards(s));
const ev7 = (s) => evaluateBest(parseCards(s));
describe('役のカテゴリ判定', () => {
    test('ロイヤルフラッシュ', () => {
        const h = ev('As Ks Qs Js Ts');
        assert.equal(h.category, HandCategory.StraightFlush);
        assert.deepEqual(h.ranks, [14]);
        assert.equal(describeHand(h), 'ロイヤルフラッシュ');
    });
    test('ストレートフラッシュ', () => {
        const h = ev('9h 8h 7h 6h 5h');
        assert.equal(h.category, HandCategory.StraightFlush);
        assert.deepEqual(h.ranks, [9]);
    });
    test('スチールホイール（A-5 のストレートフラッシュ）', () => {
        const h = ev('As 2s 3s 4s 5s');
        assert.equal(h.category, HandCategory.StraightFlush);
        assert.deepEqual(h.ranks, [5], 'A は 1 として扱うので 5 ハイ');
    });
    test('フォーカード', () => {
        const h = ev('7s 7h 7d 7c Kd');
        assert.equal(h.category, HandCategory.Quads);
        assert.deepEqual(h.ranks, [7, 13]);
    });
    test('フルハウス', () => {
        const h = ev('4s 4h 4d 9c 9d');
        assert.equal(h.category, HandCategory.FullHouse);
        assert.deepEqual(h.ranks, [4, 9]);
    });
    test('フラッシュ', () => {
        const h = ev('Ad Jd 9d 6d 2d');
        assert.equal(h.category, HandCategory.Flush);
        assert.deepEqual(h.ranks, [14, 11, 9, 6, 2]);
    });
    test('ストレート', () => {
        const h = ev('Ts 9h 8d 7c 6s');
        assert.equal(h.category, HandCategory.Straight);
        assert.deepEqual(h.ranks, [10]);
    });
    test('ホイール（A-2-3-4-5）は 5 ハイのストレート', () => {
        const h = ev('As 2h 3d 4c 5s');
        assert.equal(h.category, HandCategory.Straight);
        assert.deepEqual(h.ranks, [5]);
    });
    test('K-A-2-3-4 はストレートではない', () => {
        const h = ev('Ks Ah 2d 3c 4s');
        assert.equal(h.category, HandCategory.HighCard, 'A を挟んで折り返すことはできない');
    });
    test('スリーカード', () => {
        const h = ev('Qs Qh Qd 8c 3s');
        assert.equal(h.category, HandCategory.Trips);
        assert.deepEqual(h.ranks, [12, 8, 3]);
    });
    test('ツーペア', () => {
        const h = ev('Js Jh 5d 5c Ks');
        assert.equal(h.category, HandCategory.TwoPair);
        assert.deepEqual(h.ranks, [11, 5, 13]);
    });
    test('ワンペア', () => {
        const h = ev('9s 9h Ad 7c 2s');
        assert.equal(h.category, HandCategory.Pair);
        assert.deepEqual(h.ranks, [9, 14, 7, 2]);
    });
    test('ハイカード', () => {
        const h = ev('As Kh 9d 7c 3s');
        assert.equal(h.category, HandCategory.HighCard);
        assert.deepEqual(h.ranks, [14, 13, 9, 7, 3]);
    });
});
describe('強さの比較', () => {
    test('カテゴリが違えば上位が勝つ', () => {
        assert.ok(compareHands(ev('2s 2h 3d 4c 5s'), ev('As Kh Qd Jc 9s')) > 0, 'ワンペア > ハイカード');
        assert.ok(compareHands(ev('As Kh Qd Jc Ts'), ev('2s 2h 2d 3c 4s')) > 0, 'ストレート > スリーカード');
    });
    test('同カテゴリはキッカーで決まる', () => {
        assert.ok(compareHands(ev('9s 9h Ad 7c 2s'), ev('9s 9h Kd 7c 2s')) > 0, 'A キッカー > K キッカー');
        assert.ok(compareHands(ev('9s 9h Ad 7c 3s'), ev('9s 9h Ad 7c 2s')) > 0, '第4キッカーまで見る');
    });
    test('完全同値は 0', () => {
        assert.equal(compareHands(ev('9s 9h Ad 7c 2s'), ev('9d 9c Ah 7s 2h')), 0);
    });
    test('フルハウスは 3 枚組を先に見る', () => {
        assert.ok(compareHands(ev('4s 4h 4d Ac Ad'), ev('5s 5h 5d 2c 2d')) < 0, '444AA より 55522 が強い（3枚組が優先）');
    });
    test('ツーペアは上のペア→下のペア→キッカーの順', () => {
        assert.ok(compareHands(ev('Ks Kh 2d 2c 3s'), ev('Qs Qh Jd Jc As')) > 0);
        assert.ok(compareHands(ev('Ks Kh Jd Jc As'), ev('Ks Kh Jd Jc Qs')) > 0);
    });
});
describe('7 枚からのベストハンド抽出', () => {
    test('ボードのフラッシュより自分のフラッシュが優先される', () => {
        // ボード: 2d 5d 9d Kd 3c / 自分: Ad 7h → A ハイフラッシュ
        const h = ev7('Ad 7h 2d 5d 9d Kd 3c');
        assert.equal(h.category, HandCategory.Flush);
        assert.deepEqual(h.ranks, [14, 13, 9, 5, 2]);
    });
    test('同スート 4 枚はフラッシュにならない（ストレートを選ぶ）', () => {
        // スペードは 6s 7s 8s 9s の 4 枚だけ。6-T のストレートが最強になる
        const h = ev7('6s 7s 8s 9s Th 2c 3d');
        assert.equal(h.category, HandCategory.Straight);
        assert.deepEqual(h.ranks, [10]);
    });
    test('フルハウス vs フラッシュ（7枚）', () => {
        const h = ev7('Ks Kh Kd 4s 9s 2s 4h');
        assert.equal(h.category, HandCategory.FullHouse, 'KKK44 のフルハウスがフラッシュ 4 枚に勝る');
        assert.deepEqual(h.ranks, [13, 4]);
    });
    test('ボードプレイ（自分のカードが一切絡まない）', () => {
        // ボード: As Ks Qs Js Ts、自分は 2h 3d
        const h = ev7('2h 3d As Ks Qs Js Ts');
        assert.equal(h.category, HandCategory.StraightFlush);
        assert.deepEqual(h.ranks, [14]);
    });
    test('6 枚でも動作する', () => {
        const h = evaluateBest(parseCards('As Ah Kd Kc Qs Qh'));
        assert.equal(h.category, HandCategory.TwoPair);
        assert.deepEqual(h.ranks, [14, 13, 12]);
    });
});
describe('勝者判定', () => {
    test('単独勝者', () => {
        const hands = [ev('As Ah 2d 3c 4s'), ev('Ks Kh 2d 3c 4s'), null];
        assert.deepEqual(findWinners(hands), [0]);
    });
    test('チョップ（同点）', () => {
        const hands = [ev('As Ah 2d 3c 4s'), ev('Ad Ac 2h 3s 4h'), ev('Ks Kh 2d 3c 4s')];
        assert.deepEqual(findWinners(hands), [0, 1]);
    });
    test('null は無視される', () => {
        const hands = [null, ev('Ks Kh 2d 3c 4s'), null];
        assert.deepEqual(findWinners(hands), [1]);
    });
});
describe('総当たり検証', () => {
    test('52C5 = 2,598,960 通りの役の分布が理論値と一致する', () => {
        const deck = freshDeck();
        const counts = new Array(9).fill(0);
        const buf = new Array(5);
        let mismatches = 0;
        for (let a = 0; a < 48; a++)
            for (let b = a + 1; b < 49; b++)
                for (let c = b + 1; c < 50; c++)
                    for (let d = c + 1; d < 51; d++)
                        for (let e = d + 1; e < 52; e++) {
                            buf[0] = deck[a];
                            buf[1] = deck[b];
                            buf[2] = deck[c];
                            buf[3] = deck[d];
                            buf[4] = deck[e];
                            const hv = evaluate5(buf);
                            counts[hv.category]++;
                            // 高速版 rank5 が同じカテゴリを返すことを全パターンで確認する
                            if (Math.floor(rank5(buf[0], buf[1], buf[2], buf[3], buf[4]) / 759375) !== hv.category) {
                                mismatches++;
                            }
                        }
        assert.equal(mismatches, 0, 'rank5 と evaluate5 のカテゴリ判定が食い違っている');
        // 5 カードポーカーの既知の組み合わせ数
        const expected = {
            [HandCategory.HighCard]: 1302540,
            [HandCategory.Pair]: 1098240,
            [HandCategory.TwoPair]: 123552,
            [HandCategory.Trips]: 54912,
            [HandCategory.Straight]: 10200,
            [HandCategory.Flush]: 5108,
            [HandCategory.FullHouse]: 3744,
            [HandCategory.Quads]: 624,
            [HandCategory.StraightFlush]: 40,
        };
        for (const [cat, n] of Object.entries(expected)) {
            assert.equal(counts[Number(cat)], n, `カテゴリ ${cat} の組み合わせ数`);
        }
        assert.equal(counts.reduce((a, b) => a + b, 0), 2598960);
    });
    test('scoreBest と evaluateBest の順序が 7 枚でも一致する（ランダム 20,000 組）', () => {
        const rng = createSeededRng(555);
        const deck = freshDeck();
        for (let i = 0; i < 20000; i++) {
            shuffle(deck, rng);
            const a = deck.slice(0, 7);
            const b = deck.slice(7, 14);
            const cmpFast = Math.sign(scoreBest(a) - scoreBest(b));
            const cmpSlow = Math.sign(compareHands(evaluateBest(a), evaluateBest(b)));
            assert.equal(cmpFast, cmpSlow, `${i} 組目で高速版と通常版の勝敗が食い違った`);
        }
    });
    test('デッキの 52 枚がすべてユニークで正しく文字列化できる', () => {
        const seen = new Set();
        for (const c of freshDeck())
            seen.add(cardToString(c));
        assert.equal(seen.size, 52);
    });
});
//# sourceMappingURL=evaluator.test.js.map