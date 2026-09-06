import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bacValue, bankerDraws, dealFromCards, dealBaccarat, baccaratReturn, declareHit, BAC_DECLARE_RATE, } from '../src/server/baccarat.js';
import { Economy, BAC_MIN_BET } from '../src/server/economy.js';
import { MemoryStore } from '../src/server/store.js';
/** 値の並びからカード供給を作る(スートは♠固定。値0は10で表す) */
const feed = (...vals) => {
    const cards = vals.map((v) => ({ r: v === 0 ? 10 : v, s: 0 }));
    let i = 0;
    return () => cards[i++];
};
describe('バカラ: 数え方と三枚目規則', () => {
    test('10と絵札は0、Aは1', () => {
        assert.equal(bacValue(10), 0);
        assert.equal(bacValue(13), 0);
        assert.equal(bacValue(1), 1);
        assert.equal(bacValue(9), 9);
    });
    test('バンカーの三枚目規則(標準テーブル全域)', () => {
        // プレイヤーが引かなかったとき: 0-5 で引く
        for (let bt = 0; bt <= 9; bt++)
            assert.equal(bankerDraws(bt, null), bt <= 5, `bt=${bt} p3なし`);
        // プレイヤー三枚目の値 p3 ごとの規則
        for (let p3 = 0; p3 <= 9; p3++) {
            assert.equal(bankerDraws(2, p3), true, `bt=2 p3=${p3}`);
            assert.equal(bankerDraws(3, p3), p3 !== 8, `bt=3 p3=${p3}`);
            assert.equal(bankerDraws(4, p3), p3 >= 2 && p3 <= 7, `bt=4 p3=${p3}`);
            assert.equal(bankerDraws(5, p3), p3 >= 4 && p3 <= 7, `bt=5 p3=${p3}`);
            assert.equal(bankerDraws(6, p3), p3 === 6 || p3 === 7, `bt=6 p3=${p3}`);
            assert.equal(bankerDraws(7, p3), false, `bt=7 p3=${p3}`);
        }
    });
    test('ナチュラル(8/9)は両者とも引かない', () => {
        // P: 4+4=8(ナチュラル) / B: 2+3=5 → 三枚目なし
        const h = dealFromCards(feed(4, 2, 4, 3));
        assert.equal(h.p.length, 2);
        assert.equal(h.b.length, 2);
        assert.equal(h.pt, 8);
        assert.equal(h.bt, 5);
        assert.equal(h.res, 'P');
    });
    test('プレイヤー0-5は引く → バンカーは規則に従う', () => {
        // P: 2+3=5 → 引く(3枚目=8)。B: 4+2=6 → p3=8 は 6 で引かない
        const h = dealFromCards(feed(2, 4, 3, 2, 8));
        assert.equal(h.p.length, 3);
        assert.equal(h.b.length, 2);
        assert.equal(h.pt, 3); // 5+8=13→3
        assert.equal(h.bt, 6);
        assert.equal(h.res, 'B');
        // 配り順の最後はプレイヤーの3枚目
        assert.deepEqual(h.order[h.order.length - 1], { s: 'p', i: 2 });
    });
    test('両者スタンド(6-7同士)は4枚で終わる', () => {
        // P: 3+4=7 / B: 2+4=6
        const h = dealFromCards(feed(3, 2, 4, 4));
        assert.equal(h.order.length, 4);
        assert.equal(h.res, 'P');
    });
    test('6枚ハンド: プレイヤーもバンカーも引く', () => {
        // P: 1+2=3 → 引く(3枚目=5, p3=5)。B: 2+3=5 → p3=5 は引く
        const h = dealFromCards(feed(1, 2, 2, 3, 5, 9));
        assert.equal(h.p.length, 3);
        assert.equal(h.b.length, 3);
        assert.equal(h.pt, 8); // 3+5
        assert.equal(h.bt, 4); // 5+9=14→4
        assert.equal(h.res, 'P');
        assert.deepEqual(h.order[h.order.length - 1], { s: 'b', i: 2 });
    });
    test('本番の配札: 8デックのシューとして矛盾がない', () => {
        for (let i = 0; i < 200; i++) {
            const h = dealBaccarat(Math.random);
            const all = [...h.p, ...h.b];
            assert.ok(all.length >= 4 && all.length <= 6);
            assert.equal(h.order.length, all.length);
            for (const c of all) {
                assert.ok(c.r >= 1 && c.r <= 13);
                assert.ok(c.s >= 0 && c.s <= 3);
            }
            const recount = (cs) => cs.reduce((a, c) => a + bacValue(c.r), 0) % 10;
            assert.equal(h.pt, recount(h.p));
            assert.equal(h.bt, recount(h.b));
            const want = h.pt > h.bt ? 'P' : h.bt > h.pt ? 'B' : 'T';
            assert.equal(h.res, want);
        }
    });
});
describe('バカラ: 配当', () => {
    test('PLAYER 1:1 / BANKER 0.95:1 / TIE 8:1 とプッシュ', () => {
        const bets = { p: 1000, b: 2000, tie: 500 };
        assert.equal(baccaratReturn(bets, 'P'), 2000); // 1000×2
        assert.equal(baccaratReturn(bets, 'B'), 3900); // 2000×1.95
        assert.equal(baccaratReturn(bets, 'T'), 500 * 9 + 3000); // TIE 8:1 + P/B返金
    });
    test('コミッションの端数は切り捨て', () => {
        assert.equal(baccaratReturn({ p: 0, b: 1001, tie: 0 }, 'B'), Math.floor(1001 * 1.95));
    });
    test('読み宣言: HIGH は 5-9、LOW は 0-4 で的中', () => {
        assert.equal(declareHit('H', { r: 5, s: 0 }), true);
        assert.equal(declareHit('H', { r: 4, s: 0 }), false);
        assert.equal(declareHit('L', { r: 13, s: 0 }), true); // K=0
        assert.equal(declareHit('L', { r: 5, s: 0 }), false);
        assert.equal(declareHit(null, { r: 5, s: 0 }), false);
        // 率は HIGH の方が高い(的中率が低いぶん)。期待値がほぼ揃う設計
        assert.ok(BAC_DECLARE_RATE.H > BAC_DECLARE_RATE.L);
    });
});
describe('バカラ: 経済(支払い・上限・台帳)', () => {
    const setup = () => {
        const store = new MemoryStore();
        const eco = new Economy(store, () => Date.UTC(2026, 7, 5, 12));
        store.upsertUser('u1', 'テスト');
        store.post('u1', 'chips', 1_000_000, 'signup_bonus');
        return { store, eco };
    };
    test('賭け金が引かれ、払い戻しと残高が一致する', () => {
        const { store, eco } = setup();
        const before = store.balance('u1', 'chips');
        const r = eco.dealBaccaratHand('u1', { p: 5000, b: 0, tie: 0 }, null);
        assert.equal(r.ok, true);
        assert.equal(r.stake, 5000);
        const after = store.balance('u1', 'chips');
        assert.equal(after, before - 5000 + r.won);
        assert.equal(after, r.balance);
        // 勝敗と払い戻しの対応
        const expect = baccaratReturn({ p: 5000, b: 0, tie: 0 }, r.hand.res);
        assert.equal(r.won - r.bonus, expect);
    });
    test('下限・残高不足・不正額を弾く(上限は残高のみ)', () => {
        const { eco } = setup();
        assert.equal(eco.dealBaccaratHand('u1', { p: BAC_MIN_BET - 1, b: 0, tie: 0 }, null).ok, false);
        assert.equal(eco.dealBaccaratHand('u1', { p: 2_000_000, b: 0, tie: 0 }, null).ok, false);
        assert.equal(eco.dealBaccaratHand('u1', { p: 1000.5, b: 0, tie: 0 }, null).ok, false);
        assert.equal(eco.dealBaccaratHand('u1', { p: -100, b: 1100, tie: 0 }, null).ok, false);
        assert.equal(eco.dealBaccaratHand('nobody', { p: 1000, b: 0, tie: 0 }, null).ok, false);
    });
    test('SAFE_POST 超の賭け金も分割記帳で通る(上限なし)', () => {
        const store = new MemoryStore();
        const eco = new Economy(store, () => Date.UTC(2026, 7, 5, 12));
        store.upsertUser('u1', 'テスト');
        // 2京チップを SAFE_POST 以下の塊で入金
        for (let i = 0; i < 3; i++)
            store.post('u1', 'chips', 7_000_000_000_000_000, 'signup_bonus');
        const before = store.balance('u1', 'chips');
        const stake = 12_000_000_000_000_000; // 1.2京 > SAFE_POST(9000兆)
        const r = eco.dealBaccaratHand('u1', { p: stake, b: 0, tie: 0 }, null);
        assert.equal(r.ok, true);
        assert.equal(store.balance('u1', 'chips'), before - stake + r.won);
    });
    test('読み宣言ボーナスは絞り札の値と率に一致する', () => {
        const { store, eco } = setup();
        for (let i = 0; i < 50; i++) {
            const before = store.balance('u1', 'chips');
            const r = eco.dealBaccaratHand('u1', { p: 1000, b: 0, tie: 0 }, 'L');
            assert.equal(r.ok, true);
            const last = r.hand.order[r.hand.order.length - 1];
            const card = (last.s === 'p' ? r.hand.p : r.hand.b)[last.i];
            const hit = bacValue(card.r) <= 4;
            assert.equal(r.bonus, hit ? Math.round(1000 * BAC_DECLARE_RATE.L) : 0, `i=${i}`);
            assert.equal(store.balance('u1', 'chips'), before - 1000 + r.won);
        }
    });
    test('台帳の理由コードが baccarat_bet / baccarat_win で記録される', () => {
        const { store, eco } = setup();
        const r = eco.dealBaccaratHand('u1', { p: 0, b: 0, tie: 1000 }, null);
        assert.equal(r.ok, true);
        const rows = store.history('u1', 10);
        assert.ok(rows.some((x) => x.reason === 'baccarat_bet' && x.delta === -1000));
        if (r.won > 0)
            assert.ok(rows.some((x) => x.reason === 'baccarat_win'));
    });
});
//# sourceMappingURL=baccarat.test.js.map