/**
 * オフライン版 poker-offline.html を作る。
 *
 * 作り方は単純で、
 *   「リッチ版クライアント(poker-client.html)の <head> に、
 *     ブラウザ内サーバーのバンドルを1本差し込むだけ」。
 * サーバーバンドルはグローバルの WebSocket をループバック実装へ差し替えるので、
 * クライアント側のコードは 1 文字も変えずにそのまま動く
 * (=リッチ版の手編集をこの先も壊さない。HANDOFF 第42弾の事故の反省)。
 *
 * 実行: node scripts/build-offline.mjs
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '..');

const CLIENT = resolve(out, 'poker-client.html');
const OUT_FILE = resolve(out, 'poker-offline.html');

// --- 学習成果を読む(無くても動く) ---
const readJson = (p) => {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : 'null'; } catch { return 'null'; }
};
// どちらも poker-engine 直下。あり版が起動時に読むのと同じ場所
const tuned = readJson(resolve(root, 'tuned_params.json'));
const blueprint = readJson(resolve(root, 'flop_blueprint.json'));

// --- ブラウザ内サーバーをバンドル ---
// node: 系は入り口(offline/server.ts)から辿らないので本来は来ないが、
// botgto の設定ファイル読み込み等が dynamic import で残る。
// ブラウザには存在しないので、空モジュールへ解決して握りつぶす
// (呼び出し側はいずれも try/catch 済み)。
const stubNodeBuiltins = {
  name: 'stub-node-builtins',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: 'node-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
      contents: 'export default {}; export const readFileSync = () => { throw new Error("no fs in browser"); };',
      loader: 'js',
    }));
  },
};

const result = await esbuild.build({
  entryPoints: [resolve(root, 'offline/server.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'PokerOffline',
  target: 'es2020',
  write: false,
  logLevel: 'warning',
  plugins: [stubNodeBuiltins],
  define: {
    __TUNED_PARAMS__: tuned,
    __FLOP_BLUEPRINT__: blueprint,
    // bots.ts が環境変数(POKER_BOT_SCALE 等)を読むが、ブラウザに process は無い。
    // 参照ごと空オブジェクトに置き換えて、既定値が使われるようにする
    'process.env': '{}',
  },
});
const serverJs = result.outputFiles[0].text;

// --- クライアントHTMLへ差し込む ---
if (!existsSync(CLIENT)) throw new Error('poker-client.html が無い');
const html = readFileSync(CLIENT, 'utf8');

const imgs = (html.match(/data:image\//g) ?? []).length;
if (imgs < 90) {
  throw new Error(
    `poker-client.html の画像が ${imgs} 枚しかない。再生成された可能性が高いので中止する。` +
    'poker-client.RICH-BACKUP-*.html から復元すること',
  );
}

// クライアント本体のスクリプトより前に置く必要がある。
// クライアントは読み込み直後に new WebSocket(...) するので、その時点で差し替え済みでなければならない。
const boot = `<script>
${serverJs}
// ここで WebSocket がループバック版に差し替わる。以降クライアントは"サーバーがある"つもりで動く
window.__offlineSave = PokerOffline.startOfflineServer();
</script>
<style>
  /* オフライン版であることの控えめな表示 */
  #offline-badge { position:fixed; left:8px; bottom:8px; z-index:99999; font-size:11px;
    background:rgba(0,0,0,.6); color:#d9b45f; border:1px solid rgba(217,180,95,.5);
    border-radius:999px; padding:3px 10px; pointer-events:none; }
</style>
`;

const marker = '</head>';
if (!html.includes(marker)) throw new Error('</head> が見つからない');
let outHtml = html.replace(marker, boot + marker);

// バッジを body 末尾に足す
outHtml = outHtml.replace('</body>', '<div id="offline-badge">オフライン版</div>\n</body>');

writeFileSync(OUT_FILE, outHtml, 'utf8');
console.log(`生成: ${OUT_FILE}`);
console.log(`  サーバーバンドル: ${(serverJs.length / 1024).toFixed(0)}KB`);
console.log(`  合計: ${(outHtml.length / 1024 / 1024).toFixed(2)}MB (画像 ${imgs} 枚)`);
console.log(`  学習成果: tuned=${tuned !== 'null' ? 'あり' : 'なし'} / blueprint=${blueprint !== 'null' ? 'あり' : 'なし'}`);
