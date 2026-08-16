import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Hand } from '../src/table.js';
import { createSeededRng } from '../src/cards.js';
import { playOut } from '../src/bot.js';
import { BountyPool, MysteryChest, buildMysteryChest } from '../src/server/bounty.js';
import { commitmentOf, createFairRng } from '../src/fair.js';
import { shuffle } from '../src/cards.js';
import { Harness } from './helpers/harness.js';
const seats = (stacks) => stacks.map((s, i) => ({ id: `P${i}`, name: `P${i}`, stack: s }));
// ===========================================================================
// ストラドル
// ===========================================================================
describe('ストラドル', () => {
    test('ストラドルが置かれるとベット水準が上がる', () => {
        const h = new Hand({
            seats: seats([10000, 10000, 10000]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            straddles: [{ seat: 0, amount: 200 }], // ボタン=0, SB=1, BB=2 → UTG は席0
        });
        assert.equal(h.players[0].totalBet, 200, 'ストラドルが出ていない');
        assert.equal(h.currentBet, 200, '卓のベット水準がストラドル額になっていない');
    });
    test('最小レイズはストラドルの 2 倍', () => {
        const h = new Hand({
            seats: seats([10000, 10000, 10000]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            straddles: [{ seat: 0, amount: 200 }],
        });
        const actor = h.actingSeat;
        const raise = h.getLegalActions(actor).find((a) => a.type === 'raise');
        assert.equal(raise.min, 400);
    });
    test('ストラドラーが最後にアクションする', () => {
        const h = new Hand({
            seats: seats([10000, 10000, 10000, 10000]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            straddles: [{ seat: 3, amount: 200 }], // BB=席2 の左隣は席3
        });
        // ストラドラー（席3）の左隣＝席0 から始まる
        assert.equal(h.actingSeat, 0);
        h.act(0, 'call');
        h.act(1, 'call');
        h.act(2, 'call');
        // 最後にストラドラーへ。既に 200 出しているのでチェックできる
        assert.equal(h.actingSeat, 3);
        const types = h.getLegalActions(3).map((a) => a.type);
        assert.ok(types.includes('check'), 'ストラドラーにオプションが無い');
        assert.ok(types.includes('raise'), 'ストラドラーがレイズできない');
    });
    test('ストラドラーがチェックするとフロップへ進む', () => {
        const h = new Hand({
            seats: seats([10000, 10000, 10000, 10000]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            straddles: [{ seat: 3, amount: 200 }],
        });
        h.act(0, 'call');
        h.act(1, 'call');
        h.act(2, 'call');
        h.act(3, 'check');
        assert.equal(h.street, 'flop');
        assert.equal(h.totalPot, 800, 'ポットが 200 x 4 になっていない');
    });
    test('ダブルストラドルも積める', () => {
        const h = new Hand({
            seats: seats([10000, 10000, 10000, 10000, 10000]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            straddles: [
                { seat: 3, amount: 200 },
                { seat: 4, amount: 400 },
            ],
        });
        assert.equal(h.currentBet, 400);
        assert.equal(h.actingSeat, 0, '2 段目のストラドラーの左隣から始まるはず');
        const raise = h.getLegalActions(0).find((a) => a.type === 'raise');
        assert.equal(raise.min, 800, '最小レイズが最大ストラドルの 2 倍になっていない');
    });
    test('ストラドルがあってもチップの総量は保存される', () => {
        const rng = createSeededRng(4321);
        for (let i = 0; i < 300; i++) {
            const n = 3 + rng.randomInt(6);
            const stacks = [];
            for (let k = 0; k < n; k++)
                stacks.push(500 + rng.randomInt(20000));
            const bbEngine = (0 + 2) % n;
            const h = new Hand({
                seats: seats(stacks),
                buttonIndex: 0,
                smallBlind: 50,
                bigBlind: 100,
                straddles: [{ seat: (bbEngine + 1) % n, amount: 200 }],
                rng,
            });
            playOut(h, rng, 'tight');
            const before = stacks.reduce((a, b) => a + b, 0);
            const after = h.players.reduce((a, p) => a + p.stack, 0);
            assert.equal(after, before, `ハンド ${i} でチップが増減した`);
        }
    });
    test('スタックが足りない席のストラドルはオールインとして処理される', () => {
        const h = new Hand({
            seats: seats([10000, 10000, 10000, 150]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            straddles: [{ seat: 3, amount: 200 }],
        });
        assert.equal(h.players[3].totalBet, 150);
        assert.equal(h.players[3].allIn, true);
    });
});
// ===========================================================================
// バウンティ
// ===========================================================================
describe('ミステリーバウンティの封筒', () => {
    test('封筒の合計は必ずプールと一致する', () => {
        for (const [pool, count] of [
            [100000, 10],
            [1000000, 150],
            [7, 3],
            [999999, 7],
            [50000, 1],
        ]) {
            const chest = buildMysteryChest(pool, count);
            assert.equal(chest.length, count, `枚数が ${chest.length}`);
            assert.equal(chest.reduce((a, e) => a + e.amount, 0), pool, `プール ${pool} / ${count} 枚で合計が合わない`);
        }
    });
    test('トップ賞が最低額より大幅に大きい', () => {
        const chest = buildMysteryChest(1_000_000, 100);
        const max = Math.max(...chest.map((e) => e.amount));
        const min = Math.min(...chest.map((e) => e.amount));
        assert.ok(max > min * 10, `トップ ${max} / 最低 ${min} で差が小さすぎる`);
    });
    test('封筒の並びはシードから再現できる（Provably Fair）', () => {
        const seed = 'ab'.repeat(32);
        const a = new MysteryChest(500000, 20, 'table-1', seed);
        const b = new MysteryChest(500000, 20, 'table-1', seed);
        const drawnA = [];
        const drawnB = [];
        for (let i = 0; i < 20; i++) {
            drawnA.push(a.draw().amount);
            drawnB.push(b.draw().amount);
        }
        assert.deepEqual(drawnA, drawnB, '同じシードから違う並びが出ている');
    });
    test('コミットメントは開示シードのハッシュと一致する', () => {
        const chest = new MysteryChest(100000, 10, 'x');
        const r = chest.reveal();
        assert.equal(commitmentOf(r.serverSeed), chest.commitment);
        assert.equal(r.commitment, chest.commitment);
    });
    test('第三者が同じ手順で並びを再現できる', () => {
        const seed = 'cd'.repeat(32);
        const chest = new MysteryChest(300000, 12, 'tour-9', seed);
        const drawn = [];
        for (let i = 0; i < 12; i++)
            drawn.push(chest.draw().amount);
        // 検証側：公開情報だけから同じ並びを作る
        const rebuilt = shuffle(buildMysteryChest(300000, 12), createFairRng({ serverSeed: seed, clientSeed: 'tour-9', nonce: 0 })).map((e) => e.amount);
        assert.deepEqual(drawn, rebuilt, '第三者が並びを再現できない');
    });
    test('枚数を超えて引けない', () => {
        const chest = new MysteryChest(1000, 3, 'x');
        assert.ok(chest.draw());
        assert.ok(chest.draw());
        assert.ok(chest.draw());
        assert.equal(chest.draw(), null);
    });
});
describe('バウンティプール', () => {
    test('クラシック：撃墜すると全額もらえる', () => {
        const p = new BountyPool({ mode: 'classic', perEntry: 1000 });
        p.addEntry('a');
        p.addEntry('b');
        const award = p.knockout('a', 'b');
        assert.equal(award.cash, 1000);
        assert.equal(award.addedToOwn, 0);
        assert.equal(p.earnedBy('a'), 1000);
        assert.equal(p.bountyOf('a'), 1000, '自分の賞金首は変わらない');
        assert.equal(p.bountyOf('b'), 0, '倒された側の賞金首は消える');
    });
    test('PKO：半分が現金、半分が自分の賞金首に積まれる', () => {
        const p = new BountyPool({ mode: 'progressive', perEntry: 1000 });
        p.addEntry('a');
        p.addEntry('b');
        const award = p.knockout('a', 'b');
        assert.equal(award.cash, 500);
        assert.equal(award.addedToOwn, 500);
        assert.equal(p.bountyOf('a'), 1500, '自分の賞金首が育っていない');
    });
    test('PKO：賞金首は撃墜を重ねるほど育つ', () => {
        const p = new BountyPool({ mode: 'progressive', perEntry: 1000 });
        for (const id of ['a', 'b', 'c', 'd'])
            p.addEntry(id);
        p.knockout('a', 'b'); // a: 1500
        p.knockout('a', 'c'); // a: 2000
        assert.equal(p.bountyOf('a'), 2000);
        // d が a を倒すと、育った賞金首の半分をもらえる
        const award = p.knockout('d', 'a');
        assert.equal(award.cash, 1000);
        assert.equal(p.bountyOf('d'), 2000);
    });
    test('PKO：優勝者は自分の賞金首を全額回収する', () => {
        const p = new BountyPool({ mode: 'progressive', perEntry: 1000 });
        p.addEntry('a');
        p.addEntry('b');
        p.knockout('a', 'b');
        const final = p.finish('a');
        assert.equal(final.cash, 1500);
        assert.equal(p.audit().ok, true, JSON.stringify(p.audit()));
    });
    test('複数人でポットを分けた場合は賞金首も分割される', () => {
        const p = new BountyPool({ mode: 'classic', perEntry: 1001 });
        for (const id of ['a', 'b', 'c'])
            p.addEntry(id);
        const awards = p.knockoutSplit(['a', 'b'], 'c');
        assert.equal(awards.length, 2);
        assert.equal(awards.reduce((x, y) => x + y.cash, 0), 1001, '分割で端数が消えている');
        assert.equal(awards[0].cash, 501, '端数は最初の 1 人へ');
    });
    test('誰の手柄でもない脱落では賞金首がプールに残る', () => {
        const p = new BountyPool({ mode: 'classic', perEntry: 1000 });
        p.addEntry('a');
        p.addEntry('b');
        p.knockout(null, 'b');
        assert.equal(p.paidOut, 0);
        const swept = p.sweepRemainder();
        assert.equal(swept, 1000, '行き場を失った b の賞金首だけが回収されるはず');
        assert.equal(p.bountyOf('a'), 1000, '生存者の賞金首まで回収してはいけない');
        assert.equal(p.audit().ok, true);
    });
    test('会計：支払い済み + 未払い = プール（全方式）', () => {
        for (const mode of ['classic', 'progressive']) {
            const p = new BountyPool({ mode, perEntry: 777 });
            const ids = ['a', 'b', 'c', 'd', 'e'];
            for (const id of ids)
                p.addEntry(id);
            p.knockout('a', 'b');
            p.knockoutSplit(['c', 'd'], 'e');
            p.knockout('a', 'c');
            p.knockout('a', 'd');
            p.finish('a');
            const audit = p.audit();
            assert.equal(audit.ok, true, `${mode}: ${JSON.stringify(audit)}`);
            assert.equal(audit.paid, audit.pool, `${mode}: 支払い総額がプールと違う`);
        }
    });
    test('ミステリー：有効化前は撃墜しても何も出ない', () => {
        const p = new BountyPool({ mode: 'mystery', perEntry: 1000, mysteryActivationRatio: 0.2 });
        for (const id of ['a', 'b', 'c', 'd', 'e'])
            p.addEntry(id);
        assert.equal(p.knockout('a', 'b'), null, '有効化前に賞金が出ている');
        assert.equal(p.mysteryActive, false);
    });
    test('ミステリー：有効化すると封筒が引ける', () => {
        const p = new BountyPool({ mode: 'mystery', perEntry: 1000 });
        for (const id of ['a', 'b', 'c'])
            p.addEntry(id);
        p.activateMystery(3, 'seed');
        const award = p.knockout('a', 'b');
        assert.ok(award.envelope, '封筒が出ていない');
        assert.ok(award.cash > 0);
        assert.equal(p.mysteryChest.total, 3000, '封筒の合計がプールと違う');
    });
    test('ミステリー：全部引くとプールが空になる', () => {
        const p = new BountyPool({ mode: 'mystery', perEntry: 1000 });
        for (const id of ['a', 'b', 'c', 'd'])
            p.addEntry(id);
        p.activateMystery(4, 'seed');
        p.knockout('a', 'b');
        p.knockout('a', 'c');
        p.knockout('a', 'd');
        p.finish('a');
        assert.equal(p.paidOut, 4000, '支払い総額がプールと違う');
        assert.equal(p.audit().ok, true);
    });
    test('有効化の閾値が正しく効く', () => {
        const p = new BountyPool({ mode: 'mystery', perEntry: 100, mysteryActivationRatio: 0.15 });
        for (let i = 0; i < 100; i++)
            p.addEntry(`u${i}`);
        assert.equal(p.shouldActivateMystery(50, 100), false);
        assert.equal(p.shouldActivateMystery(16, 100), false);
        assert.equal(p.shouldActivateMystery(15, 100), true);
    });
});
// ===========================================================================
// トーナメント統合
// ===========================================================================
const CASH_TABLE = { tableId: 'cash-1', name: 'キャッシュ卓', smallBlind: 50, bigBlind: 100, maxSeats: 6 };
const fastLevels = (bb) => Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    smallBlind: Math.round((bb * Math.pow(2.2, i)) / 2),
    bigBlind: Math.round(bb * Math.pow(2.2, i)),
    ante: 0,
}));
const lastView = (c) => {
    for (let i = c.received.length - 1; i >= 0; i--) {
        const m = c.received[i];
        if (m.t === 'tournament.state')
            return m.view;
    }
    return null;
};
function bountyHarness(mode, players = 3, extra = {}) {
    return new Harness({
        tables: [CASH_TABLE],
        signupBonus: 100000,
        tournaments: [
            {
                tournamentId: 'b1',
                name: `テスト ${mode}`,
                type: 'sng',
                buyIn: 1000,
                fee: 100,
                startingStack: 1500,
                seatsPerTable: players,
                maxPlayers: players,
                levels: fastLevels(50),
                levelDurationMs: 3000,
                bounty: { mode, perEntry: 500, mysteryActivationRatio: 1 },
                ...extra,
            },
        ],
    });
}
function registerAll(h, count) {
    const cs = [];
    for (let i = 0; i < count; i++) {
        const c = h.login(`P${i}`, `user${i}`);
        h.enableBot(c, 'allin');
        cs.push(c);
    }
    for (const c of cs)
        c.send({ t: 'tour.register', tournamentId: 'b1' });
    for (const c of cs)
        c.send({ t: 'tour.watch', tournamentId: 'b1' });
    return cs;
}
describe('バウンティトーナメント（統合）', () => {
    for (const mode of ['classic', 'progressive', 'mystery']) {
        test(`${mode}：参加費に賞金首分が上乗せされる`, () => {
            const h = bountyHarness(mode);
            const cs = registerAll(h, 3);
            // buyIn 1000 + bounty 500 + fee 100 = 1600
            assert.equal(h.lobby.store.balance(cs[0].userId, 'chips'), 100000 - 1600);
            const v = lastView(cs[0]);
            assert.equal(v.bounty.pool, 1500, '賞金首プールが 500 x 3 になっていない');
            assert.equal(v.prizePool, 3000, '通常の賞金プールは 1000 x 3 のまま');
            h.dispose();
        });
        test(`${mode}：最後まで進み、チップ総量が保存される`, () => {
            const h = bountyHarness(mode);
            const before = 100000 * 3;
            const cs = registerAll(h, 3);
            for (let i = 0; i < 3000 && lastView(cs[0]).state === 'running'; i++)
                h.pump(500);
            const v = lastView(cs[0]);
            assert.equal(v.state, 'finished', 'トーナメントが終わらない');
            // 消えるのは手数料だけ。賞金プールも賞金首プールも全額プレイヤーに返る
            assert.equal(h.lobby.totalChips(), before - 100 * 3, `${mode} でチップの総量が想定と違う`);
            assert.equal(h.lobby.store.audit().ok, true);
            const bountyAudit = h.lobby.getTournament('b1').bounty.audit();
            assert.equal(bountyAudit.ok, true, JSON.stringify(bountyAudit));
            assert.equal(bountyAudit.paid, 1500, '賞金首プールが全額支払われていない');
            h.dispose();
        });
    }
    test('PKO：撃墜すると賞金首が育つ', () => {
        const h = bountyHarness('progressive', 3);
        const cs = registerAll(h, 3);
        for (let i = 0; i < 3000 && lastView(cs[0]).state === 'running'; i++)
            h.pump(500);
        const views = cs.map((c) => lastView(c));
        const totalKo = views.reduce((a, v) => a + v.bounty.yourKnockouts, 0);
        assert.equal(totalKo, 2, `3 人なら撃墜は 2 回のはず（実際 ${totalKo}）`);
        const totalEarned = views.reduce((a, v) => a + v.bounty.yourEarned, 0);
        assert.equal(totalEarned, 1500, '獲得額の合計が賞金首プールと一致しない');
        h.dispose();
    });
    test('ミステリー：終了後にシードが開示され、コミットメントと一致する', () => {
        const h = bountyHarness('mystery', 3);
        const cs = registerAll(h, 3);
        const commitmentDuring = lastView(cs[0]).bounty.commitment;
        for (let i = 0; i < 3000 && lastView(cs[0]).state === 'running'; i++)
            h.pump(500);
        const v = lastView(cs[0]);
        assert.ok(v.bounty.serverSeed, 'シードが開示されていない');
        assert.equal(commitmentOf(v.bounty.serverSeed), v.bounty.commitment, 'コミットメントと一致しない');
        if (commitmentDuring)
            assert.equal(v.bounty.commitment, commitmentDuring, '途中と終了後でコミットメントが違う');
        h.dispose();
    });
    test('進行中はミステリーのシードが漏れていない', () => {
        const h = bountyHarness('mystery', 3);
        const cs = registerAll(h, 3);
        h.pump(2000);
        for (const c of cs) {
            for (const m of c.received) {
                if (m.t !== 'tournament.state')
                    continue;
                if (m.view.state === 'running' || m.view.state === 'registering') {
                    assert.equal(m.view.bounty.serverSeed, null, '進行中にシードが漏れている');
                }
            }
        }
        h.dispose();
    });
    test('バウンティ無しのトーナメントでは賞金首が発生しない', () => {
        const h = new Harness({
            tables: [CASH_TABLE],
            signupBonus: 100000,
            tournaments: [
                {
                    tournamentId: 'b1',
                    name: 'フリーズアウト',
                    type: 'sng',
                    buyIn: 1000,
                    fee: 100,
                    startingStack: 1500,
                    seatsPerTable: 3,
                    maxPlayers: 3,
                    levels: fastLevels(50),
                },
            ],
        });
        const cs = registerAll(h, 3);
        assert.equal(h.lobby.store.balance(cs[0].userId, 'chips'), 100000 - 1100);
        assert.equal(lastView(cs[0]).bounty.mode, 'none');
        h.dispose();
    });
});
describe('リエントリーとアドオン', () => {
    test('フリーズアウトではリエントリーできない', () => {
        const h = bountyHarness('classic', 3);
        const cs = registerAll(h, 3);
        for (let i = 0; i < 3000 && lastView(cs[0]).state === 'running'; i++)
            h.pump(500);
        // 終了後は当然できない
        cs[0].send({ t: 'tour.register', tournamentId: 'b1' });
        assert.equal(cs[0].lastError()?.code, 'ILLEGAL_ACTION');
        h.dispose();
    });
    test('リエントリー可能な大会では、脱落後にもう一度参加できる', () => {
        const h = new Harness({
            tables: [CASH_TABLE],
            signupBonus: 200000,
            tournaments: [
                {
                    tournamentId: 'b1',
                    name: 'リエントリー MTT',
                    type: 'mtt',
                    buyIn: 1000,
                    fee: 100,
                    startingStack: 1500,
                    seatsPerTable: 3,
                    maxPlayers: 12,
                    minPlayers: 9,
                    levels: fastLevels(50),
                    levelDurationMs: 100000,
                    lateRegMs: 100_000_000, // 仮想時計を大きく進めるので、締切に引っかからないようにする
                    reEntryMax: 1,
                },
            ],
        });
        // 3 卓に分かれる人数にしておく。3 人だと最初の脱落と同時に大会が終わってしまい、
        // 「リエントリーできる状態」を捕まえられない
        const cs = registerAll(h, 9);
        const t = h.lobby.getTournament('b1');
        // 全員オールインのボットなので、数ハンドで必ず誰かが飛ぶ。
        // 大会が終わってしまうとリエントリー自体ができないので、running のうちに捕まえる
        let busted;
        for (let i = 0; i < 4000 && !busted && t.state === 'running'; i++) {
            h.pump(60);
            busted = cs.find((c) => {
                const v = lastView(c);
                return v?.registered && v.reEntriesLeft === 1 && v.yourTableId === null && v.state === 'running';
            });
        }
        assert.ok(busted, `脱落者を捕まえられなかった（大会の状態: ${t.state}）`);
        const balanceBefore = h.lobby.store.balance(busted.userId, 'chips');
        busted.send({ t: 'tour.register', tournamentId: 'b1' });
        assert.equal(busted.lastError(), null, `リエントリーが拒否された（状態=${t.state}, 残り=${lastView(busted)?.reEntriesLeft}）`);
        const after = h.lobby.store.balance(busted.userId, 'chips');
        assert.equal(balanceBefore - after, 1100, 'リエントリーで参加費が引かれていない');
        assert.equal(lastView(busted).reEntriesLeft, 0, 'リエントリー回数が減っていない');
        assert.equal(lastView(busted).yourTableId !== null, true, '卓に戻れていない');
        h.dispose();
    });
    test('リエントリー上限を超えると拒否される', () => {
        const h = bountyHarness('classic', 3, { reEntryMax: 0 });
        const cs = registerAll(h, 3);
        cs[0].send({ t: 'tour.register', tournamentId: 'b1' });
        assert.equal(cs[0].lastError()?.code, 'ALREADY_SEATED', '生存中の再登録は拒否されるはず');
        h.dispose();
    });
    test('アドオンでチップと賞金プールが増える', () => {
        const h = new Harness({
            tables: [CASH_TABLE],
            signupBonus: 200000,
            tournaments: [
                {
                    tournamentId: 'b1',
                    name: 'アドオン MTT',
                    type: 'mtt',
                    buyIn: 1000,
                    fee: 100,
                    startingStack: 1500,
                    seatsPerTable: 3,
                    maxPlayers: 9,
                    minPlayers: 3,
                    levels: fastLevels(50),
                    levelDurationMs: 100000,
                    lateRegMs: 100_000_000,
                    addOn: { price: 500, chips: 2000 },
                },
            ],
        });
        const cs = registerAll(h, 3);
        const before = h.lobby.store.balance(cs[0].userId, 'chips');
        const poolBefore = lastView(cs[0]).prizePool;
        cs[0].send({ t: 'tour.addon', tournamentId: 'b1' });
        assert.equal(cs[0].lastError(), null, `アドオンが失敗: ${JSON.stringify(cs[0].lastError())}`);
        assert.equal(h.lobby.store.balance(cs[0].userId, 'chips'), before - 500);
        assert.equal(lastView(cs[0]).prizePool, poolBefore + 500, 'アドオン分が賞金プールに入っていない');
        // 2 回目は拒否
        cs[0].send({ t: 'tour.addon', tournamentId: 'b1' });
        assert.equal(cs[0].lastError()?.code, 'ILLEGAL_ACTION');
        h.dispose();
    });
    test('アドオンが設定されていない大会では買えない', () => {
        const h = bountyHarness('classic', 3);
        const cs = registerAll(h, 3);
        cs[0].send({ t: 'tour.addon', tournamentId: 'b1' });
        assert.equal(cs[0].lastError()?.code, 'ILLEGAL_ACTION');
        h.dispose();
    });
});
describe('進行速度', () => {
    test('ターボ・ハイパーでレベルが短くなる', () => {
        const make = (speed) => new Harness({
            tables: [CASH_TABLE],
            tournaments: [
                {
                    tournamentId: 'b1',
                    name: speed,
                    type: 'sng',
                    buyIn: 100,
                    fee: 10,
                    startingStack: 1500,
                    seatsPerTable: 3,
                    maxPlayers: 3,
                    levelDurationMs: 300000,
                    speed,
                },
            ],
        });
        const normal = make('normal').lobby.getTournament('b1').cfg.levelDurationMs;
        const turbo = make('turbo').lobby.getTournament('b1').cfg.levelDurationMs;
        const hyper = make('hyper').lobby.getTournament('b1').cfg.levelDurationMs;
        assert.ok(turbo < normal, 'ターボが速くなっていない');
        assert.ok(hyper < turbo, 'ハイパーがターボより速くない');
        assert.equal(normal, 300000);
    });
});
describe('卓でのストラドル設定', () => {
    const STRADDLE_TABLE = {
        tableId: 'st-1',
        name: 'ストラドル卓',
        smallBlind: 50,
        bigBlind: 100,
        maxSeats: 6,
        straddleAllowed: true,
        rakePercent: 0,
        seedWindowMs: 100,
        handIntervalMs: 100,
    };
    test('許可された卓では予約できる', () => {
        const h = new Harness({ tables: [STRADDLE_TABLE], signupBonus: 100000 });
        const a = h.login('A');
        a.send({ t: 'table.watch', tableId: 'st-1' });
        a.send({ t: 'table.sit', tableId: 'st-1', buyIn: 10000 });
        a.send({ t: 'table.straddle', tableId: 'st-1', enabled: true });
        assert.equal(a.lastError(), null);
        assert.equal(a.state()?.straddleArmed, true);
        assert.equal(a.state()?.straddleAllowed, true);
        h.dispose();
    });
    test('許可されていない卓では拒否される', () => {
        const h = new Harness({ tables: [CASH_TABLE], signupBonus: 100000 });
        const a = h.login('A');
        a.send({ t: 'table.watch', tableId: CASH_TABLE.tableId });
        a.send({ t: 'table.sit', tableId: CASH_TABLE.tableId, buyIn: 5000 });
        a.send({ t: 'table.straddle', tableId: CASH_TABLE.tableId, enabled: true });
        assert.equal(a.lastError()?.code, 'ILLEGAL_ACTION');
        assert.equal(a.state()?.straddleAllowed, false);
        h.dispose();
    });
    test('全員が予約した卓でもチップ総量は保存される', () => {
        const h = new Harness({ tables: [STRADDLE_TABLE], signupBonus: 100000 });
        const cs = [];
        for (let i = 0; i < 4; i++) {
            const c = h.login(`P${i}`, `u${i}`);
            c.send({ t: 'table.watch', tableId: 'st-1' });
            c.send({ t: 'table.sit', tableId: 'st-1', buyIn: 10000 });
            c.send({ t: 'table.straddle', tableId: 'st-1', enabled: true });
            h.enableBot(c, 'passive');
            cs.push(c);
        }
        const before = h.lobby.totalChips();
        const played = h.runHands(10, 200);
        assert.ok(played >= 3, `ハンドが進んでいない: ${played}`);
        assert.equal(h.lobby.totalChips(), before, 'ストラドル卓でチップの総量が変わっている');
        assert.equal(h.lobby.store.audit().ok, true);
        h.dispose();
    });
    test('ストラドルが実際に置かれている', () => {
        const h = new Harness({ tables: [STRADDLE_TABLE], signupBonus: 100000 });
        const cs = [];
        for (let i = 0; i < 4; i++) {
            const c = h.login(`P${i}`, `u${i}`);
            c.send({ t: 'table.watch', tableId: 'st-1' });
            c.send({ t: 'table.sit', tableId: 'st-1', buyIn: 10000 });
            c.send({ t: 'table.straddle', tableId: 'st-1', enabled: true });
            h.enableBot(c, 'passive');
            cs.push(c);
        }
        h.runHands(5, 200);
        const straddleEvents = cs[0].received
            .filter((m) => m.t === 'table.events')
            .flatMap((m) => (m.t === 'table.events' ? m.events : []))
            .filter((e) => e.type === 'straddle');
        assert.ok(straddleEvents.length > 0, 'ストラドルが 1 度も置かれていない');
        assert.equal(straddleEvents[0].amount, 200, 'ストラドル額が 2BB ではない');
        h.dispose();
    });
});
//# sourceMappingURL=formats.test.js.map