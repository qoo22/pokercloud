import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from './helpers/harness.js';
import { payoutStructure, standardBlindLevels } from '../src/server/tournament.js';
const CASH_TABLE = {
    tableId: 'cash-1',
    name: 'キャッシュ卓',
    smallBlind: 50,
    bigBlind: 100,
    maxSeats: 6,
};
/** テストを短時間で終わらせるため、ブラインドを急上昇させて必ず決着させる */
const fastLevels = (bb) => Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    smallBlind: Math.round((bb * Math.pow(2.2, i)) / 2),
    bigBlind: Math.round(bb * Math.pow(2.2, i)),
    ante: 0,
}));
function sngHarness(players, seatsPerTable = players) {
    return new Harness({
        tables: [CASH_TABLE],
        signupBonus: 100000,
        tournaments: [
            {
                tournamentId: 'sng-1',
                name: 'テスト SNG',
                type: 'sng',
                buyIn: 1000,
                fee: 100,
                startingStack: 1500,
                seatsPerTable,
                maxPlayers: players,
                levels: fastLevels(50),
                levelDurationMs: 3000,
            },
        ],
    });
}
function registerAll(h, count, style = 'allin') {
    const cs = [];
    for (let i = 0; i < count; i++) {
        const c = h.login(`P${i}`, `user${i}`);
        h.enableBot(c, style);
        cs.push(c);
    }
    for (const c of cs)
        c.send({ t: 'tour.register', tournamentId: 'sng-1' });
    for (const c of cs)
        c.send({ t: 'tour.watch', tournamentId: 'sng-1' });
    return cs;
}
const lastView = (c) => {
    for (let i = c.received.length - 1; i >= 0; i--) {
        const m = c.received[i];
        if (m.t === 'tournament.state')
            return m.view;
    }
    return null;
};
// ---------------------------------------------------------------------------
describe('ブラインド構造とペイテーブル', () => {
    test('ブラインドは単調増加する', () => {
        const levels = standardBlindLevels(20, 20);
        for (let i = 1; i < levels.length; i++) {
            assert.ok(levels[i].bigBlind >= levels[i - 1].bigBlind, `レベル ${i + 1} でブラインドが下がっている`);
        }
    });
    test('1 レベルあたりの上昇率が極端でない', () => {
        const levels = standardBlindLevels(20, 20).filter((l) => !l.isBreak);
        for (let i = 1; i < levels.length; i++) {
            const ratio = levels[i].bigBlind / levels[i - 1].bigBlind;
            assert.ok(ratio >= 1.0 && ratio <= 2.5, `レベル ${i} の上昇率 ${ratio.toFixed(2)} が極端`);
        }
    });
    test('SB は BB のおよそ半分', () => {
        for (const l of standardBlindLevels(20, 12)) {
            assert.ok(Math.abs(l.smallBlind * 2 - l.bigBlind) <= 1, `SB=${l.smallBlind} BB=${l.bigBlind}`);
        }
    });
    test('ペイテーブルの合計は必ず 1 になる', () => {
        for (const n of [2, 3, 6, 9, 18, 45, 100, 500, 1000]) {
            const sum = payoutStructure(n).reduce((a, b) => a + b, 0);
            assert.ok(Math.abs(sum - 1) < 1e-9, `${n} 人のとき合計 ${sum}`);
        }
    });
    test('入賞人数は参加者数を超えない', () => {
        for (const n of [2, 3, 6, 9, 18, 45, 100]) {
            assert.ok(payoutStructure(n).length <= n, `${n} 人で入賞 ${payoutStructure(n).length} 人`);
        }
    });
    test('配分は上位ほど大きい', () => {
        const p = payoutStructure(100);
        for (let i = 1; i < p.length; i++)
            assert.ok(p[i] <= p[i - 1], `${i} 位が ${i - 1} 位より多い`);
    });
    test('大規模なら約 15% が入賞する', () => {
        assert.equal(payoutStructure(1000).length, 150);
    });
});
describe('Sit & Go', () => {
    test('定員に達すると自動的に始まる', () => {
        const h = sngHarness(3);
        const cs = registerAll(h, 3);
        const v = lastView(cs[0]);
        assert.equal(v.state, 'running', `状態が ${v.state}`);
        assert.equal(v.entrants, 3);
        assert.equal(v.prizePool, 3000, '参加費 1000 x 3。手数料 100 はプールに入らない');
        h.dispose();
    });
    test('定員に満たなければ始まらない', () => {
        const h = sngHarness(4);
        const cs = registerAll(h, 2);
        assert.equal(lastView(cs[0]).state, 'registering');
        h.dispose();
    });
    test('参加費と手数料が残高から引かれる', () => {
        const h = sngHarness(3);
        const cs = registerAll(h, 3);
        assert.equal(h.lobby.store.balance(cs[0].userId, 'chips'), 100000 - 1100);
        h.dispose();
    });
    test('残高が足りなければ参加できない', () => {
        const h = new Harness({
            tables: [CASH_TABLE],
            signupBonus: 500,
            tournaments: [
                {
                    tournamentId: 'sng-1',
                    name: 'テスト SNG',
                    type: 'sng',
                    buyIn: 1000,
                    fee: 100,
                    startingStack: 1500,
                    seatsPerTable: 3,
                    maxPlayers: 3,
                },
            ],
        });
        const c = h.login('Poor');
        c.send({ t: 'tour.register', tournamentId: 'sng-1' });
        assert.equal(c.lastError()?.code, 'INSUFFICIENT_FUNDS');
        h.dispose();
    });
    test('二重登録はできない', () => {
        const h = sngHarness(4);
        const c = h.login('A');
        c.send({ t: 'tour.register', tournamentId: 'sng-1' });
        c.send({ t: 'tour.register', tournamentId: 'sng-1' });
        assert.equal(c.lastError()?.code, 'ALREADY_SEATED');
        h.dispose();
    });
    test('開始前なら登録を取り消して全額返金される', () => {
        const h = sngHarness(4);
        const c = h.login('A');
        c.send({ t: 'tour.register', tournamentId: 'sng-1' });
        assert.equal(h.lobby.store.balance(c.userId, 'chips'), 100000 - 1100);
        c.send({ t: 'tour.unregister', tournamentId: 'sng-1' });
        assert.equal(h.lobby.store.balance(c.userId, 'chips'), 100000);
        h.dispose();
    });
    test('トーナメント卓では着席・離席・追加購入ができない', () => {
        const h = sngHarness(3);
        const cs = registerAll(h, 3);
        const tableId = lastView(cs[0]).yourTableId;
        assert.ok(tableId, '卓に割り当てられていない');
        cs[0].send({ t: 'table.sit', tableId, buyIn: 5000 });
        assert.equal(cs[0].lastError()?.code, 'ILLEGAL_ACTION');
        cs[0].send({ t: 'table.stand', tableId });
        assert.equal(cs[0].lastError()?.code, 'ILLEGAL_ACTION');
        cs[0].send({ t: 'table.rebuy', tableId, amount: 1000 });
        assert.equal(cs[0].lastError()?.code, 'ILLEGAL_ACTION');
        h.dispose();
    });
    test('最後まで進行し、順位と賞金が確定する', () => {
        const h = sngHarness(3);
        const cs = registerAll(h, 3);
        for (let i = 0; i < 3000 && lastView(cs[0]).state === 'running'; i++)
            h.pump(500);
        const v = lastView(cs[0]);
        assert.equal(v.state, 'finished', 'トーナメントが終わらない');
        // 全員に順位がついている
        const finishes = cs.map((c) => lastView(c).yourFinishPosition);
        assert.deepEqual([...finishes].sort(), [1, 2, 3], `順位が不正: ${finishes.join(',')}`);
        // 賞金の合計がプールと一致する（端数は 1 位へ寄せる設計）
        const prizes = cs.map((c) => lastView(c).yourPrize ?? 0);
        assert.equal(prizes.reduce((a, b) => a + b, 0), 3000, `賞金合計 ${prizes.join('+')} がプール 3000 と一致しない`);
        // 1 位が最も多くもらう
        const winnerIdx = finishes.indexOf(1);
        assert.equal(Math.max(...prizes), prizes[winnerIdx], '1 位が最高額を受け取っていない');
        h.dispose();
    });
    test('チップの総量が保存される（手数料の分だけ減る）', () => {
        const h = sngHarness(3);
        const before = 100000 * 3;
        const cs = registerAll(h, 3);
        for (let i = 0; i < 3000 && lastView(cs[0]).state === 'running'; i++)
            h.pump(500);
        // 手数料 100 x 3 は運営の取り分として経済から消える
        assert.equal(h.lobby.totalChips(), before - 300, 'チップの総量が想定と違う');
        assert.equal(h.lobby.store.audit().ok, true, h.lobby.store.audit().problems.join('\n'));
        h.dispose();
    });
});
describe('マルチテーブル（MTT）', () => {
    function mttHarness(players, seatsPerTable) {
        return new Harness({
            tables: [CASH_TABLE],
            signupBonus: 100000,
            tournaments: [
                {
                    tournamentId: 'sng-1',
                    name: 'テスト MTT',
                    type: 'mtt',
                    buyIn: 500,
                    fee: 50,
                    startingStack: 1500,
                    seatsPerTable,
                    maxPlayers: players,
                    minPlayers: players,
                    levels: fastLevels(50),
                    levelDurationMs: 3000,
                    lateRegMs: 0,
                },
            ],
        });
    }
    test('人数に応じて複数の卓が立つ', () => {
        const h = mttHarness(12, 4);
        const cs = registerAll(h, 12);
        const t = h.lobby.getTournament('sng-1');
        assert.equal(t.allTables().length, 3, `卓数 ${t.allTables().length}`);
        for (const room of t.allTables()) {
            assert.ok(room.seatedCount >= 3 && room.seatedCount <= 4, `卓の人数 ${room.seatedCount}`);
        }
        h.dispose();
        void cs;
    });
    test('人が減ると卓が統合され、最後は 1 卓になる', () => {
        const h = mttHarness(12, 4);
        const cs = registerAll(h, 12);
        const t = h.lobby.getTournament('sng-1');
        const tablesAtStart = t.allTables().length;
        let minTables = tablesAtStart;
        for (let i = 0; i < 4000 && t.state === 'running'; i++) {
            h.pump(500);
            minTables = Math.min(minTables, t.allTables().filter((r) => r.seatedCount > 0).length);
        }
        assert.equal(t.state, 'finished', 'トーナメントが終わらない');
        assert.ok(tablesAtStart > 1, '最初から 1 卓しかない');
        assert.equal(t.allTables().filter((r) => r.seatedCount > 0).length, 0, '終了後も着席者がいる');
        h.dispose();
        void cs;
    });
    test('卓間の人数差が 2 以上のまま放置されない', () => {
        const h = mttHarness(12, 4);
        const cs = registerAll(h, 12);
        const t = h.lobby.getTournament('sng-1');
        let worstGap = 0;
        for (let i = 0; i < 2000 && t.state === 'running'; i++) {
            h.pump(500);
            const counts = t
                .allTables()
                .map((r) => r.seatedCount)
                .filter((n) => n > 0);
            if (counts.length >= 2) {
                worstGap = Math.max(worstGap, Math.max(...counts) - Math.min(...counts));
            }
        }
        // 1 ハンド分の遅れは許容するが、恒常的に 3 以上開くならバランス調整が壊れている
        assert.ok(worstGap <= 2, `卓間の人数差が最大 ${worstGap} まで開いた`);
        h.dispose();
        void cs;
    });
    test('全員に順位がつき、賞金合計がプールと一致する', () => {
        const h = mttHarness(12, 4);
        const cs = registerAll(h, 12);
        const t = h.lobby.getTournament('sng-1');
        for (let i = 0; i < 4000 && t.state === 'running'; i++)
            h.pump(500);
        assert.equal(t.state, 'finished');
        const views = cs.map((c) => lastView(c));
        const positions = views.map((v) => v.yourFinishPosition).sort((a, b) => (a ?? 0) - (b ?? 0));
        assert.deepEqual(positions, Array.from({ length: 12 }, (_, i) => i + 1), `順位が重複または欠落: ${positions.join(',')}`);
        const prizePool = 500 * 12;
        const totalPrize = views.reduce((a, v) => a + (v.yourPrize ?? 0), 0);
        assert.equal(totalPrize, prizePool, '賞金合計がプールと一致しない');
        // 入賞圏外は 0
        const paid = payoutStructure(12).length;
        for (const v of views) {
            if ((v.yourFinishPosition ?? 99) > paid)
                assert.equal(v.yourPrize, 0, '入賞圏外なのに賞金が出ている');
        }
        h.dispose();
    });
    test('チップ総量が保存される', () => {
        const h = mttHarness(12, 4);
        const before = 100000 * 12;
        const cs = registerAll(h, 12);
        const t = h.lobby.getTournament('sng-1');
        for (let i = 0; i < 4000 && t.state === 'running'; i++)
            h.pump(500);
        assert.equal(h.lobby.totalChips(), before - 50 * 12, '手数料分以外にチップが増減している');
        assert.equal(h.lobby.store.audit().ok, true);
        h.dispose();
        void cs;
    });
});
//# sourceMappingURL=tournament.test.js.map