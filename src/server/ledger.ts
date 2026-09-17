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

export type LedgerReason =
  | 'signup_bonus'
  | 'table_buyin'
  | 'table_cashout'
  | 'table_rebuy'
  | 'purchase'
  | 'daily_bonus'
  | 'adjustment';

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

export class Ledger {
  private entries: LedgerEntry[] = [];
  private balances = new Map<string, number>();
  private nextId = 1;

  balanceOf(userId: string): number {
    return this.balances.get(userId) ?? 0;
  }

  /**
   * 取引を記録する。残高が不足する場合は false を返して何も書かない。
   * 「引けたつもりで引けていない」を防ぐため、必ず戻り値を確認すること。
   */
  post(userId: string, delta: number, reason: LedgerReason, ref?: string): LedgerEntry | null {
    if (!Number.isSafeInteger(delta)) throw new Error(`delta が整数ではありません: ${delta}`);
    const current = this.balanceOf(userId);
    const next = current + delta;
    if (next < 0) return null;

    const entry: LedgerEntry = {
      id: this.nextId++,
      userId,
      delta,
      reason,
      ref,
      at: Date.now(),
      balanceAfter: next,
    };
    this.entries.push(entry);
    this.balances.set(userId, next);
    return entry;
  }

  /** ユーザーの取引履歴（新しい順） */
  history(userId: string, limit = 50): LedgerEntry[] {
    const out: LedgerEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < limit; i--) {
      if (this.entries[i].userId === userId) out.push(this.entries[i]);
    }
    return out;
  }

  /**
   * 台帳の整合性を検証する。
   * 集計した残高とキャッシュした残高、および balanceAfter の連鎖が一致するかを見る。
   * 定期実行して、ズレたら即アラートを出す種類の処理。
   */
  audit(): { ok: boolean; problems: string[] } {
    const problems: string[] = [];
    const running = new Map<string, number>();
    for (const e of this.entries) {
      const next = (running.get(e.userId) ?? 0) + e.delta;
      running.set(e.userId, next);
      if (next !== e.balanceAfter) {
        problems.push(`取引 ${e.id}（${e.userId}）: balanceAfter=${e.balanceAfter} だが集計は ${next}`);
      }
      if (next < 0) problems.push(`取引 ${e.id}（${e.userId}）: 残高が負になっています`);
    }
    for (const [userId, bal] of this.balances) {
      if ((running.get(userId) ?? 0) !== bal) {
        problems.push(`${userId}: キャッシュ残高 ${bal} と台帳集計 ${running.get(userId) ?? 0} が不一致`);
      }
    }
    return { ok: problems.length === 0, problems };
  }

  /** 全ユーザーの残高合計。テーブル上のチップと合わせて総量保存を検証する */
  totalBalance(): number {
    let sum = 0;
    for (const v of this.balances.values()) sum += v;
    return sum;
  }

  get size(): number {
    return this.entries.length;
  }
}
