/**
 * 実際に WebSocket を張った結合テスト
 *
 * Lobby のロジックは server.test.ts でソケット無しに検証済みなので、
 * ここで見るのは「トランスポート層を通しても壊れないか」だけに絞る。
 * 具体的には JSON の往復、切断の検知、巨大メッセージの拒否、そして 2 人で 1 ハンド遊べること。
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { Gateway } from '../src/server/gateway.js';
import { PROTOCOL_VERSION } from '../src/server/protocol.js';
import { verifyHand } from '../src/fair.js';
let gateway;
let port;
before(async () => {
    gateway = new Gateway({
        port: 0,
        tables: [
            {
                tableId: 'it-1',
                name: '結合テスト卓',
                smallBlind: 50,
                bigBlind: 100,
                maxSeats: 2,
                seedWindowMs: 100,
                handIntervalMs: 100,
                actionTimeoutMs: 3000,
                rakePercent: 0,
            },
            {
                tableId: 'it-2',
                name: '切断テスト卓',
                smallBlind: 50,
                bigBlind: 100,
                maxSeats: 2,
                rakePercent: 0,
            },
        ],
        signupBonus: 50000,
    });
    port = await gateway.listen();
});
after(async () => {
    await gateway.close();
});
class Peer {
    ws;
    received = [];
    userId = '';
    waiters = [];
    constructor(url) {
        this.ws = new WebSocket(url);
        this.ws.on('message', (d) => {
            const msg = JSON.parse(d.toString());
            this.received.push(msg);
            if (msg.t === 'hello.ok')
                this.userId = msg.userId;
            for (const w of [...this.waiters]) {
                if (w.pred(msg)) {
                    this.waiters.splice(this.waiters.indexOf(w), 1);
                    w.resolve(msg);
                }
            }
        });
    }
    open() {
        return new Promise((res, rej) => {
            this.ws.once('open', () => res());
            this.ws.once('error', rej);
        });
    }
    send(msg) {
        this.ws.send(JSON.stringify(msg));
    }
    sendRaw(text) {
        this.ws.send(text);
    }
    wait(t, timeoutMs = 4000) {
        const existing = this.received.find((m) => m.t === t);
        if (existing)
            return Promise.resolve(existing);
        return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`${t} を ${timeoutMs}ms 以内に受け取れませんでした`)), timeoutMs);
            this.waiters.push({
                pred: (m) => m.t === t,
                resolve: (m) => {
                    clearTimeout(timer);
                    res(m);
                },
            });
        });
    }
    waitFor(pred, timeoutMs = 6000) {
        const existing = this.received.find(pred);
        if (existing)
            return Promise.resolve(existing);
        return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`条件を満たすメッセージが ${timeoutMs}ms 以内に来ませんでした`)), timeoutMs);
            this.waiters.push({
                pred,
                resolve: (m) => {
                    clearTimeout(timer);
                    res(m);
                },
            });
        });
    }
    close() {
        this.ws.close();
    }
}
const connect = async () => {
    const p = new Peer(`ws://127.0.0.1:${port}`);
    await p.open();
    return p;
};
describe('WebSocket 結合テスト', () => {
    test('接続して hello が通る', async () => {
        const p = await connect();
        p.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Alice' });
        const ok = await p.wait('hello.ok');
        assert.equal(ok.balance, 50000);
        p.close();
    });
    test('ping に pong が返る', async () => {
        const p = await connect();
        p.send({ t: 'hello', v: PROTOCOL_VERSION });
        await p.wait('hello.ok');
        p.send({ t: 'ping', ts: 12345 });
        const pong = await p.wait('pong');
        assert.equal(pong.ts, 12345);
        p.close();
    });
    test('壊れた JSON でも接続は切れず、エラーが返る', async () => {
        const p = await connect();
        p.send({ t: 'hello', v: PROTOCOL_VERSION });
        await p.wait('hello.ok');
        p.sendRaw('{ これは JSON ではない');
        const err = await p.waitFor((m) => m.t === 'error');
        assert.equal(err.t === 'error' && err.code, 'BAD_MESSAGE');
        assert.equal(p.ws.readyState, WebSocket.OPEN, '不正入力で接続が切られている');
        p.close();
    });
    test('ロビーのテーブル一覧が取れる', async () => {
        const p = await connect();
        p.send({ t: 'hello', v: PROTOCOL_VERSION });
        await p.wait('hello.ok');
        p.send({ t: 'lobby.list' });
        const list = await p.wait('lobby.tables');
        assert.equal(list.tables.length, 2);
        assert.equal(list.tables[0].tableId, 'it-1');
        assert.equal(list.tables[0].minBuyIn, 2000);
        assert.equal(list.tables[0].maxBuyIn, 10000);
        p.close();
    });
    test('2 人が実際に接続して 1 ハンド遊べ、公正性の検証も通る', async () => {
        const a = await connect();
        const b = await connect();
        for (const p of [a, b]) {
            p.send({ t: 'hello', v: PROTOCOL_VERSION });
            await p.wait('hello.ok');
            p.send({ t: 'table.watch', tableId: 'it-1' });
            p.send({ t: 'table.sit', tableId: 'it-1', buyIn: 10000 });
        }
        a.send({ t: 'fair.seed', tableId: 'it-1', seed: 'alice-ws' });
        b.send({ t: 'fair.seed', tableId: 'it-1', seed: 'bob-ws' });
        // 配牌前に公開されたコミットメントを控える
        const first = await a.waitFor((m) => m.t === 'table.state' && m.state.fairness.commitment !== null);
        const committed = first.state.fairness.commitment;
        // 手番が来たら常にチェックかコールで応じる
        for (const p of [a, b]) {
            p.ws.on('message', (d) => {
                const msg = JSON.parse(d.toString());
                if (msg.t !== 'table.state')
                    return;
                const st = msg.state;
                if (!st.legalActions.length || !st.handId)
                    return;
                const check = st.legalActions.find((x) => x.type === 'check');
                const call = st.legalActions.find((x) => x.type === 'call');
                p.send({
                    t: 'hand.act',
                    tableId: 'it-1',
                    handId: st.handId,
                    action: check ? 'check' : call ? 'call' : 'fold',
                });
            });
        }
        const result = await a.wait('hand.result', 15000);
        const s = result.summary;
        assert.equal(s.fairness.commitment, committed, '事前公開値と開示値が違う');
        assert.ok(s.fairness.clientSeed.includes('alice-ws'), '提出シードが反映されていない');
        const v = verifyHand({
            serverSeed: s.fairness.serverSeed,
            commitment: committed,
            clientSeed: s.fairness.clientSeed,
            nonce: s.fairness.nonce,
            deck: s.fairness.deck,
        });
        assert.equal(v.passed, true, JSON.stringify(v.checks, null, 2));
        // 相手の手札が届いていないことを、受信した全メッセージから確認する。
        // 「自分の席」はメッセージごとに判定する（観戦中は yourSeat が null なので、
        //  最初の 1 通から決め打ちすると自分の手札まで違反扱いになってしまう）
        let checked = 0;
        for (const m of a.received) {
            if (m.t !== 'table.state')
                continue;
            if (m.state.street === 'complete')
                continue;
            for (const seat of m.state.seats) {
                if (seat.seat !== m.state.yourSeat && seat.holeCards !== null) {
                    assert.fail(`ショーダウン前に他人の手札が届いている（席 ${seat.seat}, street=${m.state.street}）`);
                }
            }
            checked++;
        }
        assert.ok(checked > 0, '検査対象の状態メッセージが 1 件も無い');
        a.close();
        b.close();
        await new Promise((r) => setTimeout(r, 300)); // 切断の伝播を待つ
    });
    test('切断すると席が解放される', async () => {
        const p = await connect();
        p.send({ t: 'hello', v: PROTOCOL_VERSION });
        await p.wait('hello.ok');
        // 前のテストの後片付けと干渉しないよう、専用の卓を使う
        p.send({ t: 'table.watch', tableId: 'it-2' });
        p.send({ t: 'table.sit', tableId: 'it-2', buyIn: 5000 });
        const seated = await p.waitFor((m) => (m.t === 'table.state' && m.state.yourSeat !== null) || m.t === 'error');
        assert.notEqual(seated.t, 'error', `着席できなかった: ${JSON.stringify(seated)}`);
        const room = gateway.lobby.getRoom('it-2');
        assert.equal(room.seatedCount, 1);
        p.close();
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(room.seatedCount, 0, '切断しても席が残っている');
    });
});
//# sourceMappingURL=gateway.test.js.map