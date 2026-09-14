import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bszEvaluate, bszSpin, bszDouble, bszSpinGrid, BSZ_LINES, BSZ_WEIGHTS, BSZ_SYMS, BSZ_SPECIAL, BSZ_FREE_SPINS, BSZ_MAX_WIN_X, BSZ_DOUBLE_CAP_X, } from '../src/server/bsz.js';
/** 再現性のある乱数(テストが日によって落ちないように) */
function seeded(a) {
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const G = (s) => s.trim().split(/\s+/);
const BLANKS = 'blank blank blank blank blank blank blank blank blank';
describe('WINNING TUNNEL: 盤面の判定', () => {
    test('8ラインは横3・縦3・斜め2', () => {
        assert.equal(BSZ_LINES.length, 8);
        // どのラインも3マス、かつマス番号は0〜8
        for (const l of BSZ_LINES) {
            assert.equal(l.length, 3);
            for (const c of l)
                assert.ok(c >= 0 && c <= 8);
        }
        // 中央(4)を通るのは 中段横・中央縦・斜め2 の4本
        assert.equal(BSZ_LINES.filter((l) => l.includes(4)).length, 4);
    });
    test('横一列に揃うとライン配当が付く', () => {
        const g = G(`bell bell bell  blank blank blank  blank blank blank`);
        const r = bszEvaluate(g);
        const hit = r.lines.find((l) => l.line === 0);
        assert.ok(hit, '上段が当たっていない');
        assert.equal(hit.key, 'bell');
        assert.equal(hit.x, 4);
    });
    test('ジョーカーは他の絵柄の代わりになる', () => {
        const g = G(`blue7 joker blue7  blank blank blank  blank blank blank`);
        const hit = bszEvaluate(g).lines.find((l) => l.line === 0);
        assert.ok(hit);
        assert.equal(hit.key, 'blue7', 'WILDが代用になっていない');
        assert.equal(hit.x, 40);
    });
    test('赤7と青7が混ざった並びは ANY 7 として成立する', () => {
        const g = G(`red7 blue7 red7  blank blank blank  blank blank blank`);
        const hit = bszEvaluate(g).lines.find((l) => l.line === 0);
        assert.ok(hit);
        assert.equal(hit.key, 'any7');
        assert.equal(hit.x, 20);
    });
    test('ブランクが1つでも混ざるとラインは切れる', () => {
        const g = G(`bell bell blank  blank blank blank  blank blank blank`);
        assert.equal(bszEvaluate(g).lines.length, 0);
    });
    test('ANY配当は並んでいなくても個数で付く', () => {
        // ベルを5個ばらまく(ライン上は揃わない配置)
        const g = G(`bell blank bell  blank bell blank  bell blank bell`);
        const r = bszEvaluate(g);
        const any = r.anys.find((a) => a.key === 'bell');
        assert.ok(any, 'ANYが付いていない');
        assert.equal(any.count, 5);
        assert.equal(any.x, 8);
    });
    test('ANYにジョーカーは数えない(ラインと二重取りさせない)', () => {
        const g = G(`joker joker joker  blank blank blank  blank blank blank`);
        const r = bszEvaluate(g);
        // ラインはジョーカー3つで成立する
        assert.equal(r.lines[0].key, 'joker');
        // ANYには1件も乗らない
        assert.equal(r.anys.length, 0, 'ジョーカーがANYに数えられている');
    });
    test('ラインとANYは両方とも足される', () => {
        // ベル9個 = 8ライン全部(4×8=32)＋ANY9個(4000)
        const g = G(`bell bell bell  bell bell bell  bell bell bell`);
        const r = bszEvaluate(g);
        assert.equal(r.lines.length, 8);
        assert.equal(r.anys.find((a) => a.key === 'bell')?.x, 4000);
        assert.equal(r.payX, 8 * 4 + 4000);
    });
    test('全部ブランクなら配当はゼロ', () => {
        const r = bszEvaluate(G(BLANKS));
        assert.equal(r.payX, 0);
        assert.equal(r.lines.length, 0);
        assert.equal(r.anys.length, 0);
    });
});
describe('WINNING TUNNEL: フリーゲーム', () => {
    test('中央がジョーカーでなければフリーに入らない', () => {
        const rnd = seeded(1);
        let checked = 0;
        for (let i = 0; i < 2000 && checked < 50; i++) {
            const o = bszSpin(rnd);
            if (o.grid0[4] !== 'joker') {
                assert.equal(o.freeEntered, false);
                assert.equal(o.free.length, 0);
                assert.equal(o.tunnel, 0);
                checked++;
            }
        }
        assert.ok(checked > 0);
    });
    test('中央ジョーカーで5回のフリー・中央は固定・倍率は1/2/3/5', () => {
        const rnd = seeded(7);
        let found = 0;
        for (let i = 0; i < 60000 && found < 20; i++) {
            const o = bszSpin(rnd);
            if (!o.freeEntered)
                continue;
            found++;
            assert.equal(o.free.length, BSZ_FREE_SPINS, 'フリーが5回でない');
            assert.ok([1, 2, 3, 5].includes(o.tunnel), `トンネル倍率が不正: ${o.tunnel}`);
            for (const f of o.free)
                assert.equal(f.grid[4], 'joker', '中央が固定されていない');
        }
        assert.ok(found > 0, 'フリーが1度も出ていない');
    });
    test('突入時の配当にもトンネル倍率がかかる', () => {
        // 中央ジョーカーで、フリーが全部ハズレでも (突入配当×倍率) は残る
        const rnd = seeded(11);
        for (let i = 0; i < 60000; i++) {
            const o = bszSpin(rnd);
            if (!o.freeEntered)
                continue;
            const raw = o.base.payX + o.free.reduce((a, f) => a + f.payX, 0);
            const want = Math.min(raw * o.tunnel, BSZ_MAX_WIN_X);
            assert.equal(o.totalPayX, want, '合計が (ベース+フリー)×倍率 になっていない');
            return;
        }
        assert.fail('フリーが出なかった');
    });
    test('1スピンの払い出しは上限で止まる', () => {
        const rnd = seeded(3);
        for (let i = 0; i < 20000; i++) {
            assert.ok(bszSpin(rnd).totalPayX <= BSZ_MAX_WIN_X);
        }
    });
});
describe('WINNING TUNNEL: ダブルダウン', () => {
    test('勝敗は「選んだ1枚」で決まる(3枚の最強を自動採用しない)', () => {
        // 選ぶ位置を変えると結果が変わりうる = 選択が効いている
        let differ = 0;
        for (let s = 0; s < 300; s++) {
            const a = bszDouble(1, 0, seeded(1000 + s), 0);
            const b = bszDouble(1, 0, seeded(1000 + s), 1);
            assert.deepEqual(a.player, b.player, '同じ種なら同じ絵柄が出るはず');
            if (a.result !== b.result)
                differ++;
        }
        assert.ok(differ > 20, `選ぶ位置で結果が変わらない(${differ}/300)`);
    });
    test('勝率はおおむね公平(自動最強なら7割に偏る)', () => {
        const rnd = seeded(77);
        const N = 60000;
        let win = 0, tie = 0, ret = 0;
        for (let i = 0; i < N; i++) {
            const r = bszDouble(1, 0, rnd, i % 3);
            assert.ok(Number.isFinite(r.payX), 'payXがNaN');
            if (r.result === 'win')
                win++;
            if (r.result === 'tie')
                tie++;
            ret += r.payX;
        }
        const w = win / N;
        assert.ok(w > 0.38 && w < 0.52, `勝率が偏っている: ${(w * 100).toFixed(1)}%`);
        assert.ok(tie / N > 0.05, '引き分けがほとんど無い');
        // スペシャルボーナスぶん、わずかにプレイヤー有利になる
        assert.ok(ret / N > 0.9 && ret / N < 1.2, `戻りが極端: ${(ret / N).toFixed(3)}`);
    });
    test('ハーフダブルは負けても確保分が残る', () => {
        const rnd = seeded(5);
        for (let i = 0; i < 3000; i++) {
            const r = bszDouble(50, 50, rnd, i % 3);
            if (r.result === 'lose' && r.specialX === 0) {
                assert.equal(r.payX, 50, '確保した分が消えている');
                return;
            }
        }
        assert.fail('負けが出なかった');
    });
    test('引き分けは賭けた分が戻る', () => {
        const rnd = seeded(9);
        for (let i = 0; i < 5000; i++) {
            const r = bszDouble(100, 0, rnd, i % 3);
            if (r.result === 'tie' && r.specialX === 0) {
                assert.equal(r.payX, 100);
                return;
            }
        }
        assert.fail('引き分けが出なかった');
    });
    test('ブランク3つ揃いでスペシャルは付かない(NaNにならない)', () => {
        const rnd = seeded(21);
        for (let i = 0; i < 40000; i++) {
            const r = bszDouble(1, 0, rnd, 0);
            assert.ok(Number.isFinite(r.payX));
            assert.ok(Number.isFinite(r.specialX));
            if (r.player.every((s) => s === 'blank'))
                assert.equal(r.specialX, 0);
        }
    });
    test('上限を超えたらそれ以上ダブルできない(実機の振り切り)', () => {
        const rnd = seeded(13);
        for (let i = 0; i < 20000; i++) {
            const r = bszDouble(BSZ_DOUBLE_CAP_X, 0, rnd, i % 3);
            if (r.payX > BSZ_DOUBLE_CAP_X) {
                assert.equal(r.canDouble, false, '上限超えなのに続行できてしまう');
                return;
            }
        }
        assert.fail('上限を超える結果が出なかった');
    });
    test('スペシャルボーナスの配当表にブランク以外の全図柄がある', () => {
        for (const s of BSZ_SYMS) {
            if (s === 'blank')
                continue;
            assert.ok(BSZ_SPECIAL[s], `${s} のスペシャルが無い`);
        }
    });
});
describe('WINNING TUNNEL: 抽選の健全性', () => {
    test('重みの並びが配当の強さと逆になっている', () => {
        for (const s of BSZ_SYMS)
            assert.ok(BSZ_WEIGHTS[s] > 0, `${s} の重みが無い`);
        // ジョーカーは一番薄い(中央に来るとフリーなので)
        const min = BSZ_SYMS.reduce((a, b) => (BSZ_WEIGHTS[b] < BSZ_WEIGHTS[a] ? b : a));
        assert.equal(min, 'joker');
        // 高配当ほど薄い(チェリー > ... > 青7 > ジョーカー)
        const order = ['cherry', 'orange', 'plum', 'melon', 'bell', 'eight', 'bar', 'red7', 'blue7', 'joker'];
        for (let i = 1; i < order.length; i++) {
            assert.ok(BSZ_WEIGHTS[order[i]] < BSZ_WEIGHTS[order[i - 1]], `${order[i]} が ${order[i - 1]} より薄くない`);
        }
        // ブランクは1割前後ある(これがRTPの調整つまみ)
        const total = BSZ_SYMS.reduce((a, k) => a + BSZ_WEIGHTS[k], 0);
        const p = BSZ_WEIGHTS.blank / total;
        assert.ok(p > 0.05 && p < 0.3, `ブランクの割合が想定外: ${(p * 100).toFixed(1)}%`);
    });
    test('固定したマスは引き直されない', () => {
        const rnd = seeded(31);
        for (let i = 0; i < 200; i++) {
            const g = bszSpinGrid(rnd, { 4: 'joker', 0: 'bar' });
            assert.equal(g[4], 'joker');
            assert.equal(g[0], 'bar');
            assert.equal(g.length, 9);
        }
    });
    test('RTPが目標の帯(90〜110%)に収まっている', () => {
        // 重みを触ったら落ちる。落ちたら測り直して blank を調整すること
        const N = 60000;
        let pay = 0, free = 0;
        for (let s = 0; s < 3; s++) {
            const rnd = seeded(4242 + s * 3571);
            for (let i = 0; i < N / 3; i++) {
                const o = bszSpin(rnd);
                pay += o.totalPayX;
                if (o.freeEntered)
                    free++;
            }
        }
        const rtp = pay / N;
        assert.ok(rtp > 0.9 && rtp < 1.1, `RTPが帯を外れた: ${(rtp * 100).toFixed(1)}%`);
        // フリーは 1/80〜1/130 くらい
        const rate = N / free;
        assert.ok(rate > 70 && rate < 140, `フリー突入が帯を外れた: 1/${rate.toFixed(0)}`);
    });
});
describe('WINNING TUNNEL: ジョーカー戻り(リバース)', () => {
    test('演出は結果を変えない(hit と freeEntered は必ず一致する)', () => {
        const rnd = seeded(1234);
        let hit = 0, gase = 0;
        for (let i = 0; i < 120000; i++) {
            const o = bszSpin(rnd);
            if (!o.reverse)
                continue;
            if (o.reverse.hit) {
                assert.equal(o.freeEntered, true, '当たり演出なのにフリーに入っていない');
                assert.equal(o.grid0[4], 'joker', '当たり演出なのに中央がジョーカーでない');
                hit++;
            }
            else {
                assert.equal(o.freeEntered, false, 'ガセ演出なのにフリーに入っている');
                assert.notEqual(o.grid0[4], 'joker', 'ガセ演出なのに中央がジョーカー');
                gase++;
            }
        }
        assert.ok(hit > 0 && gase > 0, `当たり${hit} / ガセ${gase}`);
    });
    test('逆回転はボーナス確定ではない(ガセの方が多い)', () => {
        const rnd = seeded(4321);
        const N = 150000;
        let rev = 0, revHit = 0;
        for (let i = 0; i < N; i++) {
            const o = bszSpin(rnd);
            if (!o.reverse)
                continue;
            rev++;
            if (o.reverse.hit)
                revHit++;
        }
        const p = revHit / rev;
        // 逆回転した時点で当たりが確定してしまうと、焦らしが成立しない
        assert.ok(p > 0.15 && p < 0.6, `逆回転の当たり率が極端: ${(p * 100).toFixed(0)}%`);
        assert.ok(rev / N > 0.005, '逆回転がほとんど出ない');
    });
    test('フリーの一部は戻り演出を使わず直で止まる', () => {
        const rnd = seeded(777);
        let free = 0, direct = 0;
        for (let i = 0; i < 120000; i++) {
            const o = bszSpin(rnd);
            if (!o.freeEntered)
                continue;
            free++;
            if (!o.reverse)
                direct++;
        }
        assert.ok(free > 0);
        const r = direct / free;
        assert.ok(r > 0.2 && r < 0.8, `直停止の割合が極端: ${(r * 100).toFixed(0)}%`);
    });
    test('戻り演出を足してもRTPは帯のまま', () => {
        const N = 60000;
        let pay = 0;
        for (let s = 0; s < 3; s++) {
            const rnd = seeded(9100 + s * 131);
            for (let i = 0; i < N / 3; i++)
                pay += bszSpin(rnd).totalPayX;
        }
        const rtp = pay / N;
        assert.ok(rtp > 0.9 && rtp < 1.1, `RTPが帯を外れた: ${(rtp * 100).toFixed(1)}%`);
    });
});
//# sourceMappingURL=bsz.test.js.map