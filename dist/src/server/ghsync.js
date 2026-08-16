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
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
const FILE_PATH = 'backup/poker.db';
const API = 'https://api.github.com';
function cfg() {
    const token = (process.env.POKER_GH_TOKEN ?? '').trim();
    const repo = (process.env.POKER_GH_REPO ?? '').trim();
    if (!token || !repo || !repo.includes('/'))
        return null;
    return { token, repo, branch: (process.env.POKER_GH_BRANCH ?? '').trim() || 'main' };
}
function headers(c, extra = {}) {
    return {
        authorization: `Bearer ${c.token}`,
        'user-agent': 'poker-db-backup',
        'x-github-api-version': '2022-11-28',
        ...extra,
    };
}
/** 起動時の復元。ローカルDBが既にあれば触らない(上書き事故防止) */
export async function restoreFromGitHub(dbPath) {
    const c = cfg();
    if (!c)
        return;
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
            console.warn(`GitHubバックアップ復元失敗: HTTP ${res.status}`);
            return;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(dbPath, buf);
        console.log(`GitHubバックアップから残高DBを復元しました (${Math.round(buf.length / 1024)}KB)`);
    }
    catch (e) {
        console.warn('GitHubバックアップ復元エラー:', e.message);
    }
}
let lastSha = null;
let lastHash = '';
let pushing = false;
/** スナップショットを取って GitHub へプッシュ。結果を文字列で返す(ログ/管理エンドポイント用) */
export async function pushToGitHub(store, dbPath) {
    const c = cfg();
    if (!c)
        return 'POKER_GH_TOKEN / POKER_GH_REPO が未設定です';
    if (pushing)
        return 'busy';
    pushing = true;
    try {
        // 一貫性のあるコピーを作る(WAL中でも安全)。SQLiteでなければ生ファイルで妥協
        const snap = dbPath + '.snapshot';
        rmSync(snap, { force: true });
        let data;
        if (store.snapshotTo && store.snapshotTo(snap)) {
            data = readFileSync(snap);
            rmSync(snap, { force: true });
        }
        else if (existsSync(dbPath)) {
            data = readFileSync(dbPath);
        }
        else {
            return 'DBファイルがまだありません';
        }
        const hash = createHash('sha256').update(data).digest('hex');
        if (hash === lastHash)
            return 'unchanged';
        // 更新には既存ファイルの blob sha が必要
        if (lastSha === null) {
            const head = await fetch(`${API}/repos/${c.repo}/contents/${FILE_PATH}?ref=${c.branch}`, {
                headers: headers(c, { accept: 'application/vnd.github+json' }),
            });
            if (head.ok)
                lastSha = (await head.json()).sha ?? null;
        }
        const put = await fetch(`${API}/repos/${c.repo}/contents/${FILE_PATH}`, {
            method: 'PUT',
            headers: headers(c, { accept: 'application/vnd.github+json', 'content-type': 'application/json' }),
            body: JSON.stringify({
                message: `poker.db backup ${new Date().toISOString()} (${Math.round(data.length / 1024)}KB)`,
                content: data.toString('base64'),
                branch: c.branch,
                ...(lastSha ? { sha: lastSha } : {}),
            }),
        });
        if (put.status === 409 || put.status === 422) {
            // 競合(手動コミット等で sha がずれた)。次回 sha を取り直してリトライされる
            lastSha = null;
            return `sha競合のため次回リトライ (HTTP ${put.status})`;
        }
        if (!put.ok)
            return `失敗: HTTP ${put.status} ${(await put.text()).slice(0, 140)}`;
        lastSha = (await put.json()).content?.sha ?? null;
        lastHash = hash;
        return `pushed (${Math.round(data.length / 1024)}KB)`;
    }
    catch (e) {
        return 'エラー: ' + e.message;
    }
    finally {
        pushing = false;
    }
}
/** 定期バックアップ + botデータ掃除 + 終了時の駆け込みプッシュ */
export function startAutoBackup(store, dbPath) {
    const c = cfg();
    if (!c)
        return;
    console.log(`GitHub自動バックアップ有効: ${c.repo}/${FILE_PATH} (5分ごと・終了時)`);
    setInterval(async () => {
        // 2時間見ていないbotのデータを掃除してDBを小さく保つ
        if (store.pruneBots) {
            const removed = store.pruneBots(2 * 3600_000);
            if (removed > 0)
                console.log(`botデータ掃除: ${removed}行削除`);
        }
        const r = await pushToGitHub(store, dbPath);
        if (r !== 'unchanged' && !r.startsWith('pushed'))
            console.warn('GitHubバックアップ:', r);
    }, 5 * 60_000);
    // 再デプロイ・停止時に最後の状態を保存(最大6秒待って諦める)
    const flushAndExit = async () => {
        try {
            await Promise.race([pushToGitHub(store, dbPath), new Promise((r) => setTimeout(r, 6000))]);
        }
        catch {
            /* noop */
        }
        process.exit(0);
    };
    process.on('SIGTERM', flushAndExit);
    process.on('SIGINT', flushAndExit);
}
//# sourceMappingURL=ghsync.js.map