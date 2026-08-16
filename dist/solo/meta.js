/**
 * チップ経済・ランク・実績
 *
 * 設計の狙いは「チップを失うことに躊躇いを持たせる」ことです。
 * そのために効くのは、増やす手段を絞ることではなく、**回復の上限を低く保つ**ことでした。
 *
 *   - 時間で回復するが、回復は「下の卓に座れる額」までしか溜まらない
 *   - 上の卓に行くには勝って増やすしかない
 *   - つまり大きなスタックは「時間では買い戻せない」ので、失うのが惜しくなる
 *
 * 逆にやってはいけないのは、回復をゼロにして完全に詰ませることです。
 * 復帰できないゲームは、躊躇いではなく離脱を生みます。
 * 下の卓には常に戻れる、という逃げ道を必ず残しています。
 *
 * ランクを上げると回復が速く・多く・上限も高くなるので、
 * 「遊び続けるほど資金繰りが楽になる」という前進感が出ます。
 */
export const RANKS = [
    { key: 'rookie', name: 'ルーキー', minRp: 0, rechargeAmount: 1_000, rechargeIntervalMs: 8 * 60_000, rechargeCap: 3_000, color: '#8b97a5' },
    { key: 'amateur', name: 'アマチュア', minRp: 120, rechargeAmount: 2_500, rechargeIntervalMs: 6 * 60_000, rechargeCap: 20_000, color: '#4dbd7a' },
    { key: 'semipro', name: 'セミプロ', minRp: 350, rechargeAmount: 8_000, rechargeIntervalMs: 5 * 60_000, rechargeCap: 80_000, color: '#5a9de0' },
    { key: 'pro', name: 'プロ', minRp: 800, rechargeAmount: 30_000, rechargeIntervalMs: 4 * 60_000, rechargeCap: 350_000, color: '#a97bff' },
    { key: 'highroller', name: 'ハイローラー', minRp: 1_600, rechargeAmount: 120_000, rechargeIntervalMs: 3 * 60_000, rechargeCap: 1_500_000, color: '#d9b45f' },
    { key: 'legend', name: 'レジェンド', minRp: 2_200, rechargeAmount: 500_000, rechargeIntervalMs: 2 * 60_000, rechargeCap: 4_000_000, color: '#ff7a59' },
];
/**
 * 卓のレート。
 * バイインは「その卓に座るために必要な額」で、回復上限との関係が要になります。
 * 各ランクで守っている条件は 2 つだけです。
 *
 *   1. 回復上限 >= そのランクで一番安い卓 … 必ず戻れる（詰まない）
 *   2. 回復上限 <  そのランクで一番高い卓 … 上の卓は勝たないと座れない
 *
 * 例えばルーキーは上限 3,000。マイクロ 6 人（2,000）には必ず座れますが、
 * ヘッズアップ（4,000）は一度勝ってからでないと座れません。
 * この 2 つは test/solo.test.ts で全ランクぶん機械的に検査しています。
 */
