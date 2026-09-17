/**
 * 復元の安全装置(第167弾)。
 *
 * 2026-09-14、保存先が消える環境のまま `/admin/restore` を実行し、
 * 書き戻した100京が次の再起動でまるごと捨てられた。
 * さらに末尾の process.exit がホスティングの異常終了アラートまで鳴らした。
 * 「残ると確かめられない限り断る」ことを、ここで固定する。
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { Gateway } from '../src/server/gateway.js';
import type { PersistenceStatus } from '../src/server/persistence.js';

const SECRET = 'テスト用の十分に長い鍵-0123456789abcdef';
const dbPath = join(tmpdir(), `poker-restore-guard-${process.pid}.db`);

/** 保存先が消える本番(2026-09-14の状態)を再現する */
const VOLATILE: PersistenceStatus = {
  boots: 1, persisted: false, configured: false, hosted: true,
  dbPath, summary: 'データが残っていません。再起動のたびに消えます',
};
/** 永続ディスクを付けたあとの状態 */
const SAFE: PersistenceStatus = { ...VOLATILE, persisted: true, configured: true, summary: 'データは残っています(起動 2 回目)' };

async function withGateway(st: PersistenceStatus, fn: (base: string) => Promise<void>): Promise<void> {
  writeFileSync(dbPath, 'もとのデータ');
  const gw = new Gateway({ port: 0, tables: [], authSecret: SECRET, dbPath, persistence: st });
  const port = await gw.listen();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await gw.close();
    rmSync(dbPath, { force: true });
  }
}

describe('復元の安全装置', () => {
  after(() => rmSync(dbPath, { force: true }));

  test('消える環境では復元を断り、DBに触らない', async () => {
    await withGateway(VOLATILE, async (base) => {
      const res = await fetch(`${base}/admin/restore?key=${encodeURIComponent(SECRET)}`, {
        method: 'POST', body: 'あたらしいデータ',
      });
      assert.equal(res.status, 409);
      const text = await res.text();
      assert.match(text, /永続化されていません/);
      // ここが肝: 断ったのだから、元のファイルは1バイトも変わっていない
      assert.equal(readFileSync(dbPath, 'utf8'), 'もとのデータ');
    });
  });

  test('断るときは、直し方を本文で伝える', async () => {
    await withGateway(VOLATILE, async (base) => {
      const text = await (await fetch(`${base}/admin/restore?key=${encodeURIComponent(SECRET)}`, {
        method: 'POST', body: 'x',
      })).text();
      assert.match(text, /POKER_DB/);
      assert.match(text, /force=1/);
    });
  });

  test('永続化が確認できていれば、これまでどおり書き戻す', async () => {
    await withGateway(SAFE, async (base) => {
      const res = await fetch(`${base}/admin/restore?key=${encodeURIComponent(SECRET)}`, {
        method: 'POST', body: 'あたらしいデータ',
      });
      assert.equal(res.status, 200);
      assert.equal(readFileSync(dbPath, 'utf8'), 'あたらしいデータ');
    });
  });

  test('鍵が違えば、安全装置より先に弾く', async () => {
    await withGateway(VOLATILE, async (base) => {
      const res = await fetch(`${base}/admin/restore?key=ちがう`, { method: 'POST', body: 'x' });
      assert.equal(res.status, 403);
    });
  });

  test('健康診断は、消えていることを ok:false で知らせる', async () => {
    await withGateway(VOLATILE, async (base) => {
      const res = await fetch(`${base}/admin/health?key=${encodeURIComponent(SECRET)}`);
      assert.equal(res.status, 200);
      const j = await res.json() as { ok: boolean; persisted: boolean; summary: string };
      assert.equal(j.ok, false);
      assert.equal(j.persisted, false);
      assert.match(j.summary, /残っていません/);
    });
  });

  test('健康診断は残っていれば ok:true', async () => {
    await withGateway(SAFE, async (base) => {
      const j = await (await fetch(`${base}/admin/health?key=${encodeURIComponent(SECRET)}`)).json() as { ok: boolean };
      assert.equal(j.ok, true);
    });
  });

  test('健康診断も鍵が要る', async () => {
    await withGateway(SAFE, async (base) => {
      assert.equal((await fetch(`${base}/admin/health`)).status, 403);
    });
  });
});
