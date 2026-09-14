/**
 * データが残っているかの実測(第167弾)。
 * ここが正しく「消えている」と言えていれば、2026-09-14 の消失は初回で気づけた。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPersistence } from '../src/server/persistence.js';
import { MemoryStore } from '../src/server/store.js';
const HOSTED = { RENDER: '1' };
test('初回起動では「残っている」と言わない', () => {
    const st = checkPersistence(new MemoryStore(), '/tmp/x.db', HOSTED);
    assert.equal(st.boots, 1);
    assert.equal(st.persisted, false);
});
test('同じ保存先が生き残れば、起動のたびに印が増える', () => {
    const store = new MemoryStore();
    const a = checkPersistence(store, '/tmp/x.db', HOSTED);
    const b = checkPersistence(store, '/tmp/x.db', HOSTED);
    const c = checkPersistence(store, '/tmp/x.db', HOSTED);
    assert.equal(a.persisted, false);
    assert.equal(b.persisted, true);
    assert.equal(c.boots, 3);
});
test('毎回まっさらな保存先なら、何度起動しても「残っていない」', () => {
    // 永続ディスクの無い Render を再現する。ここが本番で起きていたこと
    for (let i = 0; i < 5; i++) {
        const st = checkPersistence(new MemoryStore(), '/tmp/x.db', HOSTED);
        assert.equal(st.persisted, false, `${i + 1}回目`);
        assert.equal(st.boots, 1);
    }
});
test('POKER_DB か GitHub のどちらかがあれば configured', () => {
    const disk = checkPersistence(new MemoryStore(), '/var/data/poker.db', { ...HOSTED, POKER_DB: '/var/data/poker.db' });
    assert.equal(disk.configured, true);
    const gh = checkPersistence(new MemoryStore(), '/tmp/x.db', { ...HOSTED, POKER_GH_TOKEN: 't', POKER_GH_REPO: 'a/b' });
    assert.equal(gh.configured, true);
    const none = checkPersistence(new MemoryStore(), '/tmp/x.db', HOSTED);
    assert.equal(none.configured, false);
});
test('トークンだけ・リポジトリだけでは設定済みとみなさない', () => {
    const half = checkPersistence(new MemoryStore(), '/tmp/x.db', { ...HOSTED, POKER_GH_TOKEN: 't' });
    assert.equal(half.configured, false);
});
test('印は人間のデータと混ざらない場所に置く', () => {
    const store = new MemoryStore();
    checkPersistence(store, '/tmp/x.db', HOSTED);
    // 実在しないユーザーIDなので、誰かの進捗を書き換えることはない
    assert.equal(store.getProgress('u_someone', 'sys:boots'), null);
});
test('ホスティング外の初回は警告扱いにしない', () => {
    const st = checkPersistence(new MemoryStore(), '/tmp/x.db', {});
    assert.equal(st.hosted, false);
    assert.match(st.summary, /初回起動/);
});
//# sourceMappingURL=persistence.test.js.map