/**
 * デモと検証ツールを、それぞれ単一 HTML にまとめる。
 * ファイルをダブルクリックするだけで動くよう、JS はすべてインライン化する
 * （file:// では ES モジュールの読み込みが CORS で弾かれるため）。
 *
 * 検証ツールを単一ファイルにしているのは配布のためでもある。
 * プレイヤーがダウンロードして手元に置き、いつでもオフラインで検証できる状態にしておきたい。
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '..');

const targets = [
  { entry: 'demo/demo.ts', template: 'demo/index.html', out: 'poker-engine-demo.html' },
  { entry: 'demo/verify.ts', template: 'demo/verify.html', out: 'poker-fairness-verifier.html' },
];

for (const t of targets) {
  const result = await esbuild.build({
    entryPoints: [resolve(root, t.entry)],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: false,
    write: false,
    logLevel: 'warning',
  });

  const js = result.outputFiles[0].text;
  const template = readFileSync(resolve(root, t.template), 'utf8');
  // $ を含む JS が置換パターンとして解釈されないよう、関数形式で差し込む
  const html = template.replace('%BUNDLE%', () => js);

  const outPath = resolve(outDir, t.out);
  writeFileSync(outPath, html, 'utf8');
  console.log(`生成: ${outPath}  (${(html.length / 1024).toFixed(1)} KB)`);
}
