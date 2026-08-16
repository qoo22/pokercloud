/**
 * 永続化層
 *
 * 設計方針：
 *   1. 残高は「実体化した数値（users.chips）」と「追記専用の仕訳（ledger）」の二本立てにする。
 *      数値だけだと監査できず、仕訳だけだと毎回集計が必要になる。両方持って、
 *      audit() で常に一致することを検証する。ズレたら即アラートを出す種類の指標。
 *   2. 残高の更新と仕訳の追記は必ず同一トランザクションで行う。ここが分かれていると、
 *      プロセスが落ちた瞬間に「引かれたのに記録が無い」状態が生まれる。
 *   3. インターフェースを切って、メモリ実装と SQLite 実装を差し替えられるようにする。
 *      テストはメモリ実装で回し（速い・後片付け不要）、本番は SQLite を使う。
 *
 * node:sqlite は Node 22 の組み込みモジュール。追加依存ゼロで単一ファイル DB になる。
 * 実験的 API という警告が出るが、使っているのは exec / prepare / run / all / transaction 相当の
 * 最小限の機能だけなので、将来 better-sqlite3 や Postgres へ移すのも容易にしてある。
 */
export type Currency = 'chips' | 'gold';
export type LedgerReason = 'signup_bonus' | 'table_buyin' | 'table_cashout' | 'table_rebuy' | 'tournament_buyin' | 'tournament_prize' | 'purchase' | 'daily_bonus' | 'mission_reward' | 'pass_reward' | 'piggy_bank' | 'vip_reward' | 'adjustment';
export interface LedgerRow {
    id: number;
    userId: string;
    currency: Currency;
    delta: number;
    reason: LedgerReason;
    ref: string | null;
    at: number;
    balanceAfter: number;
}
export interface UserRow {
    userId: string;
    name: string;
    createdAt: number;
    lastSeen: number;
    chips: number;
    gold: number;
    /** 累計 VIP ポイント（購入額に比例して増える） */
    vipPoints: number;
    /** 累計課金額（円）。分析用 */
    lifetimeSpend: number;
    /** 貯金箱に溜まっているチップ */
    piggyBank: number;
    /** 連続ログイン日数 */
    loginStreak: number;
    /** 最後にデイリーボーナスを受け取った日（YYYY-MM-DD） */
    lastDailyBonus: string | null;
}
export interface HandRow {
    handId: string;
    tableId: string;
    handNumber: number;
    at: number;
    board: string;
    potTotal: number;
    rake: number;
    /** Provably Fair の開示情報（JSON） */
    fairness: string;
    /** 席ごとの結果（JSON） */
    seats: string;
}
export interface PurchaseRow {
    id: number;
    userId: string;
    sku: string;
    priceJpy: number;
    granted: string;
    receipt: string;
    at: number;
}
export interface ProgressRow {
    userId: string;
    key: string;
    value: number;
    /** 日次リセットするものは日付を入れる */
    day: string | null;
    updatedAt: number;
}
export interface Store {
    getUser(userId: string): UserRow | null;
    createUser(userId: string, name: string): UserRow;
    upsertUser(userId: string, name: string): UserRow;
    updateUser(userId: string, patch: Partial<Omit<UserRow, 'userId'>>): void;
    listUsers(limit?: number): UserRow[];
    /**
     * 残高を増減し、同時に仕訳を追記する。
     * 残高が不足する場合は何も書かずに null を返す。必ず戻り値を確認すること。
     */
    post(userId: string, currency: Currency, delta: number, reason: LedgerReason, ref?: string): LedgerRow | null;
    balance(userId: string, currency: Currency): number;
    history(userId: string, limit?: number): LedgerRow[];
    saveHand(row: Omit<HandRow, 'at'> & {
        at?: number;
    }): void;
    getHand(handId: string): HandRow | null;
    recentHands(userId: string, limit?: number): HandRow[];
    savePurchase(row: Omit<PurchaseRow, 'id' | 'at'> & {
        at?: number;
    }): PurchaseRow;
    /** 同じレシートが既に使われていないか（二重付与の防止） */
    hasReceipt(receipt: string): boolean;
    purchases(userId: string, limit?: number): PurchaseRow[];
    getProgress(userId: string, key: string): ProgressRow | null;
    setProgress(userId: string, key: string, value: number, day?: string | null): void;
    listProgress(userId: string, prefix: string): ProgressRow[];
    /** 仕訳の集計と実体化残高が一致するかを検証する */
    audit(): {
        ok: boolean;
        problems: string[];
    };
    /** 一貫性のあるスナップショットを path に書き出す(SQLiteのみ)。成功で true */
    snapshotTo?(path: string): boolean;
    /** bot_ で始まるユーザーのうち、しばらく見ていないものと関連行を削除。削除行数を返す */
    pruneBots?(olderThanMs: number): number;
    totalBalance(currency: Currency): number;
    close(): void;
}
export declare class MemoryStore implements Store {
    private users;
    private ledger;
    private hands;
    private purchasesById;
    private receipts;
    private progress;
    private nextLedgerId;
    private nextPurchaseId;
    getUser(userId: string): UserRow | null;
    createUser(userId: string, name: string): UserRow;
    upsertUser(userId: string, name: string): UserRow;
    updateUser(userId: string, patch: Partial<Omit<UserRow, 'userId'>>): void;
    listUsers(limit?: number): UserRow[];
    post(userId: string, currency: Currency, delta: number, reason: LedgerReason, ref?: string): LedgerRow | null;
    balance(userId: string, currency: Currency): number;
    history(userId: string, limit?: number): LedgerRow[];
    saveHand(row: Omit<HandRow, 'at'> & {
        at?: number;
    }): void;
    getHand(handId: string): HandRow | null;
    recentHands(userId: string, limit?: number): HandRow[];
    savePurchase(row: Omit<PurchaseRow, 'id' | 'at'> & {
        at?: number;
    }): PurchaseRow;
    hasReceipt(receipt: string): boolean;
    purchases(userId: string, limit?: number): PurchaseRow[];
    getProgress(userId: string, key: string): ProgressRow | null;
    setProgress(userId: string, key: string, value: number, day?: string | null): void;
    listProgress(userId: string, prefix: string): ProgressRow[];
    audit(): {
        ok: boolean;
        problems: string[];
    };
    totalBalance(currency: Currency): number;
    close(): void;
}
interface SqliteDb {
    exec(sql: string): void;
    prepare(sql: string): {
        run(...params: unknown[]): {
            changes: number;
            lastInsertRowid: number | bigint;
        };
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
    };
    close(): void;
}
export declare class SqliteStore implements Store {
    private db;
    constructor(db: SqliteDb);
    /**
     * ファイル（または ':memory:'）を開いて Store を作る。
     * node:sqlite は同期 API なので、await 不要でそのまま使える。
     */
    static open(path: string): Promise<SqliteStore>;
    /**
     * VACUUM INTO でトランザクション一貫性のあるコピーを作る(WALでも安全)。
     * 宛先が既存だと失敗するので呼び出し側で消してから使うこと。
     */
    snapshotTo(path: string): boolean;
    /**
     * botのデータ掃除。botは接続ごとに使い捨ての bot_xxx ユーザーを作るため、
     * 放置するとDBが際限なく育つ。最後に見てから olderThanMs 経過した bot_ ユーザーの
     * 仕訳・購入・進捗・本体をまとめて消す(進行中のbotは last_seen が新しいので消えない)。
     */
    pruneBots(olderThanMs: number): number;
    private rowToUser;
    getUser(userId: string): UserRow | null;
    createUser(userId: string, name: string): UserRow;
    upsertUser(userId: string, name: string): UserRow;
    updateUser(userId: string, patch: Partial<Omit<UserRow, 'userId'>>): void;
    listUsers(limit?: number): UserRow[];
    post(userId: string, currency: Currency, delta: number, reason: LedgerReason, ref?: string): LedgerRow | null;
    balance(userId: string, currency: Currency): number;
    history(userId: string, limit?: number): LedgerRow[];
    saveHand(row: Omit<HandRow, 'at'> & {
        at?: number;
    }): void;
    getHand(handId: string): HandRow | null;
    recentHands(userId: string, limit?: number): HandRow[];
    savePurchase(row: Omit<PurchaseRow, 'id' | 'at'> & {
        at?: number;
    }): PurchaseRow;
    hasReceipt(receipt: string): boolean;
    purchases(userId: string, limit?: number): PurchaseRow[];
    getProgress(userId: string, key: string): ProgressRow | null;
    setProgress(userId: string, key: string, value: number, day?: string | null): void;
    listProgress(userId: string, prefix: string): ProgressRow[];
    audit(): {
        ok: boolean;
        problems: string[];
    };
    totalBalance(currency: Currency): number;
    close(): void;
}
export {};
