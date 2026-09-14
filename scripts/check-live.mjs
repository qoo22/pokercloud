#!/usr/bin/env node
/**
 * 本番のデータが残っているかを確かめる(第167弾)。
 *
 *   node scripts/check-live.mjs <POKER_SECRET>
 *
 * デプロイのたびにこれを走らせる。「起動 N 回目」が増えていれば残っている。
 * 何度デプロイしても 1 のままなら、データは毎回作り直されている。
 * 2026-09-14 の消失は、この一手間があれば初回で気づけた。
 */
const BASE = process.env.POKER_URL ?? 'https://poker-friends-x9o6.onrender.com';
const key = process.argv[2] ?? process.env.POKER_SECRET;
if (!key) {
  console.error('鍵がありません: node scripts/check-live.mjs <POKER_SECRET>');
  process.exit(2);
}

const res = await fetch(`${BASE}/admin/health?key=${encodeURIComponent(key)}`);
if (res.status === 403) {
  console.error('鍵が違います(または管理用の窓口がまだ無いバージョンです)');
  process.exit(2);
}
if (!res.ok) {
  console.error(`健康診断に失敗: HTTP ${res.status}`);
  process.exit(2);
}
const h = await res.json();
console.log(`  保存先      : ${h.dbPath}`);
console.log(`  起動回数    : ${h.boots} 回目`);
console.log(`  永続化の設定: ${h.configured ? 'あり' : 'なし'}`);
console.log(`  実際に残存  : ${h.persisted ? 'はい' : 'いいえ'}`);
console.log(`  判定        : ${h.summary}`);

if (!h.ok) {
  console.error('\n!! データが残りません。復元や新機能より先に永続化を直してください。');
  process.exit(1);
}
console.log('\nデータは保持されています。');
