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

export type LedgerReason =
  | 'signup_bonus'
  | 'table_buyin'
  | 'table_cashout'
  | 'table_rebuy'
  | 'tournament_buyin'
  | 'tournament_prize'
  | 'purchase'
  | 'daily_bonus'
  | 'mission_reward'
  | 'pass_reward'
  | 'piggy_bank'
  | 'vip_reward'
  /** ゴールドスロット: 賭けたゴールドの消費 */
  | 'slot_spin'
  /** ゴールドスロット: チップの払い出し */
  | 'slot_win'
  /** バカラ: 賭け金の消費(第117弾) */
  | 'baccarat_bet'
  /** バカラ: 払い戻し(第117弾) */
  | 'baccarat_win'
  /** 落ちた卓に残っていたスタックの払い戻し(再起動時の自動復旧) */
  | 'table_recover'
  | 'adjustment'
  | 'ad_reward';

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

  saveHand(row: Omit<HandRow, 'at'> & { at?: number }): void;
  getHand(handId: string): HandRow | null;
  recentHands(userId: string, limit?: number): HandRow[];

  savePurchase(row: Omit<PurchaseRow, 'id' | 'at'> & { at?: number }): PurchaseRow;
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
  audit(): { ok: boolean; problems: string[] };

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

// ---------------------------------------------------------------------------
// メモリ実装（テスト用）
// ---------------------------------------------------------------------------

export class MemoryStore implements Store {
  private users = new Map<string, UserRow>();
  private ledger: LedgerRow[] = [];
  private hands = new Map<string, HandRow>();
  private purchasesById: PurchaseRow[] = [];
  private receipts = new Set<string>();
  private progress = new Map<string, ProgressRow>();
  private openSeats = new Map<string, OpenSeatRow>();
  private transferCodes = new Map<string, TransferCodeRow>();
  private nextLedgerId = 1;
  private nextPurchaseId = 1;

  getUser(userId: string): UserRow | null {
    return this.users.get(userId) ?? null;
  }

  createUser(userId: string, name: string): UserRow {
    const now = Date.now();
    const u: UserRow = {
      userId,
      name,
      createdAt: now,
      lastSeen: now,
      chips: 0,
      gold: 0,
      vipPoints: 0,
      lifetimeSpend: 0,
      piggyBank: 0,
      loginStreak: 0,
      lastDailyBonus: null,
    };
    this.users.set(userId, u);
    return u;
  }

  upsertUser(userId: string, name: string): UserRow {
    const existing = this.users.get(userId);
    if (existing) {
      existing.name = name;
      existing.lastSeen = Date.now();
      return existing;
    }
    return this.createUser(userId, name);
  }

  updateUser(userId: string, patch: Partial<Omit<UserRow, 'userId'>>): void {
    const u = this.users.get(userId);
    if (!u) return;
    Object.assign(u, patch);
  }

  listUsers(limit = 100): UserRow[] {
    return [...this.users.values()].slice(0, limit);
  }

  post(userId: string, currency: Currency, delta: number, reason: LedgerReason, ref?: string): LedgerRow | null {
    if (!Number.isSafeInteger(delta)) throw new Error(`delta が整数ではありません: ${delta}`);
    const u = this.users.get(userId) ?? this.createUser(userId, userId);
    const current = currency === 'chips' ? u.chips : u.gold;
    const next = current + delta;
    if (next < 0) return null;

    if (currency === 'chips') u.chips = next;
    else u.gold = next;

    const row: LedgerRow = {
      id: this.nextLedgerId++,
      userId,
      currency,
      delta,
      reason,
      ref: ref ?? null,
      at: Date.now(),
      balanceAfter: next,
    };
    this.ledger.push(row);
    return row;
  }

  balance(userId: string, currency: Currency): number {
    const u = this.users.get(userId);
    if (!u) return 0;
    return currency === 'chips' ? u.chips : u.gold;
  }

  history(userId: string, limit = 50): LedgerRow[] {
    const out: LedgerRow[] = [];
    for (let i = this.ledger.length - 1; i >= 0 && out.length < limit; i--) {
      if (this.ledger[i].userId === userId) out.push(this.ledger[i]);
    }
    return out;
  }

