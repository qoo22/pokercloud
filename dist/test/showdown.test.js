/**
 * オールイン後の勝率とアウツの検証
 *
 * 勝率は「だいたい合っている」では困ります。画面に数字として出す以上、
 * 手で確かめられる有名な局面と突き合わせて、実際に一致することを確認します。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, cardToString, createSeededRng } from '../src/cards.js';
import { showdownEquity, outsFor, currentLeaders, remainingDeck, buildRevealScript, } from '../solo/showdown.js';
const P = (seat, s) => ({ seat, hole: parseCards(s) });
const pct = (n) => Math.round(n * 1000) / 10;
describe('残りの山札', () => {
    test('見えている札はすべて除かれる', () => {
        const players = [P(0, 'As Ah'), P(1, 'Kd Kc')];
        const board = parseCards('2s 7d 9h');
        const deck = remainingDeck(players, board);
        assert.equal(deck.length, 52 - 4 - 3);
        for (const c of [...players[0].hole, ...players[1].hole, ...board]) {
            assert.ok(!deck.includes(c), `${cardToString(c)} が残っている`);
        }
    });
});
describe('勝率（全通りの数え上げ）', () => {
    test('リバーまで出ていれば 100% か 0% になる', () => {
        const players = [P(0, 'As Ah'), P(1, 'Kd Kc')];
        const board = parseCards('Ac 7d 9h 2s 3c'); // 席0 が A のセット
        const r = showdownEquity(players, board);
        assert.ok(r.exact);
        assert.equal(r.seats[0].equity, 1);
        assert.equal(r.seats[1].equity, 0);
    });
    test('まったく同じ強さなら 50% ずつの引き分けになる', () => {
        // 両者ともボードの役しか使えない（ボードプレイ）
        const players = [P(0, '2s 3h'), P(1, '2d 3c')];
        const board = parseCards('As Ks Qh Jd Tc'); // ボードでストレート
        const r = showdownEquity(players, board);
        assert.equal(r.seats[0].tie, 1);
        assert.equal(r.seats[1].tie, 1);
        assert.equal(r.seats[0].equity, 0.5);
    });
    test('取り分の合計は必ず 1 になる', () => {
        const players = [P(0, 'As Ah'), P(1, 'Kd Kc'), P(2, '7s 8s')];
        const board = parseCards('2h 9d Tc');
        const r = showdownEquity(players, board);
        const sum = r.seats.reduce((a, s) => a + s.equity, 0);
        assert.ok(Math.abs(sum - 1) < 1e-9, `合計が ${sum}`);
    });
    /**
     * 世間でよく見る「AA vs KK は 82.4%」という数字は、
     * スートの組み合わせ全部を平均したものです。個別の組み合わせでは 1 ポイント以上ずれます。
     * ここで使っている値は、この手札のまま 1,712,304 通りを全部数え上げて求めた実測値です
     * （AsAh vs KdKc は 4 スートが 1 枚ずつという、平均から一番遠い組み合わせ）。
     * 覚えている数字をそのまま期待値に書くと、正しい実装を「壊れている」と誤判定します。
     */
    test('AA vs KK のプリフロップは 81.3%（このスートでの実測値）', () => {
        const players = [P(0, 'As Ah'), P(1, 'Kd Kc')];
        const r = showdownEquity(players, [], createSeededRng(1), 60_000);
        assert.ok(Math.abs(pct(r.seats[0].equity) - 81.26) < 0.6, `AA の勝率が ${pct(r.seats[0].equity)}%（81.26% のはず）`);
    });
    test('AKs vs QQ のプリフロップは 46.2%（コインフリップ）', () => {
        const players = [P(0, 'As Ks'), P(1, 'Qd Qc')];
        const r = showdownEquity(players, [], createSeededRng(2), 60_000);
        assert.ok(Math.abs(pct(r.seats[0].equity) - 46.21) < 0.6, `AKs の勝率が ${pct(r.seats[0].equity)}%（46.21% のはず）`);
    });
    test('モンテカルロの結果が数え上げと一致する', () => {
        // 推定に切り替わる局面を直接は検算できないので、
        // 両方できるフロップで突き合わせて、サンプリングに偏りが無いことを確かめる。
        // ここが合っていれば、プリフロップの推定も信用してよい
        const players = [P(0, 'As Ah'), P(1, 'Kd Kc')];
        const board = parseCards('2c 7d 9h');
        const exact = showdownEquity(players, board);
        assert.ok(exact.exact);
        const rng = createSeededRng(5);
        const mc = showdownEquity(players, board, rng, 40_000);
        assert.ok(Math.abs(mc.seats[0].equity - exact.seats[0].equity) < 0.01, `推定 ${pct(mc.seats[0].equity)}% と数え上げ ${pct(exact.seats[0].equity)}% がずれている`);
    });
    test('フロップ以降は数え上げになる（推定ではない）', () => {
        const players = [P(0, 'As Ah'), P(1, 'Kd Kc')];
        const r = showdownEquity(players, parseCards('2h 9d Tc'));
        assert.ok(r.exact, 'フロップで数え上げになっていない');
        assert.equal(r.samples, (45 * 44) / 2, `組み合わせ数が ${r.samples}`);
    });
    test('同じ盤面なら毎回まったく同じ数字が出る', () => {
        // 数え上げなので揺らがないはず。ここが揺れるなら乱数が混入している
        const players = [P(0, 'As Ah'), P(1, 'Kd Kc')];
        const a = showdownEquity(players, parseCards('2h 9d Tc'));
        const b = showdownEquity(players, parseCards('2h 9d Tc'));
        assert.deepEqual(a.seats, b.seats);
    });
});
describe('首位の判定', () => {
    test('ボードが 3 枚未満なら首位は決まらない', () => {
        assert.deepEqual(currentLeaders([P(0, 'As Ah'), P(1, '2d 3c')], []), []);
    });
    test('役が強いほうが首位になる', () => {
        const players = [P(0, 'As Ah'), P(1, 'Kd Kc')];
        assert.deepEqual(currentLeaders(players, parseCards('2h 9d Tc')), [0]);
    });
    test('同点なら両方が首位になる', () => {
        const players = [P(0, '2s 3h'), P(1, '2d 3c')];
        assert.deepEqual(currentLeaders(players, parseCards('As Ks Qh Jd Tc')), [0, 1]);
    });
});
describe('アウツ', () => {
    test('セットを追うポケットペアのアウツは 2 枚', () => {
        // 相手が A のトップペア、こちらは 8 のポケット。8 を引けば逆転
        const players = [P(0, 'Ad Kc'), P(1, '8s 8h')];
        const board = parseCards('Ah 7d 2c');
        const o = outsFor(players, board);
        const me = o.find((x) => x.seat === 1);
        assert.equal(me.cards.length, 2, `アウツが ${me.cards.map(cardToString).join(' ')}`);
        for (const c of me.cards)
            assert.ok(cardToString(c).startsWith('8'));
    });
    test('フラッシュドローのアウツは 9 枚', () => {
        // 教科書どおりの数字。ハートが 9 枚残っている
        const players = [P(0, 'Ad Ac'), P(1, 'Kh Qh')];
        const board = parseCards('7h 2h 9s');
        const me = outsFor(players, board).find((x) => x.seat === 1);
        assert.equal(me.cards.length, 9, `アウツが ${me.cards.length} 枚`);
        for (const c of me.cards)
            assert.ok(cardToString(c).endsWith('h'), `${cardToString(c)} がハートでない`);
    });
    test('オープンエンドのストレートドローのアウツは 8 枚', () => {
        const players = [P(0, 'Ad Ac'), P(1, '9s 8d')];
        const board = parseCards('7h 6c 2s');
        const me = outsFor(players, board).find((x) => x.seat === 1);
        assert.equal(me.cards.length, 8, `アウツが ${me.cards.length} 枚`);
        for (const c of me.cards) {
            const r = cardToString(c)[0];
            assert.ok(r === 'T' || r === '5', `${cardToString(c)} は T か 5 のはず`);
        }
    });
    test('ガットショットのアウツは 4 枚', () => {
        const players = [P(0, 'Ad Ac'), P(1, '9s 7d')];
        const board = parseCards('6h 5c 2s');
        const me = outsFor(players, board).find((x) => x.seat === 1);
        assert.equal(me.cards.length, 4, `アウツが ${me.cards.length} 枚`);
    });
    test('首位の席はアウツを持たず leading になる', () => {
        const players = [P(0, 'Ad Ac'), P(1, '9s 8d')];
        const o = outsFor(players, parseCards('7h 6c 2s'));
        const lead = o.find((x) => x.seat === 0);
        assert.ok(lead.leading);
        assert.equal(lead.cards.length, 0);
    });
    test('リバーまで出ていればアウツは無い', () => {
        const players = [P(0, 'Ad Ac'), P(1, '9s 8d')];
        const o = outsFor(players, parseCards('7h 6c 2s Kd 3h'));
        for (const x of o)
            assert.equal(x.cards.length, 0);
    });
    test('アウツの札が実際に来ると首位が入れ替わる', () => {
        // アウツの定義そのものを検算する
        const players = [P(0, 'Ad Kc'), P(1, '8s 8h')];
        const board = parseCards('Ah 7d 2c');
        const me = outsFor(players, board).find((x) => x.seat === 1);
        for (const c of me.cards) {
            assert.deepEqual(currentLeaders(players, [...board, c]), [1], `${cardToString(c)} で逆転しない`);
        }
    });
});
describe('演出の台本', () => {
    test('公開直後の 1 手 + めくる枚数ぶんのステップになる', () => {
        const players = [P(0, 'Ad Kc'), P(1, '8s 8h')];
        const board = parseCards('Ah 7d 2c');
        const steps = buildRevealScript(players, board, parseCards('8d 3s'));
        assert.equal(steps.length, 3);
        assert.equal(steps[0].card, null);
        assert.equal(steps[0].board.length, 3);
        assert.equal(steps[1].board.length, 4);
        assert.equal(steps[2].board.length, 5);
        assert.ok(steps[2].final);
    });
    test('逆転した瞬間に印がつく', () => {
        // A のトップペアに 8 のセットが刺さる、という分かりやすい逆転
        const players = [P(0, 'Ad Kc'), P(1, '8s 8h')];
        const steps = buildRevealScript(players, parseCards('Ah 7d 2c'), parseCards('8d 3s'));
        assert.deepEqual(steps[0].leaders, [0]);
        assert.ok(!steps[0].leadChanged);
        assert.deepEqual(steps[1].leaders, [1], 'ターンで逆転していない');
        assert.ok(steps[1].leadChanged, '逆転の印がついていない');
        assert.ok(!steps[2].leadChanged, '何も起きていないのに逆転の印がついている');
    });
    test('最後のステップの勝率は 0 か 1 に確定する', () => {
        const players = [P(0, 'Ad Kc'), P(1, '8s 8h')];
        const steps = buildRevealScript(players, parseCards('Ah 7d 2c'), parseCards('8d 3s'));
        const last = steps[steps.length - 1];
        for (const s of last.equity)
            assert.ok(s.equity === 0 || s.equity === 1, `${s.equity}`);
    });
    test('台本の勝率と首位が食い違わない', () => {
        // 表示がずれる事故を防ぐための不変条件：
        // 勝率が最大の席は、必ず首位に含まれている（ボードが揃っている限り）
        const players = [P(0, 'Ad Kc'), P(1, '8s 8h'), P(2, 'Qh Jh')];
        const steps = buildRevealScript(players, parseCards('Ah 7d 2c'), parseCards('8d 3s'));
        for (const s of steps) {
            if (s.board.length < 5)
                continue;
            const top = s.equity.reduce((a, b) => (b.equity > a.equity ? b : a));
            assert.ok(s.leaders.includes(top.seat), `首位 ${s.leaders} に ${top.seat} が入っていない`);
        }
    });
});
//# sourceMappingURL=showdown.test.js.map