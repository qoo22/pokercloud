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
import type { Store, Currency, LedgerReason } from './store.js';
import { type SlotOutcome, type FreeMode } from './slot.js';
export interface Sku {
    sku: string;
    name: string;
    priceJpy: number;
    chips?: number;
    gold?: number;
    /** 付与される VIP ポイント */
    vipPoints: number;
    kind: 'chips' | 'gold' | 'offer' | 'pass' | 'feature';
    /** 恒常商品に対する倍率（オファーの「お得さ」表示用） */
    valueMultiplier?: number;
    note?: string;
}
/** 恒常チップパック。単価差は最大 4.8 倍に抑えている（Zynga の約 10 倍は初回転換率を下げる） */
export declare const CHIP_PACKS: Sku[];
/**
 * 機能を売る商品(第66弾)。
 * ゴールドは廃止し **チップに一本化** したので、旧ゴールドパックの枠を
 * 「広告を消す」などの機能商品に置き換えた。チップの量では差がつかない価値を売る。
 */
export declare const FEATURE_SKUS: Sku[];
/** 旧名の互換(参照が残っていても落ちないように) */
export declare const GOLD_PACKS: Sku[];
/** 期間限定オファー。仕様書のとおり、実際の売上主力はこちら */
export type OfferKind = 'first_time' | 'bust_rescue' | 'piggy_bank' | 'weekend_flash' | 'vip_only';
export interface Offer {
    id: OfferKind;
    name: string;
    description: string;
    sku: Sku;
    /** 表示できる条件 */
    reason: string;
    expiresAt: number | null;
}
export interface VipTier {
    key: string;
    name: string;
    minPoints: number;
    /** 購入時のチップ増量 */
    purchaseBonus: number;
    /** デイリーボーナスの倍率 */
    dailyMultiplier: number;
    perks: string[];
}
/**
 * Zynga の実測ティアをそのまま使うと Black 到達に約 2.5 億円かかる。
 * 到達不可能なティアは動機付けにならないので、仕様書のとおり 1/100 に圧縮した
 * （¥1 = 1pt、Silver 到達が ¥2,000）。
 */
export declare const VIP_TIERS: VipTier[];
export declare function tierOf(points: number): VipTier;
export declare function nextTier(points: number): VipTier | null;
/** これ以下の残高までは素直に DAILY_RATE を掛ける(初中級者の体感を落とさない) */
export declare const DAILY_KNEE = 2000000;
/** 少額帯の支給率 */
export declare const DAILY_RATE = 0.03;
/** どれだけ持っていても、倍率を掛ける前の基礎額はここで頭打ち */
export declare const DAILY_BASE_CAP = 1000000;
/** 無一文でも最低これだけは配る(復帰支援) */
export declare const DAILY_FLOOR = 5000;
/**
 * 所持チップから、デイリーボーナスの基礎額を求める(倍率を掛ける前の値)。
 *
 * DAILY_KNEE までは線形、その先は平方根で逓減させ、最後に絶対上限で止める。
 * 平方根にするのは、残高が 100 倍になっても基礎額は 10 倍にしかならないため
 * 「持っている人ほど得をする」度合いを大きく削れるから。
 * 継ぎ目(chips = DAILY_KNEE)で値が飛ばないよう連続になっている。
 */
export declare function dailyBonusBase(chips: number): number;
/** リールの絵柄。weight が大きいほど出やすい */
/** 賭けられるゴールドの単位 */
export declare const SLOT_BETS: readonly [1, 5, 10, 50];
/**
 * 賭け1ゴールドあたりの基準チップ。
 * 第58弾で抽選が 243ways+タンブル+フリーゲームに変わりRTPが 0.70→0.96(×賭け金)に上がったため、
 * **1ゴールドあたりの期待払い出しを従来と同じ 14,076 チップに保つ** よう換算レートを下げてある
 * (0.9505 × 14,809 ≒ 14,076)。ここを触ると経済の蛇口が動くので必ず sim-slot.mjs で確認すること。
 */
export declare const SLOT_CHIPS_PER_GOLD = 14809;
/** 1日に回せる上限(ゴールド量ではなく回数。無限回しの防止) */
export declare const SLOT_DAILY_SPINS = 100;
/**
 * 広告まわりの設定(第66弾)。
 * 報酬は「所持チップの率 + 下限 + 上限」で出す。率だけだとハイローラーに配りすぎ、
 * 定額だけだと初心者に価値が無いため。上限を置いてチップの蛇口を壊さないようにする。
 */
