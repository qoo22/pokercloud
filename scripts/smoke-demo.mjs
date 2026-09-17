/**
 * 生成した単一 HTML を仮想 DOM 上で実行し、
 * 起動・ハンド進行・シミュレーションが例外なく動くかを確認する。
 *
 * 「ブラウザで開いたら真っ白」という事故を CI で止めるための最低限のスモークテスト。
 */
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, '../poker-engine-demo.html'), 'utf8');

const { window, document } = parseHTML(html);

// linkedom に無い API を最小限で補う（getter のみのプロパティは defineProperty で上書きする）
const def = (obj, key, value) => {
  try {
    Object.defineProperty(obj, key, { value, writable: true, configurable: true });
  } catch {
    /* 上書きできないものは諦める */
  }
};
// linkedom の window は globalThis を透過することがあるため、
// 差し替える前にネイティブ実装を捕まえておかないと自己再帰する
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
const nativeCrypto = globalThis.crypto;

def(window, 'performance', { now: () => Date.now() });
def(window, 'crypto', nativeCrypto);
def(window, 'setTimeout', (fn, ms) => nativeSetTimeout(fn, ms));
def(window, 'clearTimeout', (id) => nativeClearTimeout(id));

const script = document.querySelector('script:not([src])').textContent;

const sandbox = {
  window,
  document,
  performance: { now: () => Date.now() },
  crypto: nativeCrypto,
  setTimeout: nativeSetTimeout,
  clearTimeout: nativeClearTimeout,
  URLSearchParams,
  navigator: {},
  alert: () => {},
  console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const errors = [];
try {
  vm.runInContext(script, sandbox, { filename: 'demo-bundle.js' });
} catch (e) {
  errors.push(`起動時: ${e.stack}`);
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

console.log('スモークテスト:');

check('配牌前にコミットメントが表示されている', () => {
  const f = document.getElementById('fair').textContent;
  if (!/[0-9a-f]{64}/.test(f)) throw new Error('コミットメントが出ていない');
  if (!f.includes('ハンド終了後に開示')) throw new Error('進行中なのにサーバーシードが出ている');
});

check('進行中の画面にサーバーシードが漏れていない', () => {
  // ハンド完了前は、ページ全体のどこにも serverSeed が出てはいけない
  const body = document.body.textContent;
  const hashes = body.match(/[0-9a-f]{64}/g) ?? [];
  // 出てよいのはコミットメント 1 個だけ
  if (new Set(hashes).size > 1) throw new Error(`64桁の16進が複数出ている: ${new Set(hashes).size} 個`);
});

check('起動時にテーブルが描画される', () => {
  const t = document.getElementById('table').innerHTML;
  if (!t.includes('class="seat')) throw new Error('席が描画されていない');
});

check('イベントログが出力される', () => {
  const log = document.getElementById('log').innerHTML;
  if (!log.includes('開始')) throw new Error('ログが空');
});

check('新しいハンドを 200 回連続で開始できる', () => {
  for (let i = 0; i < 200; i++) sandbox.window.__newHand();
});

// 全席をボットに任せ、思考時間を 0 にして 1 ハンドを実際の進行経路で打ち切る
document.getElementById('cfgAuto').checked = true;
sandbox.window.__setBotDelay(0);
sandbox.window.__newHand();
await new Promise((r) => nativeSetTimeout(r, 1500));

check('ハンドを最後まで進めると公正性の検証が通る', () => {
  const fair = document.getElementById('fair').textContent;
  if (!fair.includes('配る前に確定していたものと一致')) {
    throw new Error(`検証が通っていない: ${fair.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  if (!/サーバーシード[\s\S]{0,20}[0-9a-f]{64}/.test(fair)) {
    throw new Error('終了後もサーバーシードが開示されていない');
  }
});

document.getElementById('cfgAuto').checked = false;
sandbox.window.__setBotDelay(550);

check('ヒーローの合法手が UI に出る（またはボット手番）', () => {
  const a = document.getElementById('actions').innerHTML;
  if (!a.includes('button')) throw new Error('アクションバーが空');
});

document.querySelector('[data-sim="1000"]').dispatchEvent(new window.Event('click'));
await new Promise((r) => nativeSetTimeout(r, 4000)); // runSim は setTimeout 経由で走る

check('1,000 ハンドのシミュレーションが完走する', () => {
  const out = document.getElementById('simOut').textContent;
  if (!out.includes('ハンド数')) throw new Error(`結果が出力されない: ${out.slice(0, 200)}`);
});

check('シミュレーションでチップ不整合とエンジン例外がゼロ', () => {
  const out = document.getElementById('simOut').textContent;
  const chip = /チップ不整合\s*:\s*(\d+)/.exec(out);
  const fail = /エンジン例外\s*:\s*(\d+)/.exec(out);
  if (!chip || !fail) throw new Error('検証行が見つからない');
  if (+chip[1] !== 0) throw new Error(`チップ不整合が ${chip[1]} 件`);
  if (+fail[1] !== 0) throw new Error(`エンジン例外が ${fail[1]} 件`);
});

check('役の出現率が理論値から 4σ 以内に収まる', () => {
  const out = document.getElementById('simOut').textContent;
  if (out.includes('← 要確認')) throw new Error(`理論値から乖離した役がある:\n${out}`);
});

console.log('\n--- シミュレーション出力 ---');
console.log(document.getElementById('simOut').textContent.trim());
console.log('---');

if (errors.length) {
  console.error('\n失敗:\n' + errors.join('\n\n'));
  process.exit(1);
}
console.log('\nすべて通過しました。');
