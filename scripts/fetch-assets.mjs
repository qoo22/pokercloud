/**
 * 素材画像を URL から取り込む。
 *
 *   npm run assets:fetch -- <クラシック裏面URL> <ネオン裏面URL> <フェルトURL>
 *
 * 画像生成サービス（Hugging Face の Space など）が返す URL をそのまま渡すと、
 * assets-src/ に保存します。そのあと `npm run assets:build` で圧縮・埋め込みまで走ります。
 *
 * 取り込みからビルドまで一気にやるなら:
 *   npm run assets -- <URL1> <URL2> <URL3>
 *
 * なぜこのスクリプトが要るのか：
 *   生成した画像を毎回ブラウザで保存してフォルダに置く、という手作業を挟むと
 *   素材の差し替えが億劫になり、結果として「一度作ったきり」になります。
 *   取り込みをコマンド 1 本にしておくと、気軽に作り直せます。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'assets-src');

/** 引数の順番と保存名の対応。build-assets.py がこの名前を読む */
const NAMES = ['card-back-classic', 'card-back-neon', 'felt'];

const urls = process.argv.slice(2).filter((a) => a.startsWith('http'));

if (urls.length === 0) {
  console.error(`使い方:
  npm run assets:fetch -- <クラシック裏面URL> <ネオン裏面URL> <フェルトURL>

URL は 1〜3 個。渡した順に ${NAMES.join(' / ')} として保存します。
1 個だけ渡した場合は 1 枚目（${NAMES[0]}）だけ差し替わります。`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

let failed = 0;
for (let i = 0; i < urls.length && i < NAMES.length; i++) {
  const url = urls[i];
  const name = NAMES[i];
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      console.error(`✗ ${name}: HTTP ${res.status}`);
      failed++;
      continue;
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) {
      // HTML のエラーページが返ってきていることがある。画像でなければ止める
      console.error(`✗ ${name}: 画像ではありません（content-type: ${type}）`);
      failed++;
      continue;
    }
    const ext = type.includes('webp') ? 'webp' : type.includes('png') ? 'png' : 'jpg';
    const buf = Buffer.from(await res.arrayBuffer());
    const path = resolve(outDir, `${name}.${ext}`);
    writeFileSync(path, buf);
    console.log(`✓ ${name}.${ext}  ${Math.round(buf.length / 1024)} KB`);
  } catch (e) {
    console.error(`✗ ${name}: ${(e).message}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} 件失敗しました。URL の有効期限が切れている可能性があります（生成サービスの一時 URL は短命です）。`);
  process.exit(1);
}
console.log(`\n保存先: ${outDir}`);

// --build を付けると、圧縮・埋め込み・クライアント再生成まで一気にやる
if (process.argv.includes('--build')) {
  console.log('\n埋め込みとビルド...');
  execFileSync('python3', [resolve(root, 'scripts/build-assets.py')], { stdio: 'inherit', cwd: root });
  execFileSync('node', [resolve(root, 'scripts/build-client.mjs')], { stdio: 'inherit', cwd: root });
} else {
  console.log('次は: npm run assets:build');
}
