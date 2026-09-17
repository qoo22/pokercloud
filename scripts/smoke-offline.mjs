/**
 * オフライン版(poker-offline.html)の E2E スモークテスト
 *
 * 本物のサーバーを立てず、生成した単一 HTML を仮想 DOM で開くだけ。
 * 中でブラウザ内サーバーが起動し、ループバックでクライアントと繋がり、
 * bot が座って実際にハンドが回るところまでを確認する。
 * 「サーバー無しで本当に成立しているか」を証明するのがこのテストの役目。
 */
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, '../poker-offline.html'), 'utf8');

const errors = [];
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { errors.push(`${label}: ${e.stack ?? e}`); console.log(`  ✗ ${label}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('オフライン版の E2E:');

// --- 仮想ブラウザを用意 ---
const { window, document } = parseHTML(html);
const loc = { href: 'file:///poker-offline.html', origin: 'null', protocol: 'file:', host: '', search: '' };
const def = (o, k, v) => Object.defineProperty(o, k, { value: v, writable: true, configurable: true });
def(window, 'location', loc);

const memory = new Map();
const storage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};
def(window, 'localStorage', storage);

const sandbox = {
  window, document, location: loc, localStorage: storage,
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
  URLSearchParams, crypto: globalThis.crypto, Math, Date, JSON,
  TextEncoder, TextDecoder,
  addEventListener: () => {},
  // warn も出す。bot が起動できない等の不具合はここにしか出ないため
  console: { log: () => {}, warn: (...a) => console.log('   [warn]', ...a), error: (...a) => console.error('[offline]', ...a) },
  alert: () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// HTML 内のスクリプトを順に実行する(1本目=サーバー、2本目=クライアント本体)
const scripts = [...document.querySelectorAll('script:not([src])')];
console.log(`  （スクリプト ${scripts.length} 本を実行）`);
for (let i = 0; i < scripts.length; i++) {
  try {
    vm.runInContext(scripts[i].textContent, sandbox, { filename: `offline-${i}.js` });
  } catch (e) {
    errors.push(`script#${i} の実行で例外: ${e.stack ?? e}`);
  }
}

check('WebSocket がループバック版に差し替わっている', () => {
  if (typeof sandbox.WebSocket !== 'function') throw new Error('WebSocket が定義されていない');
});

check('ブラウザ内サーバーが起動し、セーブ機能が公開されている', () => {
  const save = sandbox.window.__offlineSave;
  if (!save || typeof save.export !== 'function') throw new Error('__offlineSave が無い');
});

// 接続 → ロビー受信 → bot 参加 → ハンド進行、を待つ
await sleep(3000);

check('サーバーに接続できている（未接続のままでない）', () => {
  const st = document.getElementById('status')?.textContent ?? '';
  if (/未接続|切断/.test(st)) throw new Error(`状態: ${st}`);
});

check('残高が配られている（新規ユーザー作成が動いた）', () => {
  const b = document.getElementById('balance')?.textContent ?? '';
  if (!b || b === '—' || b === '0') throw new Error(`残高: ${b}`);
});

check('ロビーに卓が並ぶ', () => {
  const t = document.getElementById('tables')?.textContent ?? '';
  if (!t.includes('マイクロ')) throw new Error(`ロビーが空: ${t.slice(0, 120)}`);
});

// 着席してハンドを回す
const join = document.querySelector('[data-join="micro-5"]') ?? document.querySelector('[data-join]');
if (join) {
  join.dispatchEvent(new window.Event('click'));
  await sleep(300);
  const ok = document.getElementById('bi-ok');
  if (ok) ok.dispatchEvent(new window.Event('click'));
}
// bot が集まってハンドが始まるまで待つ(固定6秒だと負荷の高いマシンで足りずフレークするため、最大18秒ポーリング)
for (let waited = 0; waited < 18000; waited += 1500) {
  await sleep(1500);
  const t = (document.getElementById('log')?.textContent ?? '') + (document.getElementById('felt')?.textContent ?? '');
  if (/ハンド|ブラインド|フォールド|チェック|コール|ベット/.test(t)) break;
}

check('着席してハンドが始まる（bot が同じ卓に来ている）', () => {
  const felt = document.getElementById('felt')?.textContent ?? '';
  const log = document.getElementById('log')?.textContent ?? '';
  if (!felt && !log) throw new Error('卓が描画されていない');
  if (!/ハンド|ブラインド|フォールド|チェック|コール|ベット/.test(log + felt)) {
    throw new Error(`進行の形跡が無い: ${(log + felt).slice(0, 200)}`);
  }
});

check('セーブが localStorage に書かれる', () => {
  const save = sandbox.window.__offlineSave;
  const json = save.export();
  const d = JSON.parse(json);
  if (!Array.isArray(d.users) || d.users.length === 0) throw new Error('ユーザーが保存されていない');
});

// 【事故の再発防止テスト】
// オフライン版を本番と同じドメインに置いたとき、オフラインが発行した resumeToken が
// オンラインの `poker.resume` を上書きして、本番の残高に戻れなくなった事故があった。
// キーが接頭辞つきで隔離されていること＝オンライン側の保存に触れないことを固定する。
check('保存領域が隔離されている（オンラインのログイン情報を壊さない）', () => {
  const keys = [...memory.keys()];
  if (keys.length === 0) throw new Error('何も保存されていない');
  const naked = keys.filter((k) => !k.startsWith('offline:'));
  if (naked.length) {
    throw new Error(`接頭辞なしのキーがある(オンラインと衝突する): ${naked.join(', ')}`);
  }
  if (!keys.some((k) => k === 'offline:poker.resume')) {
    throw new Error('ログイン情報が隔離名前空間に入っていない');
  }
});

check('セーブを書き出して読み込み直せる（引き継ぎの土台）', () => {
  const save = sandbox.window.__offlineSave;
  const json = save.export();
  if (!save.import(json)) throw new Error('インポートに失敗');
});

// スロット・ショップ・マイページが開けるか（経済系がオフラインでも生きているか）
for (const [tab, id, kw] of [['slot', 'slot', '総獲得'], ['shop', 'shop', 'チップ'], ['me', 'profile', 'VIP']]) {
  const btn = document.querySelector(`[data-tab="${tab}"]`);
  if (btn) btn.dispatchEvent(new window.Event('click'));
  await sleep(600);
  check(`${tab} タブが中身つきで開く（経済系がオフラインで動く）`, () => {
    const t = document.getElementById(id)?.textContent ?? '';
    if (!t.includes(kw)) throw new Error(`${kw} が出ていない: ${t.slice(0, 120)}`);
  });
}

if (errors.length) {
  console.error('\n失敗:\n' + errors.join('\n\n'));
  process.exit(1);
}
console.log('\nすべて通過しました。');
process.exit(0);
