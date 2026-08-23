/**
 * 経済システム：ショップ、VIP、チャレンジパス、ミッション、デイリーボーナス
 *
 * 数値はすべて `../../poker_game_design_spec.md` の設計値に対応しています。
 * ここを読むだけで「いくら払うと何がもらえるか」が一望できるようにしてあります。
 * 経済の数値がコードのあちこちに散ると、バランス調整のたびに事故が起きるためです。
 *
 * 決済はモックです。実装してあるのは「レシートを検証し、二重付与を防ぎ、台帳に記録する」
 * という骨格だけで、Apple / Google のサーバー検証に差し替えられる形にしてあります。
 * クライアントの申告だけで付与する実装は、改造クライアントで無限にチップが増えます。
 */
import { spin as spinReels, PAY_SYMBOLS, SLOT_CFG, FREE_MODES, MAX_WIN_X, TUMBLE_LADDER, SCATTER_PAY, REELS, ROWS, LINES, PAYLINES, } from './slot.js';
/** 恒常チップパック。単価差は最大 4.8 倍に抑えている（Zynga の約 10 倍は初回転換率を下げる） */
export const CHIP_PACKS = [
    { sku: 'chips_160', name: 'スターター', priceJpy: 160, chips: 15_000_000, vipPoints: 160, kind: 'chips' },
    { sku: 'chips_480', name: 'スモール', priceJpy: 480, chips: 60_000_000, vipPoints: 480, kind: 'chips' },
    { sku: 'chips_1200', name: 'ミディアム', priceJpy: 1_200, chips: 210_000_000, vipPoints: 1_200, kind: 'chips' },
    { sku: 'chips_3000', name: 'ラージ', priceJpy: 3_000, chips: 690_000_000, vipPoints: 3_000, kind: 'chips' },
    { sku: 'chips_6000', name: 'ケース', priceJpy: 6_000, chips: 1_800_000_000, vipPoints: 6_000, kind: 'chips' },
    { sku: 'chips_12000', name: 'ビッグケース', priceJpy: 12_000, chips: 4_560_000_000, vipPoints: 12_000, kind: 'chips' },
    { sku: 'chips_30000', name: 'ボールト', priceJpy: 30_000, chips: 13_500_000_000, vipPoints: 30_000, kind: 'chips' },
];
/**
 * 機能を売る商品(第66弾)。
 * ゴールドは廃止し **チップに一本化** したので、旧ゴールドパックの枠を
 * 「広告を消す」などの機能商品に置き換えた。チップの量では差がつかない価値を売る。
 */
export const FEATURE_SKUS = [
    { sku: 'noads_forever', name: '広告を完全に消す', priceJpy: 980, vipPoints: 980, kind: 'feature' },
];
/** 旧名の互換(参照が残っていても落ちないように) */
export const GOLD_PACKS = FEATURE_SKUS;
const OFFER_DEFS = {
    first_time: { name: '初回限定パック', priceJpy: 160, multiplier: 6.0, reason: 'はじめての方だけ・一度きり' },
    bust_rescue: { name: '再挑戦パック', priceJpy: 480, multiplier: 3.0, reason: 'チップが尽きた方へ・24時間に1回' },
    piggy_bank: { name: '貯金箱', priceJpy: 480, multiplier: 1.0, reason: 'プレイで貯まったチップを回収' },
    weekend_flash: { name: '週末フラッシュ', priceJpy: 1_200, multiplier: 2.0, reason: '金〜日曜限定' },
    vip_only: { name: 'VIP 限定パック', priceJpy: 6_000, multiplier: 2.5, reason: 'Gold ティア以上の方へ' },
};
/** 恒常パックの単価（1円あたりチップ）を基準に、オファーの付与量を決める */
function baseRateFor(priceJpy) {
    let best = CHIP_PACKS[0];
    for (const p of CHIP_PACKS)
        if (p.priceJpy <= priceJpy)
            best = p;
    return best.chips / best.priceJpy;
}
/**
 * Zynga の実測ティアをそのまま使うと Black 到達に約 2.5 億円かかる。
 * 到達不可能なティアは動機付けにならないので、仕様書のとおり 1/100 に圧縮した
 * （¥1 = 1pt、Silver 到達が ¥2,000）。
 */
export const VIP_TIERS = [
    { key: 'bronze', name: 'ブロンズ', minPoints: 0, purchaseBonus: 0, dailyMultiplier: 1.0, perks: [] },
    { key: 'silver', name: 'シルバー', minPoints: 2_000, purchaseBonus: 0.03, dailyMultiplier: 1.2, perks: ['購入 +3%'] },
    { key: 'gold', name: 'ゴールド', minPoints: 10_000, purchaseBonus: 0.06, dailyMultiplier: 1.5, perks: ['購入 +6%', '専用フレーム', 'VIP限定オファー'] },
    { key: 'platinum', name: 'プラチナ', minPoints: 50_000, purchaseBonus: 0.1, dailyMultiplier: 2.0, perks: ['購入 +10%', '専用卓', '優先サポート'] },
    { key: 'ruby', name: 'ルビー', minPoints: 250_000, purchaseBonus: 0.15, dailyMultiplier: 2.5, perks: ['購入 +15%', '招待制トーナメント'] },
    { key: 'diamond', name: 'ダイヤモンド', minPoints: 750_000, purchaseBonus: 0.2, dailyMultiplier: 3.0, perks: ['購入 +20%', '専任担当'] },
    { key: 'black', name: 'ブラック', minPoints: 2_500_000, purchaseBonus: 0.25, dailyMultiplier: 3.5, perks: ['購入 +25%', '最上位特典'] },
];
export function tierOf(points) {
    let t = VIP_TIERS[0];
    for (const v of VIP_TIERS)
        if (points >= v.minPoints)
            t = v;
    return t;
}
export function nextTier(points) {
    for (const v of VIP_TIERS)
        if (points < v.minPoints)
            return v;
    return null;
}
// ---------------------------------------------------------------------------
// デイリーボーナスの額
// ---------------------------------------------------------------------------
/** これ以下の残高までは素直に DAILY_RATE を掛ける(初中級者の体感を落とさない) */
export const DAILY_KNEE = 2_000_000;
/** 少額帯の支給率 */
export const DAILY_RATE = 0.03;
/** どれだけ持っていても、倍率を掛ける前の基礎額はここで頭打ち */
export const DAILY_BASE_CAP = 1_000_000;
/** 無一文でも最低これだけは配る(復帰支援) */
export const DAILY_FLOOR = 5_000;
/**
 * 所持チップから、デイリーボーナスの基礎額を求める(倍率を掛ける前の値)。
 *
 * DAILY_KNEE までは線形、その先は平方根で逓減させ、最後に絶対上限で止める。
 * 平方根にするのは、残高が 100 倍になっても基礎額は 10 倍にしかならないため
 * 「持っている人ほど得をする」度合いを大きく削れるから。
 * 継ぎ目(chips = DAILY_KNEE)で値が飛ばないよう連続になっている。
 */
