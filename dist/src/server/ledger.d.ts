/**
 * チップ残高（追記専用の台帳）
 *
 * 残高を数値フィールドとして直接 UPDATE する実装は、必ず後で破綻する。
 * 二重加算、レース、原因不明の増減が起き、しかも「いつ何が起きたか」が残らないので
 * サポート対応でユーザーの申告を否定も肯定もできなくなる。
 *
 * ここでは取引を追記だけの台帳に記録し、残高はその集計として導出する。
 * 本番では Postgres のテーブルに置き換えるが、インターフェースは同じにしておく。
 */
export type LedgerReason = 'signup_bonus' | 'table_buyin' | 'table_cashout' | 'table_rebuy' | 'purchase' | 'daily_bonus' | 'adjustment';
export interface LedgerEntry {
    id: number;
    userId: string;
    /** 正なら増加、負なら減少 */
    delta: number;
    reason: LedgerReason;
    /** 関連するテーブル・ハンドなど */
    ref?: string;
    at: number;
    /** この取引を適用した直後の残高。監査で不整合を検出しやすくするために持つ */
    balanceAfter: number;
}
export declare class Ledger {
    private entries;
    private balances;
    private nextId;
    balanceOf(userId: string): number;
    /**
     * 取引を記録する。残高が不足する場合は false を返して何も書かない。
     * 「引けたつもりで引けていない」を防ぐため、必ず戻り値を確認すること。
     */
    post(userId: string, delta: number, reason: LedgerReason, ref?: string): LedgerEntry | null;
    /** ユーザーの取引履歴（新しい順） */
    history(userId: string, limit?: number): LedgerEntry[];
    /**
     * 台帳の整合性を検証する。
     * 集計した残高とキャッシュした残高、および balanceAfter の連鎖が一致するかを見る。
     * 定期実行して、ズレたら即アラートを出す種類の処理。
     */
    audit(): {
        ok: boolean;
        problems: string[];
    };
    /** 全ユーザーの残高合計。テーブル上のチップと合わせて総量保存を検証する */
    totalBalance(): number;
    get size(): number;
}