  saveHand(row: Omit<HandRow, 'at'> & { at?: number }): void {
    this.hands.set(row.handId, { ...row, at: row.at ?? Date.now() });
  }

  getHand(handId: string): HandRow | null {
    return this.hands.get(handId) ?? null;
  }

  recentHands(userId: string, limit = 20): HandRow[] {
    return [...this.hands.values()]
      .filter((h) => h.seats.includes(`"${userId}"`))
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  }

  savePurchase(row: Omit<PurchaseRow, 'id' | 'at'> & { at?: number }): PurchaseRow {
    const p: PurchaseRow = { ...row, id: this.nextPurchaseId++, at: row.at ?? Date.now() };
    this.purchasesById.push(p);
    this.receipts.add(row.receipt);
    return p;
  }

  hasReceipt(receipt: string): boolean {
    return this.receipts.has(receipt);
  }

  purchases(userId: string, limit = 50): PurchaseRow[] {
    return this.purchasesById
      .filter((p) => p.userId === userId)
      .slice(-limit)
      .reverse();
  }

  getProgress(userId: string, key: string): ProgressRow | null {
    return this.progress.get(`${userId} ${key}`) ?? null;
  }

  setProgress(userId: string, key: string, value: number, day: string | null = null): void {
    this.progress.set(`${userId} ${key}`, { userId, key, value, day, updatedAt: Date.now() });
  }

  listProgress(userId: string, prefix: string): ProgressRow[] {
    return [...this.progress.values()].filter((p) => p.userId === userId && p.key.startsWith(prefix));
  }

  setOpenSeat(userId: string, tableId: string, stack: number): void {
    this.openSeats.set(`${userId} ${tableId}`, { userId, tableId, stack, updatedAt: Date.now() });
  }

  clearOpenSeat(userId: string, tableId: string): void {
    this.openSeats.delete(`${userId} ${tableId}`);
  }

  listOpenSeats(): OpenSeatRow[] {
    return [...this.openSeats.values()];
  }

  setTransferCode(row: TransferCodeRow): void {
    this.transferCodes.set(row.code, { ...row });
  }

  getTransferCode(code: string): TransferCodeRow | null {
    return this.transferCodes.get(code) ?? null;
  }

  bumpTransferAttempts(code: string): number {
    const r = this.transferCodes.get(code);
    if (!r) return 0;
    r.attempts += 1;
    return r.attempts;
  }

  deleteTransferCode(code: string): void {
    this.transferCodes.delete(code);
  }

  deleteTransferCodesOf(userId: string): void {
    for (const [c, r] of [...this.transferCodes]) if (r.userId === userId) this.transferCodes.delete(c);
  }

  hasTransferCode(userId: string): boolean {
    for (const r of this.transferCodes.values()) if (r.userId === userId) return true;
    return false;
  }

  /**
   * 状態をJSON文字列にする(オフライン版でブラウザに保存するため)。
   *
   * ハンド履歴(hands)は意図的に含めない。残高とは無関係なゲームログで、
   * 際限なく増えて localStorage(数MB)を食い潰すため。
   * 1つのJSONにまとめてあるので、そのままエクスポート/インポートにも使える。
   */
  serialize(): string {
    return JSON.stringify({
      v: 1,
      users: [...this.users.values()],
      ledger: this.ledger,
      purchases: this.purchasesById,
      receipts: [...this.receipts],
      progress: [...this.progress.values()],
      openSeats: [...this.openSeats.values()],
      transferCodes: [...this.transferCodes.values()],
      nextLedgerId: this.nextLedgerId,
      nextPurchaseId: this.nextPurchaseId,
    });
  }

