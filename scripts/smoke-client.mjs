/**
 * 実卓クライアントの E2E スモークテスト
 *
 * 本物のサーバーを立て、生成した poker-client.html を仮想 DOM で 2 つ動かし、
 * 実際の WebSocket でつないで 1 ハンド遊ばせる。
 *
 * 「型は通るがブラウザで開くと動かない」を潰すのが目的。
 * クライアントのバグはコンパイルでは見つからないので、実際に動かすしかない。
 */
import { parseHTML } from 'linkedom';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Gateway } from '../dist/src/server/gateway.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * クライアントの置き場所を探す(第170弾)。
 *
 * ローカルの作業場ではエンジンの1つ上に置いてあるが、リポジトリではルート自体が
 * エンジンなので、同じ場所は存在しない。配布用の public/ にある実体を使う。
 * どこで動かしても同じコマンドで通るように、順に探して最初に見つかったものを読む。
 */
function findClient() {
  const cands = [
    resolve(root, '../poker-client.html'),   // ローカルの作業場
    resolve(root, 'public/poker-client.html'),
    resolve(root, 'docs/poker-client.html'),
  ];
  for (const c of cands) if (existsSync(c)) return c;
  throw new Error('poker-client.html が見つかりません:\n  ' + cands.join('\n  '));
}
const html = readFileSync(findClient(), 'utf8');

// クライアントの async 内で throw されると Node の unhandledRejection として出てくる。
// 原因を推測せずに済むよう、必ず表示する
process.on('unhandledRejection', (e) => console.log('  [client reject]', (e && (e.stack || e.message)) || e));
process.on('uncaughtException', (e) => {
  // 握りつぶすとテストが終わらずハングして原因が見えなくなる。必ず落とす
  console.log('  [client throw]', (e && (e.stack || e.message)) || e);
  process.exit(1);
});

