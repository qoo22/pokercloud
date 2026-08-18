/**
 * 卓上チップの保全テスト。
 *
 * 事件: 座席(スタック)はメモリ上のオブジェクトなので、サーバーが再起動すると卓上のチップが消えた。
 * バイインは永続残高から引き済みなので、これはプレイヤーの純損失になる
 * (「立ち上げたら残高が反映されない/減っている」の正体)。
 *
 * ここでは修正の核心を検証する:
 *   - open_seats に着席中スタックが記録される(sit/rebuy/ハンド終了ごとに最新化)
 *   - 精算すると記録が消える(二重払い戻しをしない)
 *   - 前回プロセスの記録が残っていれば、起動時に残高へ払い戻される
 *   - 切断猶予を過ぎた席は、以後ハンドが始まらなくても精算される
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/server/store.js';
import { Room } from '../src/server/room.js';
/** 手動で進められる時計 */
function fakeClock() {
    let now = 1_000_000;
    let seq = 0;
    const jobs = new Map();
    return {
        now: () => now,
        setTimeout(fn, ms) {
            const id = ++seq;
            jobs.set(id, { at: now + ms, fn });
            return id;
        },
        clearTimeout(h) {
            jobs.delete(h);
        },
        tick(ms) {
            now += ms;
            for (const [id, j] of [...jobs]) {
                if (j.at <= now) {
                    jobs.delete(id);
                    j.fn();
                }
            }
        },
    };
}
/** store を台帳に使う RoomBank(本番の lobby.ts と同じ配線) */
function bankOf(store) {
    return {
        withdraw: (u, a, ref) => store.post(u, 'chips', -a, 'table_buyin', ref) !== null,
        deposit: (u, a, ref) => { store.post(u, 'chips', a, 'table_cashout', ref); },
        balanceOf: (u) => store.balance(u, 'chips'),
        noteSeat: (u, t, s) => store.setOpenSeat(u, t, s),
        clearSeat: (u, t) => store.clearOpenSeat(u, t),
    };
}
const CFG = {
    tableId: 't1', name: 'テスト卓', smallBlind: 50, bigBlind: 100, maxSeats: 6,
    minBuyInBB: 20, maxBuyInBB: 100,
};
async function setup() {
    const store = await SqliteStore.open(':memory:');
    const io = { send: () => { } };
    const clock = fakeClock();
    const room = new Room(CFG, io, bankOf(store), clock);
    store.upsertUser('u_alice', 'Alice');
    store.post('u_alice', 'chips', 100_000, 'adjustment');
    return { store, room, clock };
}
describe('卓上チップの保全', () => {
    test('着席すると open_seats に記録され、精算すると消える', async () => {
        const { store, room } = await setup();
        room.join('s1', 'u_alice', 'Alice');
        assert.equal(room.sit('s1', 0, 10_000), null, '着席に失敗した');
        // バイインぶんが残高から引かれ、卓の上にあると記録される
        assert.equal(store.balance('u_alice', 'chips'), 90_000);
        const open = store.listOpenSeats();
        assert.equal(open.length, 1, 'open_seats に記録されていない(=落ちたらチップが消える)');
        assert.equal(open[0].userId, 'u_alice');
        assert.equal(open[0].tableId, 't1');
        assert.equal(open[0].stack, 10_000);
        // 自分から降りれば即精算され、記録も消える
        assert.equal(room.stand('s1'), null);
        assert.equal(store.balance('u_alice', 'chips'), 100_000, '降りたのに残高へ戻っていない');
        assert.equal(store.listOpenSeats().length, 0, '精算後も記録が残っている(二重払い戻しの危険)');
        store.close();
    });
    test('リバイでも記録が最新化される', async () => {
        const { store, room } = await setup();
        room.join('s1', 'u_alice', 'Alice');
        room.sit('s1', 0, 5_000);
        assert.equal(room.rebuy('s1', 3_000), null, 'リバイに失敗した');
        const open = store.listOpenSeats();
        assert.equal(open[0].stack, 8_000, 'リバイ後のスタックが記録に反映されていない');
        store.close();
    });
    test('記録が残ったまま落ちても、次の起動で残高へ払い戻せる', async () => {
        const { store, room } = await setup();
        room.join('s1', 'u_alice', 'Alice');
        room.sit('s1', 0, 10_000);
        // ここでプロセスが落ちたと仮定する(精算されないまま open_seats が残る)
        const before = store.balance('u_alice', 'chips');
        assert.equal(before, 90_000);
        // 次の起動での復旧処理(lobby.recoverOpenSeats と同じ手順)
        for (const r of store.listOpenSeats()) {
            store.post(r.userId, 'chips', r.stack, 'table_recover', `${r.tableId}:recover`);
            store.clearOpenSeat(r.userId, r.tableId);
        }
        assert.equal(store.balance('u_alice', 'chips'), 100_000, '落ちた卓のチップが戻っていない(純損失)');
        assert.equal(store.listOpenSeats().length, 0);
        // 台帳の整合性が保たれている(残高と仕訳集計が一致)
        assert.equal(store.audit().ok, true, `台帳が壊れた: ${store.audit().problems.join(', ')}`);
        store.close();
    });
    test('切断猶予を過ぎた席は、ハンドが始まらなくても精算される', async () => {
        const { store, room, clock } = await setup();
        room.join('s1', 'u_alice', 'Alice');
        room.sit('s1', 0, 10_000);
        assert.equal(store.balance('u_alice', 'chips'), 90_000);
        // 切断。1人しかいないのでハンドは始まらない = settle が二度と呼ばれない状況
        room.leave('s1');
        // 猶予(既定30秒)を過ぎさせる
        clock.tick(31_000);
        room.sweepExpiredSeats();
        assert.equal(store.balance('u_alice', 'chips'), 100_000, '切断後にハンドが始まらないとチップが永久に戻らない');
        assert.equal(store.listOpenSeats().length, 0);
        store.close();
    });
    test('終了時の一括精算で卓上チップを置き去りにしない', async () => {
        const { store, room } = await setup();
        store.upsertUser('u_bob', 'Bob');
        store.post('u_bob', 'chips', 50_000, 'adjustment');
        room.join('s1', 'u_alice', 'Alice');
        room.join('s2', 'u_bob', 'Bob');
        room.sit('s1', 0, 10_000);
        room.sit('s2', 1, 8_000);
        room.cashOutAll(); // SIGTERM 相当
        assert.equal(store.balance('u_alice', 'chips'), 100_000);
        assert.equal(store.balance('u_bob', 'chips'), 50_000);
        assert.equal(store.listOpenSeats().length, 0, '終了精算後も記録が残っている');
        assert.equal(store.audit().ok, true);
        store.close();
    });
    test('払い戻しは一度だけ(二重付与しない)', async () => {
        const { store, room } = await setup();
        room.join('s1', 'u_alice', 'Alice');
        room.sit('s1', 0, 10_000);
        room.stand('s1'); // 正常精算 → 記録は消える
        // 復旧処理をもう一度回しても、記録が無いので何も起きない
        for (const r of store.listOpenSeats()) {
            store.post(r.userId, 'chips', r.stack, 'table_recover', `${r.tableId}:recover`);
            store.clearOpenSeat(r.userId, r.tableId);
        }
        assert.equal(store.balance('u_alice', 'chips'), 100_000, '二重に払い戻された');
        store.close();
    });
});
//# sourceMappingURL=seatrecover.test.js.map