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
export interface Rank {
    key: string;
    name: string;
    /** 到達に必要な実績ポイント */
    minRp: number;
    /** 1 回の回復量 */
    rechargeAmount: number;
    /** 回復の間隔（ミリ秒） */
    rechargeIntervalMs: number;
    /** 時間回復で到達できる上限。ここが「躊躇い」の源泉 */
    rechargeCap: number;
    color: string;
}
export declare const RANKS: Rank[];
export interface Stake {
    key: string;
    name: string;
    smallBlind: number;
    bigBlind: number;
    buyIn: number;
    seats: number;
    /** 解禁に必要なランクの番号 */
    minRankIndex: number;
}
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
export declare const STAKES: Stake[];
export interface Achievement {
    id: string;
    name: string;
    detail: string;
    rp: number;
    /** 進捗の目標値 */
    target: number;
    /** どの統計を見るか */
    stat: keyof Stats;
}
export interface Stats {
    handsPlayed: number;
    handsWon: number;
    showdownsWon: number;
    bluffWins: number;
    cpuBusted: number;
    biggestPot: number;
    peakChips: number;
    bestStreak: number;
    streak: number;
    /** 作った最高の役（カテゴリ番号）。9 段階 */
    bestHandCategory: number;
    bestHandCards: string;
    bestHandName: string;
    totalWon: number;
}
export declare const ACHIEVEMENTS: Achievement[];
export interface SaveData {
    chips: number;
    /** 最後に回復を計算した時刻 */
    lastRechargeAt: number;
    claimedAchievements: string[];
    stats: Stats;
    createdAt: number;
    playerName: string;
}
export declare class Profile {
    data: SaveData;
    constructor(now?: number);
    private load;
    save(): void;
    reset(): void;
    get rp(): number;
    isAchieved(a: Achievement): boolean;
    progressOf(a: Achievement): number;
    get rank(): Rank;
    get rankIndex(): number;
    get nextRank(): Rank | null;
    /** 新しく達成された実績（前回チェックから増えた分）を返し、記録する */
    collectNewAchievements(): Achievement[];
    /**
     * 前回からの経過時間ぶんチップを回復する。
     *
     * タブを閉じていた間も進むよう、時刻の差分から計算しています。
     * 「開いている間だけ進む」設計にすると、放置しておくためにタブを開きっぱなしにさせる
     * ことになり、プレイヤーにとって損な行動を強いてしまいます。
     */
    applyRecharge(now?: number): number;
    /** 次の回復までの残り時間（ミリ秒）。上限に達していれば null */
    msUntilNextRecharge(now?: number): number | null;
    canAfford(amount: number): boolean;
    /**
     * now を引数に取るのは applyRecharge と時計を揃えるためです。
     * ここだけ Date.now() を直に呼ぶと、呼び出し側が別の時刻で計算しているときに
     * 補充のタイマーが噛み合わなくなります
     */
    spend(amount: number, now?: number): boolean;
    gain(amount: number): void;
    /** 今の所持で座れる卓 */
    availableStakes(): Stake[];
    recordHand(r: {
        won: boolean;
        showdown: boolean;
        potWon: number;
        bustedCpu: number;
        handCategory: number;
        handName: string;
        handCards: string;
    }): void;
}
export declare const fmtDuration: (ms: number) => string;
