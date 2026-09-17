/**
 * スロットの数値合わせ。目標(RTP96% / ヒット率20〜30% / 突入率1/150〜1/300 /
 * アンティが損得なし)に入る係数を探して、そのまま貼れる形で出力する。
 *
 *   node scripts/tune-slot.mjs
 *
 * 手順:
 *   1. スキャッター重みを振って突入率を目標に合わせる
 *   2. アンティの重みを振って「突入率ちょうど2倍」に合わせる(1.5倍賭けと釣り合う)
 *   3. 配当表を一律スケールしてRTPを96%に合わせる(RTPは配当にほぼ比例する)
 */
import { spin, PAY_SYMBOLS, SLOT_CFG, FREE_MODES } from '../dist/src/server/slot.js';

const makeRng = (seed) => {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
};

function measure(n, opts, seed = 20260822) {
  const rnd = makeRng(seed);
  let sum = 0, hits = 0, free = 0, best = 0, freePay = 0, cap = 0;
  for (let i = 0; i < n; i++) {
    const r = spin(rnd, opts);
    sum += r.totalPayX;
    freePay += r.free?.payX ?? 0;
    if (r.totalPayX > 0) hits++;
    if (r.freeEntered) free++;
    if (r.maxWin) cap++;
    if (r.totalPayX > best) best = r.totalPayX;
  }
  const cost = opts.ante ? SLOT_CFG.anteCost : 1;
  return { rtp: sum / (n * cost), hit: hits / n, freq: free / n, freeShare: freePay / sum, best, cap };
}

const N = 160_000;
const TARGET_RTP = 0.96;

// --- 1) 突入率を 1/200 付近へ ---
console.log('■ スキャッター重み → 突入率');
let bestW = SLOT_CFG.scatterWeight, bestErr = Infinity;
for (const w of [9, 10, 11, 12, 13]) {
  SLOT_CFG.scatterWeight = w;
  const m = measure(N, { mode: 'many' });
  const oneIn = Math.round(1 / m.freq);
  const err = Math.abs(oneIn - 200);
  console.log(`  重み ${w} → 1/${oneIn}   RTP ${(m.rtp * 100).toFixed(1)}%  フリー寄与 ${(m.freeShare * 100).toFixed(0)}%`);
  if (err < bestErr) { bestErr = err; bestW = w; }
}
SLOT_CFG.scatterWeight = bestW;
console.log(`  → 採用: ${bestW}`);

// --- 3) 配当を一律スケールして RTP を目標へ ---
console.log('\n■ 配当スケール → RTP');
const orig = PAY_SYMBOLS.map((s) => [...s.pay]);
const applyScale = (k) => PAY_SYMBOLS.forEach((s, i) => { s.pay = orig[i].map((v) => v * k); });
let k = 1;
for (let it = 0; it < 4; it++) {
  applyScale(k);
  const m = measure(N, { mode: 'many' });
  console.log(`  ×${k.toFixed(3)} → RTP ${(m.rtp * 100).toFixed(2)}%  ヒット率 ${(m.hit * 100).toFixed(1)}%`);
  k *= TARGET_RTP / m.rtp;
}
applyScale(k);

// --- 2) アンティ: 突入率ちょうど2倍(=1.5倍賭けと釣り合う) ---
console.log('\n■ アンティの重み → 突入率2倍 & 損得なし');
const baseRtp = measure(N, { mode: 'many' }).rtp;
const baseFreq = measure(N, { mode: 'many' }).freq;
let bestA = SLOT_CFG.scatterWeightAnte, bestAErr = Infinity;
for (const w of [14, 15, 16, 17, 18]) {
  SLOT_CFG.scatterWeightAnte = w;
  const m = measure(Math.round(N / 2), { ante: true, mode: 'many' });
  const ratio = m.freq / baseFreq;
  const err = Math.abs(m.rtp - baseRtp);
  console.log(`  重み ${w} → 突入率 ${ratio.toFixed(2)}倍   RTP ${(m.rtp * 100).toFixed(2)}%  (基準比 ${((m.rtp-baseRtp)*100).toFixed(2)}pt)`);
  if (err < bestAErr) { bestAErr = err; bestA = w; }
}
SLOT_CFG.scatterWeightAnte = bestA;
console.log(`  → 採用: ${bestA}`);


// --- 最終確認 ---
console.log('\n■ 最終');
for (const mode of FREE_MODES) {
  const m = measure(N, { mode: mode.key });
  console.log(`  ${mode.name.padEnd(6)} RTP ${(m.rtp * 100).toFixed(2)}%  ヒット率 ${(m.hit * 100).toFixed(1)}%  1/${Math.round(1 / m.freq)}  フリー寄与 ${(m.freeShare * 100).toFixed(0)}%  最高 ${m.best.toFixed(0)}x`);
}
const a = measure(Math.round(N / 2), { ante: true, mode: 'many' });
console.log(`  アンティ   RTP ${(a.rtp * 100).toFixed(2)}%  1/${Math.round(1 / a.freq)}`);

console.log('\n■ slot.ts に貼る値');
console.log(`  scatterWeight: ${bestW}, scatterWeightAnte: ${bestA}`);
for (let i = 0; i < PAY_SYMBOLS.length; i++) {
  const s = PAY_SYMBOLS[i];
  const r = (v) => Number(v.toFixed(3));
  console.log(`  ${s.key.padEnd(8)} pay: [${r(s.pay[0])}, ${r(s.pay[1])}, ${r(s.pay[2])}]`);
}