export declare const AD_DAILY_LIMIT = 5;
export declare const AD_REWARD_RATE = 0.01;
export declare const AD_REWARD_FLOOR = 20000;
export declare const AD_REWARD_CAP = 2000000;
/**
 * チップ建てスロットの設定(第59弾)。
 *
 * **重要**: ゴールド建ては「ゴールドを払ってチップをもらう蛇口」なので VIP/連続ログインの
 * 払い出し倍率(最大約1.87倍)を掛けても破綻しない。一方チップ建ては **チップを払って
 * チップをもらう閉じたループ** なので、倍率を掛けると RTP が 96% × 1.87 = 179% となり
 * **無限にチップを増やせてしまう**。よってチップ建てでは倍率を掛けない(RTP 96% 固定 =
 * 4% がシンク)。倍率はゴールド建て専用として残す。
 */
export declare const SLOT_CHIP_MIN_BET = 1000;
/** チップ建ての1日の上限。蛇口ではないので緩めでよいが、暴走時の被害を抑える安全弁として置く */
/**
 * 1日に回せる回数の上限。**第84弾でオーナー指示により無効化**(実際に回すとチップが減る
 * 体感だったため)。カウント自体は統計用に続けるが、上限で止めることはしない。
 * 表示用に十分大きい値を返す(-1等のセンチネルは古いクライアントの表示を壊すため使わない)
 */
export declare const SLOT_CHIP_DAILY_SPINS = 300;
/** 上限チェックを行うか。false なら無制限(第84弾) */
export declare const SLOT_LIMIT_ENABLED = false;
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
export declare const SAFE_POST = 9000000000000000;
export declare function chipBetLadder(balance: number): number[];
/** ゴールド建ての選択肢。所持に合わせて同じ考え方で刻む(下限1) */
export declare function goldBetLadder(balance: number): number[];
/**
 * 払い出し倍率。VIPランクと連続ログイン日数で上がる(ユーザー要望の中核)。
 *   VIP: ブロンズ1.0 → 最上位で +0.5 程度
 *   連続ログイン: 1日ごと +4%、14日で頭打ち(+56%)
 * 上限を設けているのは、倍率が青天井だと期待値がプラスに振れて無限にチップを産めるため。
 */
