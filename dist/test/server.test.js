import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from './helpers/harness.js';
import { PROTOCOL_VERSION, parseClientMessage } from '../src/server/protocol.js';
import { verifyHand } from '../src/fair.js';
import { MemoryStore } from '../src/server/store.js';
const TABLE = {
    tableId: 'test-1',
    name: 'テスト卓',
    smallBlind: 50,
    bigBlind: 100,
    maxSeats: 6,
    minBuyInBB: 20,
    maxBuyInBB: 100,
    rakePercent: 0.04,
    rakeCapBB: 4,
    actionTimeoutMs: 15000,
    timeBankMs: 0,
    seedWindowMs: 1000,
    handIntervalMs: 500,
    disconnectGraceMs: 30000,
};
const newHarness = () => new Harness({ tables: [TABLE], signupBonus: 100000 });
// ---------------------------------------------------------------------------
describe('メッセージの検証', () => {
    test('オブジェクトでない入力を弾く', () => {
        assert.equal(parseClientMessage('hello').ok, false);
        assert.equal(parseClientMessage(null).ok, false);
        assert.equal(parseClientMessage(42).ok, false);
    });
    test('未知のメッセージ種別を弾く', () => {
        assert.equal(parseClientMessage({ t: 'drop.database' }).ok, false);
    });
    test('負のバイインを弾く', () => {
        const r = parseClientMessage({ t: 'table.sit', tableId: 'a', buyIn: -100000 });
        assert.equal(r.ok, false, '負のバイインが通るとチップが増えてしまう');
    });
    test('小数・NaN・Infinity のバイインを弾く', () => {
        for (const v of [1.5, NaN, Infinity, -Infinity, '100']) {
            assert.equal(parseClientMessage({ t: 'table.sit', tableId: 'a', buyIn: v }).ok, false, `${String(v)} が通った`);
        }
    });
    test('シードに区切り文字を含められない', () => {
        assert.equal(parseClientMessage({ t: 'fair.seed', tableId: 'a', seed: 'ab|cd' }).ok, false);
        assert.equal(parseClientMessage({ t: 'fair.seed', tableId: 'a', seed: 'ab-cd_1.2' }).ok, true);
    });
    test('長すぎる文字列を弾く', () => {
        assert.equal(parseClientMessage({ t: 'fair.seed', tableId: 'a', seed: 'x'.repeat(200) }).ok, false);
    });
    test('不正な action を弾く', () => {
        const r = parseClientMessage({ t: 'hand.act', tableId: 'a', handId: 'h', action: 'win' });
        assert.equal(r.ok, false);
    });
});
describe('認証とセッション', () => {
    test('hello で初期チップが付与される', () => {
        const h = newHarness();
        const c = h.login('Alice');
        const ok = c.received.find((m) => m.t === 'hello.ok');
        assert.ok(ok && ok.t === 'hello.ok');
        assert.equal(ok.balance, 100000);
        assert.equal(ok.resumed, false);
        assert.ok(ok.resumeToken.length > 0);
        h.dispose();
    });
    test('プロトコル版が違うと拒否される', () => {
        const h = newHarness();
        const c = h.connect();
        c.send({ t: 'hello', v: PROTOCOL_VERSION + 99 });
        assert.equal(c.lastError()?.code, 'VERSION_MISMATCH');
        h.dispose();
    });
    test('hello 前のコマンドは拒否される', () => {
        const h = newHarness();
        const c = h.connect();
        c.send({ t: 'table.watch', tableId: TABLE.tableId });
        assert.equal(c.lastError()?.code, 'NOT_AUTHENTICATED');
        h.dispose();
    });
    test('resumeToken で同じユーザーとして復帰する', () => {
        const h = newHarness();
        const c1 = h.login('Alice');
        const token = c1.resumeToken;
        const userId = c1.userId;
        h.disconnect(c1);
        const c2 = h.connect();
        c2.send({ t: 'hello', v: PROTOCOL_VERSION, resumeToken: token });
        const ok = c2.received.find((m) => m.t === 'hello.ok');
        assert.ok(ok && ok.t === 'hello.ok');
        assert.equal(ok.userId, userId);
        assert.equal(ok.resumed, true);
        h.dispose();
    });
    test('偽の resumeToken では他人になりすませない', () => {
        const h = newHarness();
        const victim = h.login('Victim', 'victim-id');
        const c = h.connect();
        c.send({ t: 'hello', v: PROTOCOL_VERSION, resumeToken: 'ff'.repeat(24) });
        const ok = c.received.find((m) => m.t === 'hello.ok');
        assert.ok(ok && ok.t === 'hello.ok');
        assert.notEqual(ok.userId, victim.userId);
        assert.equal(ok.resumed, false);
        h.dispose();
    });
    test('レート制限がかかる', () => {
        const h = new Harness({ tables: [TABLE], maxMessagesPerSecond: 5 });
        const c = h.login('Spammer');
        for (let i = 0; i < 20; i++)
            c.send({ t: 'lobby.list' });
        assert.ok(c.errors().some((e) => e.code === 'RATE_LIMITED'), 'レート制限が働いていない');
        h.dispose();
    });
});
describe('着席とバイイン', () => {
    test('範囲外のバイインは拒否される', () => {
        const h = newHarness();
        const c = h.login('Alice');
        c.send({ t: 'table.watch', tableId: TABLE.tableId });
        c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 100 }); // 下限 2000 未満
        assert.equal(c.lastError()?.code, 'INVALID_BUYIN');
        c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 99999 }); // 上限 10000 超
        assert.equal(c.lastError()?.code, 'INVALID_BUYIN');
        h.dispose();
    });
    test('残高を超えるバイインは拒否され、残高は動かない', () => {
        const h = new Harness({ tables: [TABLE], signupBonus: 3000 });
        const c = h.login('Poor');
        c.send({ t: 'table.watch', tableId: TABLE.tableId });
        c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 10000 });
        assert.equal(c.lastError()?.code, 'INSUFFICIENT_FUNDS');
        assert.equal(h.lobby.store.balance(c.userId, 'chips'), 3000);
        h.dispose();
    });
    test('同じ席には座れない', () => {
        const h = newHarness();
        const a = h.login('A');
        const b = h.login('B');
        for (const c of [a, b])
            c.send({ t: 'table.watch', tableId: TABLE.tableId });
        a.send({ t: 'table.sit', tableId: TABLE.tableId, seat: 2, buyIn: 5000 });
        b.send({ t: 'table.sit', tableId: TABLE.tableId, seat: 2, buyIn: 5000 });
        assert.equal(b.lastError()?.code, 'SEAT_TAKEN');
        h.dispose();
    });
    test('二重着席はできない', () => {
        const h = newHarness();
        const a = h.login('A');
        a.send({ t: 'table.watch', tableId: TABLE.tableId });
        a.send({ t: 'table.sit', tableId: TABLE.tableId, seat: 0, buyIn: 5000 });
        a.send({ t: 'table.sit', tableId: TABLE.tableId, seat: 1, buyIn: 5000 });
        assert.equal(a.lastError()?.code, 'ALREADY_SEATED');
        h.dispose();
    });
    test('着席するとバイイン分が残高から引かれる', () => {
        const h = newHarness();
        const a = h.login('A');
        a.send({ t: 'table.watch', tableId: TABLE.tableId });
        a.send({ t: 'table.sit', tableId: TABLE.tableId, seat: 0, buyIn: 5000 });
        assert.equal(h.lobby.store.balance(a.userId, 'chips'), 95000);
        assert.equal(a.state()?.seats[0].stack, 5000);
        h.dispose();
    });
});
describe('Provably Fair の順序保証', () => {
    function seatTwo(h) {
        const a = h.login('A');
        const b = h.login('B');
        for (const c of [a, b]) {
            c.send({ t: 'table.watch', tableId: TABLE.tableId });
            c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 10000 });
        }
        return { a, b };
    }
    test('2 人揃うとまずコミットメントだけが公開される', () => {
        const h = newHarness();
        const { a } = seatTwo(h);
        const st = a.state();
        assert.ok(st.fairness.commitment, 'コミットメントが出ていない');
        assert.equal(st.fairness.serverSeed, null, '配牌前にサーバーシードが漏れている');
        assert.equal(st.fairness.acceptingSeeds, true);
        assert.equal(st.street, 'waiting', 'まだカードは配られていないはず');
        h.dispose();
    });
    test('受付窓の中ではシードを提出できる', () => {
        const h = newHarness();
        const { a } = seatTwo(h);
        a.send({ t: 'fair.seed', tableId: TABLE.tableId, seed: 'alice-seed' });
        assert.equal(a.lastError(), null);
        h.dispose();
    });
    test('配牌後はシードを受け付けない', () => {
        const h = newHarness();
        const { a } = seatTwo(h);
        h.pump(TABLE.seedWindowMs + 10); // 受付終了 → 配牌
        assert.equal(a.state()?.street, 'preflop');
        a.send({ t: 'fair.seed', tableId: TABLE.tableId, seed: 'too-late' });
        assert.equal(a.lastError()?.code, 'SEED_WINDOW_CLOSED', '配牌後にシードを受け付けている');
        h.dispose();
    });
    test('提出したシードが実際の配牌に反映される', () => {
        const h = newHarness();
        const { a, b } = seatTwo(h);
        a.send({ t: 'fair.seed', tableId: TABLE.tableId, seed: 'alice-unique-seed' });
        b.send({ t: 'fair.seed', tableId: TABLE.tableId, seed: 'bob-unique-seed' });
        h.enableBot(a);
        h.enableBot(b);
        h.runHands(1, 200);
        const summary = a.results()[0];
        assert.ok(summary, 'ハンドが終わっていない');
        assert.ok(summary.fairness.clientSeed.includes('alice-unique-seed'), `提出したシードが使われていない: ${summary.fairness.clientSeed}`);
        assert.ok(summary.fairness.clientSeed.includes('bob-unique-seed'));
        h.dispose();
    });
    test('ハンド終了後の開示が検証を通る', () => {
        const h = newHarness();
        const { a, b } = seatTwo(h);
        // 配牌前に受け取ったコミットメントを控えておく
        const committed = a.state().fairness.commitment;
        h.enableBot(a);
        h.enableBot(b);
        h.runHands(1, 200);
        const s = a.results()[0];
        assert.equal(s.fairness.commitment, committed, '事前公開値と開示時の値が違う');
        const r = verifyHand({
            serverSeed: s.fairness.serverSeed,
            commitment: committed,
            clientSeed: s.fairness.clientSeed,
            nonce: s.fairness.nonce,
            deck: s.fairness.deck,
        });
        assert.equal(r.passed, true, JSON.stringify(r.checks, null, 2));
        h.dispose();
    });
    test('連続するハンドで nonce が進み、シードが使い回されない', () => {
        const h = newHarness();
        const { a, b } = seatTwo(h);
        h.enableBot(a);
        h.enableBot(b);
        h.runHands(5, 200);
        const results = a.results();
        assert.ok(results.length >= 5, `ハンド数が足りない: ${results.length}`);
        const seeds = new Set(results.map((r) => r.fairness.serverSeed));
        assert.equal(seeds.size, results.length, 'serverSeed が使い回されている');
        const nonces = results.map((r) => r.fairness.nonce);
        for (let i = 1; i < nonces.length; i++) {
            assert.ok(nonces[i] > nonces[i - 1], `nonce が進んでいない: ${nonces.join(',')}`);
        }
        h.dispose();
    });
});
describe('情報の隠蔽', () => {
    test('他人のホールカードがどのメッセージにも含まれない', () => {
        const h = newHarness();
        const a = h.login('A');
        const b = h.login('B');
        for (const c of [a, b]) {
            c.send({ t: 'table.watch', tableId: TABLE.tableId });
            c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 10000 });
        }
        h.enableBot(a);
        h.enableBot(b);
        h.runHands(3, 200);
        // A が受け取った全メッセージから、A 以外の席の手札が見えていないことを確認する。
        // ショーダウンで公開された場合だけは許可。
        for (const msg of a.received) {
            if (msg.t !== 'table.state')
                continue;
            const st = msg.state;
            const showdownOver = st.street === 'complete';
            for (const seat of st.seats) {
                if (seat.seat === st.yourSeat)
                    continue;
                if (seat.holeCards === null)
                    continue;
                assert.ok(showdownOver, `ショーダウン前に席 ${seat.seat} の手札が見えている（street=${st.street}）`);
            }
        }
        h.dispose();
    });
    test('配布イベントにカードが載っていない', () => {
        const h = newHarness();
        const a = h.login('A');
        const b = h.login('B');
        for (const c of [a, b]) {
            c.send({ t: 'table.watch', tableId: TABLE.tableId });
            c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 10000 });
        }
        h.enableBot(a);
        h.enableBot(b);
        h.runHands(2, 200);
        for (const msg of a.received) {
            if (msg.t !== 'table.events')
                continue;
            for (const e of msg.events) {
                if (e.type === 'deal_hole') {
                    assert.equal(e.cards.length, 0, '配布イベントにカードが載っている');
                }
            }
        }
        h.dispose();
    });
    test('観戦者には誰の手札も見えない', () => {
        const h = newHarness();
        const a = h.login('A');
        const b = h.login('B');
        const watcher = h.login('Watcher');
        for (const c of [a, b]) {
            c.send({ t: 'table.watch', tableId: TABLE.tableId });
            c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 10000 });
        }
        watcher.send({ t: 'table.watch', tableId: TABLE.tableId });
        h.enableBot(a);
        h.enableBot(b);
        h.runHands(2, 200);
        for (const msg of watcher.received) {
            if (msg.t !== 'table.state')
                continue;
            const st = msg.state;
            assert.equal(st.yourSeat, null);
            if (st.street === 'complete')
                continue; // ショーダウン公開は許可
            for (const seat of st.seats) {
                assert.equal(seat.holeCards, null, `観戦者に席 ${seat.seat} の手札が見えている`);
            }
        }
        h.dispose();
    });
});
describe('オールインのネタバレ防止', () => {
    test('段階公開（場札を1枚ずつ開く）の間は、勝敗＝チップの受け渡しが先に漏れない', () => {
        const h = newHarness();
        const a = h.login('A');
        const b = h.login('B');
        for (const c of [a, b]) {
            c.send({ t: 'table.watch', tableId: TABLE.tableId });
            c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 10000 });
        }
        h.pump(TABLE.seedWindowMs + 10);
        // プリフロップで両者オールイン（＝場札が一気に配られ、1枚ずつ開く演出に入る）
        const st0 = a.state();
        const first = st0.actingSeat === st0.yourSeat ? a : b;
        const second = first === a ? b : a;
        const raise = first.state().legalActions.find((l) => l.type === 'raise' || l.type === 'bet');
        assert.ok(raise?.max, 'オールインできるレイズがない');
        first.send({ t: 'hand.act', tableId: TABLE.tableId, handId: st0.handId, action: raise.type, toAmount: raise.max });
        h.pump(50);
        const st1 = second.state();
        const call = second.state().legalActions.find((l) => l.type === 'call');
        assert.ok(call, '相手がコール（＝オールインに応じる）できない');
        second.send({ t: 'hand.act', tableId: TABLE.tableId, handId: st1.handId, action: 'call' });
        // ここから段階公開。少しずつ時間を進めて、公開中の全 state を集める
        a.clear();
        const revealFrames = [];
        let sawResult = false;
        for (let i = 0; i < 200 && !sawResult; i++) {
            h.pump(300);
            for (const m of a.received) {
                if (m.t === 'table.state' && m.state.revealStats && m.state.revealStats.length > 0) {
                    revealFrames.push(m.state);
                }
                if (m.t === 'hand.result')
                    sawResult = true;
            }
            if (!sawResult)
                a.clear(); // 結果を見たフレームは消さない（最終スタックを読むため）
        }
        assert.ok(sawResult, '段階公開が終わらなかった（hand.result 未到達）');
        assert.ok(revealFrames.length > 0, '段階公開のフレームが観測できなかった');
        // 公開中はポットがまだ渡っていない＝両オールイン者のスタックは 0（ペイアウト前）のまま。
        // どのフレームでも「勝者に約20000が入っている」ような残高は出てはいけない。
        for (const st of revealFrames) {
            const stacks = st.seats.filter((s) => s.userId).map((s) => s.stack);
            for (const s of stacks) {
                assert.ok(s < 5000, `公開中に受け渡し済みの残高が見えている（${s}）＝ネタバレ`);
            }
        }
        // フレーム間でスタックが一切動かない（チップは中央で止まっている）
        const sig = (st) => st.seats.map((s) => `${s.seat}:${s.stack}`).join(',');
        const firstSig = sig(revealFrames[0]);
        for (const st of revealFrames) {
            assert.equal(sig(st), firstSig, '公開の途中でスタックが動いている（ネタバレ）');
        }
        // 公開が終われば結果が反映される：勝者はポットを得て、敗者は 0
        h.pump(2000);
        const done = a.state();
        const settled = done.seats.filter((s) => s.userId).map((s) => s.stack).sort((x, y) => y - x);
        assert.ok(settled[0] > 15000, `決着後、勝者にポットが渡っていない（${settled[0]}）`);
        assert.equal(settled[1], 0, '決着後、敗者のスタックが 0 でない');
        h.dispose();
    });
});
describe('アクションの権限と鮮度', () => {
    function startedHand(h) {
        const a = h.login('A');
        const b = h.login('B');
        for (const c of [a, b]) {
            c.send({ t: 'table.watch', tableId: TABLE.tableId });
            c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 10000 });
        }
        h.pump(TABLE.seedWindowMs + 10);
        return { a, b };
    }
    test('手番でない席のアクションは拒否される', () => {
        const h = newHarness();
        const { a, b } = startedHand(h);
        const st = a.state();
        const notActing = st.actingSeat === st.yourSeat ? b : a;
        notActing.send({ t: 'hand.act', tableId: TABLE.tableId, handId: st.handId, action: 'fold' });
        assert.equal(notActing.lastError()?.code, 'NOT_YOUR_TURN');
        h.dispose();
    });
    test('古い handId のアクションは拒否される', () => {
        const h = newHarness();
        const { a, b } = startedHand(h);
        const st = a.state();
        const acting = st.actingSeat === st.yourSeat ? a : b;
        acting.send({ t: 'hand.act', tableId: TABLE.tableId, handId: 'test-1#999', action: 'fold' });
        assert.equal(acting.lastError()?.code, 'STALE_HAND', '古いハンドへのアクションが通っている');
        h.dispose();
    });
    test('合法でないアクションは拒否される', () => {
        const h = newHarness();
        const { a, b } = startedHand(h);
        const st = a.state();
        const acting = st.actingSeat === st.yourSeat ? a : b;
        // プリフロップでコールが必要な状況ならチェックはできない
        const canCheck = acting.state().legalActions.some((l) => l.type === 'check');
        if (!canCheck) {
            acting.send({ t: 'hand.act', tableId: TABLE.tableId, handId: st.handId, action: 'check' });
            assert.equal(acting.lastError()?.code, 'ILLEGAL_ACTION');
        }
        // 最小レイズ未満のレイズ
        const raise = acting.state().legalActions.find((l) => l.type === 'raise');
        if (raise) {
            acting.send({
                t: 'hand.act',
                tableId: TABLE.tableId,
                handId: st.handId,
                action: 'raise',
                toAmount: Math.max(1, raise.min - 1),
            });
            assert.equal(acting.lastError()?.code, 'ILLEGAL_ACTION');
        }
        h.dispose();
    });
    test('時間切れで自動的にチェックかフォールドになり、Sit Out にされる', () => {
        const h = newHarness();
        const { a, b } = startedHand(h);
        const st = a.state();
        const actingSeat = st.actingSeat;
        const before = st.handNumber;
        h.pump(TABLE.actionTimeoutMs + 100);
        const after = a.state();
        // 手番が進んでいるか、ハンドが終わっている
        assert.ok(after.actingSeat !== actingSeat || after.handNumber !== before, 'タイムアウトしても何も起きていない');
        h.dispose();
    });
});
describe('チップの保存', () => {
    test('多数のハンドを通じてチップ総量が変わらない', () => {
        const h = newHarness();
        const clients = [];
        for (let i = 0; i < 4; i++) {
            const c = h.login(`P${i}`);
            c.send({ t: 'table.watch', tableId: TABLE.tableId });
            c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 10000 });
            h.enableBot(c, i % 2 === 0 ? 'aggressive' : 'passive');
            clients.push(c);
        }
        const initialTotal = h.lobby.totalChips();
        const played = h.runHands(30, 200);
        assert.ok(played >= 10, `ハンドが進んでいない: ${played}`);
        // レーキで消えた分を足し戻せば総量は一致するはず
        let rake = 0;
        for (const s of clients[0].results())
            rake += s.pots.reduce((x, p) => x + p.rake, 0);
        assert.equal(h.lobby.totalChips() + rake, initialTotal, 'チップの総量が変わっている');
        const audit = h.lobby.store.audit();
        assert.equal(audit.ok, true, audit.problems.join('\n'));
        h.dispose();
    });
    test('席を立つとチップが残高に戻る', () => {
        const h = newHarness();
        const a = h.login('A');
        a.send({ t: 'table.watch', tableId: TABLE.tableId });
        a.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 6000 });
        assert.equal(h.lobby.store.balance(a.userId, 'chips'), 94000);
        a.send({ t: 'table.stand', tableId: TABLE.tableId });
        assert.equal(h.lobby.store.balance(a.userId, 'chips'), 100000);
        h.dispose();
    });
    test('ハンド中の離席は次のハンドまで保留される', () => {
        const h = newHarness();
        const a = h.login('A');
        const b = h.login('B');
        for (const c of [a, b]) {
            c.send({ t: 'table.watch', tableId: TABLE.tableId });
            c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 10000 });
        }
        h.pump(TABLE.seedWindowMs + 10);
        const balanceDuring = h.lobby.store.balance(a.userId, 'chips');
        a.send({ t: 'table.stand', tableId: TABLE.tableId });
        assert.equal(h.lobby.store.balance(a.userId, 'chips'), balanceDuring, 'ハンド中にチップを引き上げられてしまっている');
        h.enableBot(a);
        h.enableBot(b);
        h.runHands(1, 200);
        h.pump(TABLE.handIntervalMs + 100);
        assert.ok(h.lobby.store.balance(a.userId, 'chips') > balanceDuring, 'ハンド後に精算されていない');
        h.dispose();
    });
});
describe('切断と再接続', () => {
    test('ハンド中に切断しても席は残り、卓は止まらない', () => {
        const h = newHarness();
        const a = h.login('A');
        const b = h.login('B');
        for (const c of [a, b]) {
            c.send({ t: 'table.watch', tableId: TABLE.tableId });
            c.send({ t: 'table.sit', tableId: TABLE.tableId, buyIn: 10000 });
        }
        h.pump(TABLE.seedWindowMs + 10);
        const seatOfA = a.state().yourSeat;
        h.disconnect(a);
        h.enableBot(b);
        h.pump(5000);
        const room = h.lobby.getRoom(TABLE.tableId);
        assert.ok(room.seatedCount >= 1, '切断で席が消えている');
        // 切断者は短いタイムアウトで自動処理され、卓が固まらない
        h.pump(20000);
        assert.notEqual(b.state()?.actingSeat, seatOfA, '切断者の手番で卓が止まっている');
        h.dispose();
    });
    test('再接続すると同じ席に戻れる', () => {
        const h = newHarness();
        const a = h.login('A');
        a.send({ t: 'table.watch', tableId: TABLE.tableId });
        a.send({ t: 'table.sit', tableId: TABLE.tableId, seat: 3, buyIn: 8000 });
        const token = a.resumeToken;
        h.disconnect(a);
        // 進行中のハンドが無いので席は解放される（チップは残高に戻る）
        assert.equal(h.lobby.store.balance(a.userId, 'chips'), 100000);
        const a2 = h.connect();
        a2.send({ t: 'hello', v: PROTOCOL_VERSION, resumeToken: token });
        a2.send({ t: 'table.watch', tableId: TABLE.tableId });
        a2.send({ t: 'table.sit', tableId: TABLE.tableId, seat: 3, buyIn: 8000 });
        assert.equal(a2.lastError(), null);
        assert.equal(a2.state()?.yourSeat, 3);
        h.dispose();
    });
});
describe('台帳', () => {
    test('残高不足の引き出しは記録されない', () => {
        const l = new MemoryStore();
        l.createUser('u1', 'u1');
        l.post('u1', 'chips', 1000, 'signup_bonus');
        assert.equal(l.post('u1', 'chips', -2000, 'table_buyin'), null);
        assert.equal(l.balance('u1', 'chips'), 1000);
        assert.equal(l.history('u1').length, 1, '失敗した取引が台帳に残っている');
    });
    test('残高は取引の集計と一致する', () => {
        const l = new MemoryStore();
        l.createUser('u1', 'u1');
        l.post('u1', 'chips', 10000, 'signup_bonus');
        l.post('u1', 'chips', -3000, 'table_buyin');
        l.post('u1', 'chips', 4500, 'table_cashout');
        assert.equal(l.balance('u1', 'chips'), 11500);
        assert.equal(l.audit().ok, true);
    });
    test('チップとゴールドは別勘定として扱われる', () => {
        const l = new MemoryStore();
        l.createUser('u1', 'u1');
        l.post('u1', 'chips', 1000, 'signup_bonus');
        l.post('u1', 'gold', 50, 'signup_bonus');
        assert.equal(l.balance('u1', 'chips'), 1000);
        assert.equal(l.balance('u1', 'gold'), 50);
        assert.equal(l.audit().ok, true);
    });
    test('小数を弾く', () => {
        const l = new MemoryStore();
        assert.throws(() => l.post('u1', 'chips', 1.5, 'adjustment'), /整数ではありません/);
    });
});
//# sourceMappingURL=server.test.js.map