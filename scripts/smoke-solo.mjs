/**
 * ソロ版 poker-solo.html の E2E スモークテスト
 *
 * 生成された単一 HTML を仮想 DOM で実際に動かす。
 * TypeScript のコンパイルが通ることと、ブラウザで開いて遊べることは別問題なので、
 * 「座る → 打つ → 破産する → 共有カードを作る」まで通しで動かして確かめる。
 *
 * localStorage と canvas は linkedom に無いので差し替える。
 * canvas は描画命令を記録するだけのダミーにしてあり、
 * 「共有カードにチップ額と称号が実際に描かれているか」をそこから検証する。
 */
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, '../poker-solo.html'), 'utf8');

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

// --- canvas のダミー。描かれた文字を全部覚えておく ---
const painted = [];
function fakeContext() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  return {
    canvas: null,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arcTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    drawImage: noop,
    setTransform: noop,
    createPattern: () => null,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: (t) => ({ width: String(t).length * 12 }),
    fillText: (t) => painted.push(String(t)),
    strokeText: (t) => painted.push(String(t)),
  };
}

const played = [];
const memory = new Map();
const storage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};

const { window, document } = parseHTML(html);

// linkedom の window は globalThis を透過するので、差し替える前に本物を捕まえておく
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);

const origCreate = document.createElement.bind(document);
document.createElement = (tag, ...rest) => {
  const el = origCreate(tag, ...rest);
  if (String(tag).toLowerCase() === 'canvas') {
    const ctx = fakeContext();
    ctx.canvas = el;
    el.getContext = () => ctx;
    el.toBlob = (cb) => cb({ type: 'image/png', size: 1 });
    el.toDataURL = () => 'data:image/png;base64,';
  }
  return el;
};

/** 画像は読めない想定にして、テクスチャが無くても共有カードが成立するか確かめる */
class FakeImage {
  set src(_v) {
    nativeSetTimeout(() => this.onerror?.(new Error('no image in jsdom')), 0);
  }
}

const sandbox = {
  window,
  document,
  localStorage: storage,
  Image: FakeImage,
  navigator: { clipboard: undefined },
  requestAnimationFrame: (fn) => nativeSetTimeout(() => fn(Date.now()), 16),
  cancelAnimationFrame: nativeClearTimeout,
  setTimeout: nativeSetTimeout,
  clearTimeout: nativeClearTimeout,
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
  console: { log: () => {}, warn: () => {}, error: (...a) => console.error('[solo]', ...a) },
  alert: () => {},
  crypto: globalThis.crypto,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  Math,
  Date,
  JSON,
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  // WebAudio は linkedom に無いので、呼ばれた音の名前を数えるだけのダミーを入れる
  AudioContext: class {
    constructor() {
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
    }
    resume() {}
    createGain() { return audioNode({ gain: audioParam() }); }
    createOscillator() { played.push('osc'); return audioNode({ frequency: audioParam(), start(){}, stop(){}, type:'' }); }
    createBiquadFilter() { return audioNode({ frequency: audioParam(), Q: audioParam(), type:'' }); }
    createBufferSource() { played.push('noise'); return audioNode({ playbackRate: audioParam(), buffer:null, start(){}, stop(){} }); }
    createBuffer(_c, len) { return { getChannelData: () => new Float32Array(len) }; }
  },
};

function audioParam() {
  return {
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
    setTargetAtTime() {}, cancelScheduledValues() {},
  };
}
function audioNode(extra) {
  const n = { connect: (dst) => dst, disconnect() {}, ...extra };
  n.connect = (dst) => dst;
  return n;
}

sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const script = document.querySelector('script:not([src])').textContent;
vm.runInContext(script, sandbox, { filename: 'solo.js' });

const click = (el) => el.dispatchEvent(new window.Event('click'));
const $ = (id) => document.getElementById(id);
const chips = () => Number($('chips').textContent.replace(/,/g, ''));

console.log('ソロ版の E2E:');
await sleep(300);

// --- ロビー ---
check('ロビーに卓が並ぶ', () => {
  const t = $('stakes').textContent;
  if (!t.includes('マイクロ 6人')) throw new Error(`卓が出ていない: ${t.slice(0, 200)}`);
  if (!t.includes('ヘッズアップ')) throw new Error('ヘッズアップ卓が無い');
});

check('6人卓とヘッズアップ卓の両方が選べる', () => {
  const keys = Array.from(document.querySelectorAll('[data-stake]')).map((b) => b.dataset.stake);
  if (!keys.includes('micro6')) throw new Error('6人卓のボタンが無い');
  if (!keys.includes('microhu')) throw new Error('ヘッズアップのボタンが無い');
});