export function dailyBonusBase(chips) {
    const c = Math.max(0, chips);
    const linear = c * DAILY_RATE;
    const raw = c <= DAILY_KNEE ? linear : DAILY_KNEE * DAILY_RATE * Math.sqrt(c / DAILY_KNEE);
    return Math.round(Math.min(DAILY_BASE_CAP, Math.max(DAILY_FLOOR, raw)));
}
// ---------------------------------------------------------------------------
// デイリーミッション（仕様書 4.6 のソース）
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ゴールドスロット
//
// ゴールドはこれまで「貯まるだけで使い道がない」通貨だった。
// ゴールドを賭けてチップを狙うスロットを唯一の消費先にし、
// 「VIPランク」と「連続ログイン日数」で払い出し倍率が上がるようにして、
// 課金と継続の両方に報いる。
// ---------------------------------------------------------------------------
/** リールの絵柄。weight が大きいほど出やすい */
/** 賭けられるゴールドの単位 */
export const SLOT_BETS = [1, 5, 10, 50];
/**
 * 賭け1ゴールドあたりの基準チップ。
 * 第58弾で抽選が 243ways+タンブル+フリーゲームに変わりRTPが 0.70→0.96(×賭け金)に上がったため、
 * **1ゴールドあたりの期待払い出しを従来と同じ 14,076 チップに保つ** よう換算レートを下げてある
 * (0.9505 × 14,809 ≒ 14,076)。ここを触ると経済の蛇口が動くので必ず sim-slot.mjs で確認すること。
 */
export const SLOT_CHIPS_PER_GOLD = 14_809;
/** 1日に回せる上限(ゴールド量ではなく回数。無限回しの防止) */
export const SLOT_DAILY_SPINS = 100;
/**
 * 広告まわりの設定(第66弾)。
 * 報酬は「所持チップの率 + 下限 + 上限」で出す。率だけだとハイローラーに配りすぎ、
 * 定額だけだと初心者に価値が無いため。上限を置いてチップの蛇口を壊さないようにする。
 */
export const AD_DAILY_LIMIT = 5;
export const AD_REWARD_RATE = 0.01;
export const AD_REWARD_FLOOR = 20_000;
export const AD_REWARD_CAP = 2_000_000;
/**
 * チップ建てスロットの設定(第59弾)。
 *
 * **重要**: ゴールド建ては「ゴールドを払ってチップをもらう蛇口」なので VIP/連続ログインの
 * 払い出し倍率(最大約1.87倍)を掛けても破綻しない。一方チップ建ては **チップを払って
 * チップをもらう閉じたループ** なので、倍率を掛けると RTP が 96% × 1.87 = 179% となり
 * **無限にチップを増やせてしまう**。よってチップ建てでは倍率を掛けない(RTP 96% 固定 =
 * 4% がシンク)。倍率はゴールド建て専用として残す。
 */
export const SLOT_CHIP_MIN_BET = 1_000;
/** チップ建ての1日の上限。蛇口ではないので緩めでよいが、暴走時の被害を抑える安全弁として置く */
export const SLOT_CHIP_DAILY_SPINS = 300;
/**
 * 賭け金の選択肢(第61弾)。
 *
 * オンラインスロットは「自由入力」ではなく **ゲーム側が用意した選択肢から選ぶ** のが主流。
 * ただし所持が兆まで伸びる経済なので、固定の一覧だと上位帯で意味がなくなる。
 * そこで **1-2-5-10 の刻みを、所持額に合わせて上下にスライドさせる**。
 *   - 下限は SLOT_CHIP_MIN_BET
 *   - 上限は所持額(それ以上は賭けられないので出さない)
 *   - 出す段数は最大 12。多すぎると選べないので、所持に近い側を残す
 */
/**
 * 台帳が1回の取引で受け付けられる上限(第82弾)。
 * store.post は Number.isSafeInteger を要求するので 2^53≒9007兆 が物理限界。
 * 少し余裕を持って 9000兆 とする。これを超える支払いは postBig で分割する。
 */
export const SAFE_POST = 9_000_000_000_000_000;
export function chipBetLadder(balance) {
    const bal = Math.max(0, Math.floor(balance));
    if (bal < SLOT_CHIP_MIN_BET)
        return [];
    const out = [];
    // 1-2-5 × 10^k を小さい方から並べ、所持額を超えたら打ち切る
    for (let k = 0; k < 20 && out.length < 60; k++) {
        for (const m of [1, 2, 5]) {
            const v = m * Math.pow(10, k);
            if (v < SLOT_CHIP_MIN_BET)
                continue;
            // 台帳の1回上限も超えない(超える賭け金は控除の時点で例外になる)
            if (v > bal || v > SAFE_POST) {
                k = 99;
                break;
            }
            out.push(v);
        }
    }
    if (!out.length)
        return [];
    // 段数が多すぎるときは「所持に近い側」を12段だけ残す(小さすぎる額は選ぶ意味が薄い)
    const MAX_STEPS = 12;
    return out.length <= MAX_STEPS ? out : out.slice(out.length - MAX_STEPS);
}
/** ゴールド建ての選択肢。所持に合わせて同じ考え方で刻む(下限1) */
export function goldBetLadder(balance) {
    const bal = Math.max(0, Math.floor(balance));
    const out = [];
    for (let k = 0; k < 12 && out.length < 40; k++) {
        for (const m of [1, 2, 5]) {
            const v = m * Math.pow(10, k);
            if (v > bal) {
                k = 99;
                break;
            }
            out.push(v);
        }
    }
    return out.length <= 10 ? out : out.slice(out.length - 10);
}
/**
 * 払い出し倍率。VIPランクと連続ログイン日数で上がる(ユーザー要望の中核)。
 *   VIP: ブロンズ1.0 → 最上位で +0.5 程度
 *   連続ログイン: 1日ごと +4%、14日で頭打ち(+56%)
 * 上限を設けているのは、倍率が青天井だと期待値がプラスに振れて無限にチップを産めるため。
 */
