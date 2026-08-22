import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, SqliteStore } from '../src/server/store.js';
import { Economy, CHIP_PACKS, GOLD_PACKS, VIP_TIERS, PASS_TIERS, PASS_PREMIUM_SKU, DAILY_MISSIONS, tierOf, nextTier, dailyBonusBase, DAILY_KNEE, DAILY_RATE, DAILY_BASE_CAP, DAILY_FLOOR, slotMultiplier, } from '../src/server/economy.js';
import { SLOT_CHIP_MIN_BET, chipBetLadder } from '../src/server/economy.js';
import { PAY_SYMBOLS, spin as spinReels, MAX_WIN_X, FREE_MODES, PAYLINES, LINES } from '../src/server/slot.js';
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
        // 全マス同じ絵柄になる極端な乱数なので、上限(MAX WIN)まで伸びる
        assert.equal(r.kind, 'max');
        assert.ok(r.won > 0, '揃っているのに払い出しが無い');
        assert.ok(r.won >= 0, 'チップの払い出しが負');
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
    test('タンブルは連鎖するほど倍率が上がる', () => {
        // 連鎖が2回以上あるスピンを探して、倍率が単調非減少であることを見る
        for (let seed = 1; seed < 400; seed++) {
            const r = spinReels(seeded(seed), { mode: 'many' });
            if (r.base.length < 2)
                continue;
            for (let i = 1; i < r.base.length; i++) {
                assert.ok(r.base[i].mult >= r.base[i - 1].mult, '連鎖で倍率が下がっている');
            }
            return;
        }
        assert.fail('連鎖するスピンが見つからない（重みが壊れている可能性）');
    });
    test('フリーゲームの倍率はスピンをまたいで積み上がる（永続マルチプライヤー）', () => {
        const r = spinReels(seeded(675), { mode: 'many' });
        assert.equal(r.freeEntered, true, 'この種ではフリーゲームに入るはず');
        const free = r.free;
        assert.ok(free.spins.length >= 10, `回転数が少なすぎる: ${free.spins.length}`);
        let prev = 0;
        for (const sp of free.spins) {
            assert.ok(sp.multAfter >= prev, 'フリーゲーム中に倍率が下がった（持ち越せていない）');
            prev = sp.multAfter;
        }
        assert.ok(free.finalMult > FREE_MODES[0].startMult, '倍率が最後まで伸びていない');
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
    test('配当は上限(MAX WIN)を超えない', () => {
        for (let seed = 1; seed < 300; seed++) {
            const r = spinReels(seeded(seed), { mode: 'many' });
            assert.ok(r.totalPayX <= MAX_WIN_X, `上限を超えた: ${r.totalPayX}`);
        }
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
    // --- 第59弾: チップ建て -------------------------------------------------
    // チップ→チップは閉じたループなので、払い出し倍率を掛けると RTP が 100% を超えて
    // 無限にチップを増やせる。ここは経済の生命線なのでテストで固定する。
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
    test('チップ建ては長い目で見ると減る（シンクとして機能する）', () => {
        // 1回の試行では分散が大きすぎて偶然プラスになるので、期待値そのものを見る。
        // 抽選エンジンを固定シードで多数回まわし、賭け金1に対する平均払い出しが 1 未満であることを確認する。
        const rnd = (() => { let x = 20260822 >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; })();
        let sum = 0;
        const N = 30_000;
        for (let i = 0; i < N; i++)
            sum += spinReels(rnd, { mode: 'many' }).totalPayX;
        const rtp = sum / N;
        assert.ok(rtp < 1, `チップ建てのRTPが 100% 以上（増殖する）: ${(rtp * 100).toFixed(1)}%`);
        assert.ok(rtp > 0.85, `RTPが低すぎる（シンクが厳しすぎる）: ${(rtp * 100).toFixed(1)}%`);
    });
    test('チップ建ての賭け金は下限を下回れない', () => {
        const { s, e } = setup();
        s.post('u1', 'chips', 10_000_000, 'adjustment');
        const r = e.spinSlot('u1', SLOT_CHIP_MIN_BET - 1, undefined);
        assert.equal(r.ok, false, '下限未満で回せてしまう');
        assert.equal(s.balance('u1', 'chips'), 10_000_000, '失敗したのに残高が動いた');
    });
    test('賭け金の選択肢は所持チップに合わせて刻みが変わる', () => {
        const small = chipBetLadder(2_000_000);
        const big = chipBetLadder(1_300_000_000_000_000);
        assert.ok(big[0] > small[0], '残高が増えても刻みが上がらない');
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
    test('1 日の回数上限を超えて回せない', () => {
        const { s, e } = setup();
        s.post('u1', 'chips', 10_000_000_000, 'adjustment');
        for (let i = 0; i < SLOT_CHIP_DAILY_SPINS; i++) {
            assert.equal(e.spinSlot('u1', SLOT_CHIP_MIN_BET).ok, true, `${i + 1} 回目が失敗`);
        }
        const over = e.spinSlot('u1', SLOT_CHIP_MIN_BET);
        assert.equal(over.ok, false, '上限を超えて回せてしまう');
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
        assert.equal(v.chipSpinsLeft, SLOT_CHIP_DAILY_SPINS, '残り回数が出ていない');
        assert.equal(v.lines, 25, 'ライン数が出ていない');
        assert.ok(v.chips > 0, 'チップ残高が出ていない');
    });
    test('長期の払い出しが設計値に収まる（チップの過剰発行を防ぐ）', () => {
        // チップ建ては閉じたループなので、長期では必ず減る(RTP<100%)。
        // 分散が大きいので抽選エンジンの期待値そのものを見る。
        const rnd = (() => { let x = 20260822 >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; })();
        let sum = 0;
        const N = 30_000;
        for (let i = 0; i < N; i++)
            sum += spinReels(rnd, { mode: 'many' }).totalPayX;
        const rtp = sum / N;
        assert.ok(rtp < 1, `RTPが100%以上（増殖する）: ${(rtp * 100).toFixed(1)}%`);
        assert.ok(rtp > 0.85, `RTPが低すぎる: ${(rtp * 100).toFixed(1)}%`);
    });
});
// ---------------------------------------------------------------------------
// 広告(第66弾の土台)
//
// 報酬額は必ずサーバーが決める。クライアントに金額を持たせると要求し放題になる。
// 回数上限と上限額を守らせるのがここの役目。
// ---------------------------------------------------------------------------
describe('広告', () => {
    const adSetup = () => {
        const s = new MemoryStore();
        const e = new Economy(s, () => Date.parse('2026-08-22T09:00:00Z'));
        s.createUser('u1', 'A');
        return { s, e };
    };
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