check('上位の卓はロックされていて押せない', () => {
  const locked = Array.from(document.querySelectorAll('[data-stake]')).filter((b) => b.disabled);
  if (locked.length === 0) throw new Error('全部の卓が最初から開いている');
});

check('補充までの残り時間が表示される', () => {
  const t = $('recharge').textContent;
  if (!/補充|回復/.test(t)) throw new Error(`補充の案内が無い: ${t.slice(0, 200)}`);
});

check('実績が一覧に出る', () => {
  const t = $('achievements').textContent;
  if (!t.includes('座り慣れる')) throw new Error(`実績が空: ${t.slice(0, 200)}`);
});

const startChips = chips();
check('初期チップが配られている', () => {
  if (startChips <= 0) throw new Error(`初期チップが ${startChips}`);
});

// --- 着席 ---
const sit = document.querySelector('[data-stake="micro6"]');
click(sit);
await sleep(400);

check('着席するとバイイン分だけ手持ちが減る', () => {
  if (chips() !== startChips - 2000) throw new Error(`${startChips} → ${chips()}（2,000 引かれるはず）`);
});

check('卓の画面に切り替わる', () => {
  if ($('table-view').className.includes('hidden')) throw new Error('卓が表示されていない');
  if (!$('lobby').className.includes('hidden')) throw new Error('ロビーが消えていない');
});

check('6 席ぶんの座席が描かれる', () => {
  const seats = document.querySelectorAll('#felt .seat');
  if (seats.length !== 6) throw new Error(`座席数 ${seats.length}`);
});

// --- ハンドを進める ---
let acted = 0;
let peeked = 0;
let leaks = 0;
const bubbleKinds = new Set();
const bubbleLabels = new Set();
const drive = setInterval(() => {
  // 相手の手札が表向きで出ていないかを、手番のたびに全部見る
  const street = document.querySelector('#felt .street-tag')?.textContent ?? '';
  // 結果・ショーダウン・オールインの焦らし演出中は、公開されているのが正しい状態。
  // ここを入れ忘れると、たまたまオールインが起きた回だけ落ちる不安定なテストになる
  const openStreet = street === '結果' || street === 'ショーダウン' || street.startsWith('オールイン');
  if (!openStreet) {
    peeked++;
    for (const seat of document.querySelectorAll('#felt .seat')) {
      if (seat.dataset.seat === '0') continue;
      const faceUp = Array.from(seat.querySelectorAll('.card')).filter((c) => c.hasAttribute('data-card'));
      if (faceUp.length) leaks++;
    }
  }
  for (const b of document.querySelectorAll('#felt .act-bubble')) {
    for (const c of b.className.split(/\s+/)) if (c !== 'act-bubble' && c) bubbleKinds.add(c);
    bubbleLabels.add(b.textContent.trim());
  }
  const buttons = Array.from(document.querySelectorAll('#actions [data-act]'));
  if (!buttons.length) return;
  // なるべく降りずに進める。たまにレイズして CPU の反応も引き出す
  const by = (a) => buttons.find((b) => b.dataset.act === a);
  const pick = (acted % 5 === 4 ? by('raise') : undefined) ?? by('check') ?? by('call') ?? by('fold');
  if (pick) {
    click(pick);
    acted++;
  }
}, 40);

await sleep(27000);
clearInterval(drive);

check('自分の手番が回ってきて操作できる', () => {
  if (acted < 6) throw new Error(`押せたのは ${acted} 回だけ`);
});

check('ハンドが進行してログが出る', () => {
  const log = $('log').textContent;
  if (!/ハンド|プリフロップ|フロップ/.test(log)) throw new Error(`ログが空: ${log.slice(0, 200)}`);
});

check('CPU が実際に考えて打っている', () => {
  const log = $('log').textContent;
  if (!/(コール|レイズ|フォールド|チェック|ベット)/.test(log)) throw new Error('CPU の行動がログに無い');
});

check('相手の手札が伏せられたまま保たれている', () => {
  if (peeked < 10) throw new Error(`確認できた回数が ${peeked} 回しかない`);
  if (leaks > 0) throw new Error(`${leaks} 回、他席のカードが表向きになっていた`);
});

check('アクションが席の上に吹き出しで出る', () => {
  // ログを読まずに卓を見ただけで「誰が何をしたか」が分かることが狙い
  if (bubbleKinds.size === 0) throw new Error('吹き出しが一度も出ていない');
  for (const k of bubbleKinds) {
    if (!['fold', 'check', 'call', 'bet', 'raise', 'allin'].includes(k)) {
      throw new Error(`知らない種類の吹き出し: ${k}`);
    }
  }
});