export declare function slotMultiplier(vipPoints: number, loginStreak: number): number;
export interface SlotSpinResult {
    ok: boolean;
    error?: string;
    /** 抽選結果そのもの(盤面・連鎖・フリーゲーム)。演出はこれを再生する */
    outcome?: SlotOutcome;
    bet?: number;
    /** 賭けた通貨 */
    currency?: 'gold' | 'chips';
    /** 実際に支払った額(アンティなら bet の1.5倍) */
    cost?: number;
    /** 獲得チップ(0 ならハズレ) */
    won?: number;
    multiplier?: number;
    goldLeft?: number;
    spinsLeft?: number;
    /** 当たりの規模。演出の出し分けに使う */
    kind?: 'none' | 'small' | 'big' | 'mega' | 'max';
}
export interface MissionDef {
    id: string;
    name: string;
    target: number;
    rewardChips: number;
    /** パスの経験値 */
    rewardXp: number;
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
export declare const DAILY_MISSIONS: MissionDef[];
/**
 * ウィークリーミッション。1 週あたり 500XP（4 週で 2,000XP）。
 * デイリーより長い時間軸の目標を置くことで、毎日ログインできない人でも積み上がるようにする。
 */
export declare const WEEKLY_MISSIONS: MissionDef[];
/**
 * シーズンミッション（28日通しの長期目標）。合計 800XP。
 * デイリー1,680 + ウィークリー2,000 + シーズン800 = 4,480、
 * これに最終週のキャッチアップ増分（約320）を足して、獲得可能 約4,800XP になる。
 * 完走に必要なのは 4,000 なので、4〜5日遊べない日があっても完走できる。
 */
export declare const SEASON_MISSIONS: MissionDef[];
/** 未消化のデイリーを保持する日数。毎日ログインできなくても追いつけるようにする */
export declare const MISSION_CARRY_DAYS = 7;
export interface PassTier {
    tier: number;
    xpRequired: number;
    free: {
        chips?: number;
        gold?: number;
    };
    premium: {
        chips?: number;
        gold?: number;
    };
}
export declare const PASS_PREMIUM_SKU: Sku;
/** シーズンの長さ。短すぎず長すぎない 28 日（Zynga と同じ） */
export declare const PASS_SEASON_DAYS = 28;
/** 段階数 */
export declare const PASS_TIER_COUNT = 40;
/** 1 段階に必要な経験値 */
export declare const PASS_XP_PER_TIER = 100;
/** 完走に必要な経験値 */
export declare const PASS_COMPLETE_XP: number;
/**
 * シーズン中に獲得しうる経験値の目安。完走に必要な 4,000 より多めにして、
 * 4〜5 日遊べない日があっても完走できるようにする（必要消化率 約83%）。
 */
export declare const PASS_OBTAINABLE_XP = 4800;
/** 完走後の周回報酬: この経験値ごとに 1 箱 */
export declare const PASS_BONUS_BOX_XP = 200;
/** 周回報酬の上限。チップのインフレを防ぐため頭打ちにする */
export declare const PASS_BONUS_BOX_MAX = 5;
/** 周回報酬 1 箱の中身 */
export declare const PASS_BONUS_BOX_CHIPS = 120000;
/** 指定時刻が属するシーズン ID */
export declare function seasonIdAt(now: number): string;
/** シーズンの期間・経過日数・残り日数・最終週かどうか */
export declare function seasonWindowAt(now: number): {
    id: string;
    startsAt: number;
    endsAt: number;
    dayIndex: number;
    daysLeft: number;
    finalWeek: boolean;
};
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
export declare const PASS_TIERS: PassTier[];
/** 後方互換のための別名。現在は日付から決まるので seasonIdAt を使うこと */
export declare const PASS_SEASON_ID = "S1";
export interface GrantResult {
    chips: number;
    gold: number;
    vipPoints: number;
    /** VIP ティアが上がったなら新しいティア */
    tierUp: VipTier | null;
}
export interface PurchaseResult {
    ok: boolean;
    error?: string;
    granted?: GrantResult;
    balanceChips?: number;
    balanceGold?: number;
}
export declare class Economy {
    private store;
    private now;
    constructor(store: Store, now?: () => number);
    balance(userId: string, currency: Currency): number;
    grant(userId: string, currency: Currency, amount: number, reason: LedgerReason, ref?: string): boolean;
    allSkus(): Sku[];
    findSku(sku: string): Sku | null;
    private buildOfferSku;
    /**
     * 購入を処理する（モック決済）。
     *
     * 本番では receipt を Apple / Google のサーバーへ送って検証する。
     * ここで重要なのは「レシートは一度しか使えない」という性質で、
     * それさえ守れば検証部分を差し替えるだけで本番化できる。
     * クライアントの申告だけで付与する実装にすると、改造クライアントで無限に増える。
     */
    purchase(userId: string, sku: string, receipt: string): PurchaseResult;
    /** 現在この人に出すべきオファー。条件を満たすものだけを返す */
    offersFor(userId: string): Offer[];
    /**
     * 貯金箱：プレイ量に比例して溜まり、買うと回収できる。
     * 非課金者ほど中身が大きくなるので、初回課金の入口として機能する。
     */
    addToPiggyBank(userId: string, amount: number): void;
    private claimPiggyBank;
    vipStatus(userId: string): {
        points: number;
        tier: string;
        tierName: string;
        perks: string[];
        purchaseBonus: number;
        dailyMultiplier: number;
        nextTierName: string | null;
        pointsToNext: number | null;
    };
    /**
     * プレイでも VIP ポイントが少し貯まるようにする。
     * 購入だけで決まると、非課金者にとってティアが完全に飾りになる。
     * レートは「レーキ 1,000 チップにつき 1 ポイント」＝ 実質プレイ時間への報酬。
     */
    addPlayVipPoints(userId: string, rakeContributed: number): void;
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
    claimDailyBonus(userId: string): {
        ok: boolean;
        amount?: number;
        streak?: number;
        error?: string;
    };
    dailyBonusAvailable(userId: string): boolean;
    /** 現在のシーズン ID（日付から決まる。28日ごとに切り替わる） */
    seasonId(): string;
    /** 現在のシーズンの期間情報 */
    season(): {
        id: string;
        startsAt: number;
        endsAt: number;
        dayIndex: number;
        daysLeft: number;
        finalWeek: boolean;
    };
    /** その週のキー（ウィークリーミッションのリセット単位。シーズン内の第何週か） */
    private weekKey;
    /**
     * デイリーの「有効な日付」。
     *
     * 未消化のデイリーは MISSION_CARRY_DAYS 日ぶん保持する（調査資料 §4-1）。
     * 毎日ログインしないと完走できない設計は義務感を生んで離脱につながるため、
     * 「昨日の分が残っていれば今日でも進められる」ようにしている。
     * 実装は「進捗の日付が保持期間内なら引き継ぐ」だけで足りる。
     */
    private carriedDay;
    /** ハンド終了時などに進捗を進める。デイリーとウィークリーの両方を進める */
    advanceMission(userId: string, missionId: string, by?: number): void;
    /** ウィークリーの進捗を進める（週が変わったら自動リセット） */
    advanceWeekly(userId: string, missionId: string, by?: number): void;
    /** シーズンミッションの進捗を進める（シーズンが変わったら自動リセット） */
    advanceSeasonal(userId: string, missionId: string, by?: number): void;
    seasonalStatus(userId: string): {
        id: string;
        name: string;
        target: number;
        progress: number;
        rewardChips: number;
        rewardXp: number;
        claimed: boolean;
    }[];
    missionStatus(userId: string): {
        id: string;
        name: string;
        target: number;
        progress: number;
        rewardChips: number;
        rewardXp: number;
        claimed: boolean;
    }[];
    weeklyStatus(userId: string): {
        id: string;
        name: string;
        target: number;
        progress: number;
        rewardChips: number;
        rewardXp: number;
        claimed: boolean;
    }[];
    claimMission(userId: string, missionId: string): {
        ok: boolean;
        chips?: number;
        xp?: number;
        error?: string;
    };
    /** スロット画面に出す現在の状態(倍率の内訳・残り回数・絵柄表) */
    slotState(userId: string): {
        gold: number;
        bets: number[];
        symbols: {
            key: import("./slot.js").SlotSymKey;
            name: string;
            pay: [number, number, number];
        }[];
        multiplier: number;
        vipTierName: string;
        vipPart: number;
        streak: number;
        streakPart: number;
        chipsPerGold: number;
        spinsLeft: number;
        dailySpins: number;
        chips: number;
        chipBets: number[];
        chipMinBet: number;
        chipSpinsLeft: number;
        chipDailySpins: number;
        reels: number;
        rows: number;
        lines: number;
        paylines: number[][];
        tumbleLadder: number[];
        scatterPay: {
            [x: number]: number;
        };
        freeModes: {
            key: "many" | "few";
            name: string;
            desc: string;
            spins: number;
            startMult: number;
            step: number;
        }[];
        anteCost: number;
        maxWinX: number;
    };
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
    spinSlot(userId: string, bet: number, rnd?: () => number, opts?: {
        ante?: boolean;
        mode?: FreeMode['key'];
    }): SlotSpinResult;
    /** 広告の状態。UIの出し分けに使う */
    adState(userId: string): {
        /** 広告除去を買っているか */
        removed: boolean;
        /** 本日の視聴回数と上限 */
        watched: number;
        dailyLimit: number;
        left: number;
        /** 次に見たときにもらえるチップ(所持に応じて増える。復帰支援と同じ考え方) */
        reward: number;
    };
    /**
     * 広告1回の報酬。デイリーボーナスと同じく所持額に対する率で出しつつ、
     * 上限を設けて青天井にしない(スロットの蛇口を壊さないため)。
     */
    private adReward;
    /** 広告を見終わった。回数上限を超えていなければチップを配る */
    grantAdReward(userId: string): {
        ok: boolean;
        error?: string;
        reward?: number;
        left?: number;
    };
    /** 広告除去を有効にする(購入時に呼ぶ)。日付をまたいでも消えないよう day は固定値 */
    enableAdRemoval(userId: string): void;
    addPassXp(userId: string, xp: number): void;
    passStatus(userId: string): {
        seasonId: string;
        xp: number;
        tier: number;
        premium: boolean;
        nextTierXp: number | null;
        daysLeft: number;
        endsAt: number;
        finalWeek: boolean;
        completeXp: number;
        obtainableXp: number;
        boxesEarned: number;
        boxesClaimed: number;
        boxChips: number;
        tiers: {
            tier: number;
            xpRequired: number;
            free: {
                chips?: number;
                gold?: number;
            };
            premium: {
                chips?: number;
                gold?: number;
            };
            unlocked: boolean;
            claimedFree: boolean;
            claimedPremium: boolean;
        }[];
    };
    /**
     * 「今プレミアムパスを買ったら、いますぐ受け取れる内容」を計算する（購入前の表示用）。
     *
     * 調査資料 §11 のとおり、「最大◯倍お得」より「実際にいま受け取れる中身」を出す方が信頼される。
     * すでに到達済みのティアぶんが遡って解放されるので、シーズン後半ほどこの数字は大きくなり、
     * 「もう遅いから買わない」という離脱を防げる。
     */
    passPurchasePreview(userId: string): {
        chips: number;
        gold: number;
        tiers: number;
    };
    /**
     * 到達済みティアの報酬をまとめて受け取る。
     * プレミアムを後から買っても、それまでのティア分がさかのぼって受け取れる
     * （後半で買う障壁を下げるための設計）。
     */
    claimPassRewards(userId: string): {
        chips: number;
        gold: number;
        tiers: number[];
        boxes: number;
    };
    /**
     * ハンドが終わるたびに呼ぶ。ミッション、パス経験値、貯金箱、VIP を一括で進める。
     * 呼び忘れると進行が止まるので、Room からの呼び出しは 1 箇所にまとめてある。
     */
    onHandPlayed(userId: string, opts: {
        won: boolean;
        showdownWin: boolean;
        rakeContributed: number;
    }): void;
    onTournamentEntered(userId: string): void;
    /**
     * 経験値を加算する。最終週は取得量を増やして、出遅れた人・復帰した人が追いつけるようにする
     * （調査資料 §12「最終週に獲得XPを増やす」）。
     */
    private catchUpRate;
}
