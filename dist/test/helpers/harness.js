/**
 * サーバーテスト用のハーネス
 *
 * ソケットを一切張らずに Lobby の全機能を叩けるようにする。
 * 実時間も使わない（仮想時計）。おかげでタイムアウト絡みのテストが 15 秒待たずに書ける。
 */
import { Lobby } from '../../src/server/lobby.js';
import { PROTOCOL_VERSION } from '../../src/server/protocol.js';
/** 仮想時計。advance() で好きなだけ時間を進められる */
export class VirtualClock {
    t = 0;
    seq = 0;
    items = [];
    now() {
        return this.t;
    }
    setTimeout(fn, ms) {
        const id = ++this.seq;
        this.items.push({ id, at: this.t + Math.max(0, ms), fn });
        return id;
    }
    clearTimeout(handle) {
        this.items = this.items.filter((i) => i.id !== handle);
    }
    /** ms 分だけ進め、その間に期限が来たタイマーを順に発火させる */
    advance(ms) {
        const target = this.t + ms;
        for (let guard = 0; guard < 10000; guard++) {
            let next;
            for (const i of this.items)
                if (i.at <= target && (!next || i.at < next.at))
                    next = i;
            if (!next)
                break;
            this.items = this.items.filter((i) => i !== next);
            this.t = next.at;
            next.fn();
        }
        this.t = target;
    }
    get pendingCount() {
        return this.items.length;
    }
}
export class Harness {
    lobby;
    clock = new VirtualClock();
    clients = new Map();
    nextId = 1;
    /** 自動応答（ボット）が積んだアクション。再入を避けるためキューに溜めて後で流す */
    pending = [];
    autoPlay = new Set();
    constructor(cfg) {
        const transport = {
            send: (sessionId, msg) => {
                const c = this.clients.get(sessionId);
                if (!c)
                    return;
                c.received.push(msg);
                if (msg.t === 'hello.ok') {
                    c.userId = msg.userId;
                    c.resumeToken = msg.resumeToken;
                    c.balance = msg.balance;
                }
                if (msg.t === 'balance')
                    c.balance = msg.balance;
                if (this.autoPlay.has(sessionId))
                    this.reactAsBot(c, msg);
            },
            close: () => { },
        };
        this.lobby = new Lobby(cfg, transport, this.clock);
    }
    connect(name) {
        const sessionId = `t${this.nextId++}`;
        const client = {
            sessionId,
            received: [],
            userId: '',
            resumeToken: '',
            balance: 0,
            send: (msg) => this.lobby.onMessage(sessionId, msg),
            state: () => {
                for (let i = client.received.length - 1; i >= 0; i--) {
                    const m = client.received[i];
                    if (m.t === 'table.state')
                        return m.state;
                }
                return null;
            },
            lastError: () => {
                for (let i = client.received.length - 1; i >= 0; i--) {
                    const m = client.received[i];
                    if (m.t === 'error')
                        return m;
                }
                return null;
            },
            errors: () => client.received.filter((m) => m.t === 'error'),
            results: () => client.received
                .filter((m) => m.t === 'hand.result')
                .map((m) => m.summary),
            clear: () => {
                client.received.length = 0;
            },
        };
        this.clients.set(sessionId, client);
        this.lobby.onConnect(sessionId);
        return client;
    }
    /** hello まで済ませた接続を作る */
    login(name, userId) {
        const c = this.connect(name);
        c.send({ t: 'hello', v: PROTOCOL_VERSION, userId, name });
        return c;
    }
    disconnect(c) {
        this.lobby.onDisconnect(c.sessionId);
        this.clients.delete(c.sessionId);
    }
    /** この接続を自動プレイにする（常に一番安い合法手を選ぶ） */
    enableBot(c, style = 'passive') {
        this.autoPlay.add(c.sessionId);
        this.botStyle.set(c.sessionId, style);
    }
    botStyle = new Map();
    reactAsBot(c, msg) {
        if (msg.t !== 'table.state')
            return;
        const st = msg.state;
        if (!st.legalActions.length || st.handId === null)
            return;
        const style = this.botStyle.get(c.sessionId) ?? 'passive';
        this.pending.push(() => {
            const check = st.legalActions.find((a) => a.type === 'check');
            const call = st.legalActions.find((a) => a.type === 'call');
            const raise = st.legalActions.find((a) => a.type === 'raise' || a.type === 'bet');
            if (style === 'allin' && raise) {
                // 常にオールイン。脱落を早く起こしてトーナメントを短時間で終わらせるため
                c.send({ t: 'hand.act', tableId: st.tableId, handId: st.handId, action: raise.type, toAmount: raise.max });
                return;
            }
            if (style === 'aggressive' && raise && Math.random() < 0.35) {
                c.send({
                    t: 'hand.act',
                    tableId: st.tableId,
                    handId: st.handId,
                    action: raise.type,
                    toAmount: raise.min,
                });
                return;
            }
            if (check) {
                c.send({ t: 'hand.act', tableId: st.tableId, handId: st.handId, action: 'check' });
            }
            else if (call) {
                c.send({ t: 'hand.act', tableId: st.tableId, handId: st.handId, action: 'call' });
            }
            else {
                c.send({ t: 'hand.act', tableId: st.tableId, handId: st.handId, action: 'fold' });
            }
        });
    }
    /**
     * 溜まったボットのアクションを流しつつ時間を進める。
     * 送信の中から同期的にアクションを返すと再入で状態が壊れるので、必ずここで一段ずらす。
     */
    pump(ms = 0) {
        for (let guard = 0; guard < 5000; guard++) {
            const queue = this.pending;
            this.pending = [];
            if (queue.length === 0)
                break;
            for (const fn of queue)
                fn();
        }
        if (ms > 0) {
            this.clock.advance(ms);
            // 時間経過で発生したアクションも流す
            for (let guard = 0; guard < 5000; guard++) {
                const queue = this.pending;
                this.pending = [];
                if (queue.length === 0)
                    break;
                for (const fn of queue)
                    fn();
            }
        }
    }
    /** 指定ハンド数が終わるまで回す。戻り値は実際に完了したハンド数 */
    runHands(count, stepMs = 200, maxSteps = 5000) {
        const before = this.completedHandIds();
        for (let i = 0; i < maxSteps; i++) {
            this.pump(stepMs);
            const done = this.newHandCount(before);
            if (done >= count)
                return done;
        }
        return this.newHandCount(before);
    }
    /**
     * 完了したハンドの ID 集合。
     * hand.result は着席者全員に届くので、単純に受信数を数えると
     * 「2 人卓で 1 ハンド = 2 件」となって数え違える。ID で重複を排除する。
     */
    completedHandIds() {
        const ids = new Set();
        for (const c of this.clients.values()) {
            for (const m of c.received)
                if (m.t === 'hand.result')
                    ids.add(m.summary.handId);
        }
        return ids;
    }
    newHandCount(before) {
        let n = 0;
        for (const id of this.completedHandIds())
            if (!before.has(id))
                n++;
        return n;
    }
    dispose() {
        this.lobby.dispose();
    }
}
//# sourceMappingURL=harness.js.map