  /** serialize() の出力から状態を復元する。壊れていれば何もしない(初期状態のまま) */
  restore(json: string): boolean {
    try {
      const d = JSON.parse(json);
      if (!d || d.v !== 1 || !Array.isArray(d.users)) return false;
      this.users = new Map((d.users as UserRow[]).map((u) => [u.userId, u]));
      this.ledger = d.ledger ?? [];
      this.purchasesById = d.purchases ?? [];
      this.receipts = new Set(d.receipts ?? []);
      this.progress = new Map((d.progress ?? []).map((p: ProgressRow) => [`${p.userId} ${p.key}`, p]));
      this.openSeats = new Map((d.openSeats ?? []).map((o: OpenSeatRow) => [`${o.userId} ${o.tableId}`, o]));
      this.transferCodes = new Map((d.transferCodes ?? []).map((t: TransferCodeRow) => [t.code, t]));
      this.nextLedgerId = d.nextLedgerId ?? this.ledger.length + 1;
      this.nextPurchaseId = d.nextPurchaseId ?? this.purchasesById.length + 1;
      return true;
    } catch {
      return false;
    }
  }

  audit(): { ok: boolean; problems: string[] } {
    return auditLedger(this.ledger, [...this.users.values()]);
  }

  totalBalance(currency: Currency): number {
    let sum = 0;
    for (const u of this.users.values()) sum += currency === 'chips' ? u.chips : u.gold;
    return sum;
  }

  close(): void {
    /* メモリ実装では何もしない */
  }
}

