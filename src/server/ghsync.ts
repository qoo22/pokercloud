/**
 * GitHub リポジトリを「無料の永続ストレージ」として使う残高DBの自動バックアップ。
 *
 * 動作:
 *   起動時   … ローカルにDBが無ければ GitHub の backup/poker.db から復元
 *   5分ごと … DBのスナップショット(VACUUM INTO)を取り、変化があればプッシュ
 *   終了時   … SIGTERM/SIGINT で最後のプッシュを試みてから終了(再デプロイ時の取りこぼし防止)
 *
 * 設定(環境変数):
 *   POKER_GH_TOKEN  … GitHub のアクセストークン(対象リポジトリの Contents: Read and write)
 *   POKER_GH_REPO   … "ユーザー名/リポジトリ名"(プライベートリポジトリ推奨)
 *   POKER_GH_BRANCH … 省略時 main
 *
 * 未設定なら全機能が黙って無効になる(ローカル開発に影響なし)。
 */

import { readFileSync, writeFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Store } from './store.js';

const FILE_PATH = 'backup/poker.db';
const API = 'https://api.github.com';
/** バックアップ間隔(分)。POKER_GH_INTERVAL_MIN で調整可(既定15分) */
const INTERVAL_MIN = Math.max(1, Number(process.env.POKER_GH_INTERVAL_MIN ?? 15) || 15);

// ---- 送信量の計測(トークン等の秘密は絶対に出さない) ----
let dayKey = '';
let bytesToday = 0;
let pushesToday = 0;
function utcDay(): string { return new Date().toISOString().slice(0, 10); }
function recordBandwidth(bytes: number, ms: number): void {
  const d = utcDay();
  if (d !== dayKey) { dayKey = d; bytesToday = 0; pushesToday = 0; }
  bytesToday += bytes;
  pushesToday += 1;
  console.log(
    `[bandwidth] destination=github operation=backup bytes=${bytes} duration_ms=${ms} ` +
    `day=${d} day_total_bytes=${bytesToday} day_pushes=${pushesToday}`,
  );
}
/** その日の累計送信量(管理エンドポイント表示用) */
export function bandwidthToday(): { day: string; bytes: number; pushes: number } {
  return { day: dayKey || utcDay(), bytes: bytesToday, pushes: pushesToday };
}

interface GhCfg {
  token: string;
  repo: string;
  branch: string;
}

function cfg(): GhCfg | null {
  const token = (process.env.POKER_GH_TOKEN ?? '').trim();
  const repo = (process.env.POKER_GH_REPO ?? '').trim();
  if (!token || !repo || !repo.includes('/')) return null;
  return { token, repo, branch: (process.env.POKER_GH_BRANCH ?? '').trim() || 'main' };
}

