/**
 * 統計的な検証
 *
 * 仕様書に書いたとおり、このジャンルで最大の炎上要因は「配牌が操作されている」という不信である。
 * それに対して「操作していません」と言うだけでは何の証明にもならない。
 * ここでは以下を機械的に検証する：
 *   1. シャッフルが一様であること（特定のカードが特定の位置に偏らない）
 *   2. 7 枚役の出現頻度が理論値と統計的に一致すること
 * このテストは CI に常駐させ、失敗したらリリースを止める種類のもの。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { freshDeck, shuffle, createSeededRng, createSecureRng } from '../src/cards.js';
import { evaluateBest, HandCategory } from '../src/evaluator.js';
describe('シャッフルの一様性', () => {
    test('特定のカードが 52 箇所に均等に散る', () => {
        const rng = createSeededRng(424242);
        const n = 104000; // 1 位置あたり期待値 2000 回
        const positions = new Array(52).fill(0);
        for (let i = 0; i < n; i++) {
            const deck = shuffle(freshDeck(), rng);
            positions[deck.indexOf(0)]++; // 0 = 2s
        }
        const expected = n / 52;
        const sd = Math.sqrt(n * (1 / 52) * (51 / 52));
        for (let i = 0; i < 52; i++) {
            const z = Math.abs(positions[i] - expected) / sd;
            assert.ok(z < 5, `位置 ${i} の出現回数 ${positions[i]} が期待値 ${expected} から ${z.toFixed(2)}σ 外れている`);
        }
        // カイ二乗検定（自由度 51、有意水準 0.1% の臨界値は約 92.0）
        const chi2 = positions.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0);
        assert.ok(chi2 < 92, `カイ二乗値 ${chi2.toFixed(2)} が大きすぎます（一様分布から外れている疑い）`);
    });
    test('CSPRNG でも同様に一様（本番経路の確認）', () => {
        const rng = createSecureRng();
        const n = 26000;
        const positions = new Array(52).fill(0);
        for (let i = 0; i < n; i++) {
            positions[shuffle(freshDeck(), rng).indexOf(51)]++; // 51 = Ac
        }
        const expected = n / 52;
        const chi2 = positions.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0);
        assert.ok(chi2 < 92, `カイ二乗値 ${chi2.toFixed(2)}`);
    });
    test('乱数の剰余バイアスが無い（randomInt の分布）', () => {
        // 2^32 を割り切らない数を選ぶ。素朴な実装だと必ず偏りが出る値
        const rng = createSeededRng(7);
        const m = 52;
        const n = 520000;
        const counts = new Array(m).fill(0);
        for (let i = 0; i < n; i++)
            counts[rng.randomInt(m)]++;
        const expected = n / m;
        const chi2 = counts.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0);
        assert.ok(chi2 < 92, `カイ二乗値 ${chi2.toFixed(2)}`);
    });
});
describe('7 枚役の出現頻度が理論値と一致する', () => {
    test('モンテカルロ（150,000 サンプル）', () => {
        // C(52,7) = 133,784,560 通りにおける、ベスト 5 枚の役の組み合わせ数（既知の値）
        const THEORY = {
            [HandCategory.HighCard]: 23294460,
            [HandCategory.Pair]: 58627800,
            [HandCategory.TwoPair]: 31433400,
            [HandCategory.Trips]: 6461620,
            [HandCategory.Straight]: 6180020,
            [HandCategory.Flush]: 4047644,
            [HandCategory.FullHouse]: 3473184,
            [HandCategory.Quads]: 224848,
            [HandCategory.StraightFlush]: 41584,
        };
        const TOTAL = 133784560;
        const rng = createSeededRng(20260809);
        const n = 150000;
        const counts = new Array(9).fill(0);
        const seven = new Array(7);
        for (let i = 0; i < n; i++) {
            const deck = shuffle(freshDeck(), rng);
            for (let k = 0; k < 7; k++)
                seven[k] = deck[k];
            counts[evaluateBest(seven).category]++;
        }
        const names = {
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
        for (let cat = 0; cat <= 8; cat++) {
            const p = THEORY[cat] / TOTAL;
            const expected = p * n;
            const sd = Math.sqrt(n * p * (1 - p));
            const z = Math.abs(counts[cat] - expected) / sd;
            assert.ok(z < 4.5, `${names[cat]}: 実測 ${counts[cat]} / 理論 ${expected.toFixed(1)}（${z.toFixed(2)}σ）`);
        }
        assert.equal(counts.reduce((a, b) => a + b, 0), n, 'どのカテゴリにも分類されなかったハンドがある');
    });
});
//# sourceMappingURL=statistics.test.js.map