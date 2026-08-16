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
import { commitmentOf, randomSeedHex, createFairRng } from '../fair.js';
import { shuffle } from '../cards.js';
// ---------------------------------------------------------------------------
// ミステリーバウンティの封筒
// ---------------------------------------------------------------------------
/**
 * 賞金プール pool を count 枚の封筒に配分する。
 *
 * 実際の大会の分布に寄せて、「1 枚だけ極端に大きく、大半は最低額」という形にしている。
 * これは射幸性のためだけでなく、期待値を保ったまま話題性を作るための構造でもある。
 * 逆に均等配分にすると、ミステリーである意味がほぼ無くなる。
 */
export function buildMysteryChest(pool, count) {
    if (count <= 0)
        return [];
    if (count === 1)
        return [{ label: 'トップ賞', amount: pool }];
    const envelopes = [];
    let remaining = pool;
    // 上位賞の割合。枚数が少ないときは自動的に縮む
    const tiers = [
        { count: 1, ratio: 0.2, label: 'トップ賞' },
        { count: 2, ratio: 0.06, label: '特賞' },
        { count: 5, ratio: 0.02, label: '中賞' },
    ];
    for (const t of tiers) {
        for (let i = 0; i < t.count && envelopes.length < count - 1; i++) {
            const amount = Math.floor(pool * t.ratio);
            if (amount <= 0 || amount > remaining)
                continue;
            envelopes.push({ label: t.label, amount });
            remaining -= amount;
        }
    }
    // 残りを最低額として均等に配る
    const rest = count - envelopes.length;
    if (rest > 0) {
        const base = Math.floor(remaining / rest);
        for (let i = 0; i < rest; i++)
            envelopes.push({ label: '最低保証', amount: base });
        remaining -= base * rest;
    }
    // 端数はトップ賞へ。これで合計が必ずプールと一致する
    if (remaining !== 0 && envelopes.length > 0)
        envelopes[0].amount += remaining;
    return envelopes;
}
/**
 * 封筒の束。並びは Provably Fair でコミットしてから使う。
 *
 * 「運営が中身を見てから並べ替えていないこと」を示せなければ、
 * ミステリーバウンティは最も疑われやすい機能になる（金額が大きく、抽選だから）。
 * 配牌と同じ仕組みを使い回すことで、プレイヤーは同じ検証ツールで確認できる。
 */
