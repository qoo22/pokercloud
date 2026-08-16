/**
 * バウンティ（賞金首）トーナメント
 *
 * WSOP や主要オンラインサイトで使われている 3 方式を実装しています。
 *
 *   classic     … 撃墜すると相手の賞金首を全額もらう。賞金首の額は最後まで一定
 *   progressive … 撃墜すると相手の賞金首の半分を現金化し、残り半分は自分の賞金首に加算（PKO）
 *   mystery     … 撃墜するとトークンを得て、封筒を 1 枚引く。中身は事前に決まった分布からの抽選
 *
 * 3 方式の中で設計上の難所が違います。
 *   classic は簡単。progressive は「自分の賞金首が育つ」ので勝者が最後に自分の分を回収する処理が要る。
 *   mystery は抽選なので、**運営が中身を後から差し替えられない**ことを示す必要がある。
 *   ここでは封筒の並びを配牌と同じ Provably Fair の仕組みでコミットし、
 *   大会終了後にシードを開示して検証できるようにしています。
 *
 * 会計上の原則：バウンティプールから出ていく額の合計は、必ずプールと 1 円もずれない。
 * 端数はすべて最後の 1 人（優勝者）に寄せます。
 */
export type BountyMode = 'none' | 'classic' | 'progressive' | 'mystery';
export interface BountyConfig {
    mode: BountyMode;
    /** 1 エントリーあたり、賞金首プールに入る額 */
    perEntry: number;
    /** progressive で撃墜時に現金化する割合（残りは自分の賞金首へ）。既定 0.5 */
    progressiveSplit?: number;
    /**
     * mystery でバウンティが有効になる残り人数の割合。
     * WSOP は Day2（およそ 15%）から。それまでは通常のフリーズアウトとして進む。
     */
    mysteryActivationRatio?: number;
    /** テスト用にシードを固定したい場合 */
    serverSeed?: string;
}
export interface BountyAward {
    /** 撃墜した側 */
    winnerId: string;
    /** 撃墜された側 */
    victimId: string;
    /** 即座に受け取る現金 */
    cash: number;
    /** 自分の賞金首に加算された額（progressive のみ） */
    addedToOwn: number;
    /** mystery で引いた封筒 */
    envelope: {
        label: string;
        amount: number;
    } | null;
}
export interface MysteryEnvelope {
    label: string;
    amount: number;
}
/**
 * 賞金プール pool を count 枚の封筒に配分する。
 *
 * 実際の大会の分布に寄せて、「1 枚だけ極端に大きく、大半は最低額」という形にしている。
 * これは射幸性のためだけでなく、期待値を保ったまま話題性を作るための構造でもある。
 * 逆に均等配分にすると、ミステリーである意味がほぼ無くなる。
 */
export declare function buildMysteryChest(pool: number, count: number): MysteryEnvelope[];
/**
 * 封筒の束。並びは Provably Fair でコミットしてから使う。
 *
 * 「運営が中身を見てから並べ替えていないこと」を示せなければ、
 * ミステリーバウンティは最も疑われやすい機能になる（金額が大きく、抽選だから）。
 * 配牌と同じ仕組みを使い回すことで、プレイヤーは同じ検証ツールで確認できる。
 */
export declare class MysteryChest {
    readonly commitment: string;
    private serverSeed;
    private envelopes;
    private drawn;
    constructor(pool: number, count: number, clientSeed: string, serverSeed?: string);
    draw(): MysteryEnvelope | null;
    get remaining(): number;
    get total(): number;
    /** 残っている封筒の中身（金額のみ、順不同）。プレイヤーへの表示用 */
    remainingAmounts(): number[];
    /** 大会終了後の開示。これで並びを再現・検証できる */
    reveal(): {
        serverSeed: string;
        commitment: string;
        envelopes: MysteryEnvelope[];
    };
}
export declare class BountyPool {
    readonly mode: BountyMode;
    readonly perEntry: number;
    private split;
    private activationRatio;
    /** 各プレイヤーの現在の賞金首の額 */
    private bounties;
    /** 各プレイヤーが獲得した現金の累計 */
    private earned;
    private chest;
    private chestSeed?;
    private activated;
    /** 未使用のトークン（撃墜したがまだ封筒を引いていない） */
    private tokens;
    private totalIn;
    private totalOut;
    constructor(cfg: BountyConfig);
    get isActive(): boolean;
    /** エントリー時に呼ぶ。リエントリーでも再度呼ぶ（賞金首がもう 1 個増える） */
    addEntry(userId: string): void;
    bountyOf(userId: string): number;
    earnedBy(userId: string): number;
    tokensOf(userId: string): number;
    get poolTotal(): number;
    get paidOut(): number;
    get mysteryChest(): MysteryChest | null;
    get mysteryActive(): boolean;
    /**
     * ミステリーバウンティを有効化する（残り人数が閾値を切ったとき）。
     * 封筒の枚数 = そのときの残り人数。以降の撃墜ごとに 1 枚引かれ、最後に優勝者が 1 枚引く。
     */
    activateMystery(remainingPlayers: number, clientSeed: string): void;
    shouldActivateMystery(remainingPlayers: number, fieldSize: number): boolean;
    /**
     * 撃墜が発生したときの処理。
     *
     * @param winnerId 撃墜した側。null なら「誰の手柄でもない脱落」（時間切れの自動フォールドで
     *                 ブラインドに削られて 0 になった場合など）。この場合は賞金首をプールに戻す。
     */
    knockout(winnerId: string | null, victimId: string): BountyAward | null;
    /**
     * 撃墜者が複数いる場合（サイドポットを複数人で分けた場合）の分配。
     * 賞金首を人数で割り、端数は最初の 1 人へ寄せる。
     * ここを雑にすると「合計がプールと合わない」という最悪の不整合になる。
     */
    knockoutSplit(winners: string[], victimId: string): BountyAward[];
    /**
     * 優勝者の処理。
     * progressive では自分の賞金首を全額回収する。mystery では封筒を 1 枚引く。
     * classic では自分の賞金首は誰にも取られなかったので、そのまま返す。
     */
    finish(championId: string): BountyAward | null;
    /**
     * 使われずに残ったバウンティを回収する（中止時や、封筒が余った場合）。
     * 会計を合わせるために必ず呼ぶこと。
     */
    sweepRemainder(): number;
    /** 現在の全プレイヤーの賞金首（表示用） */
    snapshot(): Array<{
        userId: string;
        bounty: number;
        earned: number;
    }>;
    /** 会計の検証：支払い済み + 未払いの賞金首 = プール */
    audit(): {
        ok: boolean;
        pool: number;
        paid: number;
        outstanding: number;
    };
}
