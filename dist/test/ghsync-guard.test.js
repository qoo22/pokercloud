/**
 * 「読めなかったときは、絶対に書かない」(第167弾)。
 *
 * 2026-09-14、POKER_GH_TOKEN の期限が切れて起動時の復元が 401 で失敗した。
 * 当時は警告1行で空のDBのまま走り続け、全員が 50,000 の新規扱いになった。
 * プッシュも同じ401で止まっていたから GitHub の100京は生き残ったが、
 * 「読めないのに書ける」状況なら最後の砦を塗り潰していた。ここで固定する。
 *
 * 掛け金は一度上がると戻らないので、このファイルは単独プロセスで動かす前提。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
process.env.POKER_GH_TOKEN = 'きれたトークン';
process.env.POKER_GH_REPO = 'qoo22/poker-backup';
const { restoreFromGitHub, pushToGitHub, restoreFailure } = await import('../src/server/ghsync.js');
const { MemoryStore } = await import('../src/server/store.js');
const missing = join(tmpdir(), `poker-ghsync-guard-${process.pid}.db`);
rmSync(missing, { force: true });
const realFetch = globalThis.fetch;
function stubFetch(status) {
    globalThis.fetch = (async () => new Response(status === 200 ? 'db' : '', { status }));
}
test('期限切れ(401)なら、復元は失敗として記録される', async () => {
    assert.equal(restoreFailure(), null, '最初は健全なはず');
    stubFetch(401);
    await restoreFromGitHub(missing);
    assert.equal(restoreFailure(), 'HTTP 401');
});
test('復元に失敗したあとは、プッシュを断る', async () => {
    const msg = await pushToGitHub(new MemoryStore(), missing);
    assert.match(msg, /プッシュを停止中/);
    assert.match(msg, /401/);
});
test('断ったときは GitHub へ1回も送らない', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('', { status: 200 }); });
    await pushToGitHub(new MemoryStore(), missing);
    assert.equal(calls, 0, 'バックアップを上書きしに行ってしまっている');
    globalThis.fetch = realFetch;
});
test('復元に失敗すると、空のDBを作って取り繕ったりしない', async () => {
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(missing), false);
});
/**
 * 終了時の保存(第167弾)。
 *
 * 以前は ghsync が自前で SIGTERM を握っていたので、main.ts の終了処理と競走し、
 * 「卓の精算が保存に乗らない」「送信が途中で殺される」のどちらかが起きていた。
 * 再デプロイのたびに静かにチップが減るので、signalハンドラを持たないことを固定する。
 */
test('ghsync は自分で終了シグナルを握らない', async () => {
    const { startAutoBackup } = await import('../src/server/ghsync.js');
    const before = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT');
    const timer = startAutoBackup(new MemoryStore(), missing);
    const after = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT');
    if (timer)
        clearInterval(timer); // 定期タイマーが残るとテストが終われない
    assert.equal(after, before, '終了処理は main.ts が順番を決めて呼ぶ');
});
test('終了前の保存は、送信が固まっても6秒で諦める', async () => {
    const { flushBeforeExit } = await import('../src/server/ghsync.js');
    globalThis.fetch = (() => new Promise(() => { }));
    const t0 = Date.now();
    await flushBeforeExit(new MemoryStore(), missing);
    const ms = Date.now() - t0;
    assert.ok(ms < 7000, `${ms}ms かかった。終了が長引くと強制終了されて保存ごと失われる`);
    globalThis.fetch = realFetch;
});
//# sourceMappingURL=ghsync-guard.test.js.map