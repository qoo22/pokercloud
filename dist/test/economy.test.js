import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, SqliteStore } from '../src/server/store.js';
import { Economy, CHIP_PACKS, GOLD_PACKS, VIP_TIERS, PASS_TIERS, PASS_PREMIUM_SKU, DAILY_MISSIONS, tierOf, nextTier, dailyBonusBase, DAILY_KNEE, DAILY_RATE, DAILY_BASE_CAP, DAILY_FLOOR, slotMultiplier, } from '../src/server/economy.js';
import { SLOT_CHIP_MIN_BET, SLOT_CHIP_MAX_BET, chipBetLadder, SAFE_POST } from '../src/server/economy.js';
import { PAY_SYMBOLS, spin as spinReels, MAX_WIN_X, PAYLINES, LINES, SLOT_CFG as ENGINE_CFG } from '../src/server/slot.js';
import { AD_DAILY_LIMIT, AD_REWARD_FLOOR, AD_REWARD_CAP, SLOT_CHIP_DAILY_SPINS } from '../src/server/economy.js';
// 既定の「今」は、シーズンの最終週に当たらない日を選んである。
// 最終週は経験値が 1.25 倍になる（キャッチアップ）ので、そこを踏むと期待値がズレる。
const setup = (store, now = () => Date.UTC(2026, 7, 5, 12)) => {
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
    test('機能商品は価格と名前が揃っている（ゴールド廃止後の枠）', () => {
        // 第66弾でゴールドを廃止し、旧ゴールドパックの枠は機能商品(広告除去)に転用した
        for (const p of GOLD_PACKS) {
            assert.ok(p.priceJpy > 0, `${p.sku} の価格が不正`);
            assert.ok(p.name.length > 0, `${p.sku} の名前が空`);
            assert.equal(p.gold, undefined, 'ゴールドを配る商品が残っている');
        }
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
    // 未消化のデイリーは 7 日ぶん持ち越す（調査資料 §4-1）。
    // 毎日ログインしないと完走できない設計は義務感を生んで離脱につながるため、
    // 「昨日の途中まで」が翌日以降も生きているようにしてある。
    test('未消化のデイリーは 7 日以内なら引き継がれる', () => {
        const s = new MemoryStore();
        s.createUser('u1', 'A');
        let day = 0;
        const e = new Economy(s, () => Date.UTC(2026, 7, 5 + day, 12));
        for (let i = 0; i < 3; i++)
            e.advanceMission('u1', 'win_hands');
        assert.equal(e.missionStatus('u1').find((m) => m.id === 'win_hands').progress, 3);
        day = 1;
        assert.equal(e.missionStatus('u1').find((m) => m.id === 'win_hands').progress, 3, '翌日に進捗が消えている（持ち越しが効いていない）');
        // 翌日に続きから進めて達成できる
        for (let i = 0; i < 2; i++)
            e.advanceMission('u1', 'win_hands');
        assert.equal(e.missionStatus('u1').find((m) => m.id === 'win_hands').progress, 5);
        assert.equal(e.claimMission('u1', 'win_hands').ok, true, '持ち越した進捗で受け取れない');
    });
    test('保持期間を過ぎたデイリーはリセットされる', () => {
        const s = new MemoryStore();
        s.createUser('u1', 'A');
        let day = 0;
        const e = new Economy(s, () => Date.UTC(2026, 7, 5 + day, 12));
        for (let i = 0; i < 5; i++)
            e.advanceMission('u1', 'win_hands');
        day = 7; // MISSION_CARRY_DAYS を過ぎる
        assert.equal(e.missionStatus('u1').find((m) => m.id === 'win_hands').progress, 0, '保持期間を過ぎても残っている（無期限に貯められてしまう）');
        assert.equal(e.claimMission('u1', 'win_hands').ok, false);
    });
    test('一度受け取ったデイリーは持ち越しで二重取りできない', () => {
        const s = new MemoryStore();
        s.createUser('u1', 'A');
        let day = 0;
        const e = new Economy(s, () => Date.UTC(2026, 7, 5 + day, 12));
        for (let i = 0; i < 5; i++)
            e.advanceMission('u1', 'win_hands');
        assert.equal(e.claimMission('u1', 'win_hands').ok, true);
        day = 1;
        assert.equal(e.claimMission('u1', 'win_hands').ok, false, '翌日に同じ達成を再度受け取れてしまう');
    });
    test('ウィークリー・シーズンのミッションも進んで受け取れる', () => {
        const { s, e } = setup();
        for (let i = 0; i < 3; i++)
            e.onTournamentEntered('u1');
        const w = e.weeklyStatus('u1').find((m) => m.id === 'w_tournament');
        assert.equal(w.progress, 3);
        assert.equal(e.claimMission('u1', 'w_tournament').ok, true, 'ウィークリーを受け取れない');
        assert.equal(e.claimMission('u1', 'w_tournament').ok, false, '二重に受け取れてしまう');
        // シーズン側も同じ行動で進む
        assert.equal(e.seasonalStatus('u1').find((m) => m.id === 's_tournament').progress, 3);
        assert.ok(s.balance('u1', 'chips') > 0);
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
        assert.equal(e.passStatus('u1').xp, 10, 'ハンドあたりの経験値は控えめ(勝ち2/負け1)にしてある');
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
    test('残高が2^53を超えても読める（本番で hello が沈黙した事故の再発防止）', async () => {
        // node:sqlite は 2^53 を超える INTEGER 列を読むと RangeError を投げる。
        // 分割記帳(第84弾)で「書く」ことはできるのに、getUser が「読む」だけで例外になり、
        // 残高9007兆超のアカウントは hello の処理が黙って死んでいた(2026-08-25 本番で発生)。
        // MemoryStore では再現しないため、必ず SqliteStore で検査する
        const s = await SqliteStore.open(':memory:');
        s.createUser('u1', 'クジラ');
        for (let i = 0; i < 3; i++)
            s.post('u1', 'chips', 9_000_000_000_000_000, 'adjustment');
        const bal = 27_000_000_000_000_000;
        assert.equal(s.getUser('u1').chips, bal, 'getUser が読めない/値が違う');
        assert.equal(s.balance('u1', 'chips'), bal, 'balance が読めない/値が違う');
        assert.equal(s.history('u1').length, 3, 'history が読めない'); // balance_after も 2^53 超
        assert.equal(s.audit().ok, true, '台帳の整合が取れない');
        assert.equal(s.totalBalance('chips'), bal, '合計が読めない/値が違う');
        assert.ok(s.listUsers(10).some((u) => u.chips === bal), 'listUsers が読めない');
        // さらに積んでも(=post の残高読みも)例外にならない
        assert.notEqual(s.post('u1', 'chips', 1_000, 'adjustment'), null);
        s.close();
    });
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
        const e = new Economy(s, () => Date.UTC(2026, 7, 5, 12));
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
// ---------------------------------------------------------------------------
// デイリーボーナスの逓減
//
// 事件: 所持チップの 3% を上限なしで配っていたため、ハイローラーほど桁違いに増えた
// (10億チップ×最上位ティアで 1 日 2 億超)。復帰支援という趣旨から外れ、高額卓の経済も壊す。
// ここでは「初中級者の体感は据え置き」「上位帯は強く逓減」の両立を固定する。
// ---------------------------------------------------------------------------
describe('デイリーボーナスの逓減', () => {
    test('無一文でも最低額はもらえる（復帰支援）', () => {
        assert.equal(dailyBonusBase(0), DAILY_FLOOR);
        assert.equal(dailyBonusBase(50_000), DAILY_FLOOR, '少額帯は最低額が効く');
    });
    test('KNEE までは従来どおりの率で、体感が落ちない', () => {
        for (const chips of [200_000, 1_000_000, DAILY_KNEE]) {
            assert.equal(dailyBonusBase(chips), Math.round(chips * DAILY_RATE), `${chips} チップの支給額が従来と変わっている`);
        }
    });
    test('継ぎ目で額が飛ばない（連続している）', () => {
        const below = dailyBonusBase(DAILY_KNEE - 1);
        const at = dailyBonusBase(DAILY_KNEE);
        const above = dailyBonusBase(DAILY_KNEE + 1);
        assert.ok(Math.abs(at - below) <= 1, `継ぎ目の手前で飛んでいる: ${below} → ${at}`);
        assert.ok(Math.abs(above - at) <= 1, `継ぎ目の直後で飛んでいる: ${at} → ${above}`);
    });
    test('KNEE より上は逓減する（残高100倍でも支給は10倍まで）', () => {
        const a = dailyBonusBase(DAILY_KNEE * 4);
        const b = dailyBonusBase(DAILY_KNEE);
        // 平方根なので残高4倍 → 支給2倍
        assert.ok(a / b < 2.05 && a / b > 1.95, `逓減していない: ${b} → ${a}`);
    });
    test('どれだけ持っていても基礎額は上限で頭打ち', () => {
        assert.equal(dailyBonusBase(1e9), DAILY_BASE_CAP);
        assert.equal(dailyBonusBase(1e12), DAILY_BASE_CAP, '兆単位でも上限を超えない');
        assert.equal(dailyBonusBase(Number.MAX_SAFE_INTEGER), DAILY_BASE_CAP);
    });
    test('単調増加する（持っているほど損はしない）', () => {
        let prev = -1;
        for (const c of [0, 1e5, 1e6, 2e6, 1e7, 1e8, 1e9, 1e10]) {
            const v = dailyBonusBase(c);
            assert.ok(v >= prev, `${c} で減少した: ${prev} → ${v}`);
            prev = v;
        }
    });
    test('ハイローラーの実支給が旧実装より桁違いに小さい', () => {
        const chips = 1_000_000_000;
        const old = Math.max(5_000, Math.round(chips * 0.03)); // 旧実装の基礎額
        assert.ok(dailyBonusBase(chips) * 25 < old, 'ハイローラーの支給が十分に抑えられていない');
    });
    test('実際の受け取りでも上限が効く（倍率込み）', () => {
        const { s, e } = setup();
        s.post('u1', 'chips', 1_000_000_000, 'adjustment');
        // 最上位ティア相当まで VIP を積む
        s.updateUser('u1', { vipPoints: VIP_TIERS[VIP_TIERS.length - 1].minPoints, loginStreak: 7 });
        const r = e.claimDailyBonus('u1');
        assert.equal(r.ok, true);
        // 倍率の上限は 連続7日(2.05) × 最上位ティア。それでも1000万に届かない
        assert.ok(r.amount < 10_000_000, `倍率込みでも高すぎる: ${r.amount}`);
        assert.ok(r.amount > DAILY_BASE_CAP, '倍率が効いていない');
    });
});
// ---------------------------------------------------------------------------
// ゴールドスロット
//
// ゴールドは長らく「貯まるだけで使い道がない」通貨だったので、唯一の消費先として追加した。
// 倍率が VIP ランクと連続ログインで上がるのが要件の中核。
// 賭博的な要素なので「賭けた分は必ず引かれる」「上限を超えて回せない」を厳密に固定する。
// ---------------------------------------------------------------------------
describe('スロット', () => {
    const slotSetup = () => {
        const { s, e } = setup();
        s.post('u1', 'chips', 50_000_000, 'adjustment'); // 第66弾: チップ専用
        return { s, e };
    };
    /** 常に同じ絵柄を引かせる（先頭の絵柄＝chip が 3 つ揃う） */
    const alwaysFirst = () => 0.0001;
    test('絵柄の重みは正で、配当は揃いにくいものほど大きい', () => {
        for (const sym of PAY_SYMBOLS)
            assert.ok(sym.weight > 0, `${sym.key} の重みが 0 以下`);
        for (let i = 1; i < PAY_SYMBOLS.length; i++) {
            assert.ok(PAY_SYMBOLS[i].weight <= PAY_SYMBOLS[i - 1].weight, '重みが単調減少していない');
            // 5個そろいの配当で比べる(下位絵柄は3個では配当が無いため)
            assert.ok(PAY_SYMBOLS[i].pay[2] > PAY_SYMBOLS[i - 1].pay[2], '配当が単調増加していない');
        }
    });
    test('チップが引かれ、チップが払い出される', () => {
        const { s, e } = slotSetup();
        const before = s.balance('u1', 'chips');
        const r = e.spinSlot('u1', 100_000, alwaysFirst);
        assert.equal(r.ok, true, r.error);
        assert.equal(s.balance('u1', 'chips'), before - 100_000 + (r.won ?? 0), 'チップの収支が合わない');
        // 全マスがWILDになる極端な乱数。第79弾で連鎖を廃止したので上限までは伸びないが、
        // 25ライン全部が成立するので「メガ」級(BETの100倍以上)にはなる
        assert.equal(r.kind, 'mega', `想定より小さい: ${r.kind}`);
        assert.ok(r.won > 100_000 * 100, '25ライン全部そろっているのに払い出しが小さい');
        assert.equal(s.audit().ok, true, '台帳が壊れた');
    });
    // --- 第58弾: 243ways + タンブル + フリーゲーム ---------------------------
    // 線形合同法の固定シード。seed=675 は 3スキャッター→フリーゲーム18回転に入る当たり方
    const seeded = (seed) => { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };
    test('盤面は5リール×3段で、当たりは左から連続したときだけ', () => {
        const r = spinReels(seeded(675), { mode: 'many' });
        // grid0 は当たりが無いスピンでも必ず入る(ハズレでも盤面が更新されるため)
        assert.equal(r.grid0.length, 5, 'リールが5本でない');
        for (const col of r.grid0)
            assert.equal(col.length, 3, '1リールが3段でない');
        for (const st of r.base) {
            for (const w of st.wins) {
                assert.ok(w.count >= 3, '3個未満で配当が出ている');
                assert.ok(w.line != null && w.line >= 0 && w.line < LINES, 'ライン番号が入っていない');
            }
        }
    });
    // --- 第65弾: 20固定ペイライン ---------------------------------------------
    test('ペイラインは25本で、すべて5リールぶんの段を持つ', () => {
        assert.equal(LINES, 25, 'ライン数が25でない');
        assert.equal(PAYLINES.length, 25);
        for (const line of PAYLINES) {
            assert.equal(line.length, 5, 'ラインが5リールぶんでない');
            for (const row of line)
                assert.ok(row >= 0 && row <= 2, `段が範囲外: ${row}`);
        }
        // 同じ形のラインが重複していないこと
        const seen = new Set(PAYLINES.map((l) => l.join('')));
        assert.equal(seen.size, 25, '同じ形のラインが重複している');
    });
    test('同じラインでは一番高い組み合わせだけを払う', () => {
        // どのスピンでも「1ラインにつき当選は最大1つ」であることを確認する
        for (let seed = 1; seed < 300; seed++) {
            const r = spinReels(seeded(seed), { mode: 'many' });
            for (const st of r.base) {
                const lines = st.wins.map((w) => w.line);
                assert.equal(new Set(lines).size, lines.length, `同じラインで複数払っている(seed ${seed})`);
            }
        }
    });
    test('当選は必ず左端のリールから始まる', () => {
        for (let seed = 1; seed < 200; seed++) {
            const r = spinReels(seeded(seed), { mode: 'many' });
            for (const st of r.base) {
                for (const w of st.wins) {
                    const line = PAYLINES[w.line];
                    // 当選に使われたマスは line[0..count-1] のはず＝リール0が必ず含まれる
                    const usesReel0 = st.hits.some(([reel, row]) => reel === 0 && row === line[0]);
                    assert.ok(usesReel0, `左端から始まっていない(seed ${seed}, line ${w.line})`);
                }
            }
        }
    });
    test('フリーゲームの倍率はWILD配当だけ（持続倍率が復活していないこと・第94弾）', () => {
        // オーナー指定: 掛かるのは突入時に抽選する WILD配当(×2〜×5)の1本だけで、
        // WILDを含む当選ラインに1回。持続倍率(当たるたび+7)は廃止した。
        // これにより1ラインの支払いは「ライン配当 × wildMult」で頭打ちになる。
        let checkedWild = 0, checkedPlain = 0;
        for (let seed = 1; seed < 20000 && (checkedWild < 5 || checkedPlain < 5); seed++) {
            const r = spinReels(seeded(seed), { mode: 'few' });
            if (!r.free)
                continue;
            const wm = r.free.wildMult;
            assert.ok(wm >= 2 && wm <= 5, `WILD配当が×2〜×5でない: ${wm}`);
            assert.equal(r.free.finalMult, 1, '持続倍率が残っている(finalMult)');
            for (const sp of r.free.spins) {
                assert.equal(sp.multAfter, 1, '持続倍率が残っている(multAfter)');
                for (const st of sp.steps) {
                    assert.equal(st.mult, 1, `全体に掛かる倍率が1でない(seed ${seed}): ${st.mult}`);
                    // 各ラインの支払いは「素の配当 × (WILDを含むなら wildMult)」を超えない
                    let sum = 0;
                    for (const w of st.wins) {
                        const m = w.wildMult ?? 1;
                        assert.ok(m === 1 || m === wm, `ライン倍率が抽選値と違う: ${m} (期待 1 か ${wm})`);
                        sum += w.pay * m;
                        if (m === wm)
                            checkedWild++;
                        else
                            checkedPlain++;
                    }
                    assert.ok(Math.abs(st.payX - sum) < 1e-9, `スピンの支払いがライン合計と合わない(seed ${seed}): ${st.payX} ≠ ${sum}`);
                }
            }
        }
        assert.ok(checkedWild >= 5, `WILDライン適用の検体が足りない(${checkedWild})`);
        assert.ok(checkedPlain >= 5, `WILD無しラインの検体が足りない(${checkedPlain})`);
    });
    test('当たりが無いスピンでも盤面が返る（ハズレでリールが止まらない事故の防止）', () => {
        let checked = 0;
        for (let seed = 1; seed < 200 && checked < 5; seed++) {
            const r = spinReels(seeded(seed), { mode: 'many' });
            if (r.base.length > 0)
                continue; // 当たったスピンは対象外
            assert.ok(Array.isArray(r.grid0) && r.grid0.length === 5, 'ハズレなのに盤面が入っていない');
            checked++;
        }
        assert.ok(checked > 0, 'ハズレのスピンが1つも見つからない（前提が崩れた）');
    });
    test('配当は頭打ちされない（合計がそのまま支払われる）', () => {
        // 第80弾で MAX WIN の上限を撤廃(オーナー判断)。5000x は称号のしきい値としてだけ残る。
        // 第94弾で持続倍率を廃止したため 5000x 超は滅多に出ない。
        // 「切り詰めていない」ことは合計の一致で確かめ、観測の前提は大当たり(100x超)に緩める
        let big = 0;
        for (let seed = 1; seed < 4000; seed++) {
            const r = spinReels(seeded(seed), { mode: 'few' });
            const sum = r.basePayX + (r.respin?.payX ?? 0) + (r.free?.payX ?? 0);
            assert.ok(Math.abs(r.totalPayX - sum) < 1e-9, `合計が切り詰められている(seed ${seed}): ${r.totalPayX} != ${sum}`);
            assert.equal(r.maxWin, sum >= MAX_WIN_X, '称号フラグのしきい値が違う');
            if (sum > 100)
                big++;
        }
        assert.ok(big > 0, '100xを超える例が観測できない(前提が崩れた)');
    });
    test('アンティベットはフリーゲームに入りやすくなる', () => {
        const count = (ante) => {
            let n = 0;
            const rnd = seeded(4321);
            for (let i = 0; i < 4000; i++)
                if (spinReels(rnd, { ante, mode: 'many' }).freeEntered)
                    n++;
            return n;
        };
        const plain = count(false), ante = count(true);
        assert.ok(ante > plain, `アンティで突入率が上がっていない: ${plain} → ${ante}`);
    });
    // --- 第69弾/第76弾: スタックドWILD + リスピン(全リール対応) -----------------
    test('リスピンは一番左のリールが3連WILDのときだけ発生する', () => {
        let leftStack = 0, otherOnly = 0;
        for (let seed = 1; seed < 8000; seed++) {
            const r = spinReels(seeded(seed), { mode: 'few' });
            const hasLeft = r.stackedReels.indexOf(0) >= 0;
            if (hasLeft) {
                leftStack++;
                assert.ok(r.respin, `リール1が3連WILDなのにリスピンが無い(seed ${seed})`);
                assert.deepEqual(r.respin.lockedReels, [0], 'リール1以外までロックしている');
                assert.deepEqual(r.respin.grid0[0], ['wild', 'wild', 'wild'], 'リスピンでリール1が固定されていない');
                for (const col of r.respin.grid0)
                    for (const c of col) {
                        assert.notEqual(c, 'scatter', 'リスピンでスキャッターが抽選されている');
                    }
            }
            else {
                assert.equal(r.respin, undefined, `リール1が3連WILDでないのにリスピンがある(seed ${seed})`);
                if (r.stackedReels.length)
                    otherOnly++;
            }
        }
        assert.ok(leftStack > 0, 'リール1の3連WILDが一度も出ない');
        assert.ok(otherOnly > 0, '他リールだけの3連WILDが観測できない(前提が崩れた)');
    });
    test('スタックドWILDは全リールで起こりうる(理論上オールワイルドが成立する)', () => {
        // 5リールすべてが対象になっているか。実際に5本そろうのは (1/64)^5 なので、
        // 「どのリールでもフル停止が観測できる」ことをもって全リール対応を確かめる
        const seen = new Set();
        for (let seed = 1; seed < 60000 && seen.size < 5; seed++) {
            for (const reel of spinReels(seeded(seed), { mode: 'few' }).stackedReels)
                seen.add(reel);
        }
        assert.equal(seen.size, 5, `フル停止が観測できないリールがある: ${[...seen].sort().join(',')}`);
    });
    test('フリーゲーム中はWILDがコマ単位でホールドされ、増えることはあっても減らない', () => {
        let found = 0;
        for (let seed = 1; seed < 20000 && found < 5; seed++) {
            const r = spinReels(seeded(seed), { mode: 'many' });
            if (!r.free || r.free.spins.length < 2)
                continue;
            found++;
            let prev = new Set();
            for (const sp of r.free.spins) {
                const now = new Set(sp.heldCells.map(([x, y]) => `${x},${y}`));
                // ホールドは解除されない(フリーゲームが終わるまで残る)
                for (const k of prev)
                    assert.ok(now.has(k), `ホールドが外れた(seed ${seed}, ${k})`);
                // ホールドされているマスは必ずWILDとして盤面に乗っている
                for (const [x, y] of sp.heldCells) {
                    assert.equal(sp.grid0[x][y], 'wild', `ホールドなのにWILDでない(seed ${seed})`);
                }
                // fresh は「今回新しく増えたぶん」
                for (const [x, y] of sp.freshCells) {
                    assert.ok(!prev.has(`${x},${y}`), 'freshなのに前から持っていた');
                    assert.ok(now.has(`${x},${y}`), 'freshなのにホールドに入っていない');
                }
                prev = now;
            }
        }
        assert.ok(found > 0, 'フリーゲームが見つからない');
    });
    test('上乗せは総回数に正しく積まれ、残り回数と食い違わない', () => {
        const startBy = ENGINE_CFG.freeSpinsByScatter;
        // 上乗せは「フリー中にスキャッター3個以上」なので実運用では極めて稀(フリー1回あたり数%)。
        // **規則が正しいか**を見たいので、検体が集まるようスキャッターの重みだけ上げる
        const orig = ENGINE_CFG.scatterWeight;
        ENGINE_CFG.scatterWeight = 40;
        try {
            let checked = 0;
            for (let seed = 1; seed < 20000 && checked < 5; seed++) {
                const r = spinReels(seeded(seed), { mode: 'many' });
                if (!r.free)
                    continue;
                const added = r.free.spins.reduce((a, sp) => a + sp.addedSpins, 0);
                if (!added)
                    continue;
                checked++;
                // 突入回数 + 上乗せ = 総回数 になっていること
                const base = startBy[Math.min(r.scatters, 5)];
                assert.equal(r.free.spinsTotal, base + added, `総回数が合わない(seed ${seed})`);
                // 残り回数が1ずつ減り、上乗せのぶんだけ増えること(画面の「残りn回」がこれを出す)
                let left = base;
                for (const sp of r.free.spins) {
                    left = left - 1 + sp.addedSpins;
                    assert.equal(sp.spinsLeft, left, `残り回数が合わない(seed ${seed})`);
                    assert.equal(sp.retrigger, sp.addedSpins > 0, '上乗せの有無とフラグが食い違う');
                }
                assert.equal(left, 0, `最後に残り0回で終わっていない(seed ${seed})`);
            }
            assert.ok(checked > 0, '上乗せが一度も起きない');
        }
        finally {
            ENGINE_CFG.scatterWeight = orig;
        }
    });
    test('連鎖は発生しない(1スピンにつき判定は1回だけ)', () => {
        for (let seed = 1; seed < 3000; seed++) {
            const r = spinReels(seeded(seed), { mode: 'few' });
            assert.ok(r.base.length <= 1, `通常時に連鎖している(seed ${seed}, ${r.base.length}段)`);
            if (r.respin)
                assert.ok(r.respin.steps.length <= 1, `リスピンで連鎖している(seed ${seed})`);
            for (const sp of r.free?.spins ?? []) {
                assert.ok(sp.steps.length <= 1, `フリー中に連鎖している(seed ${seed})`);
            }
        }
    });
    test('WILD倍率は突入時に1回だけ抽選され、フリーゲーム中ずっと同じ値になる', () => {
        let checked = 0;
        for (let seed = 1; seed < 20000 && checked < 8; seed++) {
            const r = spinReels(seeded(seed), { mode: 'few' });
            if (!r.free)
                continue;
            const fixed = r.free.wildMult;
            assert.ok(fixed >= 2 && fixed <= 5, `WILD倍率が範囲外: ${fixed}`);
            let seen = 0;
            for (const sp of r.free.spins) {
                for (const st of sp.steps) {
                    for (const w of st.wins) {
                        if (w.wildMult == null)
                            continue;
                        seen++;
                        assert.equal(w.wildMult, fixed, `フリー中にWILD倍率が変わった(seed ${seed})`);
                    }
                }
            }
            if (seen > 0)
                checked++;
        }
        assert.ok(checked > 0, 'WILD倍率が付く当選が一度も見つからない');
    });
    test('WILD倍率はWILDを含む当選ラインにだけ・1ラインにつき1回だけ付く', () => {
        let withWild = 0, withoutWild = 0;
        for (let seed = 1; seed < 8000; seed++) {
            const r = spinReels(seeded(seed), { mode: 'few' });
            for (const st of [...r.base, ...(r.respin?.steps ?? [])]) {
                for (const w of st.wins)
                    assert.equal(w.wildMult, undefined, `通常時にWILD倍率が付いている(seed ${seed})`);
            }
            for (const sp of r.free?.spins ?? []) {
                for (const st of sp.steps) {
                    for (const w of st.wins) {
                        const line = PAYLINES[w.line];
                        let hasWild = false;
                        for (let i = 0; i < w.count; i++)
                            if (st.grid[i][line[i]] === 'wild')
                                hasWild = true;
                        if (hasWild) {
                            withWild++;
                            assert.ok(w.wildMult, `WILDを含むのに倍率が付いていない(seed ${seed}, line ${w.line})`);
                            assert.ok(w.wildMult <= 5, `WILDの枚数分だけ倍率が増えている: ${w.wildMult}`);
                        }
                        else {
                            withoutWild++;
                            assert.equal(w.wildMult, undefined, `WILDが無いのに倍率が付いている(seed ${seed}, line ${w.line})`);
                        }
                    }
                }
            }
        }
        assert.ok(withWild > 0 && withoutWild > 0, `検体が偏っている: wild=${withWild} plain=${withoutWild}`);
    });
    // --- 第72弾: 盤面に無い絵柄での当選を見分けられるようにする ---------------
    test('WILDだけで成立した当選には allWild が立つ(盤面にその絵柄が無いため)', () => {
        let all = 0, natural = 0;
        for (let seed = 1; seed < 4000; seed++) {
            const r = spinReels(seeded(seed), { mode: 'few' });
            for (const st of [...r.base, ...(r.respin?.steps ?? [])]) {
                for (const w of st.wins) {
                    const line = PAYLINES[w.line];
                    // 当選区間に「その絵柄そのもの」があるか
                    let has = false;
                    for (let i = 0; i < w.count; i++)
                        if (st.grid[i][line[i]] === w.key)
                            has = true;
                    if (w.allWild) {
                        all++;
                        assert.equal(has, false, `allWild なのに絵柄が盤面にある(seed ${seed}, ${w.key})`);
                        // 全部WILDで成立しているはず
                        for (let i = 0; i < w.count; i++) {
                            assert.equal(st.grid[i][line[i]], 'wild', `allWild なのにWILD以外がある(seed ${seed})`);
                        }
                    }
                    else {
                        natural++;
                        assert.equal(has, true, `allWild が立っていないのに絵柄が盤面に無い(seed ${seed}, ${w.key})`);
                    }
                }
            }
        }
        assert.ok(all > 0, 'WILDだけの当選が一度も出ない(前提が崩れた)');
        assert.ok(natural > all * 10, `WILDだけの当選が多すぎる: ${all}/${all + natural}`);
    });
    test('WILD倍率は突入時に1回だけ抽選され、フリーゲーム中ずっと同じ値になる', () => {
        let checked = 0;
        for (let seed = 1; seed < 20000 && checked < 8; seed++) {
            const r = spinReels(seeded(seed), { mode: 'few' });
            if (!r.free)
                continue;
            const fixed = r.free.wildMult;
            assert.ok(fixed >= 2 && fixed <= 5, `WILD倍率が範囲外: ${fixed}`);
            let seen = 0;
            for (const sp of r.free.spins) {
                for (const st of sp.steps) {
                    for (const w of st.wins) {
                        if (w.wildMult == null)
                            continue;
                        seen++;
                        // スピンごとに引き直していたら、ここで別の値が出る
                        assert.equal(w.wildMult, fixed, `フリー中にWILD倍率が変わった(seed ${seed})`);
                    }
                }
            }
            if (seen > 0)
                checked++;
        }
        assert.ok(checked > 0, 'WILD倍率が付く当選が一度も見つからない');
    });
    test('WILD倍率はWILDを含む当選ラインにだけ・1ラインにつき1回だけ付く', () => {
        let withWild = 0, withoutWild = 0;
        for (let seed = 1; seed < 8000; seed++) {
            const r = spinReels(seeded(seed), { mode: 'few' });
            // 通常時(ベース+リスピン)には付かない
            for (const st of [...r.base, ...(r.respin?.steps ?? [])]) {
                for (const w of st.wins)
                    assert.equal(w.wildMult, undefined, `通常時にWILD倍率が付いている(seed ${seed})`);
            }
            for (const sp of r.free?.spins ?? []) {
                for (const st of sp.steps) {
                    for (const w of st.wins) {
                        const line = PAYLINES[w.line];
                        // 当選区間にWILDがあるか
                        let hasWild = false;
                        for (let i = 0; i < w.count; i++)
                            if (st.grid[i][line[i]] === 'wild')
                                hasWild = true;
                        if (hasWild) {
                            withWild++;
                            assert.ok(w.wildMult, `WILDを含むのに倍率が付いていない(seed ${seed}, line ${w.line})`);
                            // 「1ラインにつき1回」= 掛かる倍率は倍率表の1つぶんで、WILDの枚数で増えない
                            assert.ok(w.wildMult <= 5, `WILDの枚数分だけ倍率が増えている: ${w.wildMult}`);
                        }
                        else {
                            withoutWild++;
                            assert.equal(w.wildMult, undefined, `WILDが無いのに倍率が付いている(seed ${seed}, line ${w.line})`);
                        }
                    }
                }
            }
        }
        assert.ok(withWild > 0 && withoutWild > 0, `検体が偏っている: wild=${withWild} plain=${withoutWild}`);
    });
    test('チップで回せる（チップが引かれ、チップで払い出される）', () => {
        const { s, e } = setup();
        s.post('u1', 'chips', 10_000_000, 'adjustment');
        const before = s.balance('u1', 'chips');
        const r = e.spinSlot('u1', 100_000, undefined);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.currency, 'chips');
        assert.equal(s.balance('u1', 'gold'), 0, 'チップ建てなのにゴールドが動いた');
        assert.equal(s.balance('u1', 'chips'), before - 100_000 + (r.won ?? 0), 'チップの収支が合わない');
        assert.equal(s.audit().ok, true, '台帳が壊れた');
    });
    test('チップ建てでは払い出し倍率が掛からない（無限増殖の防止）', () => {
        const a = setup();
        a.s.post('u1', 'chips', 10_000_000, 'adjustment');
        const b = setup();
        b.s.post('u1', 'chips', 10_000_000, 'adjustment');
        // 片方だけ最上位VIP＋連続ログイン14日にしても、同じ出目なら払い出しは同じはず
        b.s.updateUser('u1', { vipPoints: VIP_TIERS[VIP_TIERS.length - 1].minPoints, loginStreak: 14 });
        const seeded = (seed) => { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };
        const ra = a.e.spinSlot('u1', 100_000, seeded(675));
        const rb = b.e.spinSlot('u1', 100_000, seeded(675));
        assert.equal(rb.multiplier, 1, 'チップ建てで倍率が 1 でない');
        assert.equal(ra.won, rb.won, 'VIPランクでチップ建ての払い出しが変わっている（増殖の入口）');
    });
    test('フリーゲームは必ず終わる（再トリガーに上限は無いが暴走止めに触れない）', () => {
        // 第80弾でRTPの帯チェックは廃止した。RTPが100%を大きく超えるのは**オーナー判断で許容**
        // (現金化なし・1日の回転数上限が発行量の歯止め)。ここで守るべきは「1回が必ず終わる」こと。
        // 第89弾で再トリガーの上限は撤廃したので、確かめるのは
        // 「暴走止め(freeSpinsGuard)に張り付いていないこと」＝抽選が収束していること
        let worst = 0;
        for (let seed = 1; seed < 3000; seed++) {
            const r = spinReels(seeded(seed), { mode: 'few' });
            if (!r.free)
                continue;
            worst = Math.max(worst, r.free.spins.length);
            assert.ok(r.free.spins.length < ENGINE_CFG.freeSpinsGuard, `フリーゲームが暴走止めまで回った(seed ${seed}, ${r.free.spins.length}回)`);
            assert.equal(r.free.spins.length, Math.min(r.free.spinsTotal, ENGINE_CFG.freeSpinsGuard), `消化した回数と総回数が食い違う(seed ${seed})`);
        }
        // 期待上乗せが小さいので、実際には暴走止めのはるか手前で終わる
        assert.ok(worst < ENGINE_CFG.freeSpinsGuard / 2, `再トリガーが収束していない(最長 ${worst} 回)`);
    });
    test('突入回数と上乗せ回数がスキャッターの個数どおり', () => {
        // 3個=8 / 4個=12 / 5個=16、上乗せは 3個=+4 / 4個=+8 / 5個=+12(オーナー指定)
        // assert.deepEqual は `asserts actual is T` なので、**同じ変数に使うと型が絞り込まれて**
        // そのあとの数値インデックスが通らなくなる。検査はコピーに対して行う
        assert.deepEqual({ ...ENGINE_CFG.freeSpinsByScatter }, { 3: 8, 4: 12, 5: 16 });
        assert.deepEqual({ ...ENGINE_CFG.freeRetriggerByScatter }, { 3: 4, 4: 8, 5: 12 });
        const startBy = ENGINE_CFG.freeSpinsByScatter;
        const addBy = ENGINE_CFG.freeRetriggerByScatter;
        // 4個/5個の突入と上乗せは実運用では稀なので、規則を見るために重みだけ上げる
        const orig = ENGINE_CFG.scatterWeight;
        ENGINE_CFG.scatterWeight = 40;
        try {
            let checkedStart = 0, checkedAdd = 0;
            for (let seed = 1; seed < 6000 && (checkedStart < 20 || checkedAdd < 5); seed++) {
                const r = spinReels(seeded(seed), { mode: 'few' });
                if (!r.free)
                    continue;
                // 突入時の回数は「上乗せを引く前の総回数」＝ 最初のステップの残り+1
                const first = r.free.spins[0];
                const startSpins = first.spinsLeft + 1 - first.addedSpins;
                assert.equal(startSpins, startBy[Math.min(r.scatters, 5)], `突入回数が違う(seed ${seed}, スキャッター ${r.scatters}個 → ${startSpins}回)`);
                checkedStart++;
                for (const sp of r.free.spins) {
                    if (!sp.addedSpins) {
                        assert.ok(sp.scatters < 3, '3個以上なのに上乗せが無い');
                        continue;
                    }
                    assert.equal(sp.addedSpins, addBy[Math.min(sp.scatters, 5)], `上乗せ回数が違う(スキャッター ${sp.scatters}個 → +${sp.addedSpins})`);
                    checkedAdd++;
                }
            }
            assert.ok(checkedStart >= 20, `検体が足りない(突入 ${checkedStart} 件)`);
            assert.ok(checkedAdd >= 5, `上乗せの検体が足りない(${checkedAdd} 件)`);
        }
        finally {
            ENGINE_CFG.scatterWeight = orig;
        }
    });
    test('スキャッターは1リールに1個までしか出ない', () => {
        for (let seed = 1; seed < 4000; seed++) {
            const r = spinReels(seeded(seed));
            for (let reel = 0; reel < r.grid0.length; reel++) {
                const n = r.grid0[reel].filter((k) => k === 'scatter').length;
                assert.ok(n <= 1, `リール${reel + 1}にスキャッターが${n}個(seed ${seed})`);
            }
            // フリーゲーム中の盤面も同じ規則
            for (const sp of r.free?.spins ?? []) {
                for (let reel = 0; reel < sp.grid0.length; reel++) {
                    const n = sp.grid0[reel].filter((k) => k === 'scatter').length;
                    assert.ok(n <= 1, `フリー中のリール${reel + 1}にスキャッターが${n}個(seed ${seed})`);
                }
            }
        }
    });
    test('チップ建ての賭け金は下限を下回れない', () => {
        const { s, e } = setup();
        s.post('u1', 'chips', 10_000_000, 'adjustment');
        const r = e.spinSlot('u1', SLOT_CHIP_MIN_BET - 1, undefined);
        assert.equal(r.ok, false, '下限未満で回せてしまう');
        assert.equal(s.balance('u1', 'chips'), 10_000_000, '失敗したのに残高が動いた');
    });
    test('賭け金の選択肢は所持チップに合わせて上限が開き、下限は常に残る', () => {
        // 第106弾(オーナー指定): 所持が増えても**最低ベット(1,000)は必ず選べる**。
        // 5万しか持っていなくても 1,000 で回せるし、大金持ちでも少額で遊べる
        const small = chipBetLadder(2_000_000);
        const big = chipBetLadder(1_300_000_000_000_000);
        assert.equal(small[0], SLOT_CHIP_MIN_BET, '少額所持で下限から選べない');
        assert.equal(big[0], SLOT_CHIP_MIN_BET, '高額所持で下限が消えている');
        assert.ok(big[big.length - 1] > small[small.length - 1], '残高が増えても上限が開かない');
        assert.deepEqual(chipBetLadder(50_000), [1000, 2000, 5000, 10000, 20000, 50000], '5万所持のはしごが想定と違う');
        for (const list of [small, big]) {
            assert.ok(list.length > 0, '選択肢が空');
            assert.ok(list.length <= 12, `選択肢が多すぎる: ${list.length}`);
            for (const v of list)
                assert.ok(v >= SLOT_CHIP_MIN_BET, '下限を割る選択肢が出ている');
            for (let i = 1; i < list.length; i++)
                assert.ok(list[i] > list[i - 1], '昇順になっていない');
        }
        // 所持を超える選択肢は出さない
        assert.ok(small[small.length - 1] <= 2_000_000, '所持を超える選択肢が出ている');
        assert.ok(big[big.length - 1] <= 1_300_000_000_000_000, '所持を超える選択肢が出ている');
    });
    test('所持が下限に満たなければ選択肢は空（回せないことが分かる）', () => {
        assert.deepEqual(chipBetLadder(SLOT_CHIP_MIN_BET - 1), [], '回せないのに選択肢が出ている');
    });
    test('チップが足りなければ回せない（残高も動かない）', () => {
        const { s, e } = setup(); // チップ 0
        const r = e.spinSlot('u1', 100_000);
        assert.equal(r.ok, false);
        assert.equal(s.balance('u1', 'chips'), 0, '失敗したのに残高が動いた');
    });
    test('賭け金は自由額（不正な値だけ拒否される）', () => {
        const { s, e } = slotSetup();
        s.post('u1', 'chips', 50_000_000, 'adjustment'); // 連続で回すので多めに用意する
        // 0以下・小数・数値でないものは拒否
        const before = s.balance('u1', 'chips');
        for (const bad of [0, -5, 1.5, NaN, Infinity, 999]) { // 999 は下限(1,000)未満
            assert.equal(e.spinSlot('u1', bad).ok, false, `${bad} が通ってしまった`);
        }
        assert.equal(s.balance('u1', 'chips'), before, '拒否されたのに残高が減っている');
        // 単位に縛られない任意の整数が通る
        for (const good of [1_000, 1_234, 987_654]) {
            assert.equal(e.spinSlot('u1', good).ok, true, `${good} が弾かれた`);
        }
    });
    test('残高を超える賭け金は拒否される（残高も動かない）', () => {
        const { s, e } = slotSetup(); // ゴールド 1000
        const before = s.balance('u1', 'gold');
        const r = e.spinSlot('u1', before + 1);
        assert.equal(r.ok, false, '残高超えで回せてしまう');
        assert.equal(s.balance('u1', 'gold'), before, '失敗したのに残高が動いた');
    });
    test('チップも自由額で賭けられる（下限以上なら単位は自由）', () => {
        const { s, e } = setup();
        s.post('u1', 'chips', 10_000_000, 'adjustment');
        for (const good of [1_000, 1_234, 987_654]) {
            const r = e.spinSlot('u1', good, undefined);
            assert.equal(r.ok, true, `${good} が弾かれた: ${r.error}`);
            assert.equal(r.bet, good, '賭け金が丸められている');
        }
    });
    test('回数制限は無効化されている（旧上限を超えて回せる）', () => {
        // 第84弾: オーナー指示で1日の回数制限を撤廃(実際に回すとチップが減る体感のため)。
        // 旧上限(300回)を超えても回せることを、上限+5回で確かめる
        const { s, e } = setup();
        s.post('u1', 'chips', 10_000_000_000, 'adjustment');
        for (let i = 0; i < SLOT_CHIP_DAILY_SPINS + 5; i++) {
            const r = e.spinSlot('u1', SLOT_CHIP_MIN_BET);
            assert.equal(r.ok, true, `${i + 1} 回目が失敗: ${r.error}`);
        }
        assert.equal(s.audit().ok, true, '台帳が壊れた');
    });
    test('倍率は VIP ランクと連続ログインで上がる（要件の中核）', () => {
        const base = slotMultiplier(0, 0);
        assert.equal(base, 1, 'ブロンズ・連続0日の倍率が 1 でない');
        assert.ok(slotMultiplier(VIP_TIERS[VIP_TIERS.length - 1].minPoints, 0) > base, 'VIP で倍率が上がらない');
        assert.ok(slotMultiplier(0, 14) > base, '連続ログインで倍率が上がらない');
        // 両方効くと更に上がる
        const both = slotMultiplier(VIP_TIERS[VIP_TIERS.length - 1].minPoints, 14);
        assert.ok(both > slotMultiplier(0, 14) && both > slotMultiplier(VIP_TIERS[VIP_TIERS.length - 1].minPoints, 0));
    });
    test('連続ログインの倍率は青天井にならない', () => {
        assert.equal(slotMultiplier(0, 14), slotMultiplier(0, 9999), '連続日数の上限が効いていない');
    });
    test('状態表示に賭け金の候補と残り回数が出る', () => {
        const { s, e } = slotSetup();
        const v = e.slotState('u1');
        assert.ok(v.chipBets.length > 0, '賭け金の候補が空');
        // 第84弾: 無制限。表示を壊さない巨大値が入っていること
        assert.ok(v.chipSpinsLeft >= SLOT_CHIP_DAILY_SPINS, '残り回数が小さすぎる(制限が残っている疑い)');
        assert.equal(v.lines, 25, 'ライン数が出ていない');
        assert.ok(v.chips > 0, 'チップ残高が出ていない');
    });
    test('台帳の1回上限(2^53)を超える大当たりでも支払いが失敗しない（分割記帳）', () => {
        // 500Bベット×24万倍のような支払いは1回のpostでは例外になる。分割して全額届くこと
        const { s, e } = slotSetup();
        // 残高を9000兆×2に育てる(1回のpost上限があるので2回に分ける)
        s.post('u1', 'chips', SAFE_POST, 'adjustment');
        s.post('u1', 'chips', SAFE_POST, 'adjustment');
        const before = s.balance('u1', 'chips');
        // alwaysFirst は全マスWILDになる極端な乱数 → 25ライン全部が成立して数百倍になる。
        // 賭け金は上限(50兆)いっぱいで回す。数百倍が乗れば台帳の1回上限(9000兆)を軽く超える
        const bet = SLOT_CHIP_MAX_BET;
        const r = e.spinSlot('u1', bet, alwaysFirst);
        assert.equal(r.ok, true, r.error);
        assert.ok(r.won > SAFE_POST, `検体として不足: 支払い ${r.won} が1回上限より小さい`);
        assert.equal(s.balance('u1', 'chips'), before - bet + r.won, '分割記帳で金額がずれた');
        assert.equal(s.audit().ok, true, '台帳が壊れた');
    });
    test('賭け金は50兆で頭打ちになる（例外でスピンが壊れない）', () => {
        // 第88弾(オーナー指定): 50兆より上は所持の桁が増えるだけで体験が変わらないため刻まない。
        // 台帳の1回上限(2^53)より十分小さいので、賭け金の控除が例外になることも無い。
        const { s, e } = slotSetup();
        s.post('u1', 'chips', SAFE_POST, 'adjustment');
        s.post('u1', 'chips', SAFE_POST, 'adjustment');
        // 上限ちょうどは通る
        assert.equal(e.spinSlot('u1', SLOT_CHIP_MAX_BET, alwaysFirst).ok, true, '上限ちょうどが弾かれた');
        // 上限を超える賭け金は、例外ではなく「エラーの返事」で断られる
        const before = s.balance('u1', 'chips');
        const r = e.spinSlot('u1', SLOT_CHIP_MAX_BET + 1, alwaysFirst);
        assert.equal(r.ok, false, '上限超えの賭け金が通ってしまった');
        assert.equal(s.balance('u1', 'chips'), before, '拒否されたのに残高が動いた');
        // 選択肢のはしごも上限を超える段を出さない(所持がいくらあっても)
        const ladder = chipBetLadder(s.balance('u1', 'chips'));
        for (const v of ladder)
            assert.ok(v <= SLOT_CHIP_MAX_BET, `はしごに上限超えの段がある: ${v}`);
        assert.equal(ladder[ladder.length - 1], SLOT_CHIP_MAX_BET, '最大の段が50兆になっていない');
    });
    test('発行量の歯止めは「1日の回転数上限」である（高RTPでも台帳は壊れない）', () => {
        // RTP>100% を許容したので、経済の歯止めは SLOT_CHIP_DAILY_SPINS だけになる。
        // 大当たりを含む多数スピンでも台帳の整合が保たれることを確認する
        const { s, e } = slotSetup();
        s.post('u1', 'chips', 100_000_000, 'adjustment');
        const rnd = (() => { let x = 424242 >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; })();
        for (let i = 0; i < 60; i++) {
            const r = e.spinSlot('u1', 10_000, rnd);
            assert.equal(r.ok, true, r.error);
        }
        assert.equal(s.audit().ok, true, '台帳が壊れた');
    });
});
// ---------------------------------------------------------------------------
// 広告(第66弾の土台): クライアントは「見終わった」と伝えるだけで、報酬額はサーバーが決める
describe('広告', () => {
    const adSetup = () => setup();
    test('見るたびにチップがもらえ、1日の上限で止まる', () => {
        const { s, e } = adSetup();
        s.post('u1', 'chips', 1_000_000, 'adjustment');
        let got = 0;
        for (let i = 0; i < AD_DAILY_LIMIT; i++) {
            const r = e.grantAdReward('u1');
            assert.equal(r.ok, true, `${i + 1} 回目が失敗: ${r.error}`);
            got += r.reward;
        }
        assert.ok(got > 0, 'チップがもらえていない');
        const over = e.grantAdReward('u1');
        assert.equal(over.ok, false, '上限を超えて見られてしまう');
        assert.equal(s.audit().ok, true, '台帳が壊れた');
    });
    test('報酬は下限と上限の間に収まる（蛇口を壊さない）', () => {
        const poor = adSetup();
        const rich = adSetup();
        rich.s.post('u1', 'chips', 100_000_000_000_000, 'adjustment');
        const a = poor.e.grantAdReward('u1');
        const b = rich.e.grantAdReward('u1');
        assert.equal(a.reward, AD_REWARD_FLOOR, '無一文でも下限はもらえるはず');
        assert.equal(b.reward, AD_REWARD_CAP, '大金持ちでも上限で頭打ちのはず');
    });
    test('広告除去を買うと状態に反映される', () => {
        const { e } = adSetup();
        assert.equal(e.adState('u1').removed, false, '最初から消えている');
        e.enableAdRemoval('u1');
        assert.equal(e.adState('u1').removed, true, '購入しても反映されない');
    });
    test('状態に残り回数と次の報酬額が出る', () => {
        const { s, e } = adSetup();
        s.post('u1', 'chips', 1_000_000, 'adjustment');
        const before = e.adState('u1');
        assert.equal(before.left, AD_DAILY_LIMIT);
        assert.ok(before.reward > 0, '次の報酬額が出ていない');
        e.grantAdReward('u1');
        assert.equal(e.adState('u1').left, AD_DAILY_LIMIT - 1, '残り回数が減っていない');
    });
});
//# sourceMappingURL=economy.test.js.map