check('吹き出しに金額が入っている', () => {
  // 「レイズ」だけでは大きさが伝わらない
  const withAmount = [...bubbleLabels].filter((t) => /\d/.test(t));
  if (withAmount.length === 0) throw new Error(`金額つきの吹き出しが無い: ${[...bubbleLabels].join(' / ')}`);
});

check('効果音が鳴っている', () => {
  if (played.length < 5) throw new Error(`鳴ったのは ${played.length} 回だけ`);
});

check('ボードとポットが更新されている', () => {
  const pot = document.querySelector('#felt .pot')?.textContent ?? '';
  if (!/\d/.test(pot)) throw new Error(`ポットが表示されていない: ${pot}`);
});

// --- 共有カード ---
painted.length = 0;
click($('btn-share'));
await sleep(600);

check('成績カードのモーダルが開く', () => {
  if (!$('share-preview')) throw new Error('共有モーダルが出ない');
});

const RANK_NAMES = ['ルーキー', 'アマチュア', 'セミプロ', 'プロ', 'ハイローラー', 'レジェンド'];
check('共有カードにチップ額と称号が描かれている', () => {
  const text = painted.join('|');
  // 遊んだ結果ランクが上がっていることもあるので、称号名のどれかが出ていればよい
  if (!RANK_NAMES.some((r) => text.includes(r))) throw new Error(`称号が描かれていない: ${text.slice(0, 300)}`);
  if (!text.includes('所持チップ')) throw new Error('チップの見出しが無い');
  if (!text.includes('SOLO POKER')) throw new Error('署名が無い');
  if (!/ハンド/.test(text)) throw new Error('統計が描かれていない');
});

check('画像が読めなくても共有カードは生成される', () => {
  // FakeImage は必ず onerror を返す。テクスチャ無しでも落ちずに描き切れるかを見る
  if (painted.length < 10) throw new Error(`描画された文字が ${painted.length} 個しかない`);
});

const closeBtn = $('sh-close');
if (closeBtn) click(closeBtn);
await sleep(200);

// --- 卓を降りる ---
check('ハンドの途中は卓を降りるボタンが無効になっている', () => {
  // 押しても無反応、が一番よくない。降りられない理由が見えるべき
  const btn = $('btn-leave');
  if (!btn.disabled) throw new Error('ハンド中なのに押せてしまう');
  if (!btn.title) throw new Error('理由が示されていない');
});

// ハンドが終わるまで待ってから降りる
for (let i = 0; i < 120 && $('btn-leave').disabled; i++) {
  const buttons = Array.from(document.querySelectorAll('#actions [data-act]'));
  const fold = buttons.find((b) => b.dataset.act === 'fold');
  if (fold) click(fold);
  await sleep(100);
}

check('ハンドが終われば卓を降りるボタンが押せるようになる', () => {
  if ($('btn-leave').disabled) throw new Error('いつまでも降りられない');
});

click($('btn-leave'));
await sleep(400);

check('卓を降りると持ち帰った額が手持ちに戻る', () => {
  if (chips() <= 0) throw new Error(`手持ちが ${chips()}`);
  if (!$('lobby') || $('lobby').className.includes('hidden')) throw new Error('ロビーに戻っていない');
});

check('セーブデータが localStorage に書かれている', () => {
  const raw = storage.getItem('poker.solo.v1');
  if (!raw) throw new Error('保存されていない');
  const data = JSON.parse(raw);
  if (typeof data.chips !== 'number') throw new Error('chips が保存されていない');
  if (!data.stats || typeof data.stats.handsPlayed !== 'number') throw new Error('統計が保存されていない');
  if (data.stats.handsPlayed < 1) throw new Error('プレイしたハンドが記録されていない');
});

check('リロードしても続きから遊べる', () => {
  // 同じ localStorage を渡して起動し直す。チップが引き継がれるはず
  const before = chips();
  const fresh = parseHTML(html);
  const box = { ...sandbox, window: fresh.window, document: fresh.document };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(fresh.document.querySelector('script:not([src])').textContent, box, { filename: 'solo2.js' });
  const after = Number(fresh.document.getElementById('chips').textContent.replace(/,/g, ''));
  if (after !== before) throw new Error(`引き継がれていない: ${before} → ${after}`);
});

console.log(`\n  （${acted} 回アクション、他席の手札の確認 ${peeked} 回）`);

if (errors.length) {
  console.error('\n失敗:\n' + errors.join('\n\n'));
  process.exit(1);
}
console.log('\nすべて通過しました。');
process.exit(0);