export function slotMultiplier(vipPoints, loginStreak) {
    const tier = tierOf(vipPoints);
    // dailyMultiplier(1.0〜3.5)をそのまま使うと効きすぎるので、平方根で圧縮して 1.0〜1.87 に収める
    const vipPart = Math.sqrt(tier.dailyMultiplier);
    const streakPart = 1 + Math.min(Math.max(0, loginStreak), 14) * 0.04;
    return Math.round(vipPart * streakPart * 100) / 100;
}
/**
 * デイリーミッション。合計 60XP/日（28日で 1,680XP）になるよう配分してある。
 *
 * 意図的に採用していない条件（調査資料 §7 の「避けるべきミッション」）:
 *   オールイン回数 / ベット総額 / 勝利チップ額 / 高レート強制 / 特定役の完成 /
 *   連敗後の勝利 / ブラフ成功 / フレンドへのチップ送付 / 課金
 * これらは不合理なプレイや過度なリスク、チップの付け替えを誘発し、
 * 資金量の多い人ほど有利になってポーカーの戦略自体を壊すため。
 * 逆に「フォールドを無効扱いにする」条件も置かない（正しいフォールドは戦略の一部）。
 */
export const DAILY_MISSIONS = [
    { id: 'play_hands', name: 'ハンドを 20 回プレイする', target: 20, rewardChips: 8_000, rewardXp: 15 },
    { id: 'win_hands', name: 'ハンドに 5 回勝つ', target: 5, rewardChips: 10_000, rewardXp: 15 },
    { id: 'showdown_win', name: 'ショーダウンで 2 回勝つ', target: 2, rewardChips: 12_000, rewardXp: 15 },
    { id: 'play_tournament', name: 'トーナメントに 1 回参加する', target: 1, rewardChips: 15_000, rewardXp: 15 },
];
/**
 * ウィークリーミッション。1 週あたり 500XP（4 週で 2,000XP）。
 * デイリーより長い時間軸の目標を置くことで、毎日ログインできない人でも積み上がるようにする。
 */
export const WEEKLY_MISSIONS = [
    { id: 'w_hands', name: '週に 150 ハンドプレイする', target: 150, rewardChips: 120_000, rewardXp: 200 },
    { id: 'w_showdown', name: '週にショーダウンで 20 回勝つ', target: 20, rewardChips: 150_000, rewardXp: 180 },
    { id: 'w_tournament', name: '週にトーナメントへ 3 回参加する', target: 3, rewardChips: 180_000, rewardXp: 120 },
];
/**
 * シーズンミッション（28日通しの長期目標）。合計 800XP。
 * デイリー1,680 + ウィークリー2,000 + シーズン800 = 4,480、
 * これに最終週のキャッチアップ増分（約320）を足して、獲得可能 約4,800XP になる。
 * 完走に必要なのは 4,000 なので、4〜5日遊べない日があっても完走できる。
 */
export const SEASON_MISSIONS = [
    { id: 's_hands', name: 'シーズン中に 1,000 ハンドプレイする', target: 1_000, rewardChips: 400_000, rewardXp: 300 },
    { id: 's_showdown', name: 'シーズン中にショーダウンで 100 回勝つ', target: 100, rewardChips: 300_000, rewardXp: 250 },
    { id: 's_tournament', name: 'シーズン中にトーナメントへ 10 回参加する', target: 10, rewardChips: 350_000, rewardXp: 250 },
];
/** 未消化のデイリーを保持する日数。毎日ログインできなくても追いつけるようにする */
export const MISSION_CARRY_DAYS = 7;
export const PASS_PREMIUM_SKU = {
    sku: 'pass_premium',
    name: 'プレミアムパス',
    priceJpy: 980,
    vipPoints: 980,
    kind: 'pass',
    note: '購入時点までのプレミアム報酬をさかのぼって受け取れます',
};
// --- シーズンの寸法（調査資料の推奨設計に合わせた） ---
/** シーズンの長さ。短すぎず長すぎない 28 日（Zynga と同じ） */
export const PASS_SEASON_DAYS = 28;
/** 段階数 */
export const PASS_TIER_COUNT = 40;
/** 1 段階に必要な経験値 */
export const PASS_XP_PER_TIER = 100;
/** 完走に必要な経験値 */
export const PASS_COMPLETE_XP = PASS_TIER_COUNT * PASS_XP_PER_TIER; // 4,000
/**
 * シーズン中に獲得しうる経験値の目安。完走に必要な 4,000 より多めにして、
 * 4〜5 日遊べない日があっても完走できるようにする（必要消化率 約83%）。
 */
export const PASS_OBTAINABLE_XP = 4_800;
/** 完走後の周回報酬: この経験値ごとに 1 箱 */
export const PASS_BONUS_BOX_XP = 200;
/** 周回報酬の上限。チップのインフレを防ぐため頭打ちにする */
export const PASS_BONUS_BOX_MAX = 5;
/** 周回報酬 1 箱の中身 */
export const PASS_BONUS_BOX_CHIPS = 120_000;
/** シーズンの起点。ここから 28 日ごとに切り替わる */
const SEASON_ANCHOR = Date.UTC(2026, 0, 5); // 2026-01-05（月曜）
/** 指定時刻が属するシーズン ID */
export function seasonIdAt(now) {
    const n = Math.floor((now - SEASON_ANCHOR) / (PASS_SEASON_DAYS * 86_400_000));
    return `S${Math.max(0, n) + 1}`;
}
/** シーズンの期間・経過日数・残り日数・最終週かどうか */
export function seasonWindowAt(now) {
    const n = Math.max(0, Math.floor((now - SEASON_ANCHOR) / (PASS_SEASON_DAYS * 86_400_000)));
    const startsAt = SEASON_ANCHOR + n * PASS_SEASON_DAYS * 86_400_000;
    const endsAt = startsAt + PASS_SEASON_DAYS * 86_400_000;
    const dayIndex = Math.floor((now - startsAt) / 86_400_000); // 0 起点
    const daysLeft = Math.max(0, PASS_SEASON_DAYS - dayIndex);
    return { id: `S${n + 1}`, startsAt, endsAt, dayIndex, daysLeft, finalWeek: daysLeft <= 7 };
}
/**
 * 40 ティアの報酬表。
 *
 * 調査資料の配分（チップ 40〜45% / 限定コスメ 20〜25% / プレミアム通貨 5〜10%）に寄せてある。
 * 意図的にこうしている点:
 *   - 無料トラックは毎段階ではなく間隔を空ける（序盤だけは短い間隔で手応えを出す）
 *   - プレミアムは原則毎段階に置く（買った瞬間から常に何かが起きる）
 *   - 最終段階の目玉はチップではなく限定コスメ（チップは消えるが、コスメは残り続ける）
 *   - プレミアムのゴールド総量は約 180（パス価格 980 円の 2〜3 割相当）で、
 *     次のシーズンのパス購入やショップに還元できるようにする
 */
