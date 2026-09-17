/**
 * 実卓クライアントを単一 HTML にまとめる。
 * サーバーが outputs 直下を静的配信するので、そこへ出力する。
 *
 * !!! 重要 — poker-client.html は再生成してはいけない !!!
 * 本番クライアントはある時点から「ビルド済みHTMLを直接編集する」運用に移行しており
 * (AI生成画像100枚・ディーラー12人・縦スライダー等はすべて直接編集で実装)、
 * client/ 以下のソースはそれ以前の古い状態で置き去りになっている。
 * ここで再生成すると手編集の成果が全部消える(実際に一度事故になり、本番から画像が消えた)。
 * そのため下のガードで、画像が大量に埋め込まれた出力先は上書きを拒否する。
 * どうしても作り直すときは、バックアップを取ってから FORCE_REGEN=1 を付けて実行する。
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  { entry: 'client/client.ts', template: 'client/index.html', out: 'poker-client.html' },
  // カードデザインの確認ページ。サーバー不要で開ける
  { entry: 'client/preview.ts', template: 'client/preview.html', out: 'poker-card-preview.html' },
  // CPU 対戦のソロ版。サーバー不要で単体で遊べる
  { entry: 'solo/game.ts', template: 'solo/index.html', out: 'poker-solo.html' },
];

/** 手編集運用のリッチ版(画像が大量に埋め込まれている)なら true */
function isHandEdited(path) {
  if (!existsSync(path)) return false;
  const cur = readFileSync(path, 'utf8');
  return (cur.match(/data:image\//g) ?? []).length >= 90;
}

for (const t of targets) {
  const guardPath = resolve(root, '..', t.out);
  if (isHandEdited(guardPath) && process.env.FORCE_REGEN !== '1') {
    console.error(`スキップ: ${t.out} は手編集運用のリッチ版のため再生成しません(FORCE_REGEN=1 で強制)`);
    continue;
  }
  const result = await esbuild.build({
    entryPoints: [resolve(root, t.entry)],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    logLevel: 'warning',
  });

  const js = result.outputFiles[0].text;
  const template = readFileSync(resolve(root, t.template), 'utf8');
  const html = template.replace('%BUNDLE%', () => js);

  const outPath = resolve(root, '..', t.out);
  writeFileSync(outPath, html, 'utf8');
  console.log(`生成: ${outPath}  (${(html.length / 1024).toFixed(1)} KB)`);
}
