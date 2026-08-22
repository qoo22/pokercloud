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
export type LedgerReason = 'signup_bonus' | 'table_buyin' | 'table_cashout' | 'table_rebuy' | 'tournament_buyin' | 'tournament_prize' | 'purchase' | 'daily_bonus' | 'mission_reward' | 'pass_reward' | 'piggy_bank' | 'vip_reward'
/** ゴールドスロット: 賭けたゴールドの消費 */
 | 'slot_spin'
/** ゴールドスロット: チップの払い出し */
 | 'slot_win'
/** 落ちた卓に残っていたスタックの払い戻し(再起動時の自動復旧) */
 | 'table_recover' | 'adjustment' | 'ad_reward';
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
/**
 * 引き継ぎコード。端末を変えたときにアカウントを持ち出すための控え。
 * PIN は生のまま持たず、ハッシュだけを保存する。
 */
export interface TransferCodeRow {
    code: string;
    userId: string;
    pinHash: string;
    createdAt: number;
    /** PIN の失敗回数。増えすぎたら無効化して総当たりを防ぐ */
    attempts: number;
}
/** 着席中のスタック(未精算)。サーバーが落ちてもここから払い戻せる */
export interface OpenSeatRow {
    userId: string;
    tableId: string;
    stack: number;
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
    /** 引き継ぎコードを保存する。同じユーザーの古いコードは呼び出し側で消すこと */
    setTransferCode(row: TransferCodeRow): void;
    getTransferCode(code: string): TransferCodeRow | null;
    /** PIN 失敗を数える。増えた後の回数を返す */
    bumpTransferAttempts(code: string): number;
    deleteTransferCode(code: string): void;
    /** 再発行時に、そのユーザーの古いコードを全部無効化する */
    deleteTransferCodesOf(userId: string): void;
    /** そのユーザーが引き継ぎコードを発行済みか(未発行なら警告を出すため) */
    hasTransferCode(userId: string): boolean;
    /** 着席中スタックを記録/更新する(再起動時の払い戻しに使う) */
    setOpenSeat(userId: string, tableId: string, stack: number): void;
    /** 精算済みとして着席記録を消す */
    clearOpenSeat(userId: string, tableId: string): void;
    /** 未精算のまま残っている着席記録をすべて返す */
    listOpenSeats(): OpenSeatRow[];
    /** 仕訳の集計と実体化残高が一致するかを検証する */
    audit(): {
        ok: boolean;
        problems: string[];
    };
    /** 一貫性のあるスナップショットを path に書き出す(SQLiteのみ)。成功で true */
    snapshotTo?(path: string): boolean;
    /**
     * バックアップ用の「人間データだけ」のスナップショットを path に書き出す。
     * bot_ 行とハンド履歴(ゲームログ、残高に無関係)を除く。成功で true。
     */
    snapshotHumansTo?(path: string): boolean;
    /**
     * 人間の残高・課金・進捗を決定的にまとめた指紋(hash)。bot がいくら動いても不変で、
     * 人間の状態が変わったときだけ変化する。バックアップの差分検知(=送るか否か)に使う。
     */
    humanStateFingerprint?(): string;
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
    private openSeats;
    private transferCodes;
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
    setOpenSeat(userId: string, tableId: string, stack: number): void;
    clearOpenSeat(userId: string, tableId: string): void;
    listOpenSeats(): OpenSeatRow[];
    setTransferCode(row: TransferCodeRow): void;
    getTransferCode(code: string): TransferCodeRow | null;
    bumpTransferAttempts(code: string): number;
    deleteTransferCode(code: string): void;
    deleteTransferCodesOf(userId: string): void;
    hasTransferCode(userId: string): boolean;
    /**
     * 状態をJSON文字列にする(オフライン版でブラウザに保存するため)。
     *
     * ハンド履歴(hands)は意図的に含めない。残高とは無関係なゲームログで、
     * 際限なく増えて localStorage(数MB)を食い潰すため。
     * 1つのJSONにまとめてあるので、そのままエクスポート/インポートにも使える。
     */
    serialize(): string;
    /** serialize() の出力から状態を復元する。壊れていれば何もしない(初期状態のまま) */
    restore(json: string): boolean;
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
    /** バックアップ用の一時DBを同期的に開くために、コンストラクタを保持しておく */
    private dbCtor;
    constructor(db: SqliteDb, dbCtor?: (new (p: string) => SqliteDb) | null);
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
     * バックアップ専用の「人間データだけ」のスナップショット。
     * まず完全コピーを作り、そのコピー側で bot_ 行とハンド履歴(ゲームログ)を消して VACUUM する。
     * 残るのは人間の users/ledger/purchases/progress のみ。人間の残高・仕訳が変わらなければ
     * 出力ファイルは毎回バイト同一になるので、GitHubプッシュの差分検知が効いて送信が起きない。
     * ハンド履歴は残高に無関係なゲームログなので、通信量削減のためバックアップからは除外する
     * (ライブDBには直近ぶんを残す。UI表示や公正性検証はライブで行う)。
     */
    snapshotHumansTo(path: string): boolean;
    /**
     * 人間の状態(残高・課金・進捗)の決定的な指紋。bot と hands は含めないので、
     * bot が動いても不変。ゲームサーバーはこれが変わったときだけバックアップを送る。
     * セキュリティ用途ではないので軽量な FNV-1a で十分(依存追加を避ける)。
     */
    humanStateFingerprint(): string;
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
    setTransferCode(row: TransferCodeRow): void;
    getTransferCode(code: string): TransferCodeRow | null;
    bumpTransferAttempts(code: string): number;
    deleteTransferCode(code: string): void;
    deleteTransferCodesOf(userId: string): void;
    hasTransferCode(userId: string): boolean;
    setOpenSeat(userId: string, tableId: string, stack: number): void;
    clearOpenSeat(userId: string, tableId: string): void;
    listOpenSeats(): OpenSeatRow[];
    audit(): {
        ok: boolean;
        problems: string[];
    };
    totalBalance(currency: Currency): number;
    close(): void;
}
export {};