export const PASS_TIERS = Array.from({ length: PASS_TIER_COUNT }, (_, i) => {
    const tier = i + 1;
    // 序盤は軽く、後半ほど重く。ただし段階あたり一定（100XP）に保って分かりやすくする
    const xpRequired = tier * PASS_XP_PER_TIER;
    // 無料: 序盤(1〜10)は 2 段階ごと、以降は 3 段階ごと。金額は段階に比例
    const freeHit = tier <= 10 ? tier % 2 === 0 || tier === 1 : tier % 3 === 0;
    const free = freeHit ? { chips: 6_000 * tier } : {};
    if (tier === PASS_TIER_COUNT)
        free.chips = 250_000; // 無料でも完走の達成感は用意する
    // プレミアム: 毎段階チップ。5 の倍数でゴールド、節目でコスメ
    const premium = { chips: 20_000 * tier };
    if (tier % 5 === 0)
        premium.gold = tier === PASS_TIER_COUNT ? 40 : 20;
    return { tier, xpRequired, free, premium };
});
/** 後方互換のための別名。現在は日付から決まるので seasonIdAt を使うこと */
export const PASS_SEASON_ID = 'S1';
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export class Economy {
    store;
    now;
    constructor(store, now = Date.now) {
        this.store = store;
        this.now = now;
    }
    // --- 残高 -----------------------------------------------------------------
    balance(userId, currency) {
        return this.store.balance(userId, currency);
    }
    grant(userId, currency, amount, reason, ref) {
        if (amount === 0)
            return true;
        return this.store.post(userId, currency, amount, reason, ref) !== null;
    }
    // --- 課金 -----------------------------------------------------------------
    allSkus() {
        return [...CHIP_PACKS, ...GOLD_PACKS, PASS_PREMIUM_SKU];
    }
    findSku(sku) {
        return this.allSkus().find((s) => s.sku === sku) ?? this.buildOfferSku(sku);
    }
    buildOfferSku(sku) {
        const kind = Object.keys(OFFER_DEFS).find((k) => `offer_${k}` === sku);
        if (!kind)
            return null;
        const def = OFFER_DEFS[kind];
        return {
            sku,
            name: def.name,
            priceJpy: def.priceJpy,
            chips: Math.round(baseRateFor(def.priceJpy) * def.priceJpy * def.multiplier),
            vipPoints: def.priceJpy,
            kind: 'offer',
            valueMultiplier: def.multiplier,
        };
    }
    /**
     * 購入を処理する（モック決済）。
     *
     * 本番では receipt を Apple / Google のサーバーへ送って検証する。
     * ここで重要なのは「レシートは一度しか使えない」という性質で、
     * それさえ守れば検証部分を差し替えるだけで本番化できる。
     * クライアントの申告だけで付与する実装にすると、改造クライアントで無限に増える。
     */
    purchase(userId, sku, receipt) {
        const item = this.findSku(sku);
        if (!item)
            return { ok: false, error: '商品が見つかりません' };
        if (!receipt || receipt.length < 8)
            return { ok: false, error: 'レシートが不正です' };
        if (this.store.hasReceipt(receipt))
            return { ok: false, error: 'このレシートは既に使用されています' };
        // 貯金箱は特別扱い：溜まっている分を払い出して 0 に戻す
        if (sku === 'offer_piggy_bank')
            return this.claimPiggyBank(userId, receipt);
        const user = this.store.getUser(userId) ?? this.store.createUser(userId, userId);
        const tier = tierOf(user.vipPoints);
        const bonus = 1 + tier.purchaseBonus;
        const chips = item.chips ? Math.round(item.chips * bonus) : 0;
        const gold = item.gold ? Math.round(item.gold * bonus) : 0;
        const before = tierOf(user.vipPoints);
        this.store.updateUser(userId, {
            vipPoints: user.vipPoints + item.vipPoints,
            lifetimeSpend: user.lifetimeSpend + item.priceJpy,
        });
        const after = tierOf(user.vipPoints + item.vipPoints);
        if (chips)
            this.store.post(userId, 'chips', chips, 'purchase', sku);
        if (gold)
            this.store.post(userId, 'gold', gold, 'purchase', sku);
        if (sku === 'noads_forever')
            this.enableAdRemoval(userId);
        if (sku === PASS_PREMIUM_SKU.sku)
            this.store.setProgress(userId, `pass:${this.seasonId()}:premium`, 1);
        this.store.savePurchase({
            userId,
            sku,
            priceJpy: item.priceJpy,
            granted: JSON.stringify({ chips, gold, vipPoints: item.vipPoints }),
            receipt,
        });
        return {
            ok: true,
            granted: {
                chips,
                gold,
                vipPoints: item.vipPoints,
                tierUp: after.key !== before.key ? after : null,
            },
            balanceChips: this.store.balance(userId, 'chips'),
            balanceGold: this.store.balance(userId, 'gold'),
        };
    }
    /** 現在この人に出すべきオファー。条件を満たすものだけを返す */
    offersFor(userId) {
        const user = this.store.getUser(userId);
        if (!user)
            return [];
        const out = [];
        const now = this.now();
        const chips = this.store.balance(userId, 'chips');
        const push = (kind, expiresAt, overrideChips) => {
            const sku = this.buildOfferSku(`offer_${kind}`);
            if (overrideChips !== undefined)
                sku.chips = overrideChips;
            out.push({
                id: kind,
                name: OFFER_DEFS[kind].name,
                description: `${sku.chips?.toLocaleString('ja-JP')} チップ`,
                sku,
                reason: OFFER_DEFS[kind].reason,
                expiresAt,
            });
        };
        // 初回限定：一度も購入していない人だけ
        if (this.store.purchases(userId, 1).length === 0)
            push('first_time', null);
        // 破産レスキュー：最低卓のバイインにも届かない人へ、24 時間に 1 回
        const lastRescue = this.store.getProgress(userId, 'offer:bust_rescue');
        if (chips < 5_000 && (!lastRescue || now - lastRescue.updatedAt > 86_400_000))
            push('bust_rescue', null);
        // 貯金箱：溜まっていれば常時
        if (user.piggyBank > 0)
            push('piggy_bank', null, user.piggyBank);
        // 週末フラッシュ：金土日
        const dow = new Date(now).getDay();
        if (dow === 5 || dow === 6 || dow === 0) {
            const endOfSunday = new Date(now);
            endOfSunday.setDate(endOfSunday.getDate() + ((7 - dow) % 7));
            endOfSunday.setHours(23, 59, 59, 0);
            push('weekend_flash', endOfSunday.getTime());
        }
        // VIP 限定：Gold ティア以上
        if (tierOf(user.vipPoints).minPoints >= 10_000)
            push('vip_only', null);
        return out;
    }
    /**
     * 貯金箱：プレイ量に比例して溜まり、買うと回収できる。
     * 非課金者ほど中身が大きくなるので、初回課金の入口として機能する。
     */
    addToPiggyBank(userId, amount) {
        const u = this.store.getUser(userId);
        if (!u)
            return;
        const cap = 5_000_000;
        this.store.updateUser(userId, { piggyBank: Math.min(cap, u.piggyBank + amount) });
    }
    claimPiggyBank(userId, receipt) {
        const u = this.store.getUser(userId);
        if (!u || u.piggyBank <= 0)
            return { ok: false, error: '貯金箱が空です' };
        const amount = u.piggyBank;
        const price = OFFER_DEFS.piggy_bank.priceJpy;
        this.store.updateUser(userId, { piggyBank: 0, vipPoints: u.vipPoints + price, lifetimeSpend: u.lifetimeSpend + price });
        this.store.post(userId, 'chips', amount, 'piggy_bank', 'offer_piggy_bank');
        this.store.savePurchase({
            userId,
            sku: 'offer_piggy_bank',
            priceJpy: price,
            granted: JSON.stringify({ chips: amount }),
            receipt,
        });
        return {
            ok: true,
            granted: { chips: amount, gold: 0, vipPoints: price, tierUp: null },
            balanceChips: this.store.balance(userId, 'chips'),
            balanceGold: this.store.balance(userId, 'gold'),
        };
    }
    // --- VIP ------------------------------------------------------------------
    vipStatus(userId) {
        const u = this.store.getUser(userId);
        const points = u?.vipPoints ?? 0;
        const cur = tierOf(points);
        const next = nextTier(points);
        return {
            points,
            tier: cur.key,
            tierName: cur.name,
            perks: cur.perks,
            purchaseBonus: cur.purchaseBonus,
            dailyMultiplier: cur.dailyMultiplier,
            nextTierName: next?.name ?? null,
            pointsToNext: next ? next.minPoints - points : null,
        };
    }
    /**
     * プレイでも VIP ポイントが少し貯まるようにする。
     * 購入だけで決まると、非課金者にとってティアが完全に飾りになる。
     * レートは「レーキ 1,000 チップにつき 1 ポイント」＝ 実質プレイ時間への報酬。
     */
    addPlayVipPoints(userId, rakeContributed) {
        const pts = Math.floor(rakeContributed / 1000);
        if (pts <= 0)
            return;
        const u = this.store.getUser(userId);
        if (!u)
            return;
        this.store.updateUser(userId, { vipPoints: u.vipPoints + pts });
    }
    // --- デイリーボーナス -------------------------------------------------------
    /**
     * ログインボーナス。
     * 「残高が少ない人ほど相対的に多くもらえる」設計にして、
     * 破産からの復帰を助けつつ、上位者のインフレを抑える。
     *
     * 以前は所持チップの 3% を上限なしで配っていたため、ハイローラーほど桁違いに増えた
     * (10億チップ×最上位ティアで 1 日 2 億超)。復帰支援という目的から外れ、
     * 高額卓の経済も壊すので、下記の3段構えに変えた:
     *   1. 少額帯はこれまで通り 3%(体感を落とさない)
     *   2. 一定額(DAILY_KNEE)から上は平方根で逓減させる
     *   3. さらに絶対上限(DAILY_BASE_CAP)で頭を打たせる
     * 連続ログインと VIP の倍率はそのまま掛かるので、課金・継続の価値は保つ。
     */
    claimDailyBonus(userId) {
        const u = this.store.getUser(userId);
        if (!u)
            return { ok: false, error: 'ユーザーが見つかりません' };
        const day = today(this.now());
        if (u.lastDailyBonus === day)
            return { ok: false, error: '本日分は受け取り済みです' };
        const yesterday = today(this.now() - 86_400_000);
        const streak = u.lastDailyBonus === yesterday ? u.loginStreak + 1 : 1;
        const tier = tierOf(u.vipPoints);
        const streakBonus = 1 + Math.min(streak, 7) * 0.15;
        const amount = Math.round(dailyBonusBase(u.chips) * streakBonus * tier.dailyMultiplier);
        this.store.updateUser(userId, { lastDailyBonus: day, loginStreak: streak });
        this.store.post(userId, 'chips', amount, 'daily_bonus', `day:${day}`);
        return { ok: true, amount, streak };
    }
    dailyBonusAvailable(userId) {
        const u = this.store.getUser(userId);
        return !!u && u.lastDailyBonus !== today(this.now());
    }
    // --- ミッション -------------------------------------------------------------
    /** 現在のシーズン ID（日付から決まる。28日ごとに切り替わる） */
    seasonId() {
        return seasonIdAt(this.now());
    }
    /** 現在のシーズンの期間情報 */
    season() {
        return seasonWindowAt(this.now());
    }
    /** その週のキー（ウィークリーミッションのリセット単位。シーズン内の第何週か） */
    weekKey() {
        const w = this.season();
        return `${w.id}w${Math.floor(w.dayIndex / 7)}`;
    }
    /**
     * デイリーの「有効な日付」。
     *
     * 未消化のデイリーは MISSION_CARRY_DAYS 日ぶん保持する（調査資料 §4-1）。
     * 毎日ログインしないと完走できない設計は義務感を生んで離脱につながるため、
     * 「昨日の分が残っていれば今日でも進められる」ようにしている。
     * 実装は「進捗の日付が保持期間内なら引き継ぐ」だけで足りる。
     */
    carriedDay(cur) {
        if (!cur?.day)
            return null;
        const ageDays = Math.floor((Date.parse(today(this.now())) - Date.parse(cur.day)) / 86_400_000);
        return ageDays >= 0 && ageDays < MISSION_CARRY_DAYS ? cur.day : null;
    }
    /** ハンド終了時などに進捗を進める。デイリーとウィークリーの両方を進める */
    advanceMission(userId, missionId, by = 1) {
        const def = DAILY_MISSIONS.find((m) => m.id === missionId);
        if (def) {
            const key = `mission:${missionId}`;
            const day = today(this.now());
            const cur = this.store.getProgress(userId, key);
            // 保持期間内なら前日までの進捗を引き継ぐ
            const value = this.carriedDay(cur) ? cur.value : 0;
            this.store.setProgress(userId, key, Math.min(def.target, value + by), day);
        }
    }
    /** ウィークリーの進捗を進める（週が変わったら自動リセット） */
    advanceWeekly(userId, missionId, by = 1) {
        const def = WEEKLY_MISSIONS.find((m) => m.id === missionId);
        if (!def)
            return;
        const key = `weekly:${missionId}`;
        const wk = this.weekKey();
        const cur = this.store.getProgress(userId, key);
        const value = cur && cur.day === wk ? cur.value : 0;
        this.store.setProgress(userId, key, Math.min(def.target, value + by), wk);
    }
    /** シーズンミッションの進捗を進める（シーズンが変わったら自動リセット） */
    advanceSeasonal(userId, missionId, by = 1) {
        const def = SEASON_MISSIONS.find((m) => m.id === missionId);
        if (!def)
            return;
        const key = `seasonal:${missionId}`;
        const sid = this.seasonId();
        const cur = this.store.getProgress(userId, key);
        const value = cur && cur.day === sid ? cur.value : 0;
        this.store.setProgress(userId, key, Math.min(def.target, value + by), sid);
    }
    seasonalStatus(userId) {
        const sid = this.seasonId();
        return SEASON_MISSIONS.map((m) => {
            const p = this.store.getProgress(userId, `seasonal:${m.id}`);
            const claimed = this.store.getProgress(userId, `seasonal_claimed:${m.id}`);
            return {
                id: m.id,
                name: m.name,
                target: m.target,
                progress: p && p.day === sid ? p.value : 0,
                rewardChips: m.rewardChips,
                rewardXp: m.rewardXp,
                claimed: !!claimed && claimed.day === sid,
            };
        });
    }
    missionStatus(userId) {
        return DAILY_MISSIONS.map((m) => {
            const p = this.store.getProgress(userId, `mission:${m.id}`);
            const claimed = this.store.getProgress(userId, `mission_claimed:${m.id}`);
            const liveDay = this.carriedDay(p);
            return {
                id: m.id,
                name: m.name,
                target: m.target,
                progress: liveDay ? p.value : 0,
                rewardChips: m.rewardChips,
                rewardXp: m.rewardXp,
                // 受け取り済みかどうかも保持期間で判定する（引き継いだ進捗を二重に受け取らせない）
                claimed: !!claimed && !!this.carriedDay(claimed) && claimed.day === p?.day,
            };
        });
    }
    weeklyStatus(userId) {
        const wk = this.weekKey();
        return WEEKLY_MISSIONS.map((m) => {
            const p = this.store.getProgress(userId, `weekly:${m.id}`);
            const claimed = this.store.getProgress(userId, `weekly_claimed:${m.id}`);
            return {
                id: m.id,
                name: m.name,
                target: m.target,
                progress: p && p.day === wk ? p.value : 0,
                rewardChips: m.rewardChips,
                rewardXp: m.rewardXp,
                claimed: !!claimed && claimed.day === wk,
            };
        });
    }
    claimMission(userId, missionId) {
        const daily = DAILY_MISSIONS.find((m) => m.id === missionId);
        if (daily) {
            const p = this.store.getProgress(userId, `mission:${missionId}`);
            if (!p || !this.carriedDay(p) || p.value < daily.target)
                return { ok: false, error: 'まだ達成していません' };
            const claimed = this.store.getProgress(userId, `mission_claimed:${missionId}`);
            if (claimed && claimed.day === p.day)
                return { ok: false, error: '受け取り済みです' };
            this.store.setProgress(userId, `mission_claimed:${missionId}`, 1, p.day);
            this.store.post(userId, 'chips', daily.rewardChips, 'mission_reward', missionId);
            this.addPassXp(userId, daily.rewardXp);
            return { ok: true, chips: daily.rewardChips, xp: daily.rewardXp };
        }
        const weekly = WEEKLY_MISSIONS.find((m) => m.id === missionId);
        if (weekly) {
            const wk = this.weekKey();
            const p = this.store.getProgress(userId, `weekly:${missionId}`);
            if (!p || p.day !== wk || p.value < weekly.target)
                return { ok: false, error: 'まだ達成していません' };
            const claimed = this.store.getProgress(userId, `weekly_claimed:${missionId}`);
            if (claimed && claimed.day === wk)
                return { ok: false, error: '受け取り済みです' };
            this.store.setProgress(userId, `weekly_claimed:${missionId}`, 1, wk);
            this.store.post(userId, 'chips', weekly.rewardChips, 'mission_reward', missionId);
            this.addPassXp(userId, weekly.rewardXp);
            return { ok: true, chips: weekly.rewardChips, xp: weekly.rewardXp };
        }
        const seasonal = SEASON_MISSIONS.find((m) => m.id === missionId);
        if (seasonal) {
            const sid = this.seasonId();
            const p = this.store.getProgress(userId, `seasonal:${missionId}`);
            if (!p || p.day !== sid || p.value < seasonal.target)
                return { ok: false, error: 'まだ達成していません' };
            const claimed = this.store.getProgress(userId, `seasonal_claimed:${missionId}`);
            if (claimed && claimed.day === sid)
                return { ok: false, error: '受け取り済みです' };
            this.store.setProgress(userId, `seasonal_claimed:${missionId}`, 1, sid);
            this.store.post(userId, 'chips', seasonal.rewardChips, 'mission_reward', missionId);
            this.addPassXp(userId, seasonal.rewardXp);
            return { ok: true, chips: seasonal.rewardChips, xp: seasonal.rewardXp };
        }
        return { ok: false, error: 'ミッションが見つかりません' };
    }
    // --- ゴールドスロット -------------------------------------------------------
    /** スロット画面に出す現在の状態(倍率の内訳・残り回数・絵柄表) */
    slotState(userId) {
        const u = this.store.getUser(userId);
        const day = today(this.now());
        const spun = this.store.getProgress(userId, 'slot:spins');
        const used = spun && spun.day === day ? spun.value : 0;
        const spunChip = this.store.getProgress(userId, 'slot:chipspins');
        const usedChip = spunChip && spunChip.day === day ? spunChip.value : 0;
        const streak = u?.loginStreak ?? 0;
        const tier = tierOf(u?.vipPoints ?? 0);
        return {
            gold: u?.gold ?? 0,
            bets: goldBetLadder(u?.gold ?? 0),
            // 配当表(3/4/5個)。下位絵柄は4個からなので pay[0] が 0 になる
            symbols: PAY_SYMBOLS.map((x) => ({ key: x.key, name: x.name, pay: x.pay })),
            multiplier: slotMultiplier(u?.vipPoints ?? 0, streak),
            vipTierName: tier.name,
            vipPart: Math.round(Math.sqrt(tier.dailyMultiplier) * 100) / 100,
            streak,
            streakPart: Math.round((1 + Math.min(Math.max(0, streak), 14) * 0.04) * 100) / 100,
            chipsPerGold: SLOT_CHIPS_PER_GOLD,
            spinsLeft: Math.max(0, SLOT_DAILY_SPINS - used),
            dailySpins: SLOT_DAILY_SPINS,
            // --- チップ建て(第59弾) ---
            chips: u?.chips ?? 0,
            chipBets: chipBetLadder(u?.chips ?? 0),
            chipMinBet: SLOT_CHIP_MIN_BET,
            chipSpinsLeft: Math.max(0, SLOT_CHIP_DAILY_SPINS - usedChip),
            chipDailySpins: SLOT_CHIP_DAILY_SPINS,
            // --- 第58弾で追加した遊びの骨格 ---
            reels: REELS,
            rows: ROWS,
            lines: LINES,
            paylines: PAYLINES.map((l) => [...l]),
            tumbleLadder: [...TUMBLE_LADDER],
            scatterPay: { ...SCATTER_PAY },
            freeModes: FREE_MODES.map((m) => ({ key: m.key, name: m.name, desc: m.desc, spins: m.spins, startMult: m.startMult, step: m.step })),
            anteCost: SLOT_CFG.anteCost,
            maxWinX: MAX_WIN_X,
        };
    }
    /**
     * スロットを 1 回まわす。ゴールドを消費してチップを払い出す。
     * 抽選そのものは slot.ts の純粋関数(243ways+タンブル+フリーゲーム)に任せ、
     * ここは「支払い・上限・倍率・記録」だけを見る。
     * rnd を差し替えられるようにしてあるのはテストで出目を固定するため。
     */
    /**
     * スロットを 1 回まわす(第66弾で **チップ専用**)。
     * チップを賭けてチップを払い出す閉じたループなので、**払い出し倍率は掛けない**
     * (掛けると RTP が 100% を超えて無限にチップを増やせる)。
     * 抽選そのものは slot.ts の純粋関数に任せ、ここは支払い・上限・記録だけを見る。
     */
    spinSlot(userId, bet, rnd = Math.random, opts = {}) {
        const u = this.store.getUser(userId);
        if (!u)
            return { ok: false, error: 'ユーザーが見つかりません' };
        const day = today(this.now());
        // 賭け金は自由額。整数・下限以上・残高以内だけを見る
        if (!Number.isFinite(bet) || !Number.isInteger(bet) || bet < SLOT_CHIP_MIN_BET) {
            return { ok: false, error: `賭け金は ${SLOT_CHIP_MIN_BET.toLocaleString()} チップ以上の整数です` };
        }
        // 台帳の1回上限(2^53対策)。ここで弾かないと控除の post が例外を投げてスピンごと壊れる
        if (bet > SAFE_POST) {
            return { ok: false, error: `賭け金は ${SAFE_POST.toLocaleString()} チップまでです` };
        }
        const spun = this.store.getProgress(userId, 'slot:chipspins');
        const used = spun && spun.day === day ? spun.value : 0;
        if (used >= SLOT_CHIP_DAILY_SPINS)
            return { ok: false, error: '本日の上限に達しました' };
        // アンティベットは賭け金が増える(そのぶんフリーゲーム突入率が上がる)
        const cost = Math.ceil(bet * (opts.ante ? SLOT_CFG.anteCost : 1));
        if (u.chips < cost)
            return { ok: false, error: 'チップが足りません' };
        if (this.store.post(userId, 'chips', -cost, 'slot_spin', `day:${day}`) === null) {
            return { ok: false, error: 'チップが足りません' };
        }
        this.store.setProgress(userId, 'slot:chipspins', used + 1, day);
        const outcome = spinReels(rnd, { ante: opts.ante, mode: opts.mode });
        const won = Math.round(outcome.totalPayX * bet);
        // 支払いが台帳の1回上限(2^53)を超えることがある(例: 500Bベット×24万倍=1.2京)。
        // 1回で post すると例外で支払いに失敗するので、上限以下の塊に分割して記帳する
        if (won > 0) {
            let rest = won;
            while (rest > 0) {
                const part = Math.min(rest, SAFE_POST);
                this.store.post(userId, 'chips', part, 'slot_win', `day:${day}`);
                rest -= part;
            }
        }
        const x = outcome.totalPayX;
        const kind = outcome.maxWin ? 'max' : x >= 100 ? 'mega' : x >= 20 ? 'big' : x > 0 ? 'small' : 'none';
        return {
            ok: true,
            outcome,
            bet,
            currency: 'chips',
            cost,
            won,
            multiplier: 1,
            kind,
            goldLeft: 0,
            spinsLeft: Math.max(0, SLOT_CHIP_DAILY_SPINS - used - 1),
        };
    }
    // --- 広告(第66弾の土台) -----------------------------------------------
    //
    // 実際の広告SDKはまだ入れていない。ここで用意するのは**サーバー側の土台**:
    //   ・1日に見られる回数と報酬額
    //   ・「広告を消す」を買ったかどうか(買ったら視聴導線は出さない)
    //   ・報酬の付与(回数上限と台帳を通す)
    // クライアントは「広告を見終わった」と伝えるだけにし、**報酬額はサーバーが決める**。
    // (クライアントに金額を持たせると、いくらでも要求できてしまう)
    /** 広告の状態。UIの出し分けに使う */
    adState(userId) {
        const u = this.store.getUser(userId);
        const day = today(this.now());
        const w = this.store.getProgress(userId, 'ad:watched');
        const used = w && w.day === day ? w.value : 0;
        const removed = (this.store.getProgress(userId, 'ad:removed')?.value ?? 0) > 0;
        return {
            /** 広告除去を買っているか */
            removed,
            /** 本日の視聴回数と上限 */
            watched: used,
            dailyLimit: AD_DAILY_LIMIT,
            left: Math.max(0, AD_DAILY_LIMIT - used),
            /** 次に見たときにもらえるチップ(所持に応じて増える。復帰支援と同じ考え方) */
            reward: this.adReward(u?.chips ?? 0),
        };
    }
    /**
     * 広告1回の報酬。デイリーボーナスと同じく所持額に対する率で出しつつ、
     * 上限を設けて青天井にしない(スロットの蛇口を壊さないため)。
     */
    adReward(chips) {
        const byBalance = Math.round(Math.max(0, chips) * AD_REWARD_RATE);
        return Math.max(AD_REWARD_FLOOR, Math.min(byBalance, AD_REWARD_CAP));
    }
    /** 広告を見終わった。回数上限を超えていなければチップを配る */
    grantAdReward(userId) {
        const u = this.store.getUser(userId);
        if (!u)
            return { ok: false, error: 'ユーザーが見つかりません' };
        const day = today(this.now());
        const w = this.store.getProgress(userId, 'ad:watched');
        const used = w && w.day === day ? w.value : 0;
        if (used >= AD_DAILY_LIMIT)
            return { ok: false, error: '本日の視聴上限に達しました' };
        const reward = this.adReward(u.chips);
        this.store.setProgress(userId, 'ad:watched', used + 1, day);
        this.store.post(userId, 'chips', reward, 'ad_reward', `day:${day}`);
        return { ok: true, reward, left: Math.max(0, AD_DAILY_LIMIT - used - 1) };
    }
    /** 広告除去を有効にする(購入時に呼ぶ)。日付をまたいでも消えないよう day は固定値 */
    enableAdRemoval(userId) {
        this.store.setProgress(userId, 'ad:removed', 1, 'permanent');
    }
    // --- チャレンジパス ---------------------------------------------------------
    addPassXp(userId, xp) {
        const key = `pass:${this.seasonId()}:xp`;
        const cur = this.store.getProgress(userId, key)?.value ?? 0;
        this.store.setProgress(userId, key, cur + Math.round(xp * this.catchUpRate()));
    }
    passStatus(userId) {
        const xp = this.store.getProgress(userId, `pass:${this.seasonId()}:xp`)?.value ?? 0;
        const premium = (this.store.getProgress(userId, `pass:${this.seasonId()}:premium`)?.value ?? 0) === 1;
        let tier = 0;
        for (const t of PASS_TIERS)
            if (xp >= t.xpRequired)
                tier = t.tier;
        const next = PASS_TIERS.find((t) => t.tier === tier + 1) ?? null;
        const w = this.season();
        // 完走後の周回報酬。200XP ごとに 1 箱、最大 5 箱（チップのインフレを防ぐため頭打ち）
        const overflowXp = Math.max(0, xp - PASS_COMPLETE_XP);
        const boxesEarned = Math.min(PASS_BONUS_BOX_MAX, Math.floor(overflowXp / PASS_BONUS_BOX_XP));
        const boxesClaimed = this.store.getProgress(userId, `pass:${this.seasonId()}:boxes`)?.value ?? 0;
        return {
            seasonId: w.id,
            xp,
            tier,
            premium,
            nextTierXp: next?.xpRequired ?? null,
            // シーズンの残り日数を見せると「あと何日で完走できるか」が判断できる
            daysLeft: w.daysLeft,
            endsAt: w.endsAt,
            finalWeek: w.finalWeek,
            completeXp: PASS_COMPLETE_XP,
            obtainableXp: PASS_OBTAINABLE_XP,
            boxesEarned,
            boxesClaimed,
            boxChips: PASS_BONUS_BOX_CHIPS,
            tiers: PASS_TIERS.map((t) => ({
                tier: t.tier,
                xpRequired: t.xpRequired,
                free: t.free,
                premium: t.premium,
                unlocked: xp >= t.xpRequired,
                claimedFree: (this.store.getProgress(userId, `pass:${this.seasonId()}:claim_free:${t.tier}`)?.value ?? 0) === 1,
                claimedPremium: (this.store.getProgress(userId, `pass:${this.seasonId()}:claim_prem:${t.tier}`)?.value ?? 0) === 1,
            })),
        };
    }
    /**
     * 「今プレミアムパスを買ったら、いますぐ受け取れる内容」を計算する（購入前の表示用）。
     *
     * 調査資料 §11 のとおり、「最大◯倍お得」より「実際にいま受け取れる中身」を出す方が信頼される。
     * すでに到達済みのティアぶんが遡って解放されるので、シーズン後半ほどこの数字は大きくなり、
     * 「もう遅いから買わない」という離脱を防げる。
     */
    passPurchasePreview(userId) {
        const st = this.passStatus(userId);
        if (st.premium)
            return { chips: 0, gold: 0, tiers: 0 };
        let chips = 0, gold = 0, tiers = 0;
        for (const t of st.tiers) {
            if (!t.unlocked || t.claimedPremium)
                continue;
            chips += t.premium.chips ?? 0;
            gold += t.premium.gold ?? 0;
            tiers++;
        }
        return { chips, gold, tiers };
    }
    /**
     * 到達済みティアの報酬をまとめて受け取る。
     * プレミアムを後から買っても、それまでのティア分がさかのぼって受け取れる
     * （後半で買う障壁を下げるための設計）。
     */
    claimPassRewards(userId) {
        const st = this.passStatus(userId);
        let chips = 0;
        let gold = 0;
        const tiers = [];
        for (const t of st.tiers) {
            if (!t.unlocked)
                continue;
            if (!t.claimedFree) {
                chips += t.free.chips ?? 0;
                gold += t.free.gold ?? 0;
                this.store.setProgress(userId, `pass:${this.seasonId()}:claim_free:${t.tier}`, 1);
                tiers.push(t.tier);
            }
            if (st.premium && !t.claimedPremium) {
                chips += t.premium.chips ?? 0;
                gold += t.premium.gold ?? 0;
                this.store.setProgress(userId, `pass:${this.seasonId()}:claim_prem:${t.tier}`, 1);
                if (!tiers.includes(t.tier))
                    tiers.push(t.tier);
            }
        }
        // 完走後の周回報酬。早く完走した人がシーズン途中で離脱しないようにするための受け皿
        const boxes = Math.max(0, st.boxesEarned - st.boxesClaimed);
        if (boxes > 0) {
            chips += boxes * PASS_BONUS_BOX_CHIPS;
            this.store.setProgress(userId, `pass:${this.seasonId()}:boxes`, st.boxesEarned);
        }
        if (chips)
            this.store.post(userId, 'chips', chips, 'pass_reward', this.seasonId());
        if (gold)
            this.store.post(userId, 'gold', gold, 'pass_reward', this.seasonId());
        return { chips, gold, tiers, boxes };
    }
    // --- ハンド終了時のフック ----------------------------------------------------
    /**
     * ハンドが終わるたびに呼ぶ。ミッション、パス経験値、貯金箱、VIP を一括で進める。
     * 呼び忘れると進行が止まるので、Room からの呼び出しは 1 箇所にまとめてある。
     */
    onHandPlayed(userId, opts) {
        this.advanceMission(userId, 'play_hands');
        this.advanceWeekly(userId, 'w_hands');
        this.advanceSeasonal(userId, 's_hands');
        if (opts.won)
            this.advanceMission(userId, 'win_hands');
        if (opts.showdownWin) {
            this.advanceMission(userId, 'showdown_win');
            this.advanceWeekly(userId, 'w_showdown');
            this.advanceSeasonal(userId, 's_showdown');
        }
        // ハンドそのものの経験値は小さくしてある。パスの進行はミッション消化を主軸にしたいので、
        // 「ひたすら回すだけで完走できる」状態にはしない（1日60XPのデイリーが中心）
        this.addPassXp(userId, opts.won ? 2 : 1);
        // レーキの一部が貯金箱に積まれる（プレイ量に比例させるため）
        if (opts.rakeContributed > 0)
            this.addToPiggyBank(userId, Math.round(opts.rakeContributed * 0.5));
        this.addPlayVipPoints(userId, opts.rakeContributed);
    }
    onTournamentEntered(userId) {
        this.advanceMission(userId, 'play_tournament');
        this.advanceWeekly(userId, 'w_tournament');
        this.advanceSeasonal(userId, 's_tournament');
        this.addPassXp(userId, 10);
    }
    /**
     * 経験値を加算する。最終週は取得量を増やして、出遅れた人・復帰した人が追いつけるようにする
     * （調査資料 §12「最終週に獲得XPを増やす」）。
     */
    catchUpRate() {
        return this.season().finalWeek ? 1.25 : 1;
    }
}
//# sourceMappingURL=economy.js.map