export class MysteryChest {
    commitment;
    serverSeed;
    envelopes;
    drawn = 0;
    constructor(pool, count, clientSeed, serverSeed) {
        this.serverSeed = serverSeed ?? randomSeedHex(32);
        this.commitment = commitmentOf(this.serverSeed);
        const built = buildMysteryChest(pool, count);
        // シードから決定論的にシャッフルする。あとから並びを再現・検証できる
        const rng = createFairRng({ serverSeed: this.serverSeed, clientSeed, nonce: 0 });
        this.envelopes = shuffle(built.slice(), rng);
    }
    draw() {
        if (this.drawn >= this.envelopes.length)
            return null;
        return this.envelopes[this.drawn++];
    }
    get remaining() {
        return this.envelopes.length - this.drawn;
    }
    get total() {
        return this.envelopes.reduce((a, e) => a + e.amount, 0);
    }
    /** 残っている封筒の中身（金額のみ、順不同）。プレイヤーへの表示用 */
    remainingAmounts() {
        return this.envelopes.slice(this.drawn).map((e) => e.amount).sort((a, b) => b - a);
    }
    /** 大会終了後の開示。これで並びを再現・検証できる */
    reveal() {
        return { serverSeed: this.serverSeed, commitment: this.commitment, envelopes: this.envelopes.slice() };
    }
}
// ---------------------------------------------------------------------------
// バウンティプール
// ---------------------------------------------------------------------------
export class BountyPool {
    mode;
    perEntry;
    split;
    activationRatio;
    /** 各プレイヤーの現在の賞金首の額 */
    bounties = new Map();
    /** 各プレイヤーが獲得した現金の累計 */
    earned = new Map();
    chest = null;
    chestSeed;
    activated = false;
    /** 未使用のトークン（撃墜したがまだ封筒を引いていない） */
    tokens = new Map();
    totalIn = 0;
    totalOut = 0;
    constructor(cfg) {
        this.mode = cfg.mode;
        this.perEntry = cfg.mode === 'none' ? 0 : cfg.perEntry;
        this.split = cfg.progressiveSplit ?? 0.5;
        this.activationRatio = cfg.mysteryActivationRatio ?? 0.15;
        this.chestSeed = cfg.serverSeed;
    }
    get isActive() {
        return this.mode !== 'none';
    }
    /** エントリー時に呼ぶ。リエントリーでも再度呼ぶ（賞金首がもう 1 個増える） */
    addEntry(userId) {
        if (!this.isActive)
            return;
        this.totalIn += this.perEntry;
        if (this.mode === 'mystery')
            return; // mystery は個人に紐づかず、まとめて封筒になる
        this.bounties.set(userId, (this.bounties.get(userId) ?? 0) + this.perEntry);
    }
    bountyOf(userId) {
        return this.bounties.get(userId) ?? 0;
    }
    earnedBy(userId) {
        return this.earned.get(userId) ?? 0;
    }
    tokensOf(userId) {
        return this.tokens.get(userId) ?? 0;
    }
    get poolTotal() {
        return this.totalIn;
    }
    get paidOut() {
        return this.totalOut;
    }
    get mysteryChest() {
        return this.chest;
    }
    get mysteryActive() {
        return this.activated;
    }
    /**
     * ミステリーバウンティを有効化する（残り人数が閾値を切ったとき）。
     * 封筒の枚数 = そのときの残り人数。以降の撃墜ごとに 1 枚引かれ、最後に優勝者が 1 枚引く。
     */
    activateMystery(remainingPlayers, clientSeed) {
        if (this.mode !== 'mystery' || this.activated)
            return;
        this.chest = new MysteryChest(this.totalIn, remainingPlayers, clientSeed, this.chestSeed);
        this.activated = true;
    }
    shouldActivateMystery(remainingPlayers, fieldSize) {
        if (this.mode !== 'mystery' || this.activated)
            return false;
        return remainingPlayers <= Math.max(2, Math.ceil(fieldSize * this.activationRatio));
    }
    /**
     * 撃墜が発生したときの処理。
     *
     * @param winnerId 撃墜した側。null なら「誰の手柄でもない脱落」（時間切れの自動フォールドで
     *                 ブラインドに削られて 0 になった場合など）。この場合は賞金首をプールに戻す。
     */
    knockout(winnerId, victimId) {
        if (!this.isActive)
            return null;
        if (this.mode === 'mystery') {
            if (!this.activated || !winnerId)
                return null;
            void 0;
            const envelope = this.chest.draw();
            if (!envelope)
                return null;
            this.earned.set(winnerId, (this.earned.get(winnerId) ?? 0) + envelope.amount);
            this.totalOut += envelope.amount;
            return { winnerId, victimId, cash: envelope.amount, addedToOwn: 0, envelope };
        }
        const victimBounty = this.bounties.get(victimId) ?? 0;
        this.bounties.delete(victimId);
        if (victimBounty <= 0 || !winnerId)
            return null;
        if (this.mode === 'classic') {
            this.earned.set(winnerId, (this.earned.get(winnerId) ?? 0) + victimBounty);
            this.totalOut += victimBounty;
            return { winnerId, victimId, cash: victimBounty, addedToOwn: 0, envelope: null };
        }
        // progressive（PKO）：半分を現金化し、半分を自分の賞金首に積む。
        // 端数は現金側へ寄せる（プレイヤーに分かりやすい方を優先）
        const addedToOwn = Math.floor(victimBounty * (1 - this.split));
        const cash = victimBounty - addedToOwn;
        this.earned.set(winnerId, (this.earned.get(winnerId) ?? 0) + cash);
        this.bounties.set(winnerId, (this.bounties.get(winnerId) ?? 0) + addedToOwn);
        this.totalOut += cash;
        return { winnerId, victimId, cash, addedToOwn, envelope: null };
    }
    /**
     * 撃墜者が複数いる場合（サイドポットを複数人で分けた場合）の分配。
     * 賞金首を人数で割り、端数は最初の 1 人へ寄せる。
     * ここを雑にすると「合計がプールと合わない」という最悪の不整合になる。
     */
    knockoutSplit(winners, victimId) {
        if (!this.isActive || winners.length === 0) {
            this.knockout(null, victimId);
            return [];
        }
        if (winners.length === 1) {
            const a = this.knockout(winners[0], victimId);
            return a ? [a] : [];
        }
        if (this.mode === 'mystery') {
            // 封筒は分割できないので、それぞれが 1 枚ずつ引く
            const out = [];
            for (const w of winners) {
                const a = this.knockout(w, victimId);
                if (a)
                    out.push(a);
            }
            return out;
        }
        const victimBounty = this.bounties.get(victimId) ?? 0;
        this.bounties.delete(victimId);
        if (victimBounty <= 0)
            return [];
        const share = Math.floor(victimBounty / winners.length);
        let remainder = victimBounty - share * winners.length;
        const out = [];
        for (const w of winners) {
            const amount = share + (remainder > 0 ? 1 : 0);
            if (remainder > 0)
                remainder--;
            const addedToOwn = this.mode === 'progressive' ? Math.floor(amount * (1 - this.split)) : 0;
            const cash = amount - addedToOwn;
            this.earned.set(w, (this.earned.get(w) ?? 0) + cash);
            if (addedToOwn > 0)
                this.bounties.set(w, (this.bounties.get(w) ?? 0) + addedToOwn);
            this.totalOut += cash;
            out.push({ winnerId: w, victimId, cash, addedToOwn, envelope: null });
        }
        return out;
    }
    /**
     * 優勝者の処理。
     * progressive では自分の賞金首を全額回収する。mystery では封筒を 1 枚引く。
     * classic では自分の賞金首は誰にも取られなかったので、そのまま返す。
     */
    finish(championId) {
        if (!this.isActive)
            return null;
        if (this.mode === 'mystery') {
            if (!this.activated)
                return null;
            const envelope = this.chest.draw();
            if (!envelope)
                return null;
            this.earned.set(championId, (this.earned.get(championId) ?? 0) + envelope.amount);
            this.totalOut += envelope.amount;
            return { winnerId: championId, victimId: championId, cash: envelope.amount, addedToOwn: 0, envelope };
        }
        const own = this.bounties.get(championId) ?? 0;
        this.bounties.delete(championId);
        if (own <= 0)
            return null;
        this.earned.set(championId, (this.earned.get(championId) ?? 0) + own);
        this.totalOut += own;
        return { winnerId: championId, victimId: championId, cash: own, addedToOwn: 0, envelope: null };
    }
    /**
     * 使われずに残ったバウンティを回収する（中止時や、封筒が余った場合）。
     * 会計を合わせるために必ず呼ぶこと。
     */
    sweepRemainder() {
        // まだ誰かの頭に乗っている賞金首は「余り」ではない。
        // 回収するのは、持ち主が消えたのに誰にも渡らなかった分だけ。
        // ここで全額を回収してしまうと、生存者の賞金首が二重計上になる
        let outstanding = 0;
        for (const v of this.bounties.values())
            outstanding += v;
        if (this.mode === 'mystery' && this.chest) {
            outstanding = this.chest.remainingAmounts().reduce((a, b) => a + b, 0);
        }
        let leftover = this.totalIn - this.totalOut - outstanding;
        if (leftover < 0)
            leftover = 0;
        this.totalOut += leftover;
        return leftover;
    }
    /** 現在の全プレイヤーの賞金首（表示用） */
    snapshot() {
        const ids = new Set([...this.bounties.keys(), ...this.earned.keys()]);
        return [...ids].map((userId) => ({
            userId,
            bounty: this.bountyOf(userId),
            earned: this.earnedBy(userId),
        }));
    }
    /** 会計の検証：支払い済み + 未払いの賞金首 = プール */
    audit() {
        let outstanding = 0;
        for (const v of this.bounties.values())
            outstanding += v;
        if (this.mode === 'mystery' && this.chest)
            outstanding = this.chest.remainingAmounts().reduce((a, b) => a + b, 0);
        return {
            ok: this.totalOut + outstanding === this.totalIn,
            pool: this.totalIn,
            paid: this.totalOut,
            outstanding,
        };
    }
}
//# sourceMappingURL=bounty.js.map