/**
 * 独立検証ページのスモークテスト。
 *
 * このページはプレイヤーに配布するものなので、
 * 「正しい入力を通す」だけでなく「改ざんを確実に落とす」ことまで確認する。
 * 何でも ✓ を出すツールは、無いより有害だから。
 */
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, '../poker-fairness-verifier.html'), 'utf8');

const nativeCrypto = globalThis.crypto;
const errors = [];

function load(search = '') {
  const { window, document } = parseHTML(html);
  const def = (obj, key, value) => {
    try {
      Object.defineProperty(obj, key, { value, writable: true, configurable: true });
    } catch {
      /* 上書きできないものは諦める */
    }
  };
  def(window, 'crypto', nativeCrypto);
  def(window, 'location', { search, href: `file:///verify.html${search}` });

  const sandbox = {
    window,
    document,
    crypto: nativeCrypto,
    location: { search },
    URLSearchParams,
    console,
    alert: () => {},
    navigator: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const script = document.querySelector('script:not([src])').textContent;
  vm.runInContext(script, sandbox, { filename: 'verify-bundle.js' });
  return { window, document, sandbox };
}

const check = (label, fn) => {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    errors.push(`${label}: ${e.stack}`);
    console.log(`  ✗ ${label}`);
  }
};

console.log('検証ツールのスモークテスト:');

const { document, window } = load();

check('サンプルボタンで検証が通る', () => {
  document.getElementById('sample').dispatchEvent(new window.Event('click'));
  const out = document.getElementById('out').textContent;
  if (!out.includes('配られる前に確定していたものと一致')) {
    throw new Error(`合格判定が出ない: ${out.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
});

check('デッキを 1 枚改ざんすると不合格になる', () => {
  const ta = document.getElementById('deck');
  const cards = ta.value.trim().split(/\s+/);
  [cards[0], cards[1]] = [cards[1], cards[0]];
  ta.value = cards.join(' ');
  document.getElementById('run').dispatchEvent(new window.Event('click'));
  const out = document.getElementById('out').textContent;
  if (!out.includes('検証に失敗')) throw new Error('改ざんを見逃した');
  if (!out.includes('枚が不一致')) throw new Error('不一致の内訳が出ていない');
});

check('サーバーシードをすり替えるとコミットメント照合で落ちる', () => {
  document.getElementById('sample').dispatchEvent(new window.Event('click'));
  document.getElementById('serverSeed').value = '99'.repeat(32);
  document.getElementById('run').dispatchEvent(new window.Event('click'));
  const out = document.getElementById('out').textContent;
  if (!out.includes('検証に失敗')) throw new Error('すり替えを見逃した');
  if (!out.includes('コミットメントの一致')) throw new Error('照合項目が出ていない');
});

check('nonce を偽ると落ちる', () => {
  document.getElementById('sample').dispatchEvent(new window.Event('click'));
  document.getElementById('nonce').value = '4';
  document.getElementById('run').dispatchEvent(new window.Event('click'));
  if (!document.getElementById('out').textContent.includes('検証に失敗')) {
    throw new Error('nonce 改ざんを見逃した');
  }
});

check('シード未入力ならエラーを出す', () => {
  document.getElementById('clear').dispatchEvent(new window.Event('click'));
  document.getElementById('run').dispatchEvent(new window.Event('click'));
  if (!document.getElementById('out').textContent.includes('サーバーシードを入力')) {
    throw new Error('入力チェックが働いていない');
  }
});

check('壊れた入力でもクラッシュしない', () => {
  document.getElementById('serverSeed').value = 'これは16進ではない';
  document.getElementById('commitment').value = '???';
  document.getElementById('run').dispatchEvent(new window.Event('click'));
  const out = document.getElementById('out').textContent;
  if (!out.includes('検証に失敗')) throw new Error('不正入力が不合格になっていない');
});

check('URL クエリからハンド情報を受け取って自動検証する', () => {
  // ゲーム側の「独立検証ツールで開く」リンク相当
  const seed = '11'.repeat(32);
  const commitment = 'ac8d8342f92a48c5c0d6ce637fbde8d0e50a4a13cfdc4b5f8b3b1a5b2e8e6f92';
  const q = `?serverSeed=${seed}&commitment=${commitment}&clientSeed=alice%7Cbob&nonce=1`;
  const ctx = load(q);
  const out = ctx.document.getElementById('out').textContent;
  if (!out.includes('検証結果')) throw new Error('クエリからの自動実行が動かない');
});

if (errors.length) {
  console.error('\n失敗:\n' + errors.join('\n\n'));
  process.exit(1);
}
console.log('\nすべて通過しました。');
