/**
 * GitHubバックアップの帯域削減とデータ保全の検証。
 *
 * 事件: Render無料枠を超過(Service-Initiated 17.58GB)。原因は「9.6MBのDBをbase64で
 * 5分ごとに丸ごとGitHubへPUT」+「hands表が無制限に肥大」。ここでは修正の核心である
 *   - snapshotHumansTo: bot・ハンド履歴を除外し、人間の残高が変わらなければバイト同一
 *   - pruneBots: hands表を上限(HANDS_KEEP)に抑える
 * が正しく効くこと、かつ人間の残高が保全されることをテストする。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/server/store.js';
let seq = 0;
const tmpPath = (tag) => join(tmpdir(), `poker-backup-test-${process.pid}-${++seq}-${tag}.db`);
function saveDummyHand(s, id, seatUser) {
    s.saveHand({
        handId: id, tableId: 't1', handNumber: seq, board: 'AsKsQs',
        potTotal: 100, rake: 0,
        fairness: JSON.stringify({ serverSeed: 'x'.repeat(64), clientSeed: 'y', nonce: 1, deck: Array.from({ length: 52 }, (_, i) => i) }),
        seats: JSON.stringify([{ seat: 0, userId: seatUser, hole: ['As', 'Ks'] }]),
    });
}
describe('バックアップ帯域削減', () => {
    test('人間スナップショットは bot とハンド履歴を除外する', async () => {
        const s = await SqliteStore.open(':memory:');
        s.upsertUser('u_alice', 'Alice');
        s.post('u_alice', 'chips', 500_000, 'adjustment');
        s.upsertUser('bot_zzz', 'Bot');
        s.post('bot_zzz', 'chips', 999_000, 'adjustment');
        for (let i = 0; i < 50; i++)
            saveDummyHand(s, `h${i}`, i % 2 ? 'u_alice' : 'bot_zzz');
        const out = tmpPath('humans');
        rmSync(out, { force: true });
        assert.equal(s.snapshotHumansTo(out), true);
        // スナップショットを開いて中身を検証
        const snap = await SqliteStore.open(out);
        assert.equal(snap.balance('u_alice', 'chips'), 500_000, '人間の残高が保全されていない');
        assert.equal(snap.balance('bot_zzz', 'chips'), 0, 'botデータが残っている(除外されていない)');
        assert.equal(snap.recentHands('u_alice', 100).length, 0, 'ハンド履歴が除外されていない');
        snap.close();
        s.close();
        rmSync(out, { force: true });
    });
    test('botだけが動いても人間指紋は不変(=送信されない)', async () => {
        const s = await SqliteStore.open(':memory:');
        s.upsertUser('u_alice', 'Alice');
        s.post('u_alice', 'chips', 500_000, 'adjustment');
        const before = s.humanStateFingerprint();
        // botが大量に動く(残高変動・ハンド追加)——人間には無関係
        for (let i = 0; i < 30; i++) {
            s.upsertUser(`bot_${i}`, `Bot${i}`);
            s.post(`bot_${i}`, 'chips', 1000 + i, 'adjustment');
            saveDummyHand(s, `bh${i}`, `bot_${i}`);
        }
        const after = s.humanStateFingerprint();
        assert.equal(before, after, 'bot活動だけで指紋が変化した(=無駄な送信が発生する)');
        // 人間スナップショット自体も小さい(数十KB以下)ことを確認
        const out = tmpPath('sz');
        rmSync(out, { force: true });
        s.snapshotHumansTo(out);
        const kb = readFileSync(out).length / 1024;
        assert.ok(kb < 100, `人間スナップショットが大きすぎる: ${kb.toFixed(0)}KB`);
        s.close();
        rmSync(out, { force: true });
    });
    test('人間の残高が変われば指紋が変化する(=1回送信される)', async () => {
        const s = await SqliteStore.open(':memory:');
        s.upsertUser('u_alice', 'Alice');
        s.post('u_alice', 'chips', 500_000, 'adjustment');
        const before = s.humanStateFingerprint();
        s.post('u_alice', 'chips', -12_345, 'table_buyin'); // 人間の残高が動く
        const after = s.humanStateFingerprint();
        assert.notEqual(before, after, '人間の残高変化が指紋に反映されていない');
        s.close();
    });
    test('pruneBots は hands 表を上限まで刈る(DB肥大の停止)', async () => {
        const s = await SqliteStore.open(':memory:');
        s.upsertUser('u_alice', 'Alice');
        // HANDS_KEEP(2000)を超える件数を投入
        for (let i = 0; i < 2100; i++)
            saveDummyHand(s, `k${i}`, 'u_alice');
        s.pruneBots(2 * 3600_000);
        const kept = s.recentHands('u_alice', 100_000).length;
        assert.ok(kept <= 2000, `hands が刈られていない: ${kept}件`);
        assert.ok(kept >= 1900, `刈りすぎ: ${kept}件`);
        // 直近のハンドは残る(古いものが消える)
        assert.ok(s.getHand('k2099') !== null, '最新ハンドが消えている');
        assert.equal(s.getHand('k0'), null, '最古ハンドが残っている');
        s.close();
    });
    test('スナップショット生成は本番DBを破壊しない(コピー側だけ削る)', async () => {
        const s = await SqliteStore.open(':memory:');
        s.upsertUser('u_alice', 'Alice');
        s.post('u_alice', 'chips', 500_000, 'adjustment');
        s.upsertUser('bot_x', 'Bot');
        s.post('bot_x', 'chips', 7_000, 'adjustment');
        saveDummyHand(s, 'hh', 'u_alice');
        const out = tmpPath('safe');
        rmSync(out, { force: true });
        s.snapshotHumansTo(out);
        // 本番DBは無傷
        assert.equal(s.balance('u_alice', 'chips'), 500_000);
        assert.equal(s.balance('bot_x', 'chips'), 7_000, '本番DBのbotデータが消えた(コピー側でなく本体を削った)');
        assert.equal(s.getHand('hh') !== null, true, '本番DBのハンドが消えた');
        s.close();
        if (existsSync(out))
            rmSync(out, { force: true });
    });
});
//# sourceMappingURL=backup.test.js.map