/** 仕訳の集計と実体化残高の突き合わせ。実装が違っても検証ロジックは共通にする */
function auditLedger(rows: LedgerRow[], users: UserRow[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const running = new Map<string, number>();
  for (const e of rows) {
    const k = `${e.userId}:${e.currency}`;
    const next = (running.get(k) ?? 0) + e.delta;
    running.set(k, next);
    if (next !== e.balanceAfter) {
      problems.push(`仕訳 ${e.id}（${k}）: balanceAfter=${e.balanceAfter} だが集計は ${next}`);
    }
    if (next < 0) problems.push(`仕訳 ${e.id}（${k}）: 残高が負になっています`);
  }
  for (const u of users) {
    for (const c of ['chips', 'gold'] as const) {
      const expected = running.get(`${u.userId}:${c}`) ?? 0;
      const actual = c === 'chips' ? u.chips : u.gold;
      if (expected !== actual) {
        problems.push(`${u.userId}:${c}: 実体化残高 ${actual} と仕訳集計 ${expected} が不一致`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// SQLite 実装
// ---------------------------------------------------------------------------

/** ライブDBに残すハンド履歴の最大件数(これを超える古い行は掃除で消す) */
const HANDS_KEEP = 2000;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id          TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  last_seen        INTEGER NOT NULL,
  chips            INTEGER NOT NULL DEFAULT 0,
  gold             INTEGER NOT NULL DEFAULT 0,
  vip_points       INTEGER NOT NULL DEFAULT 0,
  lifetime_spend   INTEGER NOT NULL DEFAULT 0,
  piggy_bank       INTEGER NOT NULL DEFAULT 0,
  login_streak     INTEGER NOT NULL DEFAULT 0,
  last_daily_bonus TEXT
);

CREATE TABLE IF NOT EXISTS ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  currency      TEXT NOT NULL,
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  ref           TEXT,
  at            INTEGER NOT NULL,
  balance_after INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id DESC);

CREATE TABLE IF NOT EXISTS hands (
  hand_id     TEXT PRIMARY KEY,
  table_id    TEXT NOT NULL,
  hand_number INTEGER NOT NULL,
  at          INTEGER NOT NULL,
  board       TEXT NOT NULL,
  pot_total   INTEGER NOT NULL,
  rake        INTEGER NOT NULL,
  fairness    TEXT NOT NULL,
  seats       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hands_at ON hands(at DESC);

CREATE TABLE IF NOT EXISTS purchases (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL,
  sku       TEXT NOT NULL,
  price_jpy INTEGER NOT NULL,
  granted   TEXT NOT NULL,
  receipt   TEXT NOT NULL UNIQUE,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id, id DESC);

CREATE TABLE IF NOT EXISTS progress (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      INTEGER NOT NULL,
  day        TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- 引き継ぎコード。端末を変えてもアカウントを持ち出せるようにするための唯一の手段。
-- 生の PIN は保存せず、ハッシュだけを持つ。attempts は総当たり対策の失敗回数。
CREATE TABLE IF NOT EXISTS transfer_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_transfer_user ON transfer_codes(user_id);

-- 卓に着席中のスタック。座席はメモリ上のオブジェクトなので、これが無いと
-- サーバー再起動でチップが消える(バイインは永続残高から引き済みなので純粋な損失)。
-- 着席・スタック変動のたびに更新し、精算したら消す。起動時に残っている行は
-- 「精算されないまま落ちた座席」なので、残高へ払い戻す(recoverOpenSeats)。
CREATE TABLE IF NOT EXISTS open_seats (
  user_id    TEXT NOT NULL,
  table_id   TEXT NOT NULL,
  stack      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, table_id)
);
`;

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

export class SqliteStore implements Store {
  private db: SqliteDb;
  /** バックアップ用の一時DBを同期的に開くために、コンストラクタを保持しておく */
  private dbCtor: (new (p: string) => SqliteDb) | null;

  constructor(db: SqliteDb, dbCtor: (new (p: string) => SqliteDb) | null = null) {
    this.db = db;
    this.dbCtor = dbCtor;
    this.db.exec(SCHEMA);
  }

  /**
   * ファイル（または ':memory:'）を開いて Store を作る。
   * node:sqlite は同期 API なので、await 不要でそのまま使える。
   */
  static async open(path: string): Promise<SqliteStore> {
    const { DatabaseSync } = (await import('node:sqlite')) as unknown as {
      DatabaseSync: new (p: string) => SqliteDb;
    };
    return new SqliteStore(new DatabaseSync(path), DatabaseSync);
  }

  /**
   * VACUUM INTO でトランザクション一貫性のあるコピーを作る(WALでも安全)。
   * 宛先が既存だと失敗するので呼び出し側で消してから使うこと。
   */
  snapshotTo(path: string): boolean {
    try {
      this.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * バックアップ専用の「人間データだけ」のスナップショット。
   * まず完全コピーを作り、そのコピー側で bot_ 行とハンド履歴(ゲームログ)を消して VACUUM する。
   * 残るのは人間の users/ledger/purchases/progress のみ。人間の残高・仕訳が変わらなければ
   * 出力ファイルは毎回バイト同一になるので、GitHubプッシュの差分検知が効いて送信が起きない。
   * ハンド履歴は残高に無関係なゲームログなので、通信量削減のためバックアップからは除外する
   * (ライブDBには直近ぶんを残す。UI表示や公正性検証はライブで行う)。
   */
  snapshotHumansTo(path: string): boolean {
    if (!this.dbCtor) return false; // :memory: 等でコンストラクタ未保持なら不可
    let tmp: SqliteDb | null = null;
    try {
      // 完全コピー(WAL一貫性あり)を作ってから、コピー側だけを削る(本番DBには一切触れない)
      this.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
      tmp = new this.dbCtor(path);
      // open_seats は「未精算のスタック」なので人間ぶんは必ず残す。
      // これを落とすと、バックアップから復元したときに卓上のチップが戻せなくなる。
      tmp.exec(`
        DELETE FROM ledger     WHERE substr(user_id, 1, 4) = 'bot_';
        DELETE FROM purchases  WHERE substr(user_id, 1, 4) = 'bot_';
        DELETE FROM progress   WHERE substr(user_id, 1, 4) = 'bot_';
        DELETE FROM open_seats     WHERE substr(user_id, 1, 4) = 'bot_';
        DELETE FROM transfer_codes WHERE substr(user_id, 1, 4) = 'bot_';
        DELETE FROM users      WHERE substr(user_id, 1, 4) = 'bot_';
        DELETE FROM hands;
        VACUUM;
      `);
      tmp.close();
      tmp = null;
      return true;
    } catch {
      try { tmp?.close(); } catch { /* noop */ }
      return false;
    }
  }

  /**
   * 人間の状態(残高・課金・進捗)の決定的な指紋。bot と hands は含めないので、
   * bot が動いても不変。ゲームサーバーはこれが変わったときだけバックアップを送る。
   * セキュリティ用途ではないので軽量な FNV-1a で十分(依存追加を避ける)。
   */
  humanStateFingerprint(): string {
    const parts: string[] = [];
    const push = (label: string, rows: unknown[]) => {
      parts.push(label + ':' + JSON.stringify(rows));
    };
    try {
      push('u', this.db.prepare(
        `SELECT user_id, CAST(chips AS REAL) AS chips, CAST(gold AS REAL) AS gold,
                CAST(vip_points AS REAL) AS vip_points, CAST(lifetime_spend AS REAL) AS lifetime_spend,
                CAST(piggy_bank AS REAL) AS piggy_bank, login_streak, last_daily_bonus
         FROM users WHERE substr(user_id,1,4)!='bot_' ORDER BY user_id`).all());
      push('l', this.db.prepare(
        `SELECT count(*) c, coalesce(max(id),0) m FROM ledger WHERE substr(user_id,1,4)!='bot_'`).all());
      push('p', this.db.prepare(
        `SELECT count(*) c, coalesce(max(id),0) m FROM purchases WHERE substr(user_id,1,4)!='bot_'`).all());
      push('g', this.db.prepare(
        `SELECT user_id, key, value FROM progress WHERE substr(user_id,1,4)!='bot_' ORDER BY user_id, key`).all());
      // 引き継ぎコードは失うとアカウントに戻れなくなるので、変化したら必ずバックアップする
      push('t', this.db.prepare(
        `SELECT code, user_id FROM transfer_codes WHERE substr(user_id,1,4)!='bot_' ORDER BY code`).all());
      // 着席中スタックも人間の資産なので指紋に含める(卓の上で増減したら次回バックアップ対象)。
      // bot は除くので、bot がいくら回してもアイドル時の送信ゼロは維持される。
      push('s', this.db.prepare(
        `SELECT user_id, table_id, CAST(stack AS REAL) AS stack
         FROM open_seats WHERE substr(user_id,1,4)!='bot_' ORDER BY user_id, table_id`).all());
    } catch {
      return 'err';
    }
    const s = parts.join('|');
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x85ebca77) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
  }

  /**
   * botのデータ掃除。botは接続ごとに使い捨ての bot_xxx ユーザーを作るため、
   * 放置するとDBが際限なく育つ。最後に見てから olderThanMs 経過した bot_ ユーザーの
   * 仕訳・購入・進捗・本体をまとめて消す(進行中のbotは last_seen が新しいので消えない)。
   */
  pruneBots(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    try {
      const cond = `user_id IN (SELECT user_id FROM users WHERE substr(user_id, 1, 4) = 'bot_' AND last_seen < ${Math.floor(cutoff)})`;
      removed += this.db.prepare(`DELETE FROM ledger WHERE ${cond}`).run().changes;
      removed += this.db.prepare(`DELETE FROM purchases WHERE ${cond}`).run().changes;
      removed += this.db.prepare(`DELETE FROM progress WHERE ${cond}`).run().changes;
      removed += this.db.prepare(`DELETE FROM open_seats WHERE ${cond}`).run().changes;
      removed += this.db.prepare(`DELETE FROM transfer_codes WHERE ${cond}`).run().changes;
      removed += this.db
        .prepare(`DELETE FROM users WHERE substr(user_id, 1, 4) = 'bot_' AND last_seen < ${Math.floor(cutoff)}`)
        .run().changes;
      // ハンド履歴(ゲームログ)は無制限に育つのでライブDB上でも直近ぶんに上限を設ける。
      // これでDBファイルの肥大(=バックアップやディスクの膨張)を根本から止める。
      removed += this.db
        .prepare(`DELETE FROM hands WHERE hand_id NOT IN (SELECT hand_id FROM hands ORDER BY at DESC LIMIT ${HANDS_KEEP})`)
        .run().changes;
    } catch {
      /* 掃除失敗は致命的ではない */
    }
    return removed;
  }

  private rowToUser(r: Record<string, unknown>): UserRow {
    return {
      userId: r.user_id as string,
      name: r.name as string,
      createdAt: Number(r.created_at),
      lastSeen: Number(r.last_seen),
      chips: Number(r.chips),
      gold: Number(r.gold),
      vipPoints: Number(r.vip_points),
      lifetimeSpend: Number(r.lifetime_spend),
      piggyBank: Number(r.piggy_bank),
      loginStreak: Number(r.login_streak),
      lastDailyBonus: (r.last_daily_bonus as string | null) ?? null,
    };
  }

  /**
   * 残高系の列は必ず REAL に変換して読む。
   * node:sqlite は 2^53 を超える INTEGER を読むと RangeError を投げるため、
   * `SELECT *` のままだと残高9007兆超のアカウントは**読むだけで例外**になる
   * (書き込みは int64 として通るので、超えた瞬間からそのユーザーだけ壊れる)。
   * REAL 経由なら精度は2^53で頭打ちになるが例外にはならない(チップ1枚の精度は
   * その領域では既に放棄している・第84弾)。
   */
  private static readonly USER_COLS =
    `user_id, name, created_at, last_seen,
     CAST(chips AS REAL) AS chips, CAST(gold AS REAL) AS gold,
     CAST(vip_points AS REAL) AS vip_points, CAST(lifetime_spend AS REAL) AS lifetime_spend,
     CAST(piggy_bank AS REAL) AS piggy_bank, login_streak, last_daily_bonus`;

  getUser(userId: string): UserRow | null {
    const r = this.db.prepare(`SELECT ${SqliteStore.USER_COLS} FROM users WHERE user_id = ?`).get(userId) as
      | Record<string, unknown>
      | undefined;
    return r ? this.rowToUser(r) : null;
  }

  createUser(userId: string, name: string): UserRow {
    const now = Date.now();
    this.db
      .prepare('INSERT INTO users (user_id, name, created_at, last_seen) VALUES (?, ?, ?, ?)')
      .run(userId, name, now, now);
    return this.getUser(userId)!;
  }

  upsertUser(userId: string, name: string): UserRow {
    const existing = this.getUser(userId);
    if (existing) {
      this.db.prepare('UPDATE users SET name = ?, last_seen = ? WHERE user_id = ?').run(name, Date.now(), userId);
      return this.getUser(userId)!;
    }
    return this.createUser(userId, name);
  }

  updateUser(userId: string, patch: Partial<Omit<UserRow, 'userId'>>): void {
    const map: Record<string, string> = {
      name: 'name',
      lastSeen: 'last_seen',
      chips: 'chips',
      gold: 'gold',
      vipPoints: 'vip_points',
      lifetimeSpend: 'lifetime_spend',
      piggyBank: 'piggy_bank',
      loginStreak: 'login_streak',
      lastDailyBonus: 'last_daily_bonus',
      createdAt: 'created_at',
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = map[k];
      if (!col) continue;
      sets.push(`${col} = ?`);
      vals.push(v);
    }
    if (!sets.length) return;
    vals.push(userId);
    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals);
  }

  listUsers(limit = 100): UserRow[] {
    return (
      this.db.prepare(`SELECT ${SqliteStore.USER_COLS} FROM users LIMIT ?`).all(limit) as Record<string, unknown>[]
    ).map((r) => this.rowToUser(r));
  }

  post(userId: string, currency: Currency, delta: number, reason: LedgerReason, ref?: string): LedgerRow | null {
    if (!Number.isSafeInteger(delta)) throw new Error(`delta が整数ではありません: ${delta}`);
    if (!this.getUser(userId)) this.createUser(userId, userId);

    const col = currency === 'chips' ? 'chips' : 'gold';
    // 残高更新と仕訳追記は 1 トランザクションで。途中で落ちても片方だけ残らない
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cur = Number(
        (this.db.prepare(`SELECT CAST(${col} AS REAL) AS v FROM users WHERE user_id = ?`).get(userId) as { v: number })
          .v,
      );
      const next = cur + delta;
      if (next < 0) {
        this.db.exec('ROLLBACK');
        return null;
      }
      const at = Date.now();
      this.db.prepare(`UPDATE users SET ${col} = ? WHERE user_id = ?`).run(next, userId);
      const res = this.db
        .prepare(
          'INSERT INTO ledger (user_id, currency, delta, reason, ref, at, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(userId, currency, delta, reason, ref ?? null, at, next);
      this.db.exec('COMMIT');
      return {
        id: Number(res.lastInsertRowid),
        userId,
        currency,
        delta,
        reason,
        ref: ref ?? null,
        at,
        balanceAfter: next,
      };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  balance(userId: string, currency: Currency): number {
    const u = this.getUser(userId);
    if (!u) return 0;
    return currency === 'chips' ? u.chips : u.gold;
  }

  history(userId: string, limit = 50): LedgerRow[] {
    return (
      this.db
        .prepare(
          `SELECT id, user_id, currency, delta, reason, ref, at, CAST(balance_after AS REAL) AS balance_after
           FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
        )
        .all(userId, limit) as Record<
        string,
        unknown
      >[]
    ).map((r) => ({
      id: Number(r.id),
      userId: r.user_id as string,
      currency: r.currency as Currency,
      delta: Number(r.delta),
      reason: r.reason as LedgerReason,
      ref: (r.ref as string | null) ?? null,
      at: Number(r.at),
      balanceAfter: Number(r.balance_after),
    }));
  }

  saveHand(row: Omit<HandRow, 'at'> & { at?: number }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO hands (hand_id, table_id, hand_number, at, board, pot_total, rake, fairness, seats)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.handId,
        row.tableId,
        row.handNumber,
        row.at ?? Date.now(),
        row.board,
        row.potTotal,
        row.rake,
        row.fairness,
        row.seats,
      );
  }

  getHand(handId: string): HandRow | null {
    const r = this.db.prepare('SELECT * FROM hands WHERE hand_id = ?').get(handId) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      handId: r.hand_id as string,
      tableId: r.table_id as string,
      handNumber: Number(r.hand_number),
      at: Number(r.at),
      board: r.board as string,
      potTotal: Number(r.pot_total),
      rake: Number(r.rake),
      fairness: r.fairness as string,
      seats: r.seats as string,
    };
  }

  recentHands(userId: string, limit = 20): HandRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM hands WHERE seats LIKE ? ORDER BY at DESC LIMIT ?`)
      .all(`%"${userId}"%`, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      handId: r.hand_id as string,
      tableId: r.table_id as string,
      handNumber: Number(r.hand_number),
      at: Number(r.at),
      board: r.board as string,
      potTotal: Number(r.pot_total),
      rake: Number(r.rake),
      fairness: r.fairness as string,
      seats: r.seats as string,
    }));
  }

  savePurchase(row: Omit<PurchaseRow, 'id' | 'at'> & { at?: number }): PurchaseRow {
    const at = row.at ?? Date.now();
    const res = this.db
      .prepare('INSERT INTO purchases (user_id, sku, price_jpy, granted, receipt, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.userId, row.sku, row.priceJpy, row.granted, row.receipt, at);
    return { ...row, id: Number(res.lastInsertRowid), at };
  }

  hasReceipt(receipt: string): boolean {
    return this.db.prepare('SELECT 1 AS x FROM purchases WHERE receipt = ?').get(receipt) !== undefined;
  }

  purchases(userId: string, limit = 50): PurchaseRow[] {
    return (
      this.db.prepare('SELECT * FROM purchases WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit) as Record<
        string,
        unknown
      >[]
    ).map((r) => ({
      id: Number(r.id),
      userId: r.user_id as string,
      sku: r.sku as string,
      priceJpy: Number(r.price_jpy),
      granted: r.granted as string,
      receipt: r.receipt as string,
      at: Number(r.at),
    }));
  }

  getProgress(userId: string, key: string): ProgressRow | null {
    const r = this.db.prepare('SELECT * FROM progress WHERE user_id = ? AND key = ?').get(userId, key) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      userId: r.user_id as string,
      key: r.key as string,
      value: Number(r.value),
      day: (r.day as string | null) ?? null,
      updatedAt: Number(r.updated_at),
    };
  }

  setProgress(userId: string, key: string, value: number, day: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO progress (user_id, key, value, day, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, day = excluded.day, updated_at = excluded.updated_at`,
      )
      .run(userId, key, value, day, Date.now());
  }

  listProgress(userId: string, prefix: string): ProgressRow[] {
    return (
      this.db.prepare('SELECT * FROM progress WHERE user_id = ? AND key LIKE ?').all(userId, `${prefix}%`) as Record<
        string,
        unknown
      >[]
    ).map((r) => ({
      userId: r.user_id as string,
      key: r.key as string,
      value: Number(r.value),
      day: (r.day as string | null) ?? null,
      updatedAt: Number(r.updated_at),
    }));
  }

  setTransferCode(row: TransferCodeRow): void {
    this.db
      .prepare(
        `INSERT INTO transfer_codes (code, user_id, pin_hash, created_at, attempts) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET user_id = excluded.user_id, pin_hash = excluded.pin_hash,
           created_at = excluded.created_at, attempts = excluded.attempts`,
      )
      .run(row.code, row.userId, row.pinHash, row.createdAt, row.attempts);
  }

  getTransferCode(code: string): TransferCodeRow | null {
    const r = this.db.prepare('SELECT * FROM transfer_codes WHERE code = ?').get(code) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      code: r.code as string,
      userId: r.user_id as string,
      pinHash: r.pin_hash as string,
      createdAt: Number(r.created_at),
      attempts: Number(r.attempts),
    };
  }

  bumpTransferAttempts(code: string): number {
    this.db.prepare('UPDATE transfer_codes SET attempts = attempts + 1 WHERE code = ?').run(code);
    return this.getTransferCode(code)?.attempts ?? 0;
  }

  deleteTransferCode(code: string): void {
    this.db.prepare('DELETE FROM transfer_codes WHERE code = ?').run(code);
  }

  deleteTransferCodesOf(userId: string): void {
    this.db.prepare('DELETE FROM transfer_codes WHERE user_id = ?').run(userId);
  }

  hasTransferCode(userId: string): boolean {
    const r = this.db.prepare('SELECT 1 FROM transfer_codes WHERE user_id = ? LIMIT 1').get(userId);
    return !!r;
  }

  setOpenSeat(userId: string, tableId: string, stack: number): void {
    this.db
      .prepare(
        `INSERT INTO open_seats (user_id, table_id, stack, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, table_id) DO UPDATE SET stack = excluded.stack, updated_at = excluded.updated_at`,
      )
      .run(userId, tableId, Math.max(0, Math.round(stack)), Date.now());
  }

  clearOpenSeat(userId: string, tableId: string): void {
    this.db.prepare('DELETE FROM open_seats WHERE user_id = ? AND table_id = ?').run(userId, tableId);
  }

  listOpenSeats(): OpenSeatRow[] {
    return (
      this.db
        .prepare('SELECT user_id, table_id, CAST(stack AS REAL) AS stack, updated_at FROM open_seats')
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      userId: r.user_id as string,
      tableId: r.table_id as string,
      stack: Number(r.stack),
      updatedAt: Number(r.updated_at),
    }));
  }

  audit(): { ok: boolean; problems: string[] } {
    const rows = (
      this.db
        .prepare(
          `SELECT id, user_id, currency, delta, reason, ref, at, CAST(balance_after AS REAL) AS balance_after
           FROM ledger ORDER BY id ASC`,
        )
        .all() as Record<string, unknown>[]
    ).map(
      (r) => ({
        id: Number(r.id),
        userId: r.user_id as string,
        currency: r.currency as Currency,
        delta: Number(r.delta),
        reason: r.reason as LedgerReason,
        ref: (r.ref as string | null) ?? null,
        at: Number(r.at),
        balanceAfter: Number(r.balance_after),
      }),
    );
    return auditLedger(rows, this.listUsers(100000));
  }

  totalBalance(currency: Currency): number {
    const col = currency === 'chips' ? 'chips' : 'gold';
    // SUM は int64 で計算されるため、合計が 2^63 に近づくと SQLite 自体が溢れる。
    // TOTAL は常に浮動小数で集計するのでどちらの限界も踏まない
    const r = this.db.prepare(`SELECT TOTAL(${col}) AS v FROM users`).get() as { v: number };
    return Number(r.v);
  }

  close(): void {
    this.db.close();
  }
}
