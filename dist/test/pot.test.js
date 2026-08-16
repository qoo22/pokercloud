import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPots, computeUncalledReturn, awardPot, computeRake } from '../src/pot.js';
import { createSeededRng } from '../src/cards.js';
describe('コールされなかったベットの返却', () => {
    test('最高額が単独ならその差額を返す', () => {
        // A が 1000、B が 300 でオールイン、C は 50 でフォールド
        const r = computeUncalledReturn([1000, 300, 50]);
        assert.deepEqual(r, { seat: 0, amount: 700 });
    });
    test('同額なら返却なし', () => {
        assert.equal(computeUncalledReturn([500, 500, 500]), null);
    });
    test('2 人が最高額タイなら返却なし', () => {
        assert.equal(computeUncalledReturn([500, 500, 100]), null);
    });
    test('全員フォールドでブラインドだけが残る場合', () => {
        // SB 50 / BB 100 で全員フォールド → BB は 50 が返る
        const r = computeUncalledReturn([50, 100, 0, 0]);
        assert.deepEqual(r, { seat: 1, amount: 50 });
    });
});
describe('サイドポットの構築', () => {
    test('全員同額ならメインポットのみ', () => {
        const pots = buildPots([100, 100, 100], [false, false, false]);
        assert.equal(pots.length, 1);
        assert.equal(pots[0].amount, 300);
        assert.deepEqual(pots[0].eligible, [0, 1, 2]);
    });
    test('教科書的なサイドポット：ショートスタックのオールイン', () => {
        // A: 100 オールイン / B: 500 / C: 500
        const pots = buildPots([100, 500, 500], [false, false, false]);
        assert.equal(pots.length, 2);
        assert.equal(pots[0].amount, 300, 'メインポット = 100 x 3');
        assert.deepEqual(pots[0].eligible, [0, 1, 2]);
        assert.equal(pots[1].amount, 800, 'サイドポット = 400 x 2');
        assert.deepEqual(pots[1].eligible, [1, 2], 'A はメインポットしか取れない');
    });
    test('3 層のサイドポット', () => {
        // A: 50 / B: 200 / C: 1000 / D: 1000
        const pots = buildPots([50, 200, 1000, 1000], [false, false, false, false]);
        assert.equal(pots.length, 3);
        assert.equal(pots[0].amount, 200); // 50 x 4
        assert.deepEqual(pots[0].eligible, [0, 1, 2, 3]);
        assert.equal(pots[1].amount, 450); // 150 x 3
        assert.deepEqual(pots[1].eligible, [1, 2, 3]);
        assert.equal(pots[2].amount, 1600); // 800 x 2
        assert.deepEqual(pots[2].eligible, [2, 3]);
    });
    test('フォールドしたプレイヤーのチップはポットに残るが権利は無い', () => {
        // A: 100 でフォールド / B: 500 / C: 500
        const pots = buildPots([100, 500, 500], [true, false, false]);
        assert.equal(pots.length, 1, '権利者が同じ層はまとめられる');
        assert.equal(pots[0].amount, 1100, '降りた A の 100 もポットに入る');
        assert.deepEqual(pots[0].eligible, [1, 2]);
    });
    test('オールインした後にフォールドした人がいるケース', () => {
        // A: 100 オールイン / B: 300 でフォールド / C: 300
        const pots = buildPots([100, 300, 300], [false, true, false]);
        assert.equal(pots[0].amount, 300);
        assert.deepEqual(pots[0].eligible, [0, 2]);
        assert.equal(pots[1].amount, 400);
        assert.deepEqual(pots[1].eligible, [2]);
    });
    test('チップ総額は必ず保存される（ランダム 5000 ケース）', () => {
        const rng = createSeededRng(20260809);
        for (let iter = 0; iter < 5000; iter++) {
            const n = 2 + rng.randomInt(8);
            const contrib = [];
            const folded = [];
            for (let i = 0; i < n; i++) {
                contrib.push(rng.randomInt(2000));
                folded.push(rng.randomInt(3) === 0);
            }
            // 最低 1 人は降りていない状態にする
            folded[rng.randomInt(n)] = false;
            const pots = buildPots(contrib, folded);
            const total = contrib.reduce((a, b) => a + b, 0);
            const potSum = pots.reduce((a, p) => a + p.amount, 0);
            assert.equal(potSum, total, `出資合計 ${total} とポット合計 ${potSum} が一致しない`);
            // 各ポットの権利者は必ず降りていない
            for (const p of pots) {
                for (const s of p.eligible)
                    assert.equal(folded[s], false);
            }
        }
    });
});
describe('ポットの分配', () => {
    test('単独勝者が全額', () => {
        const a = awardPot({ amount: 300, eligible: [0, 1, 2], level: 0 }, [1], 0, 3);
        assert.equal(a.shares.get(1), 300);
        assert.equal(a.shares.size, 1);
    });
    test('2 人チョップで割り切れる', () => {
        const a = awardPot({ amount: 300, eligible: [0, 1], level: 0 }, [0, 1], 0, 3);
        assert.equal(a.shares.get(0), 150);
        assert.equal(a.shares.get(1), 150);
        assert.equal(a.oddChipSeat, null);
    });
    test('端数はボタンの左隣から順に配る', () => {
        // 席 4 人、ボタン = 席 1、勝者 = 席 0 と 席 3、ポット 301
        // ボタンの左隣は席 2 → 席 3 → 席 0 の順に走査するので、席 3 が端数を取る
        const a = awardPot({ amount: 301, eligible: [0, 3], level: 0 }, [0, 3], 1, 4);
        assert.equal(a.shares.get(3), 151);
        assert.equal(a.shares.get(0), 150);
        assert.equal(a.oddChipSeat, 3);
    });
    test('3 人チョップで 2 チップ余る場合', () => {
        const a = awardPot({ amount: 302, eligible: [0, 1, 2], level: 0 }, [0, 1, 2], 2, 3);
        // ボタン = 席 2 → 走査順は 0, 1, 2
        assert.equal(a.shares.get(0), 101);
        assert.equal(a.shares.get(1), 101);
        assert.equal(a.shares.get(2), 100);
        const sum = [...a.shares.values()].reduce((x, y) => x + y, 0);
        assert.equal(sum, 302, '端数を含めて総額が一致する');
    });
});
describe('レーキ', () => {
    test('フロップを見なければレーキは 0（no flop, no drop）', () => {
        assert.equal(computeRake(10000, 0.05, 500, false), 0);
    });
    test('割合で計算される', () => {
        assert.equal(computeRake(10000, 0.05, 5000, true), 500);
    });
    test('上限で頭打ちになる', () => {
        assert.equal(computeRake(1000000, 0.05, 4000, true), 4000);
    });
    test('端数は切り捨て（プレイヤー有利側）', () => {
        assert.equal(computeRake(999, 0.05, 5000, true), 49);
    });
    test('レーキ率 0 なら常に 0', () => {
        assert.equal(computeRake(100000, 0, 5000, true), 0);
    });
});
//# sourceMappingURL=pot.test.js.map