const errors = [];
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    errors.push(`${label}: ${e.stack ?? e}`);
    console.log(`  ✗ ${label}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const gateway = new Gateway({
  port: 0,
  tournaments: [
    {
      tournamentId: 'e2e-sng',
      name: 'E2E SNG',
      type: 'sng',
      buyIn: 1000,
      fee: 100,
      startingStack: 1500,
      seatsPerTable: 2,
      maxPlayers: 2,
      levelDurationMs: 5000,
    },
  ],
  tables: [
    {
      tableId: 'e2e',
      name: 'E2E 卓',
      smallBlind: 50,
      bigBlind: 100,
      maxSeats: 2,
      seedWindowMs: 150,
      handIntervalMs: 200,
      actionTimeoutMs: 4000,
      rakePercent: 0,
    },
  ],
  signupBonus: 50000,
});
const port = await gateway.listen();

/** クライアント HTML を仮想 DOM 上で 1 つ起動する */
function boot(label) {
  const { window, document } = parseHTML(html);
  const memory = new Map();
  const def = (obj, key, value) => {
    try {
      Object.defineProperty(obj, key, { value, writable: true, configurable: true });
    } catch {
      /* 上書きできない環境変数は諦める */
    }
  };
  const loc = { protocol: 'http:', host: `127.0.0.1:${port}`, search: '', href: `http://127.0.0.1:${port}/` };
  def(window, 'location', loc);
  def(window, 'WebSocket', globalThis.WebSocket);
  def(window, 'localStorage', {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
  });

  const sandbox = {
    window,
    document,
    location: loc,
    WebSocket: globalThis.WebSocket,
    localStorage: {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, String(v)),
      removeItem: (k) => memory.delete(k),
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    URLSearchParams,
    console: { log: () => {}, warn: () => {}, error: (...a) => console.error(`[${label}]`, ...a) },
    alert: () => {},
    crypto: globalThis.crypto,
    Math,
    Date,
    JSON,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // ページ内の <script> は全部、載っている順に流す。
  // 1本目だけ実行していた頃は、末尾の小さなスクリプト(FABドロワーやモード切替リンク)が
  // テストされず、壊れていても気づけなかった。
  const scripts = [...document.querySelectorAll('script:not([src])')];
  scripts.forEach((el, i) => {
    vm.runInContext(el.textContent, sandbox, { filename: `client-${label}-${i}.js` });
  });
  return { window, document, sandbox, label };
}

const click = (ctx, el) => el.dispatchEvent(new ctx.window.Event('click'));

/**
 * スロットが次のスピンを受け付けるまで待つ(第170弾)。
 *
 * ただ待つだけでは足りない。フリーゲームの倍率抽選は**ボタンを押すまで進まない**ので、
 * 直前のスピンがフリーに入っていると、待っている側は永久に「回転中…」のままになる。
 * 実際それで「SCATTERの焦らし」の検査が1回も回せずに落ちていた(回るかどうかが運任せ)。
 * プレイヤーと同じように、待ちながら押してやる。
 *
 * @returns 押せるようになったボタン。時間切れなら null
 */
async function waitSpinReady(ctx, n = 200) {
  for (let i = 0; i < n; i++) {
    const b = ctx.document.getElementById('slot-spin');
    if (b && !b.disabled) return b;
    const go = ctx.document.getElementById('fsin-go');
    if (go && !go.disabled) click(ctx, go);   // 倍率抽選を進める
    await sleep(200);
  }
  return null;
}

console.log('実卓クライアントの E2E:');

// 再生成事故ガード: poker-client.html は手編集運用(AI画像100枚埋め込み)。
// `npm run client` 等で client/ の古いソースから再生成すると画像も機能も全部消える。
// 万一そうなったら以降のテストをする意味がないので、ここで即座に落とす。
check('リッチ版クライアントである（AI画像が埋め込まれている）', () => {
  const imgs = (html.match(/data:image\//g) ?? []).length;
  if (imgs < 90) {
    throw new Error(
      `画像が ${imgs} 枚しかない。npm run client 等で再生成された可能性が高い。` +
      'poker-client.RICH-BACKUP-*.html から復元すること（HANDOFF.md 参照）',
    );
  }
});

const A = boot('A');
const B = boot('B');
// クライアントが5MB近くまで育ち、起動(vm評価+接続+初回描画)の所要が機械の込み具合で
// 大きくぶれるようになった。固定600msだと間に合わない日があるので、**揃うまで待つ**。
// これが揃わないとロビー系の検査が雪崩式に全部落ちる(今日それで何度も空振りした)
for (let i = 0; i < 100; i++) {
  const t = A.document.getElementById('tables')?.textContent ?? '';
  const b = A.document.getElementById('balance')?.textContent ?? '';
  const t2 = B.document.getElementById('tables')?.textContent ?? '';
  if (t.includes('E2E 卓') && t2.includes('E2E 卓') && b !== '—') break;
  await sleep(200);
}

check('ロビーにテーブルが表示される', () => {
  const t = A.document.getElementById('tables').textContent;
  if (!t.includes('E2E 卓')) throw new Error(`ロビーが空(20秒待っても来ない): ${t.slice(0, 200)}`);
});


check('残高が表示される', () => {
  const b = A.document.getElementById('balance').textContent;
  if (b !== '50,000') throw new Error(`残高が出ていない: ${b}`);
});

// 2 人とも参加 → バイインダイアログで着席
for (const ctx of [A, B]) {
  const join = ctx.document.querySelector('[data-join]');
  if (!join) {
    errors.push('参加ボタンが見つかりません');
    break;
  }
  click(ctx, join);
  await sleep(120);
  const ok = ctx.document.getElementById('bi-ok');
  if (!ok) {
    errors.push(`[${ctx.label}] バイインダイアログが出ません`);
    break;
  }
  click(ctx, ok);
  await sleep(200);
}
await sleep(500);

check('2 人とも着席できている', () => {
  const seated = gateway.lobby.getRoom('e2e').seatedCount;
  if (seated !== 2) throw new Error(`着席数 ${seated}`);
});

check('配牌前にコミットメントが表示される', () => {
  const f = A.document.getElementById('fair').textContent;
  if (!f.includes('コミットメント')) throw new Error('公正性パネルが空');
});

// 手番が来たらチェックかコールを押し続ける
let clicks = 0;
const drive = setInterval(() => {
  for (const ctx of [A, B]) {
    const actions = ctx.document.getElementById('actions');
    const buttons = Array.from(actions.querySelectorAll('[data-act]'));
    if (!buttons.length) continue;
    const pick =
      buttons.find((b) => b.dataset.act === 'check') ??
      buttons.find((b) => b.dataset.act === 'call') ??
      buttons.find((b) => b.dataset.act === 'fold');
    if (pick) {
      click(ctx, pick);
      clicks++;
    }
  }
}, 60);

await sleep(6000);
clearInterval(drive);

check('アクションボタンが実際に押せている', () => {
  if (clicks < 2) throw new Error(`押せたのは ${clicks} 回だけ`);
});

check('ハンドが進行してログが出ている', () => {
  const log = A.document.getElementById('log').textContent;
  if (!log.includes('ハンド #')) throw new Error(`ログが空: ${log.slice(0, 200)}`);
});

check('公正性の検証が画面上で通っている', () => {
  const f = A.document.getElementById('fair').textContent;
  if (f.includes('検証に失敗')) throw new Error(`検証が失敗している: ${f.slice(0, 300)}`);
  if (!f.includes('配る前に確定していた並びと一致')) {
    throw new Error(`検証結果が出ていない: ${f.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
});

check('他人の手札がクライアントの画面に現れていない', () => {
  // 相手の席に裏向き以外のカードが出ていたら、サーバーが情報を漏らしている
  const st = A.sandbox.window.__state ?? null;
  // 状態はモジュール内に閉じているので、代わりに DOM を見る：
  // 自分の席のカードは .card.mine、他人は .card.back のはず（ショーダウン中を除く）
  const felt = A.document.getElementById('felt');
  const seats = Array.from(felt.querySelectorAll('.seat'));
  const others = seats.filter((s) => !s.innerHTML.includes('YOU'));
  for (const o of others) {
    const faceUp = Array.from(o.querySelectorAll('.card')).filter((c) => !c.className.includes('back'));
    // ショーダウン後は公開されるので、結果表示中は許容する
    const street = felt.querySelector('.street-tag')?.textContent ?? '';
    if (faceUp.length > 0 && street !== '結果' && street !== 'ショーダウン') {
      throw new Error(`他席に表向きのカードが出ている（street=${street}）`);
    }
  }
});

// --- P2 の画面（トーナメント・ショップ・マイページ）---
const tabClick = (ctx, name) => {
  const tab = Array.from(ctx.document.querySelectorAll('.tab')).find((b) => b.dataset.tab === name);
  if (!tab) throw new Error(`タブ ${name} が無い`);
  click(ctx, tab);
};

click(A, A.document.getElementById('btn-lobby'));
await sleep(300);

tabClick(A, 'tour');
await sleep(400);
check('トーナメント一覧が表示される', () => {
  const t = A.document.getElementById('tournaments').textContent;
  if (!t.includes('E2E SNG')) throw new Error(`一覧が空: ${t.slice(0, 200)}`);
});

tabClick(A, 'shop');
await sleep(400);
check('ショップに商品とオファーが並ぶ', () => {
  const t = A.document.getElementById('shop').textContent;
  if (!t.includes('チップ')) throw new Error(`ショップが空: ${t.slice(0, 200)}`);
  if (!t.includes('初回限定パック')) throw new Error('初回オファーが出ていない');
});

// 年齢確認は事前に済ませた状態にする(20歳以上)。初回購入時のモーダルを飛ばすため
A.sandbox.localStorage.setItem('poker.ageBand', 'adult');

/** 商品を押す → チェックアウト(支払い方法選択→決済処理演出→付与)まで通す */
const buyThroughCheckout = async (ctx, sku) => {
  const btn = ctx.document.querySelector(`[data-buy="${sku}"]`);
  if (!btn) return false;
  click(ctx, btn);
  // カード以外の決済方法を選ぶと、フォーム入力なしで処理ステップへ進む
  const pm = ctx.document.querySelector('[data-pm="apple"]');
  if (pm) click(ctx, pm);
  const next = ctx.document.getElementById('co-next');
  if (!next) return false;
  click(ctx, next);
  await sleep(2700); // 決済処理演出(1.4〜2.3秒)の完了とレスポンスを待つ
  return true;
};

const buyBtn = A.document.querySelector('[data-buy="chips_160"]');
if (buyBtn) click(A, buyBtn);

check('購入前にチェックアウトが出る（金額と支払い方法を明示）', () => {
  const dlg = A.document.getElementById('modal-root').textContent;
  if (!dlg.includes('お支払い')) throw new Error('チェックアウトが出ていない');
  if (!/¥/.test(dlg)) throw new Error('金額が出ていない');
  if (!A.document.getElementById('co-next')) throw new Error('支払うボタンが無い');
});

check('やめるを押すと購入されない', () => {
  const before = Number(A.document.getElementById('balance').textContent.replace(/,/g, ''));
  const cancel = A.document.getElementById('co-cancel');
  if (!cancel) throw new Error('やめるボタンが無い');
  click(A, cancel);
  const after = Number(A.document.getElementById('balance').textContent.replace(/,/g, ''));
  if (after !== before) throw new Error('キャンセルしたのに残高が動いた');
  if (A.document.getElementById('co-next')) throw new Error('ダイアログが閉じていない');
});

if (!(await buyThroughCheckout(A, 'chips_160'))) errors.push('チェックアウトを通せなかった');
await sleep(500);

check('モック購入でチップが増える', () => {
  if (!buyBtn) throw new Error('購入ボタンが無い');
  const now = Number(A.document.getElementById('balance').textContent.replace(/,/g, ''));
  if (now < 15_000_000) throw new Error(`残高が増えていない: ${now}`);
});

const balAfterFirst = Number(A.document.getElementById('balance').textContent.replace(/,/g, ''));
await buyThroughCheckout(A, 'chips_160');
await sleep(400);

check('2回目の購入も通る（レシートは毎回新しく発行される）', () => {
  // 固定レシートを使い回す実装だと、サーバーの二重付与ガードに弾かれて残高が増えない
  const now = Number(A.document.getElementById('balance').textContent.replace(/,/g, ''));
  if (now <= balAfterFirst) throw new Error(`2回目の購入が反映されていない: ${balAfterFirst} → ${now}`);
});

tabClick(A, 'me');
await sleep(400);
check('マイページに VIP・ミッション・パスが出る', () => {
  const t = A.document.getElementById('profile').textContent;
  for (const k of ['VIP', 'デイリーミッション', 'チャレンジパス']) {
    if (!t.includes(k)) throw new Error(`${k} が出ていない`);
  }
});

const dailyBtn = A.document.getElementById('btn-daily');
if (dailyBtn && !dailyBtn.disabled) click(A, dailyBtn);
await sleep(500);

check('デイリーボーナスを受け取ると受け取り済みになる', () => {
  if (!dailyBtn) throw new Error('デイリーボタンが無い');
  const again = A.document.getElementById('btn-daily');
  if (again && !again.disabled) throw new Error('二重受け取りができてしまう');
});

check('ハンドをプレイした分ミッションが進んでいる', () => {
  const t = A.document.getElementById('profile').textContent;
  if (!/ハンドを 20 回プレイする/.test(t)) throw new Error('ミッションが出ていない');
  const m = /(\d+) \/ 20/.exec(t);
  if (!m || Number(m[1]) < 1) throw new Error(`ミッションが進んでいない: ${m?.[0]}`);
});

// --- アカウント引き継ぎ（鍵を失ってもアカウントに戻れるようにする唯一の手段） ---
tabClick(A, 'me');
await sleep(400);

check('未発行なら警告が出て発行を促す', () => {
  const t = A.document.getElementById('profile').textContent;
  if (!t.includes('アカウントの引き継ぎ')) throw new Error('引き継ぎの節が無い');
  if (!t.includes('アカウントを失うことがあります')) throw new Error('未発行の警告が出ていない');
});

const issueBtn = A.document.getElementById('btn-transfer-issue');
if (issueBtn) click(A, issueBtn);
await sleep(500);

let issuedCode = '';
let issuedPin = '';
check('引き継ぎコードとPINが発行・表示される', () => {
  const code = A.document.getElementById('xf-code')?.textContent?.trim() ?? '';
  const pin = A.document.getElementById('xf-pin')?.textContent?.trim() ?? '';
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) throw new Error(`IDの形式が違う: ${code}`);
  if (!/^\d{4}$/.test(pin)) throw new Error(`PINの形式が違う: ${pin}`);
  issuedCode = code;
  issuedPin = pin;
  const dlg = A.document.getElementById('modal-root').textContent;
  if (!dlg.includes('二度と表示されません')) throw new Error('控えるよう促していない');
});

// 発行済みになったら警告が消えて再発行に変わる
const ok = A.document.getElementById('xf-ok');
if (ok) click(A, ok);
tabClick(A, 'me');
await sleep(500);
check('発行後は警告が消え、再発行ボタンになる', () => {
  const t = A.document.getElementById('profile').textContent;
  if (t.includes('アカウントを失うことがあります')) throw new Error('警告が残っている');
  if (!t.includes('再発行')) throw new Error('再発行ボタンになっていない');
});

// 別端末（B）から実際に引き継ぐ。B はもともと別アカウントで繋がっている
const aToken = A.sandbox.localStorage.getItem('poker.resume');
const bTokenBefore = B.sandbox.localStorage.getItem('poker.resume');
tabClick(B, 'me');
await sleep(400);
{
  const open = B.document.getElementById('btn-transfer-redeem');
  if (open) click(B, open);
  const codeIn = B.document.getElementById('xr-code');
  const pinIn = B.document.getElementById('xr-pin');
  if (codeIn && pinIn) {
    codeIn.value = issuedCode;
    pinIn.value = issuedPin;
  }
  const go = B.document.getElementById('xr-go');
  if (go) click(B, go);
}
await sleep(800);

check('別端末がコードとPINでアカウントを引き継げる', () => {
  if (!issuedCode) throw new Error('コードが発行されていない');
  const dlg = B.document.getElementById('modal-root').textContent;
  if (!dlg.includes('引き継ぎ完了')) throw new Error(`引き継げていない: ${dlg.slice(0, 140)}`);
  // 鍵が A と同一になっている＝同じアカウントに入れた、ということ
  const bTokenAfter = B.sandbox.localStorage.getItem('poker.resume');
  if (bTokenAfter === bTokenBefore) throw new Error('鍵が変わっていない');
  if (bTokenAfter !== aToken) throw new Error('A と同じアカウントになっていない');
});

check('使い切り: 同じコードは二度と使えない', () => {
  // 漏れても再利用されないよう、成立した時点でコードは消えている必要がある
  const open = B.document.getElementById('btn-transfer-redeem');
  if (!open) return; // 画面が作り直された直後なら省略
  click(B, open);
  const codeIn = B.document.getElementById('xr-code');
  const pinIn = B.document.getElementById('xr-pin');
  if (codeIn && pinIn) { codeIn.value = issuedCode; pinIn.value = issuedPin; }
  const go = B.document.getElementById('xr-go');
  if (go) click(B, go);
});

let played = 0;
check('複数ハンドが連続して回っている', () => {
  const log = A.document.getElementById('log').textContent;
  played = (log.match(/ハンド #/g) ?? []).length;
  if (played < 2) throw new Error(`回ったハンド数 ${played}`);
});

// --- ゴールドスロット（ゴールドの唯一の使い道） ---
tabClick(A, 'slot');
await sleep(400);

check('スロット画面に5x3の盤面(25ライン)・配当表が出る', () => {
  const el = A.document.getElementById('slot');
  const t = el.textContent;
  // 第58弾で 3リール → 5リール×3段(243ways)へ。盤面はマス15個
  const cells = el.querySelectorAll('.sl-cell').length;
  if (cells !== 15) throw new Error(`盤面のマスが 15 でない: ${cells}`);
  if (!el.querySelector('#sl-grid')) throw new Error('盤面が無い');
  for (const k of ['LINES', '遊び方']) {
    if (!t.includes(k)) throw new Error(`${k} が出ていない`);
  }
});

check('チップ専用になっている（ゴールドの導線が無い）', () => {
  const el = A.document.getElementById('slot');
  if (el.querySelector('#sl-cur')) throw new Error('通貨の切り替えが残っている');
  if (/ゴールドで遊ぶ/.test(el.textContent)) throw new Error('ゴールドの導線が残っている');
  // 賭け金の候補はチップの下限(1,000)以上
  click(A, A.document.getElementById('sl-betnow'));
  const bets = [...A.document.querySelectorAll('.sl-betitem')].map((b) => Number(b.dataset.bet));
  if (!bets.length) throw new Error('賭け金の候補が無い');
  if (bets.some((v) => v < 1000)) throw new Error(`チップの下限を割る候補がある: ${bets.join(',')}`);
  click(A, A.document.getElementById('sl-betnow'));   // 閉じる
});

{
  const { SLOT_CHIP_MAX_BET, chipBetLadder } = await import('../dist/src/server/economy.js');
  check('hello が届かなくても諦めずに再送する（休止からの復帰で固まらない）', () => {
  // Render の無料プランは休止から復帰する間、ルーターが WebSocket を先に受け付ける。
  // その間に送った hello はアプリに届かず捨てられるため、
  // 一度しか送らないと「接続済みなのに卓もスロットも出ない」まま永久に待つ
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  if (!/__helloOk/.test(js)) throw new Error('hello.ok を待つ状態を持っていない');
  if (!/__helloTimer = setInterval/.test(js)) throw new Error('hello を再送していない');
  if (!/if \(__helloOk\) \{ clearInterval\(__helloTimer\); return; \}/.test(js))
    throw new Error('hello.ok が来ても再送が止まらない');
  // hello.ok を受け取るまで「接続済み」と言わない(言うと利用者が原因を誤解する)
  const open = /ws\.onopen = \(\) => \{[\s\S]*?\n    \};/.exec(js);
  if (!open) throw new Error('onopen が読めない');
  if (/setStatus\("\\u63A5\\u7D9A\\u6E08\\u307F"|setStatus\("接続済み"/.test(open[0]))
    throw new Error('hello.ok の前に「接続済み」と表示している');
});

check('賭け金の上限が5000兆で止まる', () => {
    // 第157弾: オーナー指示で500兆→5000兆へ増額。
    // 5000兆は 2^53(≈9007兆)未満なので、台帳は分割せず1行で記帳できる
    if (SLOT_CHIP_MAX_BET !== 5_000_000_000_000_000)
      throw new Error(`上限が5000兆でない: ${SLOT_CHIP_MAX_BET}`);
    if (!Number.isSafeInteger(SLOT_CHIP_MAX_BET))
      throw new Error('上限が台帳1行の上限(2^53)を超えている');
    // 所持が上限をはるかに超えていても、選択肢は上限で止まる
    const bets = chipBetLadder(9_000_000_000_000_000);
    if (!bets.length) throw new Error('賭け金の候補が空');
    const over = bets.filter((v) => v > SLOT_CHIP_MAX_BET);
    if (over.length) throw new Error(`上限を超える選択肢がある: ${over.join(',')}`);
    if (bets[bets.length - 1] !== SLOT_CHIP_MAX_BET)
      throw new Error(`最大の選択肢が上限でない: ${bets[bets.length - 1]}`);
    // クライアント側でも上限で止めていること(サーバーに弾かれる前に押さえる)
    const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
    if (!/sv\.chipMaxBet/.test(js)) throw new Error('クライアントが上限を見ていない');
  });
}

check('配当が着弾するまで数字に出ない（ネタバレ防止・第92弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // ①結果を受け取った瞬間に won を残高へ足していない(凍結してから演出へ)
  if (/- \(r\.cost \|\| 0\) \+ \(r\.won \|\| 0\)/.test(js))
    throw new Error('結果の受信直後に配当を残高へ足している');
  if (!/slotBalFreeze = balFrom/.test(js)) throw new Error('残高の凍結が無い');
  // ②ヘッダーの残高も凍結値を見る
  if (!/slotBalFreeze != null \? slotBalFreeze : balance/.test(js))
    throw new Error('ヘッダーの残高が凍結を見ていない');
  // ③ライン表示中に総獲得を出していない(本数だけ)
  if (!/slotShowLineCount\(wins\.length\)/.test(js))
    throw new Error('ライン表示中の本数表示が無い');
  if (/slotShowLineInfo\(wins\[i\], sv, bet, st\.mult\);\s*\n\s*slotShowTotal\(/.test(js))
    throw new Error('ライン表示中に総獲得を出している(ネタバレ)');
  // ④チップの着弾で数字が回る
  for (const fn of ['slotPayout', 'slotReleaseBalance']) {
    if (!new RegExp('function ' + fn).test(js)) throw new Error(`${fn} が無い`);
  }
  if (!/await slotPayout\(r\.won, "sl-dock-amt"/.test(js)) throw new Error('通常時の着弾が無い');
  // 第114弾からフリー中はHUD「今回」とドックを同じカウントで回す(inline化)
  if (!/const wn2 = document\.getElementById\("slfs-wnow"\)/.test(js)) throw new Error('フリー中の着弾が無い');
  // ⑤突入演出: 回数は0から数え、spinsTotal(将来の上乗せ込み)を出さない。
  //   第163弾で2台目からも呼べるよう O.spins の上書きが付いたが、
  //   **渡さなければ従来どおりスキャッター数から決まる**ことを見る
  if (!/const startSpins = (O\.spins \|\| \()?scatters >= 5 \? 16 : scatters === 4 \? 12 : 8/.test(js))
    throw new Error('突入演出が開始回数を使っていない');
  if (!/FREE GAME START!/.test(js)) throw new Error('スタート宣言が無い');
  // ⑥ルーレットは第103弾でボタン式・減速方式に変わった。
  //   「行き過ぎて戻る」焦らしはやめ、**高速→減速→停止**で焦らす(詳細は第103弾の検査)
  if (!/SPIN_MS = \d{4}/.test(js)) throw new Error('ルーレットの回転時間が読めない');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  if (!/@keyframes\s+wrShine/.test(css)) throw new Error('当選した輪の輝きが無い');
  // ⑦第93弾→第113弾: 当選バナー自体を廃止した(検査は第112弾側に統合)
  // 総獲得の反映にチップは飛ばさない(オーナー指定で撤去済み)
  if (/sl-payfly/.test(js)) throw new Error('総獲得へのチップ飛行が残っている');
});

check('フリーゲームBGMが入っていて、開始・終了・エラーで管理される（第96弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  for (const fn of ['fsBgmStart', 'fsBgmStop', 'fsBgmEnsure']) {
    if (!new RegExp('function ' + fn).test(js)) throw new Error(`${fn} が無い`);
  }
  if (!/FS_BGM_B64 = "[A-Za-z0-9+\/]{100}/.test(js)) throw new Error('BGMの音源が埋め込まれていない');
  // 第99弾: ルーレットが終わってリールが回り始めた瞬間から鳴らす。
  // 突入演出(slotFsIntro)の直前で鳴らすとルーレット中に被るので禁止
  if (/fsBgmStart\(\);[^\n]*\n\s*await slotFsIntro\(/.test(js))
    throw new Error('突入演出の頭でBGMを鳴らしている(ルーレット中に被る)');
  if (!/if \(i === 1\) fsBgmStart\(\);/.test(js))
    throw new Error('1ゲーム目の回転開始でBGMが始まらない');
  // 待ち時間を無くすため、デコードだけは突入演出の前に始めておく
  if (!/fsBgmEnsure\(\);[^\n]*\n\s*await slotFsIntro\(/.test(js))
    throw new Error('BGMの先読み(fsBgmEnsure)が無い');
  const stops = (js.match(/fsBgmStop\(\);/g) || []).length;
  if (stops < 2) throw new Error(`停止経路が足りない(${stops}/2: リザルト後+エラー時)`);
  // ミュート連動: 出力が amaster を通ること
  if (!/fsBgmGain\)\.connect\(amaster\)/.test(js)) throw new Error('BGMが音スイッチ(amaster)を通っていない');
  // 第102弾: ループの継ぎ目を消す処理(デコード後の無音カット+クロスフェード)
  if (!/function slotMakeSeamless/.test(js)) throw new Error('継ぎ目の処理が無い');
  if (!/fsBgmBuf = slotMakeSeamless\(c, buf\)/.test(js))
    throw new Error('デコード結果に継ぎ目の処理を通していない');
  if (!/Math\.sqrt\(t\)/.test(js)) throw new Error('等パワークロスフェードになっていない');
});

check('倍率抽選がボタン式になり、専用の音と演出が入る（第103弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // 支給の効果音が7つとも入っている
  for (const k of ['gong', 'draw1', 'draw2', 'draw3', 'draw4', 'letsgo', 'bonusin', 'winsure']) {
    if (!new RegExp(k + ': "[A-Za-z0-9+/]{80}').test(js)) throw new Error(`効果音 ${k} が入っていない`);
  }
  for (const fn of ['sfx', 'sfxEnsure', 'sfxPreload', 'antiBgmStart', 'antiBgmStop']) {
    if (!new RegExp('function ' + fn + '\\b').test(js)) throw new Error(`${fn} が無い`);
  }
  // ①スキャッター成立でファンファーレ → ②金色に染めて突入音
  if (!/fanfarePlay\(\);[\s\S]{0,200}el\.classList\.add\("gold"\);[\s\S]{0,60}sfx\("bonusin"\)/.test(js))
    throw new Error('ファンファーレ→金色→突入音 の流れになっていない');
  if (!/#sl-fsin\.gold::before/.test(css)) throw new Error('金色の画面転換が無い');
  // ③ボタンを押すまで待つ。待つ間はワクワクBGM
  if (!/id="fsin-go"/.test(js)) throw new Error('抽選スタートのボタンが無い');
  if (!/antiBgmStart\(\);[\s\S]{0,400}btn\.onclick = go/.test(js))
    throw new Error('ボタン待ちの間にBGMが流れない');
  // ④押したら LET'S GO → 減速しながら抽選音
  if (!/sfx\("letsgo"\)/.test(js)) throw new Error('ボタンで letsgo が鳴らない');
  if (!/55 \+ 645 \* Math\.pow\(k, 3\.2\)/.test(js)) throw new Error('抽選の減速が弱い(焦らしが足りない)');
  if (!/SPIN_MS = 6200/.test(js)) throw new Error('抽選時間が短い(焦らしが足りない)');
  if (!/sfx\("draw" \+ \(drawN % 4 \+ 1\), \{ solo: true/.test(js))
    throw new Error('抽選中に抽選音1〜4が鳴らない');
  // ⑤決定でドラ → フリーズ → 点滅
  if (!/sfx\("gong"\)/.test(js)) throw new Error('決定時にドラが鳴らない');
  if (!/wrap\.classList\.add\("blink"\)/.test(js)) throw new Error('決定した倍率が点滅しない');
  // 第104弾: 音を重ねない。ファンファーレ→(鳴り終わる)→金色+突入音→(鳴り終わる)→抽選
  if (!/await slotSleep\(6900\);/.test(js))
    throw new Error('ファンファーレの鳴り終わりを待っていない(音が重なる)');
  if (!/await slotSleep\(SFX_SEC\.bonusin \* 1000 \+ 250\);/.test(js))
    throw new Error('突入音の鳴り終わりを待っていない(音が重なる)');
  // スキャッターを点滅させながらファンファーレ
  if (!/function slotFlashScatters/.test(js)) throw new Error('スキャッターの点滅が無い');
  if (!/slotFlashScatters\(true\);\s*\n\s*fanfarePlay\(\)/.test(js))
    throw new Error('点滅とファンファーレが揃っていない');
  // 勝ち確: 左端3連WILD(リスピン)と、フリー中のWILD固定
  const winsureN = (js.match(/sfx\("winsure"\)/g) || []).length;
  if (winsureN < 2) throw new Error(`勝ち確の再生箇所が足りない(${winsureN}/2)`);
  if (!/@keyframes\s+wrBlink/.test(css)) throw new Error('点滅のCSSが無い');
});

check('当たった金額の左に WIN が付く（第116弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // 金額が「WIN +340T」の形になる(ラベルは常に「総獲得」)
  if (js.indexOf('<i class="winlbl">WIN</i>') < 0)
    throw new Error('金額の左に WIN が付かない');
  if (js.indexOf('lbl.textContent = "\\u7DCF\\u7372\\u5F97"') < 0)
    throw new Error('ラベルが「総獲得」で固定されていない');
  if (!/\.sl-dock-top \.amt \.winlbl/.test(css)) throw new Error('WIN のCSSが無い');
})

check('フリー中の当選がドックの総獲得欄に出る（第114弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // フリーの各ゲーム開始でドックを「抽選中…」に戻す
  if (!/slotSetWin\("", ""\);[^\n]*\n[^\n]*slotResetDock\(/.test(js))
    throw new Error('フリーの各ゲームでドックを戻していない');
  // 当選時はHUDの「今回」と同じカウントでドックの総獲得欄にも出す
  if (!/slotShowTotal\(v, 0, lastWins[,)]/.test(js))
    throw new Error('フリー中の当選がドックに出ない(総獲得欄が空のまま)');
  if (!/slotShowTotal\(now, 0, lastWins[,)]/.test(js))
    throw new Error('カウント後の確定値がドックに出ない');
});

// ---- バカラ(第117弾): タブを開いて1ハンド遊ぶ ----
{
  click(A, A.document.querySelector('[data-tab="baccarat"]'));
  await sleep(80);
  check('バカラのタブを開くと台が組み上がる（第117弾）', () => {
    if (!A.document.getElementById('bac-root')) throw new Error('台が組み立てられていない');
    if (!A.document.querySelector('.bac-chip')) throw new Error('チップが無い');
    if (!A.document.getElementById('bac-setbtn')) throw new Error('設定ボタンが無い');
    if (!A.document.getElementById('bac-roadbtn')) throw new Error('罫線ボタンが無い');
  });
  // 残高表示は省略表記(30.32M 等)なので、単位付きで概算値へ戻して比べる
  const bacParseAmt = (t) => {
    const m = String(t).trim().match(/^([+-]?[\d.,]+)\s*([KMGTP]|万|億|兆|京)?/);
    if (!m) return NaN;
    const mult = { K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, '万': 1e4, '億': 1e8, '兆': 1e12, '京': 1e16 }[m[2]] || 1;
    return parseFloat(m[1].replace(/,/g, '')) * mult;
  };
  const bacBalBeforeRaw = A.document.getElementById('bac-bal').textContent;
  const bacBalBefore = bacParseAmt(bacBalBeforeRaw);
  click(A, A.document.querySelector('.bac-spot[data-s="p"]'));
  await sleep(30);
  const bacBet = bacParseAmt(A.document.getElementById('bac-ap').textContent);
  click(A, A.document.getElementById('bac-deal'));
  let stageOn = false;
  for (let i = 0; i < 240; i++) {
    await sleep(50);
    const st = A.document.getElementById('bac-stage');
    if (st && st.classList.contains('on')) { stageOn = true; break; }
  }
  check('配札の後に絞りステージが開く（第117弾）', () => {
    if (!stageOn) throw new Error('絞りステージが開かない');
    if (!A.document.querySelector('#bac-cands .bac-cd')) throw new Error('候補(A〜K)が出ていない');
    // 0-9グリッドは第136弾で廃止(ミニカード表と重複)。ミニカード表が出ること
    if (A.document.getElementById('bac-grid10')) throw new Error('0-9グリッドが残っている');
    if (!A.document.querySelector('#bac-odds .bac-mini')) throw new Error('ミニカード表が出ていない');
  });
  click(A, A.document.getElementById('bac-skip'));
  let toastOn = false;
  for (let i = 0; i < 600; i++) {
    await sleep(50);
    if (A.document.getElementById('bac-toast').classList.contains('on')) { toastOn = true; break; }
  }
  check('絞りを終えると精算と大路が出る（第117弾）', () => {
    if (!toastOn) throw new Error('精算が表示されない');
    const th = A.document.getElementById('bac-th').textContent;
    if (!/(PLAYER|BANKER|TIE)\s+\d\s*-\s*\d/.test(th)) throw new Error('結果表示が壊れている: ' + th);
    if (!A.document.querySelector('#bac-road .bac-rc.P, #bac-road .bac-rc.B, #bac-road .bac-rc.T'))
      throw new Error('大路に記録されない');
  });
  let unlocked = false;
  for (let i = 0; i < 120; i++) {
    await sleep(50);
    if (!A.document.getElementById('bac-toast').classList.contains('on')) { unlocked = true; break; }
  }
  check('残高がベットと精算どおりに動く（第122弾・会計検査）', () => {
    const tsRaw = A.document.getElementById('bac-ts').textContent;
    const afterRaw = A.document.getElementById('bac-bal').textContent;
    const net = bacParseAmt(tsRaw);
    const after = bacParseAmt(afterRaw);
    if (!(bacBet > 0)) throw new Error('ベットが置かれていない: ' + bacBet);
    // 省略表記の丸め誤差(表示単位の1%)まで許容して、増減が精算どおりかを見る
    const tol = Math.max(1, (Math.abs(bacBalBefore) + Math.abs(net)) * 0.01);
    if (!(Math.abs(after - (bacBalBefore + net)) <= tol))
      throw new Error(`会計が合わない: before="${bacBalBeforeRaw}"(${bacBalBefore}) net="${tsRaw}"(${net}) after="${afterRaw}"(${after}) bet=${bacBet}`);
  });

  check('精算後に入力ロックと残高凍結が解ける（第117弾）', () => {
    if (!unlocked) throw new Error('精算トーストが消えない');
    const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
    // 配る瞬間に控除後の額でヘッダー残高を凍結(当選のネタバレ防止)
    if (!/slotBalFreeze = Math\.max\(0, balance - stake\);/.test(js)) throw new Error('配る瞬間の残高凍結が無い');
    // 精算を見せてから解除
    if (!/slotBalFreeze = null;\s*\n\s*renderBalance\(\);\s*\n\s*bacSetBal\(/.test(js)) throw new Error('精算での凍結解除が無い');
    // 宣言UIは廃止(第126弾)。プロトコル上は declare を常に未指定で送る
    if (!/t: "baccarat\.deal", bets: \{ p: bacBets\.p, b: bacBets\.b, tie: bacBets\.tie \}/.test(js))
      throw new Error('deal の送信形が壊れている');
    // 演出が落ちても立て直す守りがある
    if (!/bacOnResult\(msg\.result\)\.catch/.test(js)) throw new Error('演出失敗時の立て直しが無い');
  });
  click(A, A.document.querySelector('[data-tab="slot"]'));
  await sleep(50);
}

check('FREEリボン・リール窓ベゼル・筐体切替（第133弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // スキャッターはどのスキンでも FREE リボンで一目瞭然
  if (!/\.sl-cell\.sc::after\{content:"FREE"/.test(css)) throw new Error('FREEリボンが無い');
  // リール窓は金属ベゼルで筐体にはめ込む
  if (!/#slot \.sl-gridwrap\{border-radius:16px;padding:8px;/.test(css)) throw new Error('ベゼルが無い');
  // 筐体はCSS変数+2種の生成画像で切替
  if (!/var\(--sl-cab,/.test(css)) throw new Error('筐体が変数化されていない');
  if (!/SLOT_CABS = \{ red2: "data:image\/webp/.test(js)) throw new Error('筐体プールが無い');
  if (!/localStorage\.setItem\("slCab"/.test(js)) throw new Error('筐体選択の保存が無い');
  if (A.document.querySelectorAll('#sl-design .bac-sw[data-cb]').length !== 6) throw new Error('筐体スワッチが6つ無い');
  // 全役名の一覧バー(スキン名+scatterのFREEマーク)がリール窓の下に出る
  if (!A.document.querySelector('.sl-symlegend')) throw new Error('役名一覧バーが無い');
  if (A.document.querySelectorAll('.sl-symlegend span').length !== 9) throw new Error('役名が9個並んでいない');
  if (!A.document.querySelector('.sl-symlegend .free-mini')) throw new Error('一覧のFREEマークが無い');
  // 配当表のスキャッター行にもFREEバッジ
  if (!/free-mini">FREE<\/i><\/td>/.test(js)) throw new Error('配当表のFREEバッジが無い');
  // デザイン設定は⚙ボタンで開く畳みパネル(常時表示しない)
  if (!A.document.getElementById('sl-setbtn')) throw new Error('スロットの設定ボタンが無い');
  if (!/\.sl-setpanel\{display:none/.test(css)) throw new Error('スロット設定が常時表示になっている');
});

check('スキン4種+役名の追随（第132弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // 和風・宇宙のスキンが追加されている
  if (!/SLOT_SYM_SKINS\.wa = \{\s*chip: "data:image\//.test(js)) throw new Error('和風スキンが無い');
  if (!/SLOT_SYM_SKINS\.space = \{\s*chip: "data:image\//.test(js)) throw new Error('宇宙スキンが無い');
  // スキンごとの役名(配当は不変・名前だけ)
  if (!/SLOT_SYM_NAMES = \{/.test(js)) throw new Error('役名マップが無い');
  for (const nm of ['小判', '錦鯉', '黄金龍', '桜', '隕石', 'ブラックホール', '彗星', 'ジュエルセブン', 'BAR']) {
    if (js.indexOf(nm) < 0) throw new Error('役名「' + nm + '」が無い');
  }
  // 名前の参照経路: slotSymName と配当表とWILD/SCATTER行がスキン名を最優先
  if (!/const ov = slotSymSkinName\(key\);/.test(js)) throw new Error('slotSymNameが役名に追随していない');
  if (!/slotSymSkinName\(sym\.key\) \|\| sym\.name/.test(js)) throw new Error('配当表の名前が追随していない');
  if (!/slotSymSkinName\("wild"\)/.test(js)) throw new Error('WILD行の名前が追随していない');
  if (!/slotSymSkinName\("scatter"\)/.test(js)) throw new Error('SCATTER行の名前が追随していない');
  if (A.document.querySelectorAll('#sl-design .bac-sw[data-sy]').length !== 7) throw new Error('絵柄スワッチが7つ無い');
});

check('絵柄スキン(宝石/フルーツ)・配当キー不変（第131弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // 2セット×9キーが全部そろっている
  if (!/SLOT_SYM_SKINS = \{\s*gems: \{\s*chip: "data:image\/webp/.test(js)) throw new Error('宝石スキンが無い');
  if (!/fruits: \{\s*chip: "data:image\/webp/.test(js)) throw new Error('フルーツスキンが無い');
  for (const k of ['chip','club','diamond','heart','spade','crown','seven','wild','scatter']) {
    const n = (js.match(new RegExp(k + ': "data:image\\/', 'g')) || []).length;
    if (n < 5) throw new Error(k + ' の画像が5系統(元+4スキン)に無い: ' + n);
  }
  // 適用は SLOT_IMG の書き換え(描画側の参照は全部 SLOT_IMG[k] のまま=配当対応不変)
  if (!/SLOT_IMG_BASE = Object\.assign\(\{\}, SLOT_IMG\)/.test(js)) throw new Error('元絵柄の退避が無い');
  if (!/SLOT_IMG\[k\] = want/.test(js)) throw new Error('SLOT_IMGの差し替えが無い');
  if (!/localStorage\.setItem\("slSyms"/.test(js)) throw new Error('絵柄選択の保存が無い');
});

check('タブ崩れ対策・奥行き透過卓・スロットのデザイン選択（第130弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // タブはスマホで折り返さず横スクロール
  if (!/@media \(max-width:640px\)\{\s*\.tabs\{overflow-x:auto/.test(css)) throw new Error('タブ崩れ対策が無い');
  if (!/\.tab \{[^}]*white-space:nowrap/.test(css)) throw new Error('タブのnowrapが無い');
  // バカラ卓は透過切り抜き(奥行き)。contain+drop-shadowで浮かせる
  if (!/\.bac-table\{[^}]*center bottom\/contain no-repeat/.test(css)) throw new Error('卓が切り抜き表示でない');
  if (!/\.bac-table\{[^}]*drop-shadow/.test(css)) throw new Error('卓の落ち影が無い');
  // スロットの看板/リール選択
  if (!A.document.getElementById('sl-design')) throw new Error('スロットのデザイン行が無い');
  if (!/function slotMarqueeSrc/.test(js)) throw new Error('看板の切替が無い');
  if (!/var\(--sl-reel,/.test(css)) throw new Error('リール背景の変数が無い');
  if (!/localStorage\.setItem\("slReel"/.test(js)) throw new Error('リール選択の保存が無い');
});

check('宣言/スライダー廃止・P/B大TIE下・パネル化・解放条件・全札表示（第126弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // 読み宣言と縦スライダーは消えている
  if (A.document.getElementById('bac-dlow') || A.document.getElementById('bac-dhigh'))
    throw new Error('読み宣言が残っている');
  if (A.document.getElementById('bacv')) throw new Error('縦スライダーが残っている');
  // P/B が上段2列、TIE が下段ワイド
  if (!/\.bac-spots\{display:grid;grid-template-columns:1fr 1fr/.test(css)) throw new Error('P/Bが2列でない');
  if (!/\.bac-spot\.tie-wide\{grid-column:1\/3/.test(css)) throw new Error('TIEが下段ワイドでない');
  // 罫線とデザインはパネル(普段は非表示)
  if (!A.document.getElementById('bac-roadpanel')) throw new Error('罫線パネルが無い');
  if (!A.document.getElementById('bac-setpanel')) throw new Error('設定パネルが無い');
  if (!/\.bac-roadpanel,\.bac-setpanel\{display:none/.test(css)) throw new Error('パネルが常時表示になっている');
  // カスタマイズは残高100万で解放
  if (!/function bacCustomUnlocked/.test(js)) throw new Error('解放条件が無い');
  if (!/>= 1000000/.test(js)) throw new Error('解放しきい値が無い');
  // チップの皮膚切替(写真/フラット)
  if (!A.document.querySelector('.bac-sw[data-skin="flat"]')) throw new Error('チップ皮膚の切替が無い');
  // 引けば勝ちは全部の札(J/Q/Kまとめ廃止)
  if (/J\/Q\/K"\) < 0\) wl\.push/.test(js)) throw new Error('J/Q/Kがまとめられたまま');
  // 長押し自動オープンは廃止(ゆっくり絞る操作を邪魔しない・第136弾)
  if (/bacPressTimer/.test(js)) throw new Error('長押しオープンが残っている');
  // スマホ/PCのレスポンシブ
  if (!/@media \(max-width:480px\)\{\s*#bac-root/.test(css)) throw new Error('スマホ向け調整が無い');
  if (!/@media \(min-width:900px\)\{\s*#bac-root/.test(css)) throw new Error('PC向け調整が無い');
});

check('斜め(角)絞り: ボタン・対角クリップ・署名の一致（第141弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // 方向ボタンに斜めがある
  if (!A.document.querySelector('.bac-dir[data-d="d"]')) throw new Error('斜め絞りボタンが無い');
  // 第145弾: 斜めが一番左+既定(オーナーはだいたい斜めから絞る)
  const dirBtns = A.document.querySelectorAll('.bac-dir');
  if (dirBtns[0].dataset.d !== 'd') throw new Error('斜め絞りが一番左でない');
  if (!dirBtns[0].classList.contains('on')) throw new Error('斜め絞りが既定でない');
  if (!/var bacDir = "d";/.test(js)) throw new Error('既定方向が斜めでない');
  // 対角線のクリップ(ポリゴン)がある
  if (!/polygon\(0% 0%, 100% 0%, 100% 100%, /.test(js)) throw new Error('対角クリップが無い');
  // 署名も同じ対角線の式(見た目と一致=正直さの不変条件)
  if (!/\(BAC_COLS\[c\] \+ 1 - BAC_ROWS\[rw\]\) \/ 2 <= rev/.test(js)) throw new Error('斜め署名が無い');
  if (!/rev >= 0\.1635/.test(js)) throw new Error('絵札の斜め署名が無い');
  // 指の対角射影と行程(対角線長)
  if (!/Math\.hypot\(rc\.width, rc\.height\)/.test(js)) throw new Error('斜めの行程が無い');
  if (!/\(e\.clientX - e\.clientY\) \* 0\.7071/.test(js)) throw new Error('対角射影が無い');
});

check('ダブルダウンが実機の手順どおり（第168弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');

  // ①下に別の盤を作らず、通常のリール画面と同じ場所を入れ替える
  if (/\.tn-pick\{/.test(css)) throw new Error('別盤の縦長カードが残っている');
  if (!/\.tn-ddstage\{/.test(css)) throw new Error('入れ替え用の盤が無い');
  if (!/tnDD\s*\?\s*'<div class="tn-board">' \+ tnDDStageHtml\(\)/.test(js))
    throw new Error('リール画面を入れ替えていない');
  // リールは通常時と同じ横長のコマを使う(正方形に押し込まない)
  if (!/cell\("dd-dealer", "tn-dd-d"\)/.test(js)) throw new Error('ディーラーが tn-cell でない');

  // ②ディーラーが先に止まり、理解する間を置いてからプレイヤーが回り出す
  if (!/function tnDDDealt/.test(js)) throw new Error('ディーラー先行の処理が無い');
  if (!/setTimeout\(tnDDSpinPlayers, 340\)/.test(js)) throw new Error('ディーラー停止後の間が無い');
  if (!/t: "tunnel.double.deal"/.test(js)) throw new Error('配りの要求を送っていない');

  // ③ハーフもダブルも同じ手順を通る(どちらも3択へ行く)
  const half = js.match(/if \(h\) h\.onclick = function \(\) \{ ([^}]*) \};/);
  const full = js.match(/if \(f\) f\.onclick = function \(\) \{ ([^}]*) \};/);
  if (!half || !full) throw new Error('ハーフ/ダブルの配線が無い');
  if (!/tnDDBegin\(true\)/.test(half[1])) throw new Error('ハーフが3択を通っていない');
  if (!/tnDDBegin\(false\)/.test(full[1])) throw new Error('ダブルが3択を通っていない');

  // ④選んだあと、未選択2本を**遠い順**に先に止める
  if (!/function tnDDChoose/.test(js)) throw new Error('3択の受け付けが無い');
  if (!/Math\.abs\(b - idx\) - Math\.abs\(a - idx\)/.test(js))
    throw new Error('未選択リールを遠い順に止めていない');
  if (!/setTimeout\(function \(\) \{ stopOther\(0\); \}, 150\)/.test(js))
    throw new Error('1本目の停止が早すぎ/遅すぎ');

  // ⑤選んだ1本は4段階で減速し、最後は1コマぶんをゆっくり送る
  const plan = js.match(/\{ v: 1\.00, ms: 520 \}, \{ v: 0\.60, ms: 500 \},\s*\{ v: 0\.25, ms: 660 \}, \{ v: 0\.08, ms: 480/);
  if (!plan) throw new Error('4段階の減速が無い');
  // 未選択2本が同図柄なら、3つ揃いの期待があるぶん長く焦らす
  if (!/var same = r\.player\[others\[0\]\] === r\.player\[others\[1\]\]/.test(js))
    throw new Error('3つ揃いの焦らし延長が無い');

  // ⑥焦らしの中身: 勝ちは弱い図柄から滑り込み、負けは勝ち図柄を通過する
  if (!/function tnTeaser/.test(js)) throw new Error('焦らし図柄の選び方が無い');
  if (!/r\.result === "win" \? tnTeaser\(r\.dealer, "weak"\)/.test(js))
    throw new Error('勝ちの滑り込みが無い');
  if (!/tnTeaser\(r\.dealer, "strong"\)/.test(js)) throw new Error('負けの通過が無い');

  // ⑦演出中に盤を作り直さない(残高更新で回転が消えないこと)
  if (!/if \(tnDD && tnDD\.built\) \{ tnDDPaint\(\); return; \}/.test(js))
    throw new Error('演出中の再描画を止めていない');
});

check('2台目の音と賭け金は GOLD RUSH と同じ作り（第169弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');

  // ①回転音は GOLD RUSH と同じ録音のループ。合成音を鳴らし直さない
  if (!/function tnLoopOn\(\) \{\s*if \(tnLoop\) return;\s*try \{ reelSoundStart\(\);/.test(js))
    throw new Error('回転音が GOLD RUSH の録音ループでない');
  if (!/reelSoundStop\(\);/.test(js)) throw new Error('回転音を止めていない');
  if (/play\("reelSpin"\)/.test(js.slice(js.indexOf('function tnLoopOn'), js.indexOf('function tnLoopOn') + 600)))
    throw new Error('合成音が残っている');

  // ②BET音・START音も同じボタン音
  if (!/function tnSfxBet\(\) \{ try \{ sfx\("btn"\); \}/.test(js)) throw new Error('BET音が違う');
  if (!/function tnSfxStart\(\) \{ try \{ sfx\("btn"\); \}/.test(js)) throw new Error('START音が違う');
  // ボタン音が鳴り終わってから回る(GOLD RUSH と同じ間の取り方)
  if (!/SFX_SEC\.btn \? SFX_SEC\.btn : 0\.2\) \* 1000/.test(js))
    throw new Error('ボタン音を待たずに回している');

  // ③賭け金は「段を選ぶ」方式。半分/2倍で自由に動かさない
  if (/tnBet = Math\.max\(1000, Math\.floor\(tnBet \/ 2\)\)/.test(js))
    throw new Error('半分/2倍の操作が残っている');
  if (!/function tnBetList/.test(js)) throw new Error('段の一覧が無い');
  if (!/sv\.chipBets/.test(js)) throw new Error('サーバーの刻みを使っていない');
  if (!/\[data-tnbetstep\]/.test(js)) throw new Error('1段ずつの操作が無い');
  if (!/b\.dataset\.tnbetop === "max"/.test(js)) throw new Error('MAX が無い');
  if (!/\.tn-betlist\{/.test(css)) throw new Error('一覧の見た目が無い');

  // 賭け金を覚えておく(開き直しても段が戻らない)
  if (!/localStorage\.setItem\("tnBet"/.test(js)) throw new Error('賭け金を保存していない');
  if (!/localStorage\.getItem\("tnBet"\)/.test(js)) throw new Error('賭け金を読み戻していない');
});

check('押した瞬間に絵柄が消えない（第170弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');

  // ①スピンで盤を空にしない。以前は tnLast を捨てて9マスが真っ黒になっていた
  const spin = js.slice(js.indexOf('if (spin) spin.onclick'), js.indexOf('if (spin) spin.onclick') + 900);
  if (/tnLast = null/.test(spin)) throw new Error('押した瞬間に盤を捨てている');
  if (!/tnLast\.hitCells = \[\]/.test(spin)) throw new Error('前回の当たり表示を消していない');

  // ②いま出ている絵柄から動き出す(帯の末尾を現在の絵柄にする)
  if (!/var nowGrid = \(tnLast && tnLast\.grid\)/.test(js)) throw new Error('今の絵柄を引き継いでいない');
  if (!/syms\[N - 1\] = nowGrid\[i\]/.test(js)) throw new Error('帯の入口が今の絵柄になっていない');

  // ③ゆっくり動き出す(静止からいきなり最高速にしない)
  if (!/var SPIN_UP = 260/.test(js)) throw new Error('始動の立ち上がりが無い');
  if (!/Math\.pow\(t \/ SPIN_UP, 2\)/.test(js)) throw new Error('加速がなめらかでない');
  if (!/k \*= up;/.test(js)) throw new Error('加速が速度に効いていない');

  // ④中央がブランクなら上下はジョーカー。戻り演出がリールの並びと合う
  if (!/if \(i === 4 && finalGrid\[i\] === "blank"\) syms\[1\] = "joker"/.test(js))
    throw new Error('中央ブランクの隣がジョーカーになっていない');
});

check('9リールの形と挙動が実機寄り（第165弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // ①1マスは正方形でなく横長(約1.9:1)
  if (!/\.tn-cell\{[^}]*aspect-ratio:150\/78/.test(css))
    throw new Error('マスが横長になっていない(実機は約1.9:1)');
  // ②上下の覗きは出さない(第168弾で撤去)。
  //    小さい絵が散らかって、肝心の停止図柄が読みにくかった
  if (/\.tn-peek\{/.test(css)) throw new Error('上下の覗きが残っている');
  if (/function tnPeekSym/.test(js)) throw new Error('覗く絵柄の決め方が残っている');
  // ③横長の窓を絵柄で埋める(第168弾)。素材が正方形なので、縦を目一杯まで上げ、
  //    わずかに横へ引き伸ばして実機の「横長のリール絵」に見せる
  if (!/\.tn-cell img\{[^}]*height:94%/.test(css)) throw new Error('絵柄が小さいまま');
  if (!/\.tn-cell img\{[^}]*transform:scaleX\(1\.14\)/.test(css)) throw new Error('横に伸ばしていない');
  if (!/\.tn-cell\.s-joker img\{width:98%/.test(css)) throw new Error('ジョーカーが大きくない');
  // ④回転: ほぼ同時に始動し、左上→右下へ順次停止
  if (!/function tnSpinReels/.test(js)) throw new Error('回転処理が無い');
  // 最初の停止までの時間は、始動の立ち上がり(SPIN_UP)より十分あとにする。
  // ここが近いと、加速し終わる前に1本目が止まって「回った感じ」が出ない
  const first = js.match(/var FIRST = (\d+), GAP = (\d+);/);
  const spinUp = js.match(/var SPIN_UP = (\d+);/);
  if (!first || !spinUp) throw new Error('停止の間隔が実機寄りでない');
  if (Number(first[2]) !== 85) throw new Error('1本ずつの停止間隔が変わっている');
  if (Number(first[1]) < Number(spinUp[1]) * 3)
    throw new Error('加速し終わる前に止まり始めている');
  if (!/var stopAt = FIRST \+ i \* GAP/.test(js)) throw new Error('順番に止めていない');
  // 停止直前だけ短く減速(長く滑らせない)
  if (!/left < 160 \? 0\.35/.test(js)) throw new Error('停止前の減速が無い');
  // ④-2 リールは実機と同じく**上から下へ**流れる(第168弾で向きを直した)
  if (!/var syms = \[finalGrid\[i\]\];/.test(js)) throw new Error('止める絵柄が帯の先頭に無い');
  if (!/translateY\(" \+ \(st\.pos - \(st\.n - 1\) \* H\) \+ "px\)/.test(js))
    throw new Error('リールが下向きに流れていない');
  // ⑤音: BET/START/回転ループ/停止
  for (const fn of ['tnSfxBet', 'tnSfxStart', 'tnSfxStop', 'tnLoopOn', 'tnLoopOff']) {
    if (!new RegExp('function ' + fn).test(js)) throw new Error(fn + ' が無い');
  }
  if (!/tnLoopOff\(\);/.test(js)) throw new Error('回転音を止めていない');
  // ⑥結果は回し終えてから見せる(いきなり出さない)
  if (!/if \(!tnSpun\) \{/.test(js)) throw new Error('回してから結果を見せていない');
  // 戻り演出があるときは「一度外した盤面」で止める
  if (!/if \(o\.reverse && o\.reverse\.hit\) land\[4\] = "blank";/.test(js))
    throw new Error('戻り演出の着地が仕込まれていない');
});

check('2台目の書体設計: 役割で4種を使い分ける（第164弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // ①ビットマップフォントを埋め込んでいる(オフラインでも出る)
  if (!/@font-face\{font-family:"PxArcade"[\s\S]{0,200}data:font\/woff2;base64,/.test(css))
    throw new Error('ビットマップフォントが埋め込まれていない');
  if (!/Open Font License/.test(css)) throw new Error('フォントのライセンス表記が無い');
  // ②情報は色で種類を分ける(WAGER=シアン / WIN=黄 / PAID=黄緑 / CREDITS=シアン)
  for (const [k, c] of [['wager', '#5fe3ff'], ['win', '#ffd23f'], ['paid', '#9bea4a']]) {
    if (!new RegExp('\\.tn-stats \\.k\\.' + k + '\\{color:' + c).test(css))
      throw new Error(k + ' の色分けが無い');
  }
  if (!/\.tn-credits \.k\{[^}]*color:#5fe3ff/.test(css)) throw new Error('CREDITSの色が違う');
  // ③説明文は1行。倍率を巨大表示しない
  if (!/"TUNNEL " \+ o\.tunnel \+ "x WINNING COMBINATION"/.test(js))
    throw new Error('説明文が実機の言い回しでない');
  if (!/\.tn-cap\{[^}]*font-size:8\.5px/.test(css)) throw new Error('説明文が小さく組まれていない');
  // ④WINNER! は看板(画像)。当選のときだけ出す
  if (!/\.tn-winner\{/.test(css)) throw new Error('WINNERの看板が無い');
  if (!/winner: total > 0/.test(js)) throw new Error('当選時だけ出す条件が無い');
  // BETプレートは5色、ラインの色に対応
  for (const n of [1, 2, 3, 4, 5]) {
    if (!new RegExp('\\.tn-p' + n + '\\{background:#').test(css)) throw new Error('BETプレート' + n + 'が無い');
  }
  // WILD(緑) と TUNNEL(青) を色で区別
  if (!/\.tn-tag\.wild\{color:#b6ff3a/.test(css)) throw new Error('WILDラベルが緑でない');
  if (!/\.tn-tag\.tunnel\{color:#5fe3ff/.test(css)) throw new Error('TUNNELラベルが青でない');
  if (!/i === 4 \? "tunnel" : "wild"/.test(js)) throw new Error('中央だけTUNNELにしていない');
  // CRTの走査線(動きを減らす設定では消す)
  if (!/\.tn-cab::after\{[^}]*repeating-linear-gradient/.test(css)) throw new Error('走査線が無い');
  if (!/prefers-reduced-motion: reduce\)\{ \.tn-cab::after\{display:none\} \}/.test(css))
    throw new Error('走査線を切る配慮が無い');
});

check('トンネル倍率は1台目の抽選演出を流用している（第163弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // 2台目から 1台目の突入演出を呼んでいる(演出を二重に作っていない)
  if (!/function tnTunnelDraw/.test(js)) throw new Error('トンネル抽選のラッパが無い');
  if (!/slotFsIntro\("WINNING TUNNEL", 5, o\.tunnel, 3, \{/.test(js))
    throw new Error('1台目の演出を呼んでいない');
  // 戻り当たり・直停止のどちらからも同じ抽選を通る
  const calls = (js.match(/tnTunnelDraw\(o, finish\)/g) || []).length;
  if (calls < 2) throw new Error(`トンネル抽選への導線が足りない: ${calls}`);
  // 台ごとに文言を差し替えられる(1台目の既定は壊していない)
  if (!/const CAP = O\.capText \|\| "/.test(js)) throw new Error('文言の差し替えが無い');
  if (!/const startSpins = O\.spins \|\| \(scatters >= 5/.test(js))
    throw new Error('回数の差し替えが無い');
  // 2台目ではスキャッター点滅とアップグレードを出さない(1台目の盤面の話なので)
  if (!/noUpgrade: true/.test(js) || !/noScatterFlash: true/.test(js))
    throw new Error('2台目で1台目固有の演出を止めていない');
  if (!/if \(!O\.noScatterFlash\) slotFlashScatters\(true\)/.test(js))
    throw new Error('点滅の抑止が効いていない');
  // 倍率はサーバーの値をそのまま渡す(演出側で決めない)
  if (/tnTunnelDraw[^}]*Math\.random/.test(js)) throw new Error('演出側で倍率を決めている');
});

check('ジョーカー戻り: ガセ込み・結果は先に決まっている（第162弾）', async () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // サーバーが見せ方まで決めている(クライアントが抽選し直さない)
  const { bszSpin, BSZ_REVERSE } = await import('../dist/src/server/bsz.js');
  if (!(BSZ_REVERSE.hitRate > 0 && BSZ_REVERSE.hitRate < 1)) throw new Error('戻り当たりの割合が不正');
  if (!(BSZ_REVERSE.gaseRate > 0)) throw new Error('戻りガセが無い(逆回転=確定になってしまう)');
  let rev = 0, hit = 0;
  for (let i = 0; i < 40000; i++) {
    const o = bszSpin();
    if (!o.reverse) continue;
    rev++;
    if (o.reverse.hit) { hit++; if (!o.freeEntered) throw new Error('演出と結果が食い違う'); }
    else if (o.freeEntered) throw new Error('ガセなのにフリーに入っている');
  }
  if (!rev) throw new Error('逆回転が出ない');
  const p = hit / rev;
  if (p > 0.6) throw new Error(`逆回転がほぼ確定になっている: ${(p * 100).toFixed(0)}%`);
  // クライアントは結果を見て演出を選ぶだけ(Math.random で当落を決めていない)
  if (!/function tnReverse\(hit, centerSym, done\)/.test(js)) throw new Error('戻り演出が無い');
  if (/tnReverse\([^)]*Math\.random/.test(js)) throw new Error('演出側で抽選している');
  if (!/o\.reverse\.hit/.test(js)) throw new Error('サーバーの指示を見ていない');
  // 先に当たりを告知しない(戻る前に freeText を出さない)
  if (!/shown\[4\] = "blank";/.test(js)) throw new Error('当たりでも一度外して見せていない');
  // 無音の間
  if (!/\}, 700\);/.test(js)) throw new Error('0.7秒の間が無い');
  // 逆回転のCSSと、当たり時だけのバウンド/ロック
  for (const cls of ['tn-revstrip', 'tn-cell\\.revhit', 'tn-cell\\.revlock']) {
    if (!new RegExp('\\.' + cls).test(css)) throw new Error(cls + ' が無い');
  }
});

check('2台目 WINNING TUNNEL と台えらび（第161弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // 台えらびのバーと、2台ぶんのボタン
  if (!A.document.getElementById('mc-bar')) throw new Error('台えらびのバーが無い');
  if (!/MACHINES = \[/.test(js)) throw new Error('台の一覧が無い');
  const machines = (js.match(/\{ k: "(gold|tunnel)"/g) || []).length;
  if (machines !== 2) throw new Error(`台が2つ登録されていない: ${machines}`);
  // 2台目の置き場と盤面のCSS
  if (!A.document.getElementById('tunnel')) throw new Error('2台目の置き場が無い');
  if (!/\.tn-grid\{display:grid;grid-template-columns:repeat\(3,1fr\)/.test(css))
    throw new Error('3×3の盤面が無い');
  // 絵柄10種が入っている
  for (const k of ['joker', 'cherry', 'orange', 'plum', 'melon', 'bell', 'eight', 'bar', 'red7', 'blue7']) {
    if (!new RegExp(k + ': "data:image\\/webp').test(js)) throw new Error('絵柄 ' + k + ' が無い');
  }
  // 台を選ぶと切り替わる
  A.sandbox.window.__mcBuild ? A.sandbox.window.__mcBuild() : null;
  if (!/localStorage\.setItem\("slotMachine"/.test(js)) throw new Error('台の選択が保存されない');
  // 賭け金と持ち越しはサーバーが握る(クライアントが額を送っていない)
  if (/t: "tunnel\.double"[^}]*payX/.test(js)) throw new Error('ダブルの額をクライアントが送っている');
  if (!/send\(\{ t: "tunnel\.spin", bet: tnBet \}\)/.test(js)) throw new Error('スピンの送信が無い');
  // ダブル・確定の導線
  for (const id of ['tn-collect', 'tn-half', 'tn-full']) {
    if (!new RegExp('id="' + id + '"').test(js)) throw new Error(id + ' が無い');
  }
});

check('止めるまで回り続けるオートがある・フリー中は紫を出さない（第159弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // 回数の選択肢に無限がある
  if (!/\[10, 25, 50, 100, Infinity\]/.test(js)) throw new Error('無限の選択肢が無い');
  // 表示は ∞(Infinity と出さない)
  if (!/slotAuto\.left === Infinity \? "\\u221E"/.test(js)) throw new Error('∞表示が無い');
  if (/"AUTO " \+ slotAuto\.left/.test(js)) throw new Error('Infinity がそのまま表示される箇所が残っている');
  // 無限は残り回数を減らさない(減らすと -1 になって止まる)
  if (!/if \(slotAuto\.left !== Infinity\) slotAuto\.left--/.test(js)) throw new Error('無限で回数が減る');
  // 無限を選んだらフリーゲームで止まらない
  if (!/slotAuto\.stopOnFree = count !== Infinity &&/.test(js)) throw new Error('無限でもフリーで止まってしまう');
  // フリーゲーム中はWILDの紫枠とリボンを出さない
  if (!/body\.fs-play #slot \.sl-cell\.wd::after\{display:none\}/.test(css))
    throw new Error('フリー中にWILDリボンが出たままになる');
  if (!/body\.fs-play #slot \.sl-cell\.wd\{box-shadow:none\}/.test(css))
    throw new Error('フリー中に紫枠が出たままになる');
});

check('卓の生地を自分で選べる（第155弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // 第160弾: 無地のマクロ生地は拡大でぼやけるのでやめ、
  // 大柄の同色ダマスク(参考画像と同系統)を高解像度で9種入れた(計13種)
  const KEYS = ['crimson', 'wine', 'emerald', 'teal', 'royal', 'indigo',
                'purple', 'noir', 'bronze',
                'green', 'navy', 'jade', 'suede'];
  // 生地の画像(横・縦)とCSSが6種そろっている
  for (const k of KEYS) {
    if (!new RegExp('--felt-' + k + ':url\\("data:image').test(css)) throw new Error('生地 ' + k + '(横)が無い');
    if (!new RegExp('--felt-' + k + '-p:url\\("data:image').test(css)) throw new Error('生地 ' + k + '(縦)が無い');
    if (!new RegExp('body\\[data-felt="' + k + '"\\] \\.felt-surface').test(css)) throw new Error('生地 ' + k + 'のCSSが無い');
  }
  // 選択UIがあり、自動+6種のボタンが並ぶ
  if (!A.document.getElementById('felt-panel')) throw new Error('生地パネルが無い');
  if (!/function feltBuild/.test(js) || !/function feltApply/.test(js)) throw new Error('生地の適用処理が無い');
  if (!/localStorage\.setItem\("feltPick"/.test(js)) throw new Error('選択が保存されない');
  // 「自動」は卓の格に従う(選んだときだけ上書き)
  if (!/document\.body\.dataset\.felt = ok && pick !== "auto" \? pick : feltAuto/.test(js))
    throw new Error('自動と手動の切り分けが無い');
  // 一覧と実体の数が合っている(片方だけ足して見本が出ない事故を防ぐ)。
  // 数えるのは FELTS の中だけ。他にも { k: "..." } を使う配列があるので範囲を切る
  const feltsBlock = js.slice(js.indexOf('var FELTS = ['));
  const listed = (feltsBlock.slice(0, feltsBlock.indexOf('];')).match(/\{ k: "/g) || []).length;
  if (listed !== KEYS.length) throw new Error(`一覧が${listed}種、実体が${KEYS.length}種で食い違う`);
  // 拡大でぼやけた無地のマクロ生地は残っていない
  for (const gone of ['champagne', 'flannel', 'cognac', 'scarlet', 'midnight']) {
    if (new RegExp('--felt-' + gone + ':').test(css)) throw new Error('ぼやける生地が残っている: ' + gone);
  }
  // 卓面は拡大されるので、横向きは 900px 以上の素材を使う
  const wide = css.match(/--felt-crimson:url\("data:image\/webp;base64,([A-Za-z0-9+/=]+)"/);
  if (!wide || wide[1].length < 40000) throw new Error('生地の解像度が足りない(拡大で粗くなる)');

  // --- 第158弾: 本当に「選べて切り替わる」か。見た目のCSSがあるだけでは足りない ---
  // 開くボタンが無いと、サイドの奥に埋もれて誰も辿り着けない
  if (!A.document.getElementById('fab-felt')) throw new Error('生地パネルを開くボタンが無い');
  if (!/openSide\('felt-panel'\)/.test(js)) throw new Error('ボタンがパネルに繋がっていない');
  // 見本ボタンが「自動+全種」ぶん組み上がる
  A.sandbox.window.__feltBuild();
  const sw = [...A.document.querySelectorAll('#felt-pick .felt-sw')];
  if (sw.length !== KEYS.length + 1) throw new Error(`見本が ${sw.length} 個(自動+${KEYS.length}のはず)`);
  // 実際に押すと卓面が切り替わり、保存される
  // 生地の種類は入れ替わるので、キーを直書きせず一覧の先頭を押す
  const target = sw.find((b) => b.dataset.f && b.dataset.f !== 'auto');
  if (!target) throw new Error('見本ボタンが見つからない');
  const pick = target.dataset.f;
  target.click();
  if (A.document.body.dataset.felt !== pick)
    throw new Error(`押しても切り替わらない: ${A.document.body.dataset.felt}`);
  if (A.sandbox.localStorage.getItem('feltPick') !== pick) throw new Error('選択が保存されない');
  // 「自動」に戻すと卓の格に従う値へ戻る
  sw.find((b) => b.dataset.f === 'auto').click();
  if (A.document.body.dataset.felt === pick) throw new Error('自動に戻せない');
});

check('秘密卓は卓面(フェルト)まで専用になっている（第154弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // 卓IDで卓面を選ぶ(BB帯だと 2.5兆以上が全部 arena の青になってしまう)
  if (!/SECRET_FELT = \{ "abyss-6": "7", "cosmos-6": "8", "zenith-6": "9" \}/.test(js))
    throw new Error('卓IDごとの卓面割り当てが無い');
  if (!/SECRET_FELT\[state\.tableId\]/.test(js)) throw new Error('卓面が卓IDを見ていない');
  // 卓面の画像(横・縦)とCSSが3種そろっている
  for (const n of ['7', '8', '9']) {
    if (!new RegExp('--felt-t' + n + ':url\\("data:image').test(css)) throw new Error('卓面' + n + '(横)が無い');
    if (!new RegExp('--felt-t' + n + '-p:url\\("data:image').test(css)) throw new Error('卓面' + n + '(縦)が無い');
    if (!new RegExp('body\\[data-felt="' + n + '"\\] \\.felt-surface').test(css)) throw new Error('卓面' + n + 'のCSSが無い');
  }
  // 青(arena)を共有していない
  if (/body\[data-felt="7"\][^{]*\{[^}]*--felt-arena/.test(css)) throw new Error('まだarenaの青を使っている');
});

check('ハイローラー卓に専用の背景と紋章がある（第153弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // 高額7卓それぞれに背景と紋章(=2枚)が入っている
  for (const id of ['hr-6', 'whale-6', 'legend-6', 'mil-6', 'bil-6', 'titan-6', 'gods-9']) {
    const n = (js.match(new RegExp('"' + id + '": "data:image', 'g')) || []).length;
    if (n < 2) throw new Error('卓 ' + id + ' の背景と紋章がそろっていない: ' + n);
  }
  // 卓の画像が使い回しになっていない(全卓ぶん違う画像であること)
  const arts = new Set();
  for (const id of ['hr-6', 'whale-6', 'legend-6', 'mil-6', 'bil-6', 'titan-6', 'gods-9']) {
    const m = js.match(new RegExp('"' + id + '": "(data:image[^"]{200,300})'));
    if (m) arts.add(m[1]);
  }
  if (arts.size !== 7) throw new Error('卓の画像が使い回されている: ' + arts.size + '/7');
});

check('秘密卓: 存在の秘匿と解禁演出（第150弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // 3つの秘密卓と紋章
  for (const id of ['abyss-6', 'cosmos-6', 'zenith-6']) {
    if (!new RegExp('"' + id + '": \\{ seal: "data:image\\/webp').test(js))
      throw new Error('秘密卓 ' + id + ' の紋章が無い');
  }
  // 卓カードの背景と紋章がある(第151弾: 無いと真っ黒なカードになる)
  for (const id of ['abyss-6', 'cosmos-6', 'zenith-6']) {
    if (!new RegExp('"' + id + '": "data:image\\/webp[^"]{500,}"').test(js))
      throw new Error('卓 ' + id + ' の画像が足りない(背景/紋章)');
    // TABLE_BG(カード背景)と TABLE_ART(カードの紋章)の2つ。封印紋章は上で別に見ている
    const n = (js.match(new RegExp('"' + id + '": "data:image', 'g')) || []).length;
    if (n < 2) throw new Error('卓 ' + id + ' の背景と紋章がそろっていない: ' + n);
  }
  // 一度だけ出す(localStorageに記録)
  if (!/function secretRevealCheck/.test(js)) throw new Error('解禁チェックが無い');
  if (!/localStorage\.setItem\("secretSeen"/.test(js)) throw new Error('既読記録が無い');
  if (!/function secretReveal\(/.test(js)) throw new Error('解禁演出が無い');
  // 封印が割れる演出
  if (!/@keyframes secCrack/.test(css)) throw new Error('封印が割れる演出が無い');
  if (!/\.tcard\.secret/.test(css)) throw new Error('秘密卓カードの飾りが無い');
  // クライアントは卓を隠さない(隠すのはサーバー)。届いた卓は素直に描く
  if (/SECRET_TABLES\[[^\]]*\][^\n]*hidden/.test(js)) throw new Error('クライアント側で隠している');
});

check('絵柄スキン海洋/エジプト・固定リール前面化・クラシックのリボン抑止（第149弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  for (const sk of ['ocean', 'egypt']) {
    if (!new RegExp('SLOT_SYM_SKINS\\.' + sk + ' = \\{').test(js)) throw new Error('スキン ' + sk + ' が無い');
    if (!A.document.querySelector('#sl-design .bac-sw[data-sy="' + sk + '"]')) throw new Error(sk + ' のスワッチが無い');
  }
  if (!/クラーケン/.test(js) || !/スフィンクス/.test(js)) throw new Error('新スキンの役名が無い');
  // 固定リールは筒の暗転(z4)より前面(上段のWILDが欠けない)
  if (!/\.sl-reel\.locked \{[^}]*z-index:5/.test(css)) throw new Error('固定リールが前面でない');
  // クラシックのWILDは画像にWILDと書いてあるのでリボンを出さない
  if (!/body\.syms-classic #slot \.sl-cell\.wd::after\{display:none\}/.test(css)) throw new Error('クラシックのリボン抑止が無い');
  if (!/syms-classic", sk === "classic"/.test(js)) throw new Error('syms-classicクラスの付与が無い');
});

check('リール盤面+4種・WILD常設リボン・回転帯のスキン追随（第143弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // リール盤面が classic+6種
  for (const k of ['gold', 'red', 'ice', 'noir', 'purple', 'green']) {
    if (!new RegExp(k + ': "data:image\\/webp[^"]*", ').test(js) && !new RegExp(k + ': "data:image\\/webp').test(js))
      throw new Error('リール盤面 ' + k + ' が無い');
  }
  if (A.document.querySelectorAll('#sl-design .bac-sw[data-rl]').length !== 7) throw new Error('リールスワッチが7つ(元+6種)無い');
  // WILDリボン(グリッド常設CSS・一覧・配当表)
  if (!/\.sl-cell\.wd::after\{content:"WILD"/.test(css)) throw new Error('WILDリボンCSSが無い');
  if (!/Copperplate/.test(css)) throw new Error('豪華フォント指定が無い');
  if (!A.document.querySelector('.sl-symlegend .wild-mini')) throw new Error('一覧のWILDバッジが無い');
  if (!/wild-mini">WILD<\/i><\/td>/.test(js)) throw new Error('配当表のWILDバッジが無い');
  // 回転中の帯もスキン追随(canvasで組み立て、無い環境は従来帯)
  if (!/function slotStripBuild/.test(js)) throw new Error('帯の組み立てが無い');
  if (!/const bandSrc = slotStripSrc\(\);/.test(js)) throw new Error('帯が差し替わっていない');
  if (!/strokeText\("WILD"/.test(js)) throw new Error('帯のWILD字が無い');
});

check('絞りボタンが候補数字に隠れず押せる（第142弾）', () => {
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // stagemid(position:relative)より前面に。背景も敷いて数字が透けない
  if (!/\.bac-stagebot\{[^}]*z-index:6/.test(css)) throw new Error('ボタン列が前面でない');
  if (!/\.bac-dirrow\{[^}]*flex-wrap:wrap/.test(css)) throw new Error('ボタン列が折り返せない');
});

check('チップ8色・飛んで積む・勝てる札・焦らし配布・自動ローテ・二段絞り（第125弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // チップ8段(2色追加)と飛ぶ演出
  if (!/mults = \[1, 5, 25, 100, 500, 2500, 10000, 50000\]/.test(js)) throw new Error('ラダーが8段でない');
  if (!/function bacFlyChip/.test(js)) throw new Error('チップが飛ぶ演出が無い');
  // 山はスポット中央に大きく(ポーカー式)
  if (!/\.bac-pile\{position:absolute;left:50%/.test(css)) throw new Error('山が中央に無い');
  // 引けば勝つ札の表示
  // 勝ち/分け/負けの全通りをミニカード(実カードの見た目)で表示(第128弾)
  if (!/function bacMiniCard/.test(js)) throw new Error('ミニカードが無い');
  for (const oc of ['win', 'push', 'lose']) {
    if (!new RegExp('rows\\.' + oc + '\\.length\\) wcards').test(js)) throw new Error(oc + ' の行が無い');
  }
  // 絞り中は「いまの筋」(P vs B の現況)を出す
  if (!A.document.getElementById('bac-sqstate')) throw new Error('筋ボードが無い');
  if (!/pVis = slot\.s === "p" \? sumVis/.test(js)) throw new Error('見えている合計の計算が無い');
  // 勝率バーは「絞っている人」目線(勝ち/分け/負け)
  if (!/あなた: <b>勝ち /.test(js)) throw new Error('あなた目線の勝率が無い');
  // 配布の焦らし(1枚 380ms)
  if (!/await bacSleep\(380\)/.test(js)) throw new Error('配布が焦らされていない');
  // 卓・背景の自動ローテ(1時間ごと)
  if (!/hourIdx % tKeys\.length/.test(js)) throw new Error('自動ローテが無い');
  if (A.document.querySelectorAll('.bac-sw[data-room]').length !== 8) throw new Error('背景スワッチが8つ無い');
  if (A.document.querySelectorAll('.bac-sw[data-tbl]').length !== 7) throw new Error('卓スワッチが7つ(自動+6色)無い');
  // 絞り: 重い紙(0.55倍)+二段階(持ち替え)
  if (!/size\) \* 0\.45/.test(js)) throw new Error('絞りが重くなっていない');
  if (!/next = Math\.min\(next, 0\.52\)/.test(js)) throw new Error('前半キャップが無い');
  // 後半の解禁は「奥まで(幅の9割)スライド」のみ
  if (!/stroke >= Math\.max\(40, size\) \* 0\.9/.test(js)) throw new Error('奥までスライド解禁が無い');
  if (!/bacSqStage = 2;/.test(js)) throw new Error('持ち替え解禁が無い');
});

check('スポットにチップが積み上がる・生成チップ画像・残り連動MAX・カジノ背景（第123弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // 生成したチップ画像(6色)
  if (!/BAC_CHIP_IMGS = \["data:image\/webp/.test(js)) throw new Error('チップ画像が無い');
  // スポットの上にチップの山
  for (const id of ['bac-pile-p', 'bac-pile-b', 'bac-pile-tie']) {
    if (!A.document.getElementById(id)) throw new Error(id + ' が無い');
  }
  if (!/bacStack\[k\]\.push\(discs\[di\]\)/.test(js)) throw new Error('置いたチップが山に積まれない');
  if (!/function bacRenderStacks/.test(js)) throw new Error('山の描画が無い');
  // スライダーの最大値は「残高 - ベット済み」に自動追随
  if (!/function bacRemaining/.test(js)) throw new Error('残り計算が無い');
  if (!/bacRemaining\(\)/.test(js)) throw new Error('残り計算が使われていない');
  // ディーラーの背景は生成カジノ内観(第124弾で5種の切替式)
  if (!/#bac-root\{[^}]*var\(--bac-room\)/.test(css)) throw new Error('カジノ内観の背景が無い');
  if (!/BAC_ROOMS = \{ floor: "data:image\/webp/.test(js)) throw new Error('背景プールが無い');
  if (!/localStorage\.setItem\("bacRoom"/.test(js)) throw new Error('背景の保存が無い');
  if (!A.document.querySelector('.bac-sw[data-room]')) throw new Error('背景スワッチが無い');
});

check('縦スライダー・チップ連打積み・絵札の絞り（第122弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // (第126弾: 縦スライダーは廃止。チップ8段で足りるため)
  // (第123弾で積み上がりはスポット側へ移動。バーは fill+ピルのみ)
  // 絵札は絞り中も絵柄がめくれ、内枠が見えた瞬間に候補が割れる(bacSig)
  if (!/return vis \? "COURT" : "";/.test(js)) throw new Error('絵札のbacSigが無い');
  if (/BAC_FACE_CELLS : BAC_CELLS\[rank\]/.test(js)) throw new Error('絞り中の絵札が四隅ピップのまま');
  // ラダーは6段(残高比例)
  if (!/mults = \[1, 5, 25,[^\]]+\]/.test(js)) throw new Error('ラダーが無い');
});

check('祝勝・オッズ・スライダー・デザイン切替・上限なし（第121弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // ピップさらに拡大(A105/数札56)
  if (!/rank === 1 \? 105 : 56/.test(js)) throw new Error('ピップが56になっていない');
  // 勝者点滅 → 拍手+ファンファーレ+勝ち額
  if (!/sideEl\.classList\.add\("winblink"\)/.test(js)) throw new Error('勝者側の点滅が無い');
  if (!/try \{ play\("applause"\); \} catch/.test(js)) throw new Error('拍手が無い');
  if (!/try \{ fanfarePlay\(\); \} catch/.test(js)) throw new Error('ファンファーレが無い');
  if (!/tw\.textContent = net > 0 \? "WIN \+"/.test(js)) throw new Error('勝ち額の表示が無い');
  // 絞り数字の加算演出
  if (!/function bacFloatAdd/.test(js)) throw new Error('加算演出が無い');
  // 有利/アウツ
  if (!/function bacUpdateOdds/.test(js)) throw new Error('オッズ計算が無い');
  if (!/勝ちのアウツ/.test(js)) throw new Error('アウツ表示が無い');
  // スライダー(対数)とデザイン切替
  if (A.document.getElementById('bacv')) throw new Error('縦スライダーが残っている(第126弾で廃止)');
  if (!/BAC_TBLS = \{ pgreen: "data:image\/webp/.test(js)) throw new Error('卓デザインが無い');
  // 第140弾: 透過再生成の6卓が揃っている
  for (const k of ['pgreen','pred','pnoir','pblue','ppurple','pteal']) {
    if (!new RegExp(k + ': "data:image\\/webp').test(js)) throw new Error('卓 ' + k + ' が無い');
    if (!new RegExp('data-tbl="' + k + '"').test(js)) throw new Error('卓スワッチ ' + k + ' が無い');
  }
  if (!/BAC_BKS = \{ classic: "data:image\/webp/.test(js)) throw new Error('カード裏デザインが無い');
  if (!/localStorage\.setItem\("bacTbl"/.test(js)) throw new Error('デザイン保存が無い');
  // 上限撤廃(残高だけが天井)
  if (/BAC_MAX_STAKE/.test(js)) throw new Error('上限が残っている');
});

check('ピップ拡大・ポーカーのディーラーと配布音を共用（第120弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // スートを大きく(A=88 / 数札=46)。位置は不変なので絞りの読みは壊れない
  if (!/rank === 1 \? \d+ : \d+/.test(js)) throw new Error('ピップサイズ指定が消えている');
  // ディーラーはポーカーと同じ人物プール(DEALERS/DEALERS_DEAL)から
  if (!/function bacPickDealer/.test(js)) throw new Error('人物選択が無い');
  if (!/DEALERS_DEAL\[bacDealerIdx\]/.test(js)) throw new Error('配りポーズの切替が無い');
  if (!A.document.getElementById('bac-dlr')) throw new Error('ディーラー要素が無い(タブを開けば生成されるはず)');
  // 配る音はポーカーの playCardDealSound
  if (!/playCardDealSound\(\{ pan: o\.s === "p" \? -0\.25 : 0\.25/.test(js)) throw new Error('配布音が共用されていない');
  // 写真の帯(旧 .bac-dealer)は廃止
  if (/class="bac-dealer"/.test(js)) throw new Error('旧ディーラー帯が残っている');
});

check('卓上のカードは大きな数字、絞り中は数字なし（第119弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // SVG化: スートは path、面は viewBox 250x350
  if (!/function bacBuildFace\(el, rank, suitIdx, showIndex\)/.test(js)) throw new Error('showIndex 引数が無い');
  if (!/viewBox="0 0 250 350"/.test(js)) throw new Error('カードがSVGになっていない');
  // 卓上(フリップ・リビール)は大きなインデックス付き
  if (!/bacBuildFace\(f2, arr2\[o2\.i\]\.r, arr2\[o2\.i\]\.s, true\)/.test(js)) throw new Error('フリップにインデックスが無い');
  if (!/bacBuildFace\(f3, card\.r, card\.s, true\)/.test(js)) throw new Error('リビールにインデックスが無い');
  // 絞りの大カードはインデックスなしで開始(数字は開き切るまで出さない)
  if (!/bacBuildFace\(document\.getElementById\("bac-bigface"\), card\.r, card\.s\);/.test(js))
    throw new Error('絞り中に数字が出る形になっている');
  // 開き切った瞬間にフェードインで数字を出す
  if (!/bacBuildFace\(bf, card2\.r, card2\.s, true\);/.test(js)) throw new Error('開いた瞬間の数字が無い');
  // 絵札はオーナー提供の生成画像(J/Q/K)
  if (!/BAC_COURT = \{ 11: "data:image\/webp/.test(js)) throw new Error('絵札画像が無い');
});

check('停止後のチカチカ解消・フリー中のWINバナー廃止（第112弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // 停止後の全再描画(renderSlot)は盤面を作り直して点滅する。締めは差分更新だけ
  if (!/function slotUnlockUI/.test(js)) throw new Error('slotUnlockUI が無い');
  if (!/slotSpinning = false;\s*\n\s*slotUnlockUI\(\);/.test(js))
    throw new Error('締めが差分更新になっていない(全再描画でチカつく)');
  // 締めブロックに renderSlot が残っていない
  const shime = js.slice(js.indexOf('// --- 締め ---'), js.indexOf('// --- オートスピンの続き ---'));
  if (/renderSlot\(\)/.test(shime)) throw new Error('締めに全再描画が残っている(チカチカの原因)');
  // 演出中は slot.info でも再描画しない
  if (!/case "slot\.info":[\s\S]{0,300}?if \(!slotSpinning\) renderSlot\(\)/.test(js))
    throw new Error('slot.info が演出中に全再描画している');
  // 第113弾: 当選のWINバナーは通常時も含めて出さない(リールに被る)。
  // 内訳はドックの行(+フリー中はHUD)が担当
  if (/slotSetWin\(slotWinLabel/.test(js))
    throw new Error('当選のWINバナーが復活している(リールに被る)');
  if (!/slotSetWin\("", ""\);[\s\S]{0,240}?slotSpinAnimStart\(\);/.test(js))
    throw new Error('フリーの各ゲームで前のバナーを消していない');
});

check('抽選音の鋭さ・ボタン音先行・フリーのテンポ・ドルルル（第108弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // 抽選音は0.28秒の芯だけ(長いと高速回転時に聞こえない)
  if (!/draw1: 0\.28, draw2: 0\.28, draw3: 0\.28, draw4: 0\.28/.test(js))
    throw new Error('抽選音が短くなっていない');
  // 第109弾: ボタン音が**鳴り終わってから**リールが回る(長さは SFX_SEC.btn から取る)
  if (!/sfx\("btn"\);\s*\n\s*setTimeout\(\(\) => \{[\s\S]{0,500}?slotSpinAnimStart\(\);[\s\S]{0,500}?\}, Math\.round\(\(SFX_SEC\.btn \|\| 1\) \* 1000\)\)/.test(js))
    throw new Error('ボタン音が鳴り終わる前にリールが回っている');
  // 第111弾: 小当たり音は**総獲得のカウント開始と同時**に鳴る
  if (!/function sfxWait/.test(js)) throw new Error('sfxWait が無い');
  if (!/sfx\("smallwin"\);\s*\n\s*await slotPayout\(r\.won, "sl-dock-amt"/.test(js))
    throw new Error('小当たり音がカウント開始と同時に鳴らない');
  // 第110弾: 鳴らした**後**に待ち、待ち終わってから解除(順序を検査)
  if (!/await sfxWait\("smallwin"\);\s*\n\s*slotSpinning = false;/.test(js))
    throw new Error('音の終わりを待ってから解除していない');
  const playIdx = js.indexOf('sfx("smallwin");');
  const waitIdx = js.indexOf('await sfxWait("smallwin");');
  if (playIdx < 0 || waitIdx < 0 || waitIdx < playIdx)
    throw new Error('音を鳴らす前に待っている(残り0で素通りする)');
  // フリー中の停止テンポ(回転820ms・着地320・間隔170)
  if (!/await slotSleep\(820\);\s*\n\s*await slotSpinAnimStop\(fsp\.grid0, \{ fast: true, land: 320, gap: 170 \}\)/.test(js))
    throw new Error('フリー中の停止テンポが調整されていない');
  // カウントアップは55ms刻みで音が鳴る(ドルルル)
  if (!/now - lastTick > 55/.test(js)) throw new Error('カウント音がドルルルになっていない');
  // フリー中の集計は1.6秒以上かける
  if (!/const dur = 1600 \+ Math\.round\(2600 \* bigness\)/.test(js))
    throw new Error('カウントアップの焦らしが強化されていない');
});

check('間の撤廃・ファンファーレ待ち・トナメHUD・ドアの位置（第107弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // 通常配当の1秒の間は撤廃(残っていたら復活事故)
  if (/if \(bigPay\) await slotSleep\(1000\)/.test(js)) throw new Error('1秒の間が残っている');
  // ファンファーレの鳴り終わりと残高反映を待ってから次のスピンへ
  if (!/function fanfareWait/.test(js)) throw new Error('fanfareWait が無い');
  if (!/await fanfareWait\(\);[\s\S]{0,300}slotSpinning = false;/.test(js))
    throw new Error('締めでファンファーレを待っていない(鳴っている途中で次が回せる)');
  // トナメHUD: カウントダウン・次ブラインド・入賞ボーダー・賞金表
  if (!/id="tour-next-in"/.test(js)) throw new Error('次のレベルのカウントダウンが無い');
  if (!/nextBigBlind/.test(js)) throw new Error('次のブラインド表示が無い');
  // 日本語はソース上 \uXXXX で書かれているため、IDとクラス名で確かめる
  if (!/tour-paylist/.test(js)) throw new Error('賞金表が無い');
  if (!/toMoney > 0/.test(js)) throw new Error('入賞ボーダーの表示が無い');
  if (!/function tourFmtMs/.test(js)) throw new Error('カウントダウンの時計が無い');
  // ドアのボタンが縦並び(ディーラー絵に被らない)
  if (!/#side-fabs \{[^}]*flex-direction:column/.test(css))
    throw new Error('卓上ボタンが横並びのまま(ドアがディーラーに被る)');
});

check('ベットの固定・下限開放・ボタン音・スピンの色（第106弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  // フリーゲーム中(演出中)はベットを触れない
  if (!/const betLocked = slotSpinning;/.test(js)) throw new Error('ベット固定の条件が無い');
  for (const t of ['data-betstep="-1"', 'data-betstep="1"', 'data-betop="max"', 'id="sl-betnow"']) {
    const m = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^>]{0,120}betLocked');
    if (!m.test(js)) throw new Error(`${t} が演出中に固定されていない`);
  }
  // ボタン音が入っていて、スピンとベット操作で鳴る
  if (!/btn: "[A-Za-z0-9+/]{80}/.test(js)) throw new Error('ボタン音が入っていない');
  if ((js.match(/sfx\("btn"\)/g) || []).length < 4)
    throw new Error('ボタン音の再生箇所が足りない(スピン+−/＋/MAX/一覧)');
  // スピンの色: 不足のときだけ暗い
  if (!/have < cost \? "short" : "idle"/.test(js)) throw new Error('スピンボタンが不足時だけ暗くなっていない');
  if (!/#slot \.spin-btn\.king\.short/.test(css)) throw new Error('不足時のCSSが無い');
  // リール音はループ用に拍で切ってあり、デコード後に無音を落とす
  if (!/function slotTrimSilence/.test(js)) throw new Error('ループ音の無音カットが無い');
  if (!/key === "reel"\) \? slotTrimSilence\(c, buf\)/.test(js))
    throw new Error('リール音に無音カットを通していない');
});

check('リール音・小あたり音・残高のネタバレ防止（第105弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  // 支給の2音が入っている
  for (const k of ['smallwin', 'reel']) {
    if (!new RegExp(k + ': "[A-Za-z0-9+/]{80}').test(js)) throw new Error(`効果音 ${k} が入っていない`);
  }
  // リール音は回り始めで鳴らし、止まったら消す(ループ)
  for (const fn of ['reelSoundStart', 'reelSoundStop']) {
    if (!new RegExp('function ' + fn).test(js)) throw new Error(`${fn} が無い`);
  }
  if (!/src\.loop = true;[\s\S]{0,120}reelSrc = src/.test(js)) throw new Error('リール音がループしていない');
  if (!/reelSoundStart\(\);/.test(js)) throw new Error('回り始めでリール音が鳴らない');
  if ((js.match(/reelSoundStop\(\);/g) || []).length < 2)
    throw new Error('リール音の停止経路が足りない(停止時+例外時)');
  // 祝福が出ない当たりには小あたり音(第111弾からカウント開始と同時。位置は111の検査が見る)
  if (!/sfx\("smallwin"\)/.test(js))
    throw new Error('NICE WIN未満の当たりで小あたり音が鳴らない');
  // 残高は**スピンを押した瞬間から**凍結する(balance通知が先に届くため)
  if (!/slotBalFreeze = Math\.max\(0, \(typeof balance === "number" \? balance : have\) - c\)/.test(js))
    throw new Error('スピン開始時に残高を凍結していない(勝ち額が先に見える)');
  if (!/balFrom = slotBalFreeze != null \? slotBalFreeze :/.test(js))
    throw new Error('凍結値を引き継いでいない(ベットを二重に引く)');
  // (第107弾で「間」は撤廃した。復活していないことは第107弾の検査が見る)
  // フリー中の集計はゆっくり(具体的な秒数は第108弾の検査が見る)
  if (!/const dur = \d+ \+ Math\.round\(\d+ \* bigness\)/.test(js))
    throw new Error('フリー中のカウントアップがゆっくりになっていない');
});

check('高額当選でファンファーレが鳴る（第100弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  if (!/FANFARE_B64 = "[A-Za-z0-9+\/]{100}/.test(js)) throw new Error('ファンファーレの音源が無い');
  for (const fn of ['fanfarePlay', 'fanfareEnsure', 'fanfareStop', 'fsBgmDuck']) {
    if (!new RegExp('function ' + fn).test(js)) throw new Error(`${fn} が無い`);
  }
  // 高額当選の演出が現れた瞬間に鳴らす(金額のカウントアップに重なる)
  if (!/el\.classList\.add\("show"\);[\s\S]{0,300}?fanfarePlay\(\);/.test(js))
    throw new Error('高額当選の演出でファンファーレが鳴らない');
  // 第101弾: フリーゲームは**リザルト画面で1回だけ**。締めの祝福では鳴らさない
  if (!/slotCelebrate\(payX, r\.won, r\.bet, \{ fanfare: !oc\.freeEntered \}\)/.test(js))
    throw new Error('フリーゲームで締めのファンファーレを止めていない(テンポが悪くなる)');
  if (!/opts\.fanfare !== false\) fanfarePlay\(\)/.test(js))
    throw new Error('ファンファーレの抑止が効いていない');
  const outro = /async function slotFsOutro[\s\S]{0,1800}?\n  \}/.exec(js);
  if (!outro || !/fanfarePlay\(\)/.test(outro[0]))
    throw new Error('フリーゲームのリザルトでファンファーレが鳴らない');
  // ループしない(BGMと違い1回きり)
  if (/src\.loop = true;[\s\S]{0,120}fanfareBuf/.test(js)) throw new Error('ファンファーレがループしている');
  // 鳴っている間はBGMを絞り、終わったら戻す
  if (!/fsBgmDuck\(true\)/.test(js) || !/fsBgmDuck\(false\)/.test(js))
    throw new Error('ファンファーレ中のBGMダッキングが無い');
  // 音スイッチ(amaster)を通ること
  if (!/src\.connect\(g\)\.connect\(amaster\)/.test(js))
    throw new Error('ファンファーレが音スイッチを通っていない');
});

check('フリーゲームの倍率はWILD配当だけ（持続倍率のUIが残っていない・第94弾）', () => {
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  if (/fsp\.multAfter/.test(js)) throw new Error('持続倍率の表示更新が残っている');
  if (/slfs-m">1<\/b>' \+ '/.test(js)) throw new Error('HUD中央が固定値になっていない');
  if (!/slfs-wlbl/.test(js)) throw new Error('HUD中央がWILD配当になっていない');
  if (/\\u6700\\u7D42\\u500D\\u7387/.test(js)) throw new Error('リザルトに最終倍率が残っている');
});

check('回数制限の表示と判定が撤廃されている', () => {
  // 第84弾: オーナー指示。「本日あと n 回」を出さず、回数でスピンを止めない
  const t = A.document.getElementById('slot').textContent;
  if (t.includes('本日あと')) throw new Error('回数表示が残っている');
  if (t.includes('本日は終了')) throw new Error('回数制限の文言が残っている');
});

check('配当表示でスピンボタンがズレない（配当ドックの高さが固定されている）', () => {
  // 第86弾: 結果エリアを「配当ドック」に置き換えた。当選しても高さが変わらないので
  // 下のBET欄とスピンボタンが動かない。告知はリールに重ねる(積まない)
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  const m = /\.sl-dock\s*\{[^}]*\}/.exec(css);
  if (!m) throw new Error('配当ドックのCSSが無い');
  const h = /height\s*:\s*(\d+)px/.exec(m[0]);
  if (!h) throw new Error('配当ドックの高さが固定されていない');
  if (Number(h[1]) < 56 || Number(h[1]) > 72) throw new Error(`配当ドックの高さが指定外(${h[1]}px)`);
  const js0 = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const dock = A.document.getElementById('sl-dock');
  if (!dock) throw new Error('配当ドックがDOMに無い');
  for (const id of ['sl-dock-amt', 'sl-dock-lines', 'sl-dock-line']) {
    if (!A.document.getElementById(id)) throw new Error(`${id} が無い`);
  }
  // 告知(FREE GAME等)はリール枠に重ねる。行として積むとボタンが動く
  const wrap = A.document.querySelector('.sl-gridwrap .slot-win');
  if (!wrap) throw new Error('告知がリール枠に重なっていない');
  if (!/\.sl-gridwrap\s+\.slot-win\s*\{[^}]*position\s*:\s*absolute/.test(css))
    throw new Error('告知が absolute で重ねられていない');
  // 長い当選文言(フリー中)が筐体の外にはみ出さないこと
  if (!/\.sl-gridwrap\s+\.slot-win\s*\{[^}]*text-overflow\s*:\s*ellipsis/.test(css))
    throw new Error('長い告知がはみ出す(省略が指定されていない)');
  // スピンボタンの高さが固定されていること(「回転中…」は1行なので、
  // 固定しないと 58⇔76px で揺れて下の所持金行が毎回動く)
  // 同じセレクタの規則が複数あるので、どれか1つで高さが固定されていればよい
  const sm = [...css.matchAll(/#slot \.spin-btn\.king\s*\{[^}]*\}/g)];
  if (!sm.length) throw new Error('スピンボタンのCSSが無い');
  if (!sm.some((m) => /min-height\s*:\s*\d+px/.test(m[0])))
    throw new Error('スピンボタンの高さが固定されていない');
  // 小当たり・ハズレでバナーを出さない(リール下段が隠れる)
  // 第112弾で slotSetWin(bigEnough ? ...) の形に変わった(全再描画をやめたため)
  if (!/const bigEnough = /.test(js0) || !/slotSetWin\(bigEnough \?/.test(js0))
    throw new Error('バナーが見せ場に絞られていない');
  // 第87弾: 配当まわりが筐体と同じ「金と黒漆」であること(寒色に戻す事故の防止)
  const dockCss = /\.sl-dock\s*\{[^}]*\}/.exec(css);
  if (!dockCss) throw new Error('配当ドックのCSSが読めない');
  if (/#9fb0c2|#cfe0f2|206,214,224/.test(css.slice(css.indexOf('配当ドックを筐体'))))
    throw new Error('配当まわりに寒色(プラチナ)が残っている');
  if (!/217,180,95/.test(dockCss[0])) throw new Error('ドックの縁が金でない');
  const amtCss = /\.sl-dock-top \.amt\s*\{[^}]*\}/.exec(css);
  if (!amtCss || !/background-clip\s*:\s*text/.test(amtCss[0]))
    throw new Error('金額が金のグラデーションになっていない');
  if (!/@keyframes\s+slDockSheen/.test(css)) throw new Error('当選時の金の光が無い');
  // 金額を伝える3か所(ドック・当たり演出・フリーゲーム結果)がすべて金であること。
  // 以前は当たり演出とフリーゲーム結果だけ薄緑(#8ff2a8)で、台から浮いていた
  for (const [sel, where] of [['\\.slc-amt', '当たり演出'], ['\\.fsout-amt', 'フリーゲーム結果']]) {
    const m = new RegExp(sel + '\\s*\\{[^}]*\\}').exec(css);
    if (!m) throw new Error(`${where}の金額のCSSが無い`);
    if (/#8ff2a8|240,140/.test(m[0])) throw new Error(`${where}の金額が薄緑のまま`);
    if (!/background-clip\s*:\s*text/.test(m[0])) throw new Error(`${where}の金額が金のグラデーションでない`);
  }
  // 配当表の絵柄名が折り返さない(「チ/ップ」と1文字ずつ折れていた)
  if (!/#slot \.paytable td:first-child\s*\{[^}]*white-space\s*:\s*nowrap/.test(css))
    throw new Error('配当表の絵柄名が折り返し防止になっていない');
  if (!/\.spin-btn\.king\.autorun\s*\{[^}]*217,180,95/.test(css))
    throw new Error('AUTO中のボタンが台の色に揃っていない');
  // 総獲得の描画が二重定義されていない(後ろの宣言が勝って金額が出ない事故があった)
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  const dup = (js.match(/function slotShowTotal\b/g) || []).length;
  if (dup !== 1) throw new Error(`slotShowTotal が ${dup} 個ある(二重定義)`);
});

check('画面が単純化されている（ボーナスタイプ欄・アンティ欄が無い）', () => {
  // 第71弾: 画面を単純にするため、モード選択・固定表示・アンティBET を撤去した。
  // 「賭け金 → スピン」だけが残っていることを確かめる（消し忘れの再発防止）
  const el = A.document.getElementById('slot');
  if (el.querySelector('[data-mode]')) throw new Error('モード選択UIが残っている');
  if (el.querySelector('.sl-fixedmode')) throw new Error('ボーナスタイプの固定表示が残っている');
  if (el.querySelector('#sl-ante')) throw new Error('アンティBETのトグルが残っている');
  if (el.querySelector('.sl-cost')) throw new Error('アンティの内訳が残っている');
  if (!el.querySelector('#sl-betnow')) throw new Error('賭け金のUIまで消えている');
  if (!el.querySelector('#slot-spin')) throw new Error('スピンボタンまで消えている');
});

check('賭け金がそのまま消費額になる（アンティの上乗せが無い）', () => {
  // アンティを撤去したので cost === bet のはず。ボタンの表示額で検証する
  const bet = Number(A.document.getElementById('sl-betnow').dataset.betval);
  const t = A.document.getElementById('slot-spin').textContent.replace(/,/g, '');
  const m = /消費[^\d]*(\d+)/.exec(t);
  if (!m) return;   // 「チップ不足」等でスピン以外の表示になっているときは対象外
  if (Number(m[1]) !== bet) throw new Error(`消費額が賭け金と違う: bet=${bet} cost=${m[1]}`);
});

check('配当表が3個/4個/5個の3列になっている', () => {
  const t = A.document.getElementById('slot').textContent;
  for (const k of ['5個', '4個', '3個', 'ワイルド', 'スキャッター']) {
    if (!t.includes(k)) throw new Error(`${k} が配当表に出ていない`);
  }
});


check('チップが足りなければ回せない（ボタンが無効）', () => {
  const btn = A.document.getElementById('slot-spin');
  if (!btn) throw new Error('スピンボタンが無い');
  // 賭け金の候補が空＝下限に満たない＝回せない、が成り立っているか
  const now = A.document.getElementById('sl-betnow');
  const bet = Number(now?.dataset.betval || 0);
  if (bet <= 0 && !btn.disabled) throw new Error('賭け金が無いのに回せてしまう');
  if (bet > 0 && btn.disabled && !/終了/.test(btn.textContent)) throw new Error('賭けられるのに回せない');
});

// 残高表示は 30.31M のように略記されるので、単位を戻してから比べる
const parseAmount = (t) => {
  const m = /^([\d.,]+)\s*([KMBT]|万|億|兆|京|垓)?/.exec(String(t ?? '').trim());
  if (!m) return NaN;
  const unit = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, '万': 1e4, '億': 1e8, '兆': 1e12, '京': 1e16, '垓': 1e20 };
  return Number(m[1].replace(/,/g, '')) * (m[2] ? unit[m[2]] : 1);
};
// 略記は小数2桁までなので、賭け金が小さいと残高表示が変わらない。
// ただし MAX にすると **所持の50%以上になり高額ベット確認が出てスピンしない** ので、
// 所持の 40% 以下で一番大きい段を選ぶ(確認は別のチェックで検証する)。
{
  const bal = parseAmount(A.document.getElementById('balance')?.textContent);
  click(A, A.document.getElementById('sl-betnow'));               // 一覧を開く
  const items = [...A.document.querySelectorAll('.sl-betitem')];
  const safe = items.filter((b) => Number(b.dataset.bet) <= bal * 0.4);
  click(A, (safe.length ? safe : items)[Math.max(0, (safe.length ? safe : items).length - 1)]);
}
// 既定はチップ建てなので、チップ残高の増減を見る
const goldBefore = Number(A.document.getElementById('gold').textContent.replace(/,/g, '')) || 0;
const chipsBefore = parseAmount(A.document.getElementById('balance')?.textContent);
const spinBtn = A.document.getElementById('slot-spin');
if (spinBtn && !spinBtn.disabled) click(A, spinBtn);
// 演出の長さは当たり方でまるで変わる(連鎖・ライン数・祝福)。
// 固定待ちだと足りなくなるので、**スピンボタンが戻るまで**待つ
for (let i = 0; i < 250; i++) {
  const b = A.document.getElementById('slot-spin');
  if (b && !b.disabled) break;
  await sleep(200);
}
await sleep(300);


check('スロットを回すと残高が動き、結果が表示される', () => {
  const chipsAfter = parseAmount(A.document.getElementById('balance')?.textContent);
  if (!Number.isFinite(chipsBefore) || chipsBefore <= 0) throw new Error('チップ残高が読めていない（判定が空振りしている）');
  if (chipsAfter === chipsBefore) throw new Error(`チップが動いていない: ${chipsBefore} → ${chipsAfter}`);
  const t = A.document.getElementById('slot').textContent;
  if (!/ハズレ|\+[\d,]+/.test(t)) throw new Error('結果表示が出ていない');
});

check('当選演出の光条が画面を覆う真円である（四角い画像の回転が見えない）', () => {
  // 第73弾の再発防止。回転する光条をラスタ画像でやるなら、内接円が画面の対角線を
  // 覆う大きさ（≒1.42vmax以上）でないと「四角が回っている」のが見えてしまう。
  // いまは円錐グラデーションで描いているので、そちらが残っているかを確認する。
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  const m = /\.slc-rays\s*\{[^}]*\}/.exec(css);
  if (!m) throw new Error('CSSの光条(.slc-rays)が無い');
  if (!/repeating-conic-gradient/.test(m[0])) throw new Error('光条が円錐グラデーションで描かれていない');
  const w = /width\s*:\s*(\d+)vmax/.exec(m[0]);
  if (!w) throw new Error('光条の大きさが vmax 指定でない（画面比で覆えない）');
  if (Number(w[1]) < 142) throw new Error(`光条が小さく回転で縁が見える: ${w[1]}vmax（142vmax以上必要）`);
  if (!/mask-image\s*:\s*radial-gradient/.test(m[0])) throw new Error('外周が放射状マスクで消えていない');
  // 四角いラスタを回す実装に戻っていないこと
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  if (/slc-burst/.test(js) || /slc-burst/.test(css)) throw new Error('四角い光条画像(slc-burst)が復活している');
});

check('連鎖(タンブル)が廃止されている', () => {
  // 第79弾: 止まった盤面が勝手に入れ替わるのは分かりにくく、演出も長すぎたので廃止。
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  if (/slotSetChain\(i \+ 1/.test(js)) throw new Error('連鎖カウンタがまだ動いている');
});

check('当選ラインは次の操作まで巡回表示され続ける', () => {
  // 消えるとスクリーンショットが撮れず、何で当たったのかも確認できない
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  for (const fn of ['slotStartCycle', 'slotStopCycle', 'slotShowTotal']) {
    if (!new RegExp('function ' + fn).test(js)) throw new Error(`${fn} が無い`);
  }
  if (!/slotStopCycle\(\); slotClearLines\(\);/.test(js)) throw new Error('次のスピンで巡回を止めていない');
});

check('演出のあとに画面を暗転させない', () => {
  // スピンボタンまで暗くなって「壊れている」ように見えていた
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  const m = /\.sl-cell\.dim img\s*\{[^}]*\}/.exec(css);
  if (!m) throw new Error('非当選マスの表現が無い');
  const b = /brightness\(\.?([\d.]+)\)/.exec(m[0]);
  if (!b) throw new Error('明るさの指定が読めない');
  const v = Number(b[1] < 1 ? '0.' + b[1].replace('.', '') : b[1]);
  if (v < 0.4) throw new Error(`非当選マスが暗すぎる(brightness ${b[1]})`);
});

check('当選ラインが線で描かれ、内訳が出る', () => {
  // 第75弾。当たったマスが光るだけでは「どのラインで当たったのか」が分からない。
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  if (!/\.sl-lines\s+polyline/.test(css)) throw new Error('ラインを描くSVGのCSSが無い');
  if (!/@keyframes\s+slLineDraw/.test(css)) throw new Error('左から右へ伸ばす描画が無い');
  if (!/\.sl-lineinfo/.test(css)) throw new Error('当選内訳パネルのCSSが無い');
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  for (const fn of ['slotDrawLine', 'slotShowLineInfo', 'slotShowWinLines', 'slotCellCenter']) {
    if (!new RegExp('function ' + fn).test(js)) throw new Error(`${fn} が無い`);
  }
  // 本数が多いときの短縮(1〜3本=全部 / 4〜8本=5本 / 9本以上=3本)
  if (!/wins\.length <= 3/.test(js) || !/wins\.length <= 8/.test(js)) throw new Error('本数による短縮が無い');
  // タップでスキップできること
  if (!/pointerdown/.test(js)) throw new Error('タップでスキップできない');
  // 色だけに頼らずライン番号を出していること(ドックの内訳は「L12」表記)
  if (!/lbadge/.test(js)) throw new Error('リール上のライン番号バッジが無い');
  if (!/>L' \+ \(win\.line \+ 1\)/.test(js)) throw new Error('内訳のライン番号表示が無い');
});

check('当選表示に絵柄が出る（何で当たったのか分かる）', () => {
  // 金額とライン数だけだと「止まった絵柄と無関係に当たった」ように見えるため、
  // 絵柄名を必ず出す。WILDだけの成立は「◯◯扱い」と明示する。
  const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
  if (!/function slotWinLabel/.test(js)) throw new Error('当選ラベルの生成が無い');
  if (!/allWild/.test(js)) throw new Error('WILDだけの成立を区別していない');
  if (!/function slotSymName/.test(js)) throw new Error('絵柄名の解決が無い');
});

check('確定した絵柄にぼかしが掛からない（停止後にモザイクにならない）', () => {
  // 第71弾の再発防止。旧実装の名残 `.sl-grid.spinning .sl-cell img { filter:blur() }` が
  // 残っていると、**先に止まったリールが最後の1本が止まるまでぼやけたまま**になる。
  // linkedom には計算済みスタイルが無いので、スタイルシートの本文を直接検査する。
  const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
  const bad = /\.sl-grid\.spinning\s+\.sl-cell\s+img\s*\{[^}]*filter\s*:[^}]*blur\(/.exec(css);
  if (bad) throw new Error(`確定マスにぼかしが掛かっている: ${bad[0].slice(0, 80)}`);
  // 回転中の帯にはブラーが掛かっていること（演出まで消していないか）
  if (!/\.sl-band\s*\{[^}]*filter\s*:\s*url\(#slvblur\)/.test(css)) {
    throw new Error('回転中の帯の縦モーションブラーが失われている');
  }
});

check('賭け金は選択式（−/＋で1段ずつ・一覧・MAX）', () => {
  // 描き直しで要素が入れ替わるので毎回取り直す
  const now = () => A.document.getElementById('sl-betnow');
  if (!now()) throw new Error('賭け金の選択UIが無い');
  if (A.document.getElementById('sl-betin')) throw new Error('自由入力が残っている（選択式にしたはず）');

  // 表示は 20M のように略記されるため、正確な額は data-betval から読む
  const read = () => Number(now().dataset.betval);
  const first = read();

  // ＋ で1段上がる
  click(A, A.document.querySelector('[data-betstep="1"]'));
  const up = read();
  if (!(up > first)) throw new Error(`＋で上がらない: ${first} → ${up}`);

  // − で戻る
  click(A, A.document.querySelector('[data-betstep="-1"]'));
  if (read() !== first) throw new Error(`−で戻らない: ${read()} (期待 ${first})`);

  // 額を押すと一覧が開き、そこから選べる
  click(A, now());
  const items = [...A.document.querySelectorAll('.sl-betitem')];
  if (items.length < 2) throw new Error(`一覧が開かない: ${items.length}`);
  click(A, items[items.length - 1]);
  const picked = read();
  if (picked <= first) throw new Error(`一覧から選べない: ${picked}`);

  // MAX は一番大きい段(所持以内)
  click(A, A.document.querySelector('[data-betop="max"]'));
  const maxed = read();
  const balTxt = A.document.getElementById('balance')?.textContent;
  if (maxed > parseAmount(balTxt) * 1.001) throw new Error(`所持を超える段が選べる: ${maxed} > ${balTxt}`);
});

check('所持の半分以上を賭けるときは初回だけ確認が出る', () => {
  // MAXの段が所持の何%になるかは残高しだいなので、**しきい値を跨ぐか否かで期待値を切り替える**。
  // こうすると「たまたま条件を満たさず素通り」がなくなり、どちらに転んでも何かを検証できる。
  click(A, A.document.querySelector('[data-betop="max"]'));
  const bet = Number(A.document.getElementById('sl-betnow').dataset.betval);
  const bal = parseAmount(A.document.getElementById('balance')?.textContent);
  const spin = A.document.getElementById('slot-spin');
  if (!spin || spin.disabled) throw new Error('回せる状態でない');
  const shouldWarn = bet >= bal * 0.5;
  click(A, spin);
  const warn = A.document.getElementById('sl-warn');
  if (shouldWarn) {
    if (!warn) throw new Error(`所持の50%以上(${bet}/${bal})なのに確認が出ない`);
    if (!/初回のみ/.test(warn.textContent)) throw new Error('初回のみである旨の説明が無い');
    click(A, A.document.getElementById('slw-no'));      // やめるで閉じる＝賭けない
    if (A.document.getElementById('sl-warn')) throw new Error('やめるで閉じない');
  } else {
    if (warn) throw new Error(`所持の50%未満(${bet}/${bal})なのに確認が出た`);
  }
});


// --- 第69弾: スタックドWILD + リスピン --------------------------------------
// 自然発生(1/64)を待つとテストが不安定になるので、**エンジンの帯設定を一時的に
// 3コマへ縮めて必ず出す**。SLOT_CFG はチューナー用に可変オブジェクトで、
// サーバーはこのプロセス内の同じモジュール実体を使っているため直接触れる。
{
  const { SLOT_CFG } = await import('../dist/src/server/slot.js');
  const origLen = SLOT_CFG.stackedStripLen;
  // 帯を4コマにすると各リール 1/4 でフル停止する。3にすると**全リールが必ずフル停止**し、
  // 引き直す相手がいなくなってリスピンが起きない(第76弾で全リール対応にしたため)
  SLOT_CFG.stackedStripLen = 4;
  // 前のチェックの再生(演出)が残っているとボタンが無効のままなので、押せるまで待つ
  for (let i = 0; i < 50; i++) {
    const b = A.document.getElementById('slot-spin');
    if (b && !b.disabled) break;
    await sleep(200);
  }
  // 賭け金を最小に戻す(高額ベット確認に吸われない額)
  click(A, A.document.getElementById('sl-betnow'));
  const smallBet = [...A.document.querySelectorAll('.sl-betitem')][0];
  if (smallBet) click(A, smallBet);
  // 高額ベット確認が開きっぱなしだと以降のクリックが全部無視される
  { const w = A.document.getElementById('sl-warn'); if (w) { const no = A.document.getElementById('slw-no'); if (no) click(A, no); } }
  {   // 1スピンの所要時間を実測する(長すぎないか)
    const durs = [];
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 200; i++) {
        const b = A.document.getElementById('slot-spin');
        if (b && !b.disabled) break;
        await sleep(200);
      }
      const b0 = A.document.getElementById('slot-spin');
      if (!b0 || b0.disabled) break;
      const t0 = Date.now();
      click(A, b0);
      for (let i = 0; i < 400; i++) {
        await sleep(100);
        const b = A.document.getElementById('slot-spin');
        if (b && !b.disabled) break;
      }
      durs.push(((Date.now() - t0) / 1000).toFixed(1));
    }
    console.log('  [spin所要秒]', durs.join(', '));
  }
  // 1/4 なので数回まわせば「一部だけフル停止」= リスピンありの盤面が出る
  let sawBanner = false, sawLocked = false, sawRespinText = false;
  for (let attempt = 0; attempt < 12 && !(sawBanner && sawLocked && sawRespinText); attempt++) {
    for (let i = 0; i < 160; i++) {
      const b = A.document.getElementById('slot-spin');
      if (b && !b.disabled) break;
      await sleep(200);
    }
    const sb2 = A.document.getElementById('slot-spin');
    if (!sb2 || sb2.disabled) break;
    click(A, sb2);
    for (let i = 0; i < 160; i++) {
      await sleep(150);
      const g = A.document.getElementById('sl-grid');
      if (g && g.querySelector('.sl-respin')) sawBanner = true;
      if (g && g.querySelector('.sl-reel.locked')) sawLocked = true;
      const w = A.document.getElementById('sl-win');
      if (w && /WILD RE-SPIN/.test(w.textContent)) sawRespinText = true;
      if (sawBanner && sawLocked && sawRespinText) break;
      const b2 = A.document.getElementById('slot-spin');
      if (b2 && !b2.disabled) break;
    }
  }
  SLOT_CFG.stackedStripLen = origLen;
  check('3連WILDで「WILD RE-SPIN」が発生し、そのリールが固定表示される', () => {
    if (!sawBanner) throw new Error('WILD RE-SPIN の告知帯が出ていない');
    if (!sawLocked) throw new Error('リールのロック表示(金枠)が出ていない');
    if (!sawRespinText) throw new Error('「WILD RE-SPIN　リールn固定」の表示が出ていない');
  });

  // 演出の途中で判定すると、正常にロックされている最中を「解除されていない」と誤判定する。
  // スピンが完全に終わる(ボタンが戻る)まで待ってから確かめる
  // スタックド+リスピン+祝福が重なると20秒を超えることがある。終わり切るまで待つ
  for (let i = 0; i < 200; i++) {
    const b = A.document.getElementById('slot-spin');
    if (b && !b.disabled) break;
    await sleep(200);
  }
  await sleep(600);

  check('リスピンが終わればロックは必ず解除される', () => {
    // 全リールWILDのときはリスピンが起きないので、
    // 「リスピンの中で解除」していると固定表示が次のスピン以降も残ってしまう
    const stuck = A.document.querySelectorAll('#sl-grid .sl-reel.locked').length;
    if (stuck) throw new Error(`スピンが終わったのに ${stuck} 本のリールが固定表示のまま`);
  });
  await sleep(3500);   // 再生が残っていても次のチェックに漏れないよう待ち切る
}

// --- 第74弾: フリーゲームの始まり・最中・終わり ------------------------------
// 突入は 1/188 なので自然発生は待てない。ただし**重みを上げすぎると毎ゲーム再抽選が起きて
// 200ゲーム上限まで回り続ける**(実際にそれで結果画面まで到達しなかった)。
// 突入はそこそこ起きて再抽選は収束する値を選び、初期ゲーム数も 2 に縮めて短時間で終わらせる。
{
  const { SLOT_CFG, FREE_MODES } = await import('../dist/src/server/slot.js');
  const few = FREE_MODES.find((m) => m.key === 'few');
  const origSc = SLOT_CFG.scatterWeight;
  const origSpins = { ...SLOT_CFG.freeSpinsByScatter };
  const origAdd = { ...SLOT_CFG.freeRetriggerByScatter };
  SLOT_CFG.scatterWeight = 55;       // 突入しやすくする
  // **上乗せを切らないとフリーゲームが終わらない**。スキャッターの重みを上げているので、
  // 3個以上が頻発して上乗せが発散する。0 にして切っておく
  SLOT_CFG.freeRetriggerByScatter = { 3: 0, 4: 0, 5: 0 };
  // 突入回数は第89弾から mode.spins ではなくスキャッターの個数で決まる。
  // 短時間で結果画面まで到達させるため2回に縮める
  SLOT_CFG.freeSpinsByScatter = { 3: 2, 4: 2, 5: 2 };

  const waitSpinnable = async (n = 320) => {
    for (let i = 0; i < n; i++) {
      const b = A.document.getElementById('slot-spin');
      if (b && !b.disabled) return b;
      await sleep(200);
    }
    return null;
  };

  // 第103弾: 倍率抽選は**ボタンを押すまで進まない**(押さないと12秒待たされる)。
  // テストでもプレイヤーと同じように押してやらないと、フリーゲーム系が軒並み時間切れになる
  const pressDrawButton = () => {
    const go = A.document.getElementById('fsin-go');
    if (go && !go.disabled) { click(A, go); return true; }
    return false;
  };

  let sawIntro = false, sawHud = false, sawCounter = false, sawBar = false, sawOutro = false, sawReelSpin = false;
  let sawLeft = false, sawWinSplit = false, hudText = '';
  let counterText = '';
  // 賭け金を最小にして、突入するまで回す
  {
    const b0 = await waitSpinnable();
    if (b0) {
      click(A, A.document.getElementById('sl-betnow'));
      const small = [...A.document.querySelectorAll('.sl-betitem')][0];
      if (small) click(A, small);
    }
  }
  // 第92弾以降、1スピンの演出が長くなった(着弾のカウントアップ・回転560ms など)。
  // 待ち幅を広げないと「スピンの途中で見切って次を押す」ことになり、
  // 突入を取り逃してこのブロックがまるごと揺れる(実際に落ちた)
  for (let attempt = 0; attempt < 40 && !sawIntro; attempt++) {
    const btn = await waitSpinnable();
    if (!btn) break;
    click(A, btn);
    // このスピンが終わるまで(またはフリーに入るまで)追いかける
    for (let i = 0; i < 400; i++) {
      await sleep(150);
      pressDrawButton();
      if (A.document.getElementById('sl-fsin')) { sawIntro = true; break; }
      const b = A.document.getElementById('slot-spin');
      if (b && !b.disabled) break;
    }
  }
  // 突入したら、HUD と結果画面を観測する
  for (let i = 0; i < 900 && sawIntro && !sawOutro; i++) {
    await sleep(150);
    pressDrawButton();
    const hud = A.document.getElementById('sl-fs');
    if (hud) {
      sawHud = true;
      const ic = A.document.getElementById('slfs-i');
      if (ic && Number(ic.textContent) >= 1) { sawCounter = true; counterText = hud.textContent; }
      const bar = A.document.getElementById('slfs-bar');
      if (bar && parseFloat(bar.style.width) > 0) sawBar = true;
      hudText = hud.textContent.replace(/\s+/g, ' ').trim();
      if (A.document.getElementById('slfs-left')) sawLeft = true;
      if (A.document.getElementById('slfs-w') && A.document.getElementById('slfs-wnow')) sawWinSplit = true;
      if (A.document.querySelectorAll('#sl-grid .sl-reel.rolling').length > 0) sawReelSpin = true;
      if (!A.document.getElementById('sl-grid')) throw new Error('フリー中に盤面が消えている');
    }
    if (A.document.getElementById('sl-fsout')) sawOutro = true;
  }
  // --- 再トリガー: 自然発生は稀すぎるので、条件を強めて必ず1回起こす ---
  // 見たいのは「短い専用演出が出て、残り回数が増える」こと(突入演出はやり直さない)
  let sawRetrig = false, sawRetrigText = '', leftGrew = false, sawNoIntroAgain = true;
  let prevTot = 0, totAtRetrig = null, totLeakedEarly = false;
  let retrigFsSeen = 0;                    // 落ちたときの切り分け用(何回フリーに入れたか)
  {
    // 再トリガー(フリー中に3個以上)を確実に観測するため、スキャッターをさらに重くする。
    // 55 だと 2連続で観測失敗する程度の揺れが残っていた(第112弾で増強)
    SLOT_CFG.scatterWeight = 80;
    SLOT_CFG.freeSpinsByScatter = { 3: 3, 4: 3, 5: 3 };
    SLOT_CFG.freeRetriggerByScatter = { 3: 4, 4: 8, 5: 12 };
    for (let attempt = 0; attempt < 60 && !sawRetrig; attempt++) {
      const btn = await waitSpinnable();
      if (!btn) break;
      click(A, btn);
      // 突入演出は**フリーゲームの最初に1回だけ**。再トリガーのあとに出たらやり直している
      // 第104弾: 突入演出だけで約23秒(音の鳴り終わりを待つ)。
      // 1スピンぶんの猶予は「突入23秒 + フリー数ゲーム」を見込んで取る
      let introAfter = 0, lastLeft = 0;
      for (let i = 0; i < 1000; i++) {
        await sleep(120);
        pressDrawButton();
        if (A.document.getElementById('sl-fs')) retrigFsSeen++;
        if (sawRetrig && A.document.getElementById('sl-fsin')) introAfter++;
        const tt = A.document.getElementById('slfs-tot');
        const totNow = tt ? Number(tt.textContent) : 0;
        const rt = A.document.getElementById('sl-retrig');
        if (rt) {
          sawRetrig = true;
          sawRetrigText = rt.textContent.replace(/\s+/g, ' ').trim();
          // **この演出が出ている間**は総回数が動かないこと(先に増えると種明かしになる)。
          // 直前のティックの値と比べる(前回の再トリガーで増えた値は基準にしない)
          if (totAtRetrig === null) totAtRetrig = prevTot;
          if (totNow > totAtRetrig) totLeakedEarly = true;
        } else {
          totAtRetrig = null;          // 演出が消えたら次の再トリガーに備えて解除
        }
        prevTot = totNow;
        const l = A.document.getElementById('slfs-left');
        if (l) { const v = Number(l.textContent);
          if (v > lastLeft && lastLeft > 0) leftGrew = true;
          lastLeft = v; }
        const b = A.document.getElementById('slot-spin');
        if (b && !b.disabled) break;
      }
      if (introAfter > 0) sawNoIntroAgain = false;
    }
  }

  SLOT_CFG.scatterWeight = origSc;
  SLOT_CFG.freeSpinsByScatter = origSpins;
  SLOT_CFG.freeRetriggerByScatter = origAdd;

  check('再トリガーは短い専用演出で、残り回数が増える', () => {
    if (!sawRetrig) throw new Error('再トリガーの演出(#sl-retrig)が出ていない(フリー観測tick=' + retrigFsSeen + ')');
    if (!/RETRIGGER/.test(sawRetrigText)) throw new Error(`RETRIGGER の表記が無い: ${sawRetrigText}`);
    if (!/\uFF0B\d+ FREE GAMES/.test(sawRetrigText)) throw new Error(`上乗せ回数が出ていない: ${sawRetrigText}`);
    if (!leftGrew) throw new Error('残り回数が増えていない');
    if (!sawNoIntroAgain) throw new Error('再トリガーで突入演出をやり直している');
    // 総回数を先に書き換えると、RETRIGGER の演出より前に増えたことが割れてしまう
    if (totLeakedEarly) throw new Error('演出より先に総回数が書き換わっている');
  });

  check('フリーゲームの突入を専用画面で祝う', () => {
    if (!sawIntro) throw new Error('突入演出(#sl-fsin)が出ていない');
  });
  check('フリーゲーム中もリールが回り、何ゲーム目かが分かる', () => {
    if (!sawHud) throw new Error('フリーゲームのHUDが出ていない');
    if (!sawCounter) throw new Error('ゲーム数のカウンタが動いていない');
    if (!/ゲーム目/.test(counterText)) throw new Error(`「ゲーム目」の表記が無い: ${counterText.slice(0, 80)}`);
    if (!sawBar) throw new Error('進捗バーが伸びていない');
    if (!sawReelSpin) throw new Error('フリー中にリールが回っていない（盤面の差し替えだけになっている）');
  });
  check('フリーゲームのHUDを盤面の親に挿す（基準ノードの親から呼ぶ）', () => {
    // 実ブラウザで起きた事故の再発防止。第86弾で盤面を .sl-gridwrap で包んだのに
    // machine.insertBefore(ov, grid) のままだったため NotFoundError になり、
    // **フリーゲームの演出がまるごと飛んで結果画面だけが出ていた**。
    // linkedom は insertBefore の親子チェックをしないのでDOM側では再現しない。
    // そのため「基準ノードの親から挿している」ことをソースで確かめる。
    const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
    if (/machine\.insertBefore\(\s*ov\s*,\s*grid\s*\)/.test(js))
      throw new Error('HUDを machine.insertBefore(ov, grid) で挿している（grid は machine の子ではない）');
    if (!/anchor\.parentNode\.insertBefore\(ov, anchor\)/.test(js))
      throw new Error('HUDを基準ノードの親から挿していない');
  });
  check('リスピンの演出は一番左のリールだけ', () => {
    // 2〜5列目の3連WILDではリスピンが起きないのに、金枠固定と RE-SPIN 告知が出ていた
    const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
    if (!/\(oc\.stackedReels \|\| \[\]\)\.filter\(\(r\) => r === 0\)/.test(js))
      throw new Error('リスピン演出が全リール対象のまま');
  });
  check('賭け金を変えてもスピンボタンが光ったままになる', () => {
    // 押せる状態なのに黒いままになる事故の防止(setBet で idle を付け直していなかった)
    const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
    if (!/sb\.classList\.toggle\("idle"/.test(js))
      throw new Error('賭け金の変更後に idle を付け直していない');
  });
  check('残り回数と、総獲得・今回の獲得が分けて出る', () => {
    // 第89弾: 「あと何回回せるか」と「このゲームでいくら勝ったか」は別々に常時出す
    if (!/残り/.test(hudText)) throw new Error(`残り回数の表示が無い: ${hudText.slice(0, 90)}`);
    if (!sawLeft) throw new Error('残り回数(#slfs-left)が出ていない');
    if (!sawWinSplit) throw new Error('総獲得と今回の獲得が分かれていない(#slfs-w / #slfs-wnow)');
  });
  check('フリーゲーム終了時に結果が出る', () => {
    if (!sawOutro) throw new Error('結果画面(#sl-fsout)が出ていない');
  });

  await waitSpinnable(80);
}

// --- 第78弾: 回転中もスピンボタンは光る / 停止後の盤面は作り直さない ------------
{
  await waitSpinReady(A, 120);
  const sb = A.document.getElementById('slot-spin');
  if (sb && !sb.disabled) click(A, sb);
  await sleep(500);
  const busyCls = (A.document.getElementById('slot-spin') || {}).className || '';

  check('回転中のスピンボタンは暗く落とさない（一時的に押せないだけ）', () => {
    // 「回転中」と「チップ不足・本日の上限」は意味が違うので見た目も分ける。
    // 両方を disabled の暗転で表すと、回転中に真っ黒に見えてしまう
    if (!/\bbusy\b/.test(busyCls)) throw new Error(`回転中に busy が付かない: ${busyCls}`);
    const css = [...A.document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
    const m = /\.spin-btn\.king\.busy:disabled\s*\{[^}]*\}/.exec(css);
    if (!m) throw new Error('回転中の見た目(busy:disabled)が定義されていない');
    if (!/filter\s*:\s*none/.test(m[0])) throw new Error('回転中もグレースケールが掛かっている');
    if (!/opacity\s*:\s*1/.test(m[0])) throw new Error('回転中も半透明のまま');
  });

  check('停止後に盤面を作り直さない（着地の跳ねが最後まで再生される）', () => {
    const js = [...A.document.querySelectorAll('script')].map((e) => e.textContent).join('\n');
    if (!/function slotAdoptGrid/.test(js)) throw new Error('停止後に盤面をそのまま採用する処理が無い');
    // 停止時にセルのクラス(格)まで貼り替えていること。ここを怠ると
    // 作り直しをやめた瞬間に明るさの階層が前のスピンのまま残る
    if (!/function slotCellClass/.test(js)) throw new Error('セルのクラス生成が共通化されていない');
    if (!/c\.className = slotCellClass/.test(js)) throw new Error('停止時にセルのクラスを更新していない');
  });

  // 停止直後の盤面で、絵柄と明るさの階層(lo/hi/sp)が食い違っていないこと
  await waitSpinReady(A, 120);
  check('停止後の絵柄と明るさの階層が一致している', () => {
    const g = A.document.getElementById('sl-grid');
    if (!g) throw new Error('盤面が無い');
    const map = {};
    A.document.querySelectorAll('#slot .paytable tr').forEach((tr) => {
      const im = tr.querySelector('img.pay-ico');
      if (im) map[im.getAttribute('src')] = tr.querySelector('td').textContent.trim().replace(/\s*(FREE|WILD)$/, '');
    });
    const tierOf = (n) => (n === 'ワイルド' || n === 'スキャッター') ? 'sp'
      : ('スペード王冠セブン'.includes(n) ? 'hi' : 'lo');
    const bad = [];
    g.querySelectorAll('.sl-cell').forEach((c) => {
      const im = c.querySelector('img');
      const name = im && map[im.getAttribute('src')];
      if (!name) return;
      const want = tierOf(name);
      const has = /\bsp\b/.test(c.className) ? 'sp' : /\bhi\b/.test(c.className) ? 'hi' : 'lo';
      if (want !== has) bad.push(`${name}: 期待=${want} 実際=${has}`);
    });
    if (bad.length) throw new Error(`絵柄と明るさが食い違う: ${bad.slice(0, 3).join(' / ')}`);
  });
}

// --- 第77弾 §6: SCATTER の焦らし -----------------------------------------------
// 「2個見えていて3個目が出うるなら**結果にかかわらず**焦らす」のが要件。
// 当たるときだけ焦らすと結果を読まれてしまうので、外れる場合も発動しなければならない。
{
  const { SLOT_CFG } = await import('../dist/src/server/slot.js');
  const origSc = SLOT_CFG.scatterWeight;
  // 落ちていた本当の原因は試行数ではなく、**たまたまフリーゲームに入ると
  // 約40秒の演出で観測窓を使い切る**こと(第113弾で特定)。重みは設計値の42のまま、
  // ①突入しても1ゲームで終わるよう縮め、②観測窓をボタン復帰まで延ばす
  SLOT_CFG.scatterWeight = 42;         // 2個は頻繁に出るが3個は揃いにくい＝外れの焦らしが観測できる
  // pressDrawButton はフリーゲーム節のスコープ内なので、このブロック用に定義し直す
  const pressDrawButton = () => {
    const go = A.document.getElementById('fsin-go');
    if (go && !go.disabled) { click(A, go); return true; }
    return false;
  };
  const anticOrigSpins = { ...SLOT_CFG.freeSpinsByScatter };
  SLOT_CFG.freeSpinsByScatter = { 3: 1, 4: 1, 5: 1 };
  let sawAntic = false, sawLit = false, sawTarget = false, anticMissed = false;
  // 落ちたときに「何回回せて、SCATTERが何個見えたか」を言えるようにする。
  // これが無いと、回せなかったのか出なかったのかが区別できない(第170弾)
  let spins = 0, stopReason = '', maxScatters = 0;
  let attempt = 0;
  for (; attempt < 35 && !(sawAntic && sawLit && sawTarget && anticMissed); attempt++) {
    await waitSpinReady(A, 200);
    const sb = A.document.getElementById('slot-spin');
    if (!sb || sb.disabled) {
      stopReason = sb ? 'スピンボタンが押せないまま(残高不足の疑い): ' + (sb.textContent || '').trim().slice(0, 30)
        : 'スピンボタンが見つからない';
      break;
    }
    spins++;
    click(A, sb);
    let anticThisSpin = false, enteredFs = false;
    for (let i = 0; i < 700; i++) {                       // 突入(短縮済みでも約30秒)まで待ち切る
      await sleep(100);
      pressDrawButton();                                  // 倍率抽選のボタンで止まらないように
      const g = A.document.getElementById('sl-grid');
      if (A.document.body.classList.contains('sl-antic')) { sawAntic = true; anticThisSpin = true; }
      if (A.document.getElementById('sl-fsin')) enteredFs = true;
      if (g && g.querySelector('.sl-cell.sc.antic-lit')) sawLit = true;
      if (g) maxScatters = Math.max(maxScatters, g.querySelectorAll('.sl-cell.sc').length);
      if (g && g.querySelector('.sl-reel.antic-target')) sawTarget = true;
      const b2 = A.document.getElementById('slot-spin');
      if (b2 && !b2.disabled) break;
    }
    // 焦らしたのにフリーに入らなかった＝「外れでも焦らした」が観測できた
    if (anticThisSpin && !enteredFs) anticMissed = true;
  }
  SLOT_CFG.scatterWeight = origSc;
  SLOT_CFG.freeSpinsByScatter = anticOrigSpins;

  const anticWhy = ` (${spins}回転/${attempt}試行, 見えたSCATTERの最大${maxScatters}個` +
    (stopReason ? `, 中断: ${stopReason}` : '') + ')';
  check('SCATTER が2個見えたら焦らし演出が入る', () => {
    if (!sawAntic) throw new Error('焦らし(外周の暗転)が発動しない' + anticWhy);
    if (!sawLit) throw new Error('見えているSCATTERが脈動していない');
    if (!sawTarget) throw new Error('最終リールが強調されていない');
  });

  check('外れるときも同じ条件で焦らす（結果を読まれない）', () => {
    if (!anticMissed) throw new Error('当たったときしか焦らしていない疑いがある' + anticWhy);
  });

  check('焦らしが終われば画面は必ず元に戻る', () => {
    if (A.document.body.classList.contains('sl-antic')) throw new Error('外周の暗転が残っている');
    const g = A.document.getElementById('sl-grid');
    if (g && g.querySelector('.antic-lit, .antic-target')) throw new Error('焦らしの強調が残っている');
  });

  for (let i = 0; i < 60; i++) {
    const b = A.document.getElementById('slot-spin');
    if (b && !b.disabled) break;
    await sleep(200);
  }
}

// --- 第77弾 §7: ペイライン一覧モーダル ---------------------------------------
{
  for (let i = 0; i < 60; i++) {
    const b = A.document.getElementById('slot-spin');
    if (b && !b.disabled) break;
    await sleep(200);
  }
  const ways = A.document.getElementById('sl-ways');
  if (ways) click(A, ways);
  await sleep(300);
  const modal = A.document.getElementById('sl-lines-modal');

  check('25 LINES をタップするとペイライン一覧が開く', () => {
    if (!ways) throw new Error('「25 LINES」がタップできる要素になっていない');
    if (!modal) throw new Error('ペイライン一覧が開かない');
    // 25本を一度に描かず、5本ずつのページに分かれていること
    const pages = modal.querySelectorAll('[data-page]');
    if (pages.length !== 5) throw new Error(`ページが5つでない: ${pages.length}`);
    const lines = modal.querySelectorAll('[data-line]');
    if (lines.length !== 5) throw new Error(`1ページが5本でない: ${lines.length}`);
    // 色だけに頼らず番号も出していること
    const nums = [...lines].map((b) => b.textContent.trim());
    if (!nums.includes('1') || !nums.includes('5')) throw new Error(`ライン番号が出ていない: ${nums.join(',')}`);
    if (!modal.querySelector('.plm-svg polyline')) throw new Error('ラインが描かれていない');
  });

  check('ページを切り替えると別の5本になる', () => {
    if (!modal) throw new Error('モーダルが無い');
    const p3 = [...modal.querySelectorAll('[data-page]')][2];
    click(A, p3);
    const nums = [...modal.querySelectorAll('[data-line]')].map((b) => b.textContent.trim());
    if (!nums.includes('11') || !nums.includes('15')) throw new Error(`3ページ目が11〜15でない: ${nums.join(',')}`);
  });

  if (modal) { const c = A.document.getElementById('plm-close'); if (c) click(A, c); }
  await sleep(200);
}

// --- 第77弾 §8: オートスピン ---------------------------------------------------
{
  check('AUTO ボタンから回数と停止条件を選べる', () => {
    // 第86弾: 起動は所持金の行の「AUTO」ピル。
    // renderSlot で要素が作り直されるので、**押す直前に取り直す**(古い参照はクリックが効かない)
    const autoBtn = A.document.getElementById('sl-auto-open');
    if (!autoBtn) throw new Error('AUTO の起動ボタンが無い');
    click(A, autoBtn);
    const m = A.document.getElementById('sl-auto-modal');
    if (!m) throw new Error('オートスピンの設定が開かない');
    const counts = [...m.querySelectorAll('[data-n]')].map((b) => Number(b.dataset.n));
    for (const n of [10, 25, 50, 100]) if (!counts.includes(n)) throw new Error(`${n} 回の選択肢が無い`);
    if (!m.querySelector('#am-free')) throw new Error('フリーゲームで停止の選択肢が無い');
    if (!m.querySelector('#am-big')) throw new Error('BIG WIN で停止の選択肢が無い');
  });

  // 10回を選んで開始し、実際に自動で回ることを見る
  {
    const m = A.document.getElementById('sl-auto-modal');
    if (m) {
      const ten = [...m.querySelectorAll('[data-n]')].find((b) => b.dataset.n === '10');
      if (ten) click(A, ten);
      click(A, A.document.getElementById('am-go'));
    }
  }
  // 前の検査の演出(フリーゲームだと1分超)が終わり切るまで待ってから始める
  for (let i = 0; i < 600; i++) {
    const b = A.document.getElementById('slot-spin');
    if (b && !b.disabled) break;
    await sleep(300);
  }
  // 第84弾で「本日あと」表記を撤去したため、回ったことは **AUTO n の残り回数が減る**ことで確かめる
  let sawAutoLabel = false, spun = 0, minAuto = 99;
  // 1回あたり演出込みで2〜4秒、途中でフリーゲームを引くと1回で1分を超えることもある。
  // 10回ぶん+フリー2回ぶんまで見込んで4分待つ
  let stopped = false;
  for (let i = 0; i < 1200; i++) {
    await sleep(200);
    const b = A.document.getElementById('slot-spin');   // 第86弾: AUTOの表示はスピンボタン
    const m = b && /AUTO\s+(\d+)/.exec(b.textContent);
    if (m) { sawAutoLabel = true; spun = 1; minAuto = Math.min(minAuto, Number(m[1])); }
    if (b && !/AUTO\s+\d/.test(b.textContent) && sawAutoLabel) { stopped = true; break; }
  }

  check('オートを開始すると残り回数が表示され、自動で回る', () => {
    if (!sawAutoLabel) throw new Error('「AUTO n」の残り回数が表示されない');
    if (!spun) throw new Error('自動で回っていない');
    // 10回で開始したので、進んでいれば残りが10未満の値を必ず観測できる
    if (!(minAuto < 10)) throw new Error(`オートで回っていない: AUTO の残りが ${minAuto} から減らない`);
  });

  check('オートは必ず止まる（回数終了・不足・上限のいずれか）', () => {
    const b = A.document.getElementById('slot-spin');
    if (!b) throw new Error('スピンボタンが消えている');
    if (!stopped || /AUTO\s+\d/.test(b.textContent)) {
      throw new Error(`オートが止まらない（4分待っても継続）: ${b.textContent.trim()}`);
    }
  });
}

console.log(`\n  （${clicks} 回アクション、${played} ハンド進行）`);

await gateway.close();

if (errors.length) {
  console.error('\n失敗:\n' + errors.join('\n\n'));
  process.exit(1);
}
console.log('\nすべて通過しました。');
process.exit(0);