function headers(c: GhCfg, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${c.token}`,
    'user-agent': 'poker-db-backup',
    'x-github-api-version': '2022-11-28',
    ...extra,
  };
}

/** 起動時の復元。ローカルDBが既にあれば触らない(上書き事故防止) */
export async function restoreFromGitHub(dbPath: string): Promise<void> {
  const c = cfg();
  if (!c) return;
  if (existsSync(dbPath)) {
    console.log('GitHubバックアップ: ローカルDBが存在するため復元はスキップ');
    return;
  }
  try {
    const res = await fetch(`${API}/repos/${c.repo}/contents/${FILE_PATH}?ref=${c.branch}`, {
      headers: headers(c, { accept: 'application/vnd.github.raw' }),
    });
    if (res.status === 404) {
      console.log('GitHubバックアップ: まだバックアップが無い(初回起動)');
      return;
    }
    if (!res.ok) {
      // ここに来たら、GitHub側に何があるのか分からない。書き込みは以後すべて止める
      restoreBroken = `HTTP ${res.status}`;
      const line = '='.repeat(64);
      console.error(`\n${line}`);
      console.error(`!! GitHubバックアップからの復元に失敗しました (HTTP ${res.status})`);
      if (res.status === 401 || res.status === 403) {
        console.error('   トークンが期限切れか、権限が足りません。');
        console.error('   POKER_GH_TOKEN を作り直してください(Contents: Read and write)。');
        console.error('   有効期限は「No expiration」にすること。切れると今回と同じことが起きます。');
      }
      console.error('   保存済みの残高を読めていないので、全員が新規扱いになります。');
      console.error('   **バックアップを壊さないため、以後のプッシュは停止します。**');
      console.error(`${line}\n`);
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // アトミック書き込み: 一時ファイルに書いてから rename(中途半端なDBが残らない)
    const tmp = dbPath + '.restore';
    writeFileSync(tmp, buf);
    renameSync(tmp, dbPath);
    console.log(`GitHubバックアップから残高DBを復元しました (${Math.round(buf.length / 1024)}KB)`);
  } catch (e) {
    console.warn('GitHubバックアップ復元エラー:', (e as Error).message);
  }
}

/**
 * 復元に失敗したまま上書きするのを禁じる掛け金(第167弾)。
 *
 * 2026-09-14、トークンの期限が切れて起動時の復元が 401 で失敗した。
 * 当時は警告を1行出して空のDBのまま動き続けたので、全員が新規扱いになった。
 * 運良くプッシュも同じ401で止まっていたから GitHub 側の100京は無事だったが、
 * もし読めないのに書けていたら、最後の砦を 50,000 で塗り潰していた。
 *
 * だから「読めなかったときは、絶対に書かない」。
 */
let restoreBroken: string | null = null;
/** 復元に失敗していないか(失敗していれば理由) */
export function restoreFailure(): string | null { return restoreBroken; }

let lastSha: string | null = null;
let lastHash = '';
let pushing = false;

/** スナップショットを取って GitHub へプッシュ。結果を文字列で返す(ログ/管理エンドポイント用) */
export async function pushToGitHub(store: Store, dbPath: string): Promise<string> {
  const c = cfg();
  if (!c) return 'POKER_GH_TOKEN / POKER_GH_REPO が未設定です';
  // 読めなかったものを上書きしない。壊れた復元のあとのプッシュは、最後の砦を消す行為
  if (restoreBroken) return `復元に失敗しているためプッシュを停止中 (${restoreBroken})`;
  if (pushing) return 'busy';
  pushing = true;
  try {
    // 差分検知(最優先・最軽量): 人間の状態が前回送信時と同じなら、スナップショットも作らず即終了。
    // bot がいくら動いてもここで弾かれるので、アイドル時の送信はゼロになる。
    if (store.humanStateFingerprint) {
      const fp = store.humanStateFingerprint();
      if (fp === lastHash) return 'unchanged';
    }
    // バックアップ用スナップショットを作る。優先度:
    //   1. 人間データだけ(bot・ハンド履歴を除く) … 人間の残高が変わらなければ毎回バイト同一
    //      → 差分検知が効いてプッシュが起きない = 帯域を激減できる
    //   2. 通常のフルスナップショット
    //   3. 生ファイル
    const snap = dbPath + '.snapshot';
    rmSync(snap, { force: true });
    let data: Buffer;
    if (store.snapshotHumansTo && store.snapshotHumansTo(snap)) {
      data = readFileSync(snap);
      rmSync(snap, { force: true });
    } else if (store.snapshotTo && store.snapshotTo(snap)) {
      data = readFileSync(snap);
      rmSync(snap, { force: true });
    } else if (existsSync(dbPath)) {
      data = readFileSync(dbPath);
    } else {
      return 'DBファイルがまだありません';
    }

    // 差分キー: 人間の状態指紋があればそれを、無ければファイル内容のハッシュを使う
    const hash = store.humanStateFingerprint
      ? store.humanStateFingerprint()
      : createHash('sha256').update(data).digest('hex');
    if (hash === lastHash) return 'unchanged'; // 人間の残高に変化なし → 送信しない

    // 更新には既存ファイルの blob sha が必要
    if (lastSha === null) {
      const head = await fetch(`${API}/repos/${c.repo}/contents/${FILE_PATH}?ref=${c.branch}`, {
        headers: headers(c, { accept: 'application/vnd.github+json' }),
      });
      if (head.ok) lastSha = ((await head.json()) as { sha?: string }).sha ?? null;
    }

    const body = JSON.stringify({
      message: `poker.db backup ${new Date().toISOString()} (${Math.round(data.length / 1024)}KB)`,
      content: data.toString('base64'),
      branch: c.branch,
      ...(lastSha ? { sha: lastSha } : {}),
    });
    const bodyBytes = Buffer.byteLength(body); // 実際に送信するバイト数(base64込み)
    const started = Date.now();

    // 一時的な失敗(ネットワーク/5xx/429)は指数バックオフで最大3回リトライ。
    // 恒久的な失敗(4xx)は即諦める(暴走リトライで帯域を食わないため)
    let lastErr = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      let put: Response;
      try {
        put = await fetch(`${API}/repos/${c.repo}/contents/${FILE_PATH}`, {
          method: 'PUT',
          headers: headers(c, { accept: 'application/vnd.github+json', 'content-type': 'application/json' }),
          body,
        });
      } catch (e) { lastErr = 'ネットワーク: ' + (e as Error).message; continue; }
      if (put.status === 409 || put.status === 422) {
        // 競合(手動コミット等で sha がずれた)。次回 sha を取り直してリトライされる
        lastSha = null;
        return `sha競合のため次回リトライ (HTTP ${put.status})`;
      }
      if (put.status === 429 || put.status >= 500) { lastErr = `一時エラー HTTP ${put.status}`; continue; }
      if (!put.ok) return `失敗: HTTP ${put.status} ${(await put.text()).slice(0, 140)}`;
      lastSha = ((await put.json()) as { content?: { sha?: string } }).content?.sha ?? null;
      lastHash = hash; // 成功して初めて「送信済み」を確定(失敗時は次回また送る=データ消失しない)
      recordBandwidth(bodyBytes, Date.now() - started);
      return `pushed (${Math.round(data.length / 1024)}KB)`;
    }
    return `失敗(リトライ上限): ${lastErr}`;
  } catch (e) {
    return 'エラー: ' + (e as Error).message;
  } finally {
    pushing = false;
  }
}

let autoBackupArmed = false;

/**
 * データ掃除(第152弾)。以前は startAutoBackup の中にあり、GitHubバックアップを
 * 設定していない環境では**一度も走らなかった**。バックアップの有無に関係なく
 * 掃除だけは回す(2時間見ていないボットのデータとハンド履歴を捨ててDBを小さく保つ)
 */
let pruneArmed = false;
export function startAutoPrune(store: Store): void {
  if (pruneArmed || !store.pruneBots) return;
  pruneArmed = true;
  const t = setInterval(() => {
    try {
      const removed = store.pruneBots?.(2 * 3600_000) ?? 0;
      if (removed > 0) console.log(`データ掃除: ${removed}行削除`);
    } catch (e) {
      console.warn('データ掃除に失敗:', (e as Error).message);
    }
  }, 15 * 60_000);
  t.unref?.();
}

/** 定期バックアップ + データ掃除 + 終了時の駆け込みプッシュ(タイマーは常に1本) */
/** 定期バックアップを始める。戻り値のタイマーは止められる(テスト用) */
export function startAutoBackup(store: Store, dbPath: string): NodeJS.Timeout | null {
  const c = cfg();
  if (!c) return null;
  if (autoBackupArmed) {
    // 二重起動ガード: 何らかの理由で複数回呼ばれてもタイマーは1本だけにする
    console.warn('GitHub自動バックアップ: 既に起動済みのため二重登録を無視');
    return null;
  }
  autoBackupArmed = true;
  console.log(`GitHub自動バックアップ有効: ${c.repo}/${FILE_PATH} (${INTERVAL_MIN}分ごと・変化時のみ送信・終了時)`);
  const timer = setInterval(async () => {
    // 2時間見ていないbotのデータとハンド履歴を掃除してDBを小さく保つ
    if (store.pruneBots) {
      const removed = store.pruneBots(2 * 3600_000);
      if (removed > 0) console.log(`データ掃除: ${removed}行削除`);
    }
    const r = await pushToGitHub(store, dbPath);
    if (r !== 'unchanged' && !r.startsWith('pushed')) console.warn('GitHubバックアップ:', r);
  }, INTERVAL_MIN * 60_000);

  // 終了時の保存は main.ts の shutdown が順番を決めて呼ぶ。
  // ここで独自に SIGTERM を握ると、卓の精算より先に送信してしまったり、
  // 送信の途中で store.close() されたりする(第167弾で直した競合)
  flushOnExit = () => flushBeforeExit(store, dbPath);
  return timer;
}

/** main.ts の終了処理から呼ばれる、最後の1回の保存 */
let flushOnExit: (() => Promise<void>) | null = null;

/** 終了時に「最後の状態」を保存する。最大6秒待って諦める */
export async function flushBeforeExit(store: Store, dbPath: string): Promise<void> {
  try {
    const r = await Promise.race([
      pushToGitHub(store, dbPath),
      new Promise<string>((res) => setTimeout(() => res('時間切れ(6秒)'), 6000)),
    ]);
    console.log('終了前バックアップ:', r);
  } catch (e) {
    console.warn('終了前バックアップに失敗:', (e as Error).message);
  }
}

/** 自動バックアップが有効なら、終了前の保存処理を返す */
export function exitFlusher(): (() => Promise<void>) | null { return flushOnExit; }
