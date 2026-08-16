import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, SqliteStore } from '../src/server/store.js';
import { Economy, CHIP_PACKS, GOLD_PACKS, VIP_TIERS, PASS_TIERS, PASS_PREMIUM_SKU, DAILY_MISSIONS, tierOf, nextTier, } from '../src/server/economy.js';
const setup = (store, now = () => Date.UTC(2026, 7, 10, 12)) => {
    const s = store ?? new MemoryStore();
    s.createUser('u1', 'Alice');
    const e = new Economy(s, now);
    return { s, e };
};
const RECEIPT = () => `r_${Math.random().toString(36).slice(2)}${Date.now()}`;
// ---------------------------------------------------------------------------
describe('価格表の健全性', () => {
    test('チップパックは高額なほど単価が良い', () => {
        for (let i = 1; i < CHIP_PACKS.length; i++) {
            const prev = CHIP_PACKS[i - 1].chips / CHIP_PACKS[i - 1].priceJpy;
            const cur = CHIP_PACKS[i].chips / CHIP_PACKS[i].priceJpy;
            assert.ok(cur > prev, `${CHIP_PACKS[i].sku} の単価が下の段より悪い`);
        }
    });
    test('単価差は 5 倍以内に収まっている', () => {
        // Zynga の実測は約 10 倍。低額課金者に「損している」と感じさせないため 5 倍未満に抑える設計
        const lo = CHIP_PACKS[0].chips / CHIP_PACKS[0].priceJpy;
        const hi = CHIP_PACKS[CHIP_PACKS.length - 1].chips / CHIP_PACKS[CHIP_PACKS.length - 1].priceJpy;
        assert.ok(hi / lo < 5, `単価差が ${(hi / lo).toFixed(2)} 倍`);
    });
    test('ゴールドの単価差はチップより緩やか', () => {
        const chipRatio = CHIP_PACKS[CHIP_PACKS.length - 1].chips /
            CHIP_PACKS[CHIP_PACKS.length - 1].priceJpy /
            (CHIP_PACKS[0].chips / CHIP_PACKS[0].priceJpy);
        const goldRatio = GOLD_PACKS[GOLD_PACKS.length - 1].gold /
            GOLD_PACKS[GOLD_PACKS.length - 1].priceJpy /
            (GOLD_PACKS[0].gold / GOLD_PACKS[0].priceJpy);
        assert.ok(goldRatio < chipRatio, 'ゴールドの単価差がチップより急');
    });
    test('日本の価格点に沿っている（¥160 から始まる細かい刻み）', () => {
        assert.equal(CHIP_PACKS[0].priceJpy, 160);
        assert.ok(CHIP_PACKS.some((p) => p.priceJpy <= 500), '低価格帯の商品が無い');
    });
    test('VIP ティアは単調増加し、到達可能な範囲に収まっている', () => {
        for (let i = 1; i < VIP_TIERS.length; i++) {
            assert.ok(VIP_TIERS[i].minPoints > VIP_TIERS[i - 1].minPoints);
            assert.ok(VIP_TIERS[i].purchaseBonus >= VIP_TIERS[i - 1].purchaseBonus);
        }
        // ¥1 = 1pt なので、Silver は ¥2,000 で到達できる
        assert.equal(VIP_TIERS[1].minPoints, 2000);
    });
    test('パスのティアは経験値が単調増加する', () => {
        for (let i = 1; i < PASS_TIERS.length; i++) {
            assert.ok(PASS_TIERS[i].xpRequired > PASS_TIERS[i - 1].xpRequired);
        }
    });
});
describe('購入', () => {
    test('チップが付与され、台帳に記録される', () => {
        const { s, e } = setup();
        const r = e.purchase('u1', 'chips_1200', RECEIPT());
        assert.equal(r.ok, true, r.error);
        assert.equal(r.granted.chips, 210_000_000);
        assert.equal(s.balance('u1', 'chips'), 210_000_000);
        assert.equal(s.audit().ok, true);
    });
    test('同じレシートは二度使えない', () => {
        const { s, e } = setup();
        const receipt = RECEIPT();
        assert.equal(e.purchase('u1', 'chips_160', receipt).ok, true);
        const second = e.purchase('u1', 'chips_160', receipt);
        assert.equal(second.ok, false, 'レシートの使い回しで二重付与されている');
        assert.equal(s.balance('u1', 'chips'), 15_000_000);
    });
    test('存在しない商品は買えない', () => {
        const { e } = setup();
        assert.equal(e.purchase('u1', 'chips_free_999999', RECEIPT()).ok, false);
    });
    test('レシートが短すぎる場合は拒否される', () => {
        const { e } = setup();
        assert.equal(e.purchase('u1', 'chips_160', 'x').ok, false);
    });
    test('VIP ポイントが貯まり、ティアが上がる', () => {
        const { s, e } = setup();
        // ¥1 = 1pt。Silver（2,000pt）到達には ¥2,000 必要
        e.purchase('u1', 'chips_1200', RECEIPT());
        assert.equal(e.vipStatus('u1').tier, 'bronze');
        const r = e.purchase('u1', 'chips_1200', RECEIPT());
        assert.equal(e.vipStatus('u1').tier, 'silver');
        assert.equal(r.granted.tierUp?.key, 'silver', '昇格の通知が出ていない');
        assert.equal(s.getUser('u1').lifetimeSpend, 2400);
    });
    test('VIP ティアが上がると購入時に増量される', () => {
        const { e } = setup();
        // Silver（+3%）まで上げる
        e.purchase('u1', 'chips_3000', RECEIPT());
        assert.equal(e.vipStatus('u1').tier, 'silver');
        const r = e.purchase('u1', 'chips_160', RECEIPT());
        assert.equal(r.granted.chips, Math.round(15_000_000 * 1.03));
    });
    test('プレミアムパスを買うとパスがプレミアムになる', () => {
        const { e } = setup();
        assert.equal(e.passStatus('u1').premium, false);
        assert.equal(e.purchase('u1', PASS_PREMIUM_SKU.sku, RECEIPT()).ok, true);
        assert.equal(e.passStatus('u1').premium, true);
    });
});
describe('オファー', () => {
    test('未購入なら初回限定パックが出る', () => {
        const { e } = setup();
        const offers = e.offersFor('u1');
        assert.ok(offers.some((o) => o.id === 'first_time'), '初回オファーが出ない');
    });
    test('一度購入すると初回限定は消える', () => {
        const { e } = setup();
        e.purchase('u1', 'chips_160', RECEIPT());
        assert.equal(e.offersFor('u1').some((o) => o.id === 'first_time'), false);
    });
    test('初回限定は恒常パックより明確にお得', () => {
        const { e } = setup();
        const offer = e.offersFor('u1').find((o) => o.id === 'first_time');
        const base = CHIP_PACKS[0];
        assert.ok(offer.sku.chips / offer.sku.priceJpy > (base.chips / base.priceJpy) * 4, '初回オファーの割安感が足りない');
    });
    test('チップが尽きると再挑戦パックが出る', () => {
        const { s, e } = setup();
        s.post('u1', 'chips', 1000, 'signup_bonus');
        assert.ok(e.offersFor('u1').some((o) => o.id === 'bust_rescue'));
    });
    test('チップが十分にあれば再挑戦パックは出ない', () => {
        const { s, e } = setup();
        s.post('u1', 'chips', 500_000, 'signup_bonus');
        assert.equal(e.offersFor('u1').some((o) => o.id === 'bust_rescue'), false);
    });
    test('VIP 限定オファーは Gold ティア以上にしか出ない', () => {
        const { s, e } = setup();
        assert.equal(e.offersFor('u1').some((o) => o.id === 'vip_only'), false);
        s.updateUser('u1', { vipPoints: 10_000 });
        assert.ok(e.offersFor('u1').some((o) => o.id === 'vip_only'));
    });
    test('週末だけ週末フラッシュが出る', () => {
        // 2026-08-08 は土曜、2026-08-11 は火曜
        const sat = setup(undefined, () => Date.UTC(2026, 7, 8, 12));
        assert.ok(sat.e.offersFor('u1').some((o) => o.id === 'weekend_flash'));
        const tue = setup(undefined, () => Date.UTC(2026, 7, 11, 12));
        assert.equal(tue.e.offersFor('u1').some((o) => o.id === 'weekend_flash'), false);
    });
});
describe('貯金箱', () => {
    test('プレイに応じて貯まる', () => {
        const { s, e } = setup();
        e.addToPiggyBank('u1', 3000);
        e.addToPiggyBank('u1', 2000);
        assert.equal(s.getUser('u1').piggyBank, 5000);
    });
    test('上限を超えて貯まらない', () => {
        const { s, e } = setup();
        e.addToPiggyBank('u1', 999_999_999);
        assert.equal(s.getUser('u1').piggyBank, 5_000_000);
    });
    test('購入すると中身が払い出され、空になる', () => {
        const { s, e } = setup();
        e.addToPiggyBank('u1', 40_000);
        const r = e.purchase('u1', 'offer_piggy_bank', RECEIPT());
        assert.equal(r.ok, true, r.error);
        assert.equal(r.granted.chips, 40_000);
        assert.equal(s.getUser('u1').piggyBank, 0);
        assert.equal(s.balance('u1', 'chips'), 40_000);
    });
    test('空の貯金箱は買えない', () => {
        const { e } = setup();
        assert.equal(e.purchase('u1', 'offer_piggy_bank', RECEIPT()).ok, false);
    });
});
describe('デイリーボーナス', () => {
    test('1 日 1 回だけ受け取れる', () => {
        const { e } = setup();
        assert.equal(e.claimDailyBonus('u1').ok, true);
        assert.equal(e.claimDailyBonus('u1').ok, false, '同じ日に 2 回受け取れてしまう');
    });
    test('連続ログインで増える', () => {
        const s = new MemoryStore();
        s.createUser('u1', 'A');
        let day = 0;
        const e = new Economy(s, () => Date.UTC(2026, 7, 10 + day, 12));
        const amounts = [];
        for (day = 0; day < 5; day++)
            amounts.push(e.claimDailyBonus('u1').amount);
        assert.equal(s.getUser('u1').loginStreak, 5);
        // 残高が増えるので額も増えるが、少なくとも初日より最終日が多い
        assert.ok(amounts[4] > amounts[0], `連続ボーナスが効いていない: ${amounts.join(',')}`);
    });
    test('連続が途切れるとストリークが 1 に戻る', () => {
        const s = new MemoryStore();
        s.createUser('u1', 'A');
        let day = 0;
        const e = new Economy(s, () => Date.UTC(2026, 7, 10 + day, 12));
        e.claimDailyBonus('u1');
        day = 3; // 2 日空ける
        e.claimDailyBonus('u1');
        assert.equal(s.getUser('u1').loginStreak, 1);
    });
    test('残高が少ないほど相対的に多くもらえる', () => {
        const poor = setup();
        const rich = setup();
        rich.s.post('u1', 'chips', 10_000_000, 'adjustment');
        const p = poor.e.claimDailyBonus('u1').amount;
        const r = rich.e.claimDailyBonus('u1').amount;
        assert.ok(r > p, '残高連動が効いていない');
        assert.ok(p >= 5000, '下限が保証されていない');
    });
    test('VIP ティアで倍率がかかる', () => {
        const base = setup();
        const vip = setup();
        vip.s.updateUser('u1', { vipPoints: 50_000 }); // Platinum = 2.0 倍
        const b = base.e.claimDailyBonus('u1').amount;
        const v = vip.e.claimDailyBonus('u1').amount;
        assert.equal(v, b * 2, `${v} !== ${b} * 2`);
    });
});
describe('ミッション', () => {
    test('進捗が進み、達成すると受け取れる', () => {
        const { e } = setup();
        const m = DAILY_MISSIONS[1]; // ハンドに 5 回勝つ
        for (let i = 0; i < m.target; i++)
            e.advanceMission('u1', m.id);
        const st = e.missionStatus('u1').find((x) => x.id === m.id);
        assert.equal(st.progress, m.target);
        const r = e.claimMission('u1', m.id);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.chips, m.rewardChips);
    });
    test('未達成では受け取れない', () => {
        const { e } = setup();
        e.advanceMission('u1', 'win_hands');
        assert.equal(e.claimMission('u1', 'win_hands').ok, false);
    });
    test('二重受け取りはできない', () => {
        const { e } = setup();
        for (let i = 0; i < 20; i++)
            e.advanceMission('u1', 'play_hands');
        assert.equal(e.claimMission('u1', 'play_hands').ok, true);
        assert.equal(e.claimMission('u1', 'play_hands').ok, false);
    });
    test('進捗は目標値で頭打ちになる', () => {
        const { e } = setup();
        for (let i = 0; i < 100; i++)
            e.advanceMission('u1', 'win_hands');
        assert.equal(e.missionStatus('u1').find((m) => m.id === 'win_hands').progress, 5);
    });
    test('日付が変わるとリセットされる', () => {
        const s = new MemoryStore();
        s.createUser('u1', 'A');
        let day = 0;
        const e = new Economy(s, () => Date.UTC(2026, 7, 10 + day, 12));
        for (let i = 0; i < 5; i++)
            e.advanceMission('u1', 'win_hands');
        assert.equal(e.missionStatus('u1').find((m) => m.id === 'win_hands').progress, 5);
        day = 1;
        assert.equal(e.missionStatus('u1').find((m) => m.id === 'win_hands').progress, 0, '翌日にリセットされていない');
        assert.equal(e.claimMission('u1', 'win_hands').ok, false);
    });
});
describe('チャレンジパス', () => {
    test('経験値でティアが上がる', () => {
        const { e } = setup();
        e.addPassXp('u1', 350);
        assert.equal(e.passStatus('u1').tier, 3);
    });
    test('無料トラックの報酬を受け取れる', () => {
        const { s, e } = setup();
        e.addPassXp('u1', 300);
        const r = e.claimPassRewards('u1');
        assert.equal(r.tiers.length, 3);
        assert.ok(r.chips > 0);
        assert.equal(s.balance('u1', 'chips'), r.chips);
    });
    test('同じティアの報酬は二度受け取れない', () => {
        const { e } = setup();
        e.addPassXp('u1', 300);
        const first = e.claimPassRewards('u1');
        const second = e.claimPassRewards('u1');
        assert.ok(first.chips > 0);
        assert.equal(second.chips, 0);
        assert.equal(second.tiers.length, 0);
    });
    test('プレミアムを後から買うと、それまでのティア分もさかのぼって受け取れる', () => {
        const { e } = setup();
        e.addPassXp('u1', 500);
        const freeOnly = e.claimPassRewards('u1');
        e.purchase('u1', PASS_PREMIUM_SKU.sku, RECEIPT());
        const afterPremium = e.claimPassRewards('u1');
        assert.ok(afterPremium.chips > 0, 'プレミアム購入後にさかのぼって受け取れていない');
        assert.ok(afterPremium.chips > freeOnly.chips * 0.5, 'プレミアム分の報酬が少なすぎる');
    });
    test('プレミアムの総量は無料の 2 倍以上ある', () => {
        const free = PASS_TIERS.reduce((a, t) => a + (t.free.chips ?? 0), 0);
        const prem = PASS_TIERS.reduce((a, t) => a + (t.premium.chips ?? 0), 0);
        assert.ok(prem >= free * 2, `無料 ${free} / プレミアム ${prem}`);
    });
});
describe('ハンド終了時のフック', () => {
    test('ミッション・パス・貯金箱・VIP がまとめて進む', () => {
        const { s, e } = setup();
        for (let i = 0; i < 5; i++) {
            e.onHandPlayed('u1', { won: true, showdownWin: true, rakeContributed: 4000 });
        }
        const st = e.missionStatus('u1');
        assert.equal(st.find((m) => m.id === 'play_hands').progress, 5);
        assert.equal(st.find((m) => m.id === 'win_hands').progress, 5);
        assert.equal(st.find((m) => m.id === 'showdown_win').progress, 2, '目標値で頭打ちになるはず');
        assert.equal(e.passStatus('u1').xp, 30);
        assert.equal(s.getUser('u1').piggyBank, 10_000, 'レーキの半分が貯金箱に積まれるはず');
        assert.equal(s.getUser('u1').vipPoints, 20, 'プレイでも VIP ポイントが貯まるはず');
    });
    test('非課金でもプレイだけで VIP ポイントが貯まる', () => {
        const { e } = setup();
        for (let i = 0; i < 1000; i++)
            e.onHandPlayed('u1', { won: false, showdownWin: false, rakeContributed: 2000 });
        assert.ok(e.vipStatus('u1').points >= 2000, '非課金者が Silver に到達できない');
    });
});
describe('VIP ヘルパー', () => {
    test('ポイントからティアが引ける', () => {
        assert.equal(tierOf(0).key, 'bronze');
        assert.equal(tierOf(1999).key, 'bronze');
        assert.equal(tierOf(2000).key, 'silver');
        assert.equal(tierOf(999_999_999).key, 'black');
    });
    test('次のティアが分かる', () => {
        assert.equal(nextTier(0)?.key, 'silver');
        assert.equal(nextTier(999_999_999), null);
    });
    test('次ティアまでの残りポイントが正しい', () => {
        const { s, e } = setup();
        s.updateUser('u1', { vipPoints: 1500 });
        const v = e.vipStatus('u1');
        assert.equal(v.nextTierName, 'シルバー');
        assert.equal(v.pointsToNext, 500);
    });
});
describe('永続化（SQLite）', () => {
    test('保存した内容が読み戻せる', async () => {
        const s = await SqliteStore.open(':memory:');
        s.createUser('u1', 'Alice');
        s.post('u1', 'chips', 50_000, 'signup_bonus');
        s.post('u1', 'gold', 100, 'signup_bonus');
        s.post('u1', 'chips', -12_000, 'table_buyin', 'cash-1');
        assert.equal(s.balance('u1', 'chips'), 38_000);
        assert.equal(s.balance('u1', 'gold'), 100);
        assert.equal(s.getUser('u1').name, 'Alice');
        assert.equal(s.history('u1').length, 3);
        assert.equal(s.audit().ok, true);
        s.close();
    });
    test('残高不足の引き出しはロールバックされ、仕訳も残らない', async () => {
        const s = await SqliteStore.open(':memory:');
        s.createUser('u1', 'A');
        s.post('u1', 'chips', 1000, 'signup_bonus');
        assert.equal(s.post('u1', 'chips', -5000, 'table_buyin'), null);
        assert.equal(s.balance('u1', 'chips'), 1000);
        assert.equal(s.history('u1').length, 1, '失敗した取引が仕訳に残っている');
        assert.equal(s.audit().ok, true);
        s.close();
    });
    test('レシートの一意制約で二重付与を防げる', async () => {
        const s = await SqliteStore.open(':memory:');
        const e = new Economy(s);
        s.createUser('u1', 'A');
        const receipt = RECEIPT();
        assert.equal(e.purchase('u1', 'chips_480', receipt).ok, true);
        assert.equal(e.purchase('u1', 'chips_480', receipt).ok, false);
        assert.equal(s.balance('u1', 'chips'), 60_000_000);
        s.close();
    });
    test('ハンド履歴を保存して取り出せる', async () => {
        const s = await SqliteStore.open(':memory:');
        s.saveHand({
            handId: 'h1',
            tableId: 't1',
            handNumber: 1,
            board: 'As Kd 7h 2c 9s',
            potTotal: 5000,
            rake: 200,
            fairness: JSON.stringify({ serverSeed: 'aa' }),
            seats: JSON.stringify([{ seat: 0, userId: 'u1', net: 2400 }]),
        });
        const got = s.getHand('h1');
        assert.equal(got.potTotal, 5000);
        assert.equal(got.board, 'As Kd 7h 2c 9s');
        assert.equal(s.recentHands('u1').length, 1);
        s.close();
    });
    test('進捗（ミッション・パス）が保存される', async () => {
        const s = await SqliteStore.open(':memory:');
        s.createUser('u1', 'A');
        const e = new Economy(s);
        e.addPassXp('u1', 250);
        e.advanceMission('u1', 'play_hands', 5);
        assert.equal(e.passStatus('u1').tier, 2);
        assert.equal(e.missionStatus('u1').find((m) => m.id === 'play_hands').progress, 5);
        s.close();
    });
    test('メモリ実装と SQLite 実装が同じ結果を返す', async () => {
        const results = [];
        for (const store of [new MemoryStore(), await SqliteStore.open(':memory:')]) {
            store.createUser('u1', 'A');
            const e = new Economy(store, () => Date.UTC(2026, 7, 10, 12));
            e.purchase('u1', 'chips_1200', 'receipt_fixed_1');
            e.addPassXp('u1', 400);
            e.claimPassRewards('u1');
            e.claimDailyBonus('u1');
            results.push(JSON.stringify({
                chips: store.balance('u1', 'chips'),
                gold: store.balance('u1', 'gold'),
                vip: e.vipStatus('u1').points,
                tier: e.passStatus('u1').tier,
                audit: store.audit().ok,
            }));
            store.close();
        }
        assert.equal(results[0], results[1], `実装によって結果が違う:\n${results[0]}\n${results[1]}`);
    });
});
//# sourceMappingURL=economy.test.js.map