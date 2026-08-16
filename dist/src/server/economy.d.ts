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
export interface Sku {
    sku: string;
    name: string;
    priceJpy: number;
    chips?: number;
    gold?: number;
    /** 付与される VIP ポイント */
    vipPoints: number;
    kind: 'chips' | 'gold' | 'offer' | 'pass';
    /** 恒常商品に対する倍率（オファーの「お得さ」表示用） */
    valueMultiplier?: number;
    note?: string;
}
/** 恒常チップパック。単価差は最大 4.8 倍に抑えている（Zynga の約 10 倍は初回転換率を下げる） */
export declare const CHIP_PACKS: Sku[];
/** ゴールド（スロットを回す権利）。消費速度が有限なので単価差は緩やかにする */
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
export interface MissionDef {
    id: string;
    name: string;
    target: number;
    rewardChips: number;
    /** パスの経験値 */
    rewardXp: number;
}
export declare const DAILY_MISSIONS: MissionDef[];
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
/** 30 ティア。無料トラックだけでも進むが、プレミアムは約 4 倍の総量になる */
export declare const PASS_TIERS: PassTier[];
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
     */
    claimDailyBonus(userId: string): {
        ok: boolean;
        amount?: number;
        streak?: number;
        error?: string;
    };
    dailyBonusAvailable(userId: string): boolean;
    /** ハンド終了時などに進捗を進める。日付が変わっていれば自動でリセットする */
    advanceMission(userId: string, missionId: string, by?: number): void;
    missionStatus(userId: string): {
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
    addPassXp(userId: string, xp: number): void;
    passStatus(userId: string): {
        seasonId: string;
        xp: number;
        tier: number;
        premium: boolean;
        nextTierXp: number | null;
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
     * 到達済みティアの報酬をまとめて受け取る。
     * プレミアムを後から買っても、それまでのティア分がさかのぼって受け取れる
     * （後半で買う障壁を下げるための設計）。
     */
    claimPassRewards(userId: string): {
        chips: number;
        gold: number;
        tiers: number[];
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
}
