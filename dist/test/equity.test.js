/**
 * リアルタイム勝率・Equity エンジン（solo/equity.ts）の検証。
 *
 * 正解値は完全数え上げ（EXACT）自身、または広く知られたヘッズアップ勝率と照合する。
 * モンテカルロは同一 seed で再現し、数え上げへ統計的に収束することを確かめる。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../src/cards.js';
import { calculateEquity, heroEquityVsUnknown, resolveVisibility, EquityVisibilityMode, EquityError, } from '../solo/equity.js';
const hole = (s) => {
    const c = parseCards(s);
    return [c[0], c[1]];
};
const player = (id, cards, status = 'ALL_IN') => ({
    id,
    holeCards: hole(cards),
    status,
});
const pct = (n) => Math.round(n * 1000) / 10;
describe('Equity エンジン: 数え上げ（EXACT）', () => {
    test('リバー完成は 1 回評価で勝者確定', () => {
        const req = {
            players: [player('a', 'As Ah'), player('b', 'Kd Kc')],
            board: parseCards('Ac 7d 9h 2s 3c'),
            mode: 'AUTO',
        };
        const r = calculateEquity(req);
        assert.equal(r.exact, true);
        assert.equal(r.street, 'RIVER');
        assert.equal(r.totalRunouts, 1);
        assert.equal(r.players[0].equity, 1);
        assert.equal(r.players[1].equity, 0);
        // win + tie + lose = 1
        for (const p of r.players) {
            assert.ok(Math.abs(p.winProbability + p.tieProbability + p.loseProbability - 1) < 1e-9);
        }
    });
    test('ボードプレイのタイは 0.5 ずつに分割される', () => {
        const req = {
            players: [player('a', '2s 3h'), player('b', '2d 3c')],
            board: parseCards('As Ks Qh Jd Tc'),
        };
        const r = calculateEquity(req);
        assert.equal(r.players[0].equity, 0.5);
        assert.equal(r.players[1].equity, 0.5);
        assert.equal(r.players[0].tieProbability, 1);
    });
    test('マルチウェイでも Equity 合計は 1', () => {
        const req = {
            players: [player('a', 'As Ah'), player('b', 'Kd Kc'), player('c', '7s 8s')],
            board: parseCards('2h 9d Tc'),
        };
        const r = calculateEquity(req);
        const sum = r.players.reduce((a, p) => a + p.equity, 0);
        assert.ok(Math.abs(sum - 1) < 1e-9, `合計 ${sum}`);
        assert.equal(r.street, 'FLOP');
    });
    test('フロップ HU は C(45,2)=990 通りを数え上げる', () => {
        const req = {
            players: [player('a', 'As Ah'), player('b', 'Kd Kc')],
            board: parseCards('2h 9d Tc'),
        };
        const r = calculateEquity(req);
        assert.equal(r.exact, true);
        assert.equal(r.totalRunouts, (45 * 44) / 2);
    });
    test('mode:EXACT を明示すればターンは 44 通りを数え上げる', () => {
        const req = {
            players: [player('a', 'As Ah'), player('b', 'Kd Kc')],
            board: parseCards('2h 9d Tc 3s'),
            mode: 'EXACT',
        };
        const r = calculateEquity(req);
        assert.equal(r.exact, true);
        assert.equal(r.street, 'TURN');
        assert.equal(r.totalRunouts, 44);
    });
});
describe('Equity エンジン: プリフロップは既定で MC（実測 81.3% へ収束）', () => {
    test('AA vs KK プリフロップ AUTO はモンテカルロ、~81.3% へ収束', () => {
        // 全列挙は約 27 秒かかりリアルタイム表示に耐えないため既定は MC。
        // 正解 81.26%（このスートを 1,712,304 通り数え上げた実測値）へ収束することを確認する。
        const r = calculateEquity({
            players: [player('a', 'As Ah'), player('b', 'Kd Kc')],
            board: [],
            mode: 'AUTO',
            samples: 80_000,
            seed: 42,
        });
        assert.equal(r.exact, false, 'プリフロップは既定で MC のはず');
        assert.ok(Math.abs(pct(r.players[0].equity) - 81.26) < 0.6, `AA=${pct(r.players[0].equity)}%`);
    });
});
describe('Equity エンジン: モンテカルロ（MONTE_CARLO）', () => {
    test('同一 seed・同一入力なら完全に同じ結果（決定性）', () => {
        const base = {
            players: [player('a', 'As Ks'), player('b', 'Qd Qc')],
            board: [],
            mode: 'MONTE_CARLO',
            samples: 20_000,
            seed: 12345,
        };
        const r1 = calculateEquity(base);
        const r2 = calculateEquity(base);
        assert.deepEqual(r1.players, r2.players);
        assert.equal(r1.exact, false);
    });
    test('モンテカルロは数え上げへ収束する（フロップで照合）', () => {
        const players = [player('a', 'As Ah'), player('b', 'Kd Kc')];
        const board = parseCards('2c 7d 9h');
        const exact = calculateEquity({ players, board, mode: 'EXACT' });
        const mc = calculateEquity({ players, board, mode: 'MONTE_CARLO', samples: 50_000, seed: 7 });
        assert.ok(Math.abs(mc.players[0].equity - exact.players[0].equity) < 0.01, `MC ${pct(mc.players[0].equity)}% vs EXACT ${pct(exact.players[0].equity)}%`);
    });
});
describe('Equity エンジン: デッドカード / フォールド', () => {
    test('フォールドした既知札はデッキから除かれ、勝率に影響する', () => {
        // c は 9 を 2 枚フォールドしている。相手のセット/ストレートの分母が変わる
        const players = [
            player('a', 'As Ah'),
            player('b', 'Td Tc'),
            player('c', '9h 9d', 'FOLDED'),
        ];
        const board = parseCards('2s 7d Ks');
        const withDead = calculateEquity({ players, board });
        // 明示 deadCards で同じことをしても一致する
        const asDead = calculateEquity({
            players: [player('a', 'As Ah'), player('b', 'Td Tc')],
            board,
            deadCards: parseCards('9h 9d'),
        });
        assert.ok(Math.abs(withDead.players[0].equity - asDead.players[0].equity) < 1e-9);
        // フォールド者は結果に含まれない
        assert.equal(withDead.players.length, 2);
        assert.deepEqual(withDead.players.map((p) => p.playerId), ['a', 'b']);
    });
});
describe('Equity エンジン: バリデーション', () => {
    const good = () => [player('a', 'As Ah'), player('b', 'Kd Kc')];
    test('重複カードを拒否', () => {
        assert.throws(() => calculateEquity({ players: [player('a', 'As Ah'), player('b', 'As Kc')], board: [] }), (e) => e instanceof EquityError && e.code === 'DUPLICATE_CARD');
    });
    test('ボードとホールの重複も拒否', () => {
        assert.throws(() => calculateEquity({ players: good(), board: parseCards('As 2d 3c') }), (e) => e instanceof EquityError && e.code === 'DUPLICATE_CARD');
    });
    test('不正なボード枚数を拒否', () => {
        assert.throws(() => calculateEquity({ players: good(), board: parseCards('2d 3c') }), (e) => e instanceof EquityError && e.code === 'INVALID_BOARD');
    });
    test('人数不足を拒否', () => {
        assert.throws(() => calculateEquity({ players: [player('a', 'As Ah')], board: [] }), (e) => e instanceof EquityError && e.code === 'INVALID_PLAYER_COUNT');
    });
    test('ショーダウン対象が 2 人未満（片方フォールド）を拒否', () => {
        assert.throws(() => calculateEquity({
            players: [player('a', 'As Ah'), player('b', 'Kd Kc', 'FOLDED')],
            board: [],
        }), (e) => e instanceof EquityError && e.code === 'NO_ACTIVE_PLAYERS');
    });
    test('不正なカード整数を拒否', () => {
        assert.throws(() => calculateEquity({ players: [{ id: 'a', holeCards: [99, 0], status: 'ALL_IN' }, player('b', 'Kd Kc')], board: [] }), (e) => e instanceof EquityError && e.code === 'INVALID_CARD');
    });
});
describe('Equity エンジン: 不変条件（プロパティ）', () => {
    test('ランダム局面で 0<=equity<=1・合計≈1・win+tie+lose≈1', () => {
        // 決定的にデッキから配って複数局面を検証
        for (let trial = 0; trial < 40; trial++) {
            const deck = Array.from({ length: 52 }, (_, i) => i);
            // 線形合同で決定的にシャッフル
            let s = (trial + 1) * 2654435761;
            const rnd = () => {
                s = (s * 1103515245 + 12345) & 0x7fffffff;
                return s / 0x7fffffff;
            };
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(rnd() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
            const nPlayers = 2 + (trial % 4); // 2..5
            const players = [];
            let k = 0;
            for (let p = 0; p < nPlayers; p++) {
                players.push({ id: `p${p}`, holeCards: [deck[k++], deck[k++]], status: 'ALL_IN' });
            }
            const boardLen = [0, 3, 4, 5][trial % 4];
            const board = deck.slice(k, k + boardLen);
            // 不変条件の確認が目的なので、preflop の巨大数え上げを避けて MC で高速に回す
            const r = calculateEquity({ players, board, mode: 'MONTE_CARLO', samples: 8000, seed: trial });
            let total = 0;
            for (const pl of r.players) {
                assert.ok(pl.equity >= 0 && pl.equity <= 1, `equity=${pl.equity}`);
                assert.ok(Math.abs(pl.winProbability + pl.tieProbability + pl.loseProbability - 1) < 1e-6);
                total += pl.equity;
            }
            assert.ok(Math.abs(total - 1) < 1e-6, `合計 ${total} (trial ${trial})`);
        }
    });
    test('スート一括置換で Equity は不変', () => {
        // s->h, h->d, d->c, c->s に回してもエクイティは変わらない
        const rotate = (c) => {
            const rank = c >> 2;
            const suit = (c & 3) + 1 === 4 ? 0 : (c & 3) + 1;
            return (rank << 2) | suit;
        };
        const orig = {
            players: [player('a', 'As Ks'), player('b', 'Qd Jd')],
            board: parseCards('Ts 9h 2c'),
        };
        const rotated = {
            players: orig.players.map((p) => ({ ...p, holeCards: [rotate(p.holeCards[0]), rotate(p.holeCards[1])] })),
            board: orig.board.map(rotate),
        };
        const r1 = calculateEquity(orig);
        const r2 = calculateEquity(rotated);
        for (let i = 0; i < r1.players.length; i++) {
            assert.ok(Math.abs(r1.players[i].equity - r2.players[i].equity) < 1e-9);
        }
    });
});
describe('主観勝率（HERO_VS_UNKNOWN）: 情報漏洩しないこと', () => {
    test('相手の実手札を引数に取らない＝構造的に漏れない（決定的・再現可能）', () => {
        const h = hole('As Ks');
        const board = parseCards('Qh 7d 2c');
        // 同じ (hole, board, oppCount, seed) なら毎回同じ。相手カードは入力に存在しない。
        const a = heroEquityVsUnknown(h, board, 1, { seed: 42, iters: 2000 });
        const b = heroEquityVsUnknown(h, board, 1, { seed: 42, iters: 2000 });
        assert.equal(a, b, '決定的でない（漏洩とは別に表示がちらつく）');
        assert.ok(a > 0 && a < 1);
    });
    test('AA は 1 人の未知相手に対して約 85%（プリフロップ）', () => {
        const r = heroEquityVsUnknown(hole('As Ah'), [], 1, { seed: 1, iters: 20000 });
        assert.ok(Math.abs(pct(r) - 85.2) < 1.5, `AA vs 1 unknown = ${pct(r)}%`);
    });
    test('相手が増えるほど主観勝率は下がる（公開情報＝人数だけに依存）', () => {
        const h = hole('As Ah');
        const vs1 = heroEquityVsUnknown(h, [], 1, { seed: 3, iters: 8000 });
        const vs3 = heroEquityVsUnknown(h, [], 3, { seed: 3, iters: 8000 });
        const vs6 = heroEquityVsUnknown(h, [], 6, { seed: 3, iters: 8000 });
        assert.ok(vs1 > vs3 && vs3 > vs6, `${pct(vs1)} > ${pct(vs3)} > ${pct(vs6)}`);
    });
    test('ボードが自分に不利でも、その変化は公開情報から導ける（主観値も動く）', () => {
        // AK が 2-2-7 レインボーで主観勝率を落とす。これは誰でもボードから分かる変化＝漏洩ではない
        const pre = heroEquityVsUnknown(hole('As Ks'), [], 1, { seed: 5, iters: 8000 });
        const miss = heroEquityVsUnknown(hole('As Ks'), parseCards('2h 2d 7c'), 1, { seed: 5, iters: 8000 });
        assert.ok(miss < pre, `flop miss ${pct(miss)}% は preflop ${pct(pre)}% より低いはず`);
    });
});
describe('可視性ポリシー（resolveVisibility, §34-36）', () => {
    test('対戦中（手札非公開）のプレイヤーは HERO_VS_UNKNOWN', () => {
        assert.equal(resolveVisibility({ isSpectator: false, handComplete: false, cardsPublic: false }), EquityVisibilityMode.HERO_VS_UNKNOWN);
    });
    test('ショーダウンで手札公開後のみ SHOWDOWN_ONLY', () => {
        assert.equal(resolveVisibility({ isSpectator: false, handComplete: true, cardsPublic: true }), EquityVisibilityMode.SHOWDOWN_ONLY);
        // 手札がまだ公開されていなければ実カード勝率は出さない
        assert.equal(resolveVisibility({ isSpectator: false, handComplete: true, cardsPublic: false }), EquityVisibilityMode.HERO_VS_UNKNOWN);
    });
    test('観戦者は権限がある時だけ SPECTATOR_ALL_KNOWN、無ければ NONE', () => {
        assert.equal(resolveVisibility({ isSpectator: true, handComplete: false, cardsPublic: false, spectatorAuthorized: true }), EquityVisibilityMode.SPECTATOR_ALL_KNOWN);
        assert.equal(resolveVisibility({ isSpectator: true, handComplete: false, cardsPublic: false }), EquityVisibilityMode.NONE);
    });
    test('リプレイは REPLAY', () => {
        assert.equal(resolveVisibility({ isSpectator: false, handComplete: true, cardsPublic: true, isReplay: true }), EquityVisibilityMode.REPLAY);
    });
});
describe('Equity エンジン: モード選択', () => {
    test('board 3/4/5 は AUTO で必ず EXACT', () => {
        for (const b of ['2h 9d Tc', '2h 9d Tc As', '2h 9d Tc As 3c']) {
            const r = calculateEquity({ players: [player('a', 'Ad Kc'), player('b', '7s 7h')], board: parseCards(b) });
            assert.equal(r.exact, true, `board=${b}`);
        }
    });
    test('プリフロップ AUTO は既定で MONTE_CARLO（seed を返す）', () => {
        const r = calculateEquity({
            players: [player('a', 'As Ah'), player('b', 'Kd Kc')],
            board: [],
            mode: 'AUTO',
            samples: 5000,
            seed: 1,
        });
        assert.equal(r.exact, false);
        assert.equal(r.modeUsed, 'MONTE_CARLO');
        assert.equal(typeof r.seed, 'number');
    });
    test('maxExactCases を上げてもフロップ以降は数え上げのまま', () => {
        const r = calculateEquity({
            players: [player('a', 'As Ah'), player('b', 'Kd Kc')],
            board: parseCards('2h 9d Tc'),
            mode: 'AUTO',
        });
        assert.equal(r.exact, true);
        assert.equal(r.modeUsed, 'EXACT');
    });
});
//# sourceMappingURL=equity.test.js.map