export const STAKES = [
    { key: 'micro6', name: 'マイクロ 6人', smallBlind: 25, bigBlind: 50, buyIn: 2_000, seats: 6, minRankIndex: 0 },
    { key: 'microhu', name: 'マイクロ ヘッズアップ', smallBlind: 50, bigBlind: 100, buyIn: 4_000, seats: 2, minRankIndex: 0 },
    { key: 'low6', name: 'ロー 6人', smallBlind: 100, bigBlind: 200, buyIn: 12_000, seats: 6, minRankIndex: 1 },
    { key: 'lowhu', name: 'ロー ヘッズアップ', smallBlind: 200, bigBlind: 400, buyIn: 24_000, seats: 2, minRankIndex: 1 },
    { key: 'mid6', name: 'ミドル 6人', smallBlind: 500, bigBlind: 1_000, buyIn: 60_000, seats: 6, minRankIndex: 2 },
    { key: 'midhu', name: 'ミドル ヘッズアップ', smallBlind: 1_000, bigBlind: 2_000, buyIn: 120_000, seats: 2, minRankIndex: 2 },
    { key: 'high6', name: 'ハイ 6人', smallBlind: 5_000, bigBlind: 10_000, buyIn: 600_000, seats: 6, minRankIndex: 3 },
    { key: 'nose6', name: 'ノーズブリード 6人', smallBlind: 50_000, bigBlind: 100_000, buyIn: 6_000_000, seats: 6, minRankIndex: 4 },
];
export const ACHIEVEMENTS = [
    { id: 'play10', name: '座り慣れる', detail: '10 ハンドをプレイ', rp: 10, target: 10, stat: 'handsPlayed' },
    { id: 'play100', name: '常連', detail: '100 ハンドをプレイ', rp: 30, target: 100, stat: 'handsPlayed' },
    { id: 'play500', name: 'グラインダー', detail: '500 ハンドをプレイ', rp: 80, target: 500, stat: 'handsPlayed' },
    { id: 'win1', name: '初勝利', detail: 'ハンドに 1 回勝つ', rp: 10, target: 1, stat: 'handsWon' },
    { id: 'win25', name: '勝ち方を覚える', detail: 'ハンドに 25 回勝つ', rp: 30, target: 25, stat: 'handsWon' },
    { id: 'win150', name: '勝ち続ける', detail: 'ハンドに 150 回勝つ', rp: 90, target: 150, stat: 'handsWon' },
    { id: 'sd10', name: '見せて勝つ', detail: 'ショーダウンで 10 回勝つ', rp: 25, target: 10, stat: 'showdownsWon' },
    { id: 'sd50', name: '読み勝ち', detail: 'ショーダウンで 50 回勝つ', rp: 70, target: 50, stat: 'showdownsWon' },
    { id: 'bluff5', name: '見せずに勝つ', detail: 'ショーダウンなしで 5 回勝つ', rp: 25, target: 5, stat: 'bluffWins' },
    { id: 'bluff30', name: '駆け引き巧者', detail: 'ショーダウンなしで 30 回勝つ', rp: 70, target: 30, stat: 'bluffWins' },
    { id: 'bust1', name: '撃墜', detail: 'CPU を 1 人飛ばす', rp: 20, target: 1, stat: 'cpuBusted' },
    { id: 'bust10', name: 'テーブルの捕食者', detail: 'CPU を 10 人飛ばす', rp: 60, target: 10, stat: 'cpuBusted' },
    { id: 'bust50', name: '卓の主', detail: 'CPU を 50 人飛ばす', rp: 150, target: 50, stat: 'cpuBusted' },
    { id: 'streak3', name: '3 連勝', detail: '3 ハンド連続で勝つ', rp: 25, target: 3, stat: 'bestStreak' },
    { id: 'streak6', name: '波に乗る', detail: '6 ハンド連続で勝つ', rp: 60, target: 6, stat: 'bestStreak' },
    { id: 'pot20k', name: '大きなポット', detail: '20,000 のポットを取る', rp: 30, target: 20_000, stat: 'biggestPot' },
    { id: 'pot200k', name: '記録的なポット', detail: '200,000 のポットを取る', rp: 90, target: 200_000, stat: 'biggestPot' },
    { id: 'pot2m', name: '伝説のポット', detail: '2,000,000 のポットを取る', rp: 200, target: 2_000_000, stat: 'biggestPot' },
    { id: 'chip50k', name: '資産形成', detail: '所持 50,000 に到達', rp: 40, target: 50_000, stat: 'peakChips' },
    { id: 'chip500k', name: '富豪', detail: '所持 500,000 に到達', rp: 120, target: 500_000, stat: 'peakChips' },
    { id: 'chip5m', name: '大富豪', detail: '所持 5,000,000 に到達', rp: 300, target: 5_000_000, stat: 'peakChips' },
    { id: 'chip50m', name: '桁が違う', detail: '所持 50,000,000 に到達', rp: 600, target: 50_000_000, stat: 'peakChips' },
    { id: 'flush', name: 'フラッシュ', detail: 'フラッシュ以上を作る', rp: 25, target: 5, stat: 'bestHandCategory' },
    { id: 'boat', name: 'フルハウス', detail: 'フルハウス以上を作る', rp: 45, target: 6, stat: 'bestHandCategory' },
    { id: 'quads', name: 'フォーカード', detail: 'フォーカード以上を作る', rp: 100, target: 7, stat: 'bestHandCategory' },
    { id: 'sf', name: 'ストレートフラッシュ', detail: 'ストレートフラッシュを作る', rp: 300, target: 8, stat: 'bestHandCategory' },
];
// ---------------------------------------------------------------------------
// セーブデータ
// ---------------------------------------------------------------------------
const SAVE_KEY = 'poker.solo.v1';
const emptyStats = () => ({
    handsPlayed: 0,
    handsWon: 0,
    showdownsWon: 0,
    bluffWins: 0,
    cpuBusted: 0,
    biggestPot: 0,
    peakChips: 0,
    bestStreak: 0,
    streak: 0,
    bestHandCategory: -1,
    bestHandCards: '',
    bestHandName: '—',
    totalWon: 0,
});
const STARTING_CHIPS = 5_000;
export class Profile {
    data;
    constructor(now = Date.now()) {
        this.data = this.load(now);
        this.applyRecharge(now);
    }
    load(now) {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                // 欠けている項目は既定値で埋める（バージョン差で壊れないように）
                return {
                    chips: Number.isFinite(parsed.chips) ? parsed.chips : STARTING_CHIPS,
                    lastRechargeAt: parsed.lastRechargeAt ?? now,
                    claimedAchievements: parsed.claimedAchievements ?? [],
                    stats: { ...emptyStats(), ...(parsed.stats ?? {}) },
                    createdAt: parsed.createdAt ?? now,
                    playerName: parsed.playerName ?? 'あなた',
                };
            }
        }
        catch {
            /* 壊れていたら作り直す */
        }
        return {
            chips: STARTING_CHIPS,
            lastRechargeAt: now,
            claimedAchievements: [],
            stats: { ...emptyStats(), peakChips: STARTING_CHIPS },
            createdAt: now,
            playerName: 'あなた',
        };
    }
    save() {
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
        }
        catch {
            /* 保存できない環境でも遊べるようにする */
        }
    }
    reset() {
        try {
            localStorage.removeItem(SAVE_KEY);
        }
        catch {
            /* 無視 */
        }
        this.data = this.load(Date.now());
    }
    // --- 実績とランク ---
    get rp() {
        let n = 0;
        for (const a of ACHIEVEMENTS)
            if (this.isAchieved(a))
                n += a.rp;
        return n;
    }
    isAchieved(a) {
        const v = this.data.stats[a.stat];
        return typeof v === 'number' && v >= a.target;
    }
    progressOf(a) {
        const v = this.data.stats[a.stat];
        return typeof v === 'number' ? Math.min(1, v / a.target) : 0;
    }
    get rank() {
        const rp = this.rp;
        let r = RANKS[0];
        for (const x of RANKS)
            if (rp >= x.minRp)
                r = x;
        return r;
    }
    get rankIndex() {
        return RANKS.indexOf(this.rank);
    }
    get nextRank() {
        const i = this.rankIndex;
        return i + 1 < RANKS.length ? RANKS[i + 1] : null;
    }
    /** 新しく達成された実績（前回チェックから増えた分）を返し、記録する */
    collectNewAchievements() {
        const fresh = [];
        for (const a of ACHIEVEMENTS) {
            if (this.isAchieved(a) && !this.data.claimedAchievements.includes(a.id)) {
                this.data.claimedAchievements.push(a.id);
                fresh.push(a);
            }
        }
        if (fresh.length)
            this.save();
        return fresh;
    }
    // --- 時間回復 ---
    /**
     * 前回からの経過時間ぶんチップを回復する。
     *
     * タブを閉じていた間も進むよう、時刻の差分から計算しています。
     * 「開いている間だけ進む」設計にすると、放置しておくためにタブを開きっぱなしにさせる
     * ことになり、プレイヤーにとって損な行動を強いてしまいます。
     */
    applyRecharge(now = Date.now()) {
        const r = this.rank;
        if (this.data.chips >= r.rechargeCap) {
            this.data.lastRechargeAt = now;
            return 0;
        }
        const elapsed = now - this.data.lastRechargeAt;
        const ticks = Math.floor(elapsed / r.rechargeIntervalMs);
        if (ticks <= 0)
            return 0;
        const before = this.data.chips;
        this.data.chips = Math.min(r.rechargeCap, this.data.chips + ticks * r.rechargeAmount);
        this.data.lastRechargeAt += ticks * r.rechargeIntervalMs;
        this.save();
        return this.data.chips - before;
    }
    /** 次の回復までの残り時間（ミリ秒）。上限に達していれば null */
    msUntilNextRecharge(now = Date.now()) {
        const r = this.rank;
        if (this.data.chips >= r.rechargeCap)
            return null;
        const elapsed = now - this.data.lastRechargeAt;
        return Math.max(0, r.rechargeIntervalMs - (elapsed % r.rechargeIntervalMs));
    }
    // --- チップの出入り ---
    canAfford(amount) {
        return this.data.chips >= amount;
    }
    /**
     * now を引数に取るのは applyRecharge と時計を揃えるためです。
     * ここだけ Date.now() を直に呼ぶと、呼び出し側が別の時刻で計算しているときに
     * 補充のタイマーが噛み合わなくなります
     */
    spend(amount, now = Date.now()) {
        if (!this.canAfford(amount))
            return false;
        this.data.chips -= amount;
        // 上限より下に落ちた瞬間から回復のタイマーを始める
        if (this.data.chips < this.rank.rechargeCap) {
            this.data.lastRechargeAt = now;
        }
        this.save();
        return true;
    }
    gain(amount) {
        this.data.chips += amount;
        this.data.stats.peakChips = Math.max(this.data.stats.peakChips, this.data.chips);
        this.save();
    }
    /** 今の所持で座れる卓 */
    availableStakes() {
        return STAKES.filter((s) => s.minRankIndex <= this.rankIndex);
    }
    // --- 統計の更新 ---
    recordHand(r) {
        const s = this.data.stats;
        s.handsPlayed++;
        if (r.won) {
            s.handsWon++;
            s.streak++;
            s.bestStreak = Math.max(s.bestStreak, s.streak);
            s.totalWon += r.potWon;
            s.biggestPot = Math.max(s.biggestPot, r.potWon);
            if (r.showdown)
                s.showdownsWon++;
            else
                s.bluffWins++;
        }
        else {
            s.streak = 0;
        }
        s.cpuBusted += r.bustedCpu;
        if (r.handCategory > s.bestHandCategory) {
            s.bestHandCategory = r.handCategory;
            s.bestHandName = r.handName;
            s.bestHandCards = r.handCards;
        }
        this.save();
    }
}
export const fmtDuration = (ms) => {
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}分${String(s % 60).padStart(2, '0')}秒` : `${s}秒`;
};
//# sourceMappingURL=meta.js.map