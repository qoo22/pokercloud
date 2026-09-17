/**
 * スロットの期待値検証。dist の抽選エンジンをそのまま回すので、
 * 実際に配られる値と同じものを測っている(実装と別式で近似しない)。
 *
 *   node scripts/sim-slot.mjs [スピン数]
 *
 * 見るべき数字:
 *   - RTP(×賭け金)      … これに SLOT_CHIPS_PER_GOLD を掛けたものが「1ゴールドあたりのチップ」
 *   - ヒット率           … 業界の相場は 20〜30%
 *   - フリーゲーム突入率 … 相場は 1/150〜1/300
 *   - 最大配当の分布     … Max Win 5000x に届くのは極稀でよい
 */
import { spin, MAX_WIN_X, FREE_MODES } from '../dist/src/server/slot.js';

const N = Number(process.argv[2] ?? 300_000);

/** 再現性のある線形合同法。実運用は Math.random だが、比較のため固定シードで回す */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 複数シードで回して平均を返す。
 * **1シードだけだと数pt単位でぶれる**(フリーゲームの寄与が大きく分散が高いため)。
 * 実際、第76弾で1シード30万スピンが 106% を示したが、10シードの平均は 99.98% だった。
 */
const SEEDS = [20260822, 11, 22, 33, 44, 55, 66, 77];

function run(label, opts, n) {
  const per = SEEDS.map((sd) => runOne(opts, Math.max(1, Math.round(n / SEEDS.length)), sd));
  const mean = (f) => per.reduce((a, b) => a + f(b), 0) / per.length;
  const rtps = per.map((p) => p.rtp);
  const spread = Math.max(...rtps) - Math.min(...rtps);
  const rtp = mean((p) => p.rtp);
  console.log(`\n[${label}] ${n.toLocaleString()} スピン (${SEEDS.length} シードの平均)`);
  console.log(`  RTP           ${(rtp * 100).toFixed(2)}%   (通常時 ${(mean((p) => p.basePay) * 100).toFixed(1)}% / フリー ${(mean((p) => p.freePay) * 100).toFixed(1)}%)`);
  console.log(`  シード間のぶれ ${(spread * 100).toFixed(1)}pt   [${rtps.map((v) => (v * 100).toFixed(0)).join(', ')}]`);
  console.log(`  ヒット率      ${(mean((p) => p.hit) * 100).toFixed(1)}%`);
  console.log(`  フリー突入    1/${Math.round(1 / mean((p) => p.freq))}`);
  console.log(`  最高配当      ${Math.max(...per.map((p) => p.best)).toFixed(1)}x   / MaxWin(${MAX_WIN_X}x) 到達 ${per.reduce((a, b) => a + b.cap, 0)} 回`);
  return rtp;
}

function runOne(opts, n, seed) {
  const rnd = makeRng(seed);
  let sum = 0, hits = 0, free = 0, maxWinHits = 0, best = 0;
  let freePay = 0, basePay = 0;
  const buckets = { '0': 0, '0-1': 0, '1-5': 0, '5-20': 0, '20-100': 0, '100-500': 0, '500+': 0 };
  for (let i = 0; i < n; i++) {
    const r = spin(rnd, opts);
    const x = r.totalPayX;
    sum += x;
    basePay += r.basePayX;
    freePay += r.free?.payX ?? 0;
    if (x > 0) hits++;
    if (r.freeEntered) free++;
    if (r.maxWin) maxWinHits++;
    if (x > best) best = x;
    if (x === 0) buckets['0']++;
    else if (x < 1) buckets['0-1']++;
    else if (x < 5) buckets['1-5']++;
    else if (x < 20) buckets['5-20']++;
    else if (x < 100) buckets['20-100']++;
    else if (x < 500) buckets['100-500']++;
    else buckets['500+']++;
  }
  // アンティは賭け金が1.5倍なので、RTPは「支払った額」で割る
  const cost = opts.ante ? 1.5 : 1;
  return {
    rtp: sum / (n * cost),
    basePay: basePay / n / cost,
    freePay: freePay / n / cost,
    hit: hits / n,
    freq: free / n,
    best,
    cap: maxWinHits,
  };
}

console.log('=== ゴールドスロット 期待値検証 ===');
const base = run('通常(モード:回数多め)', { mode: 'many' }, N);
const few = run('通常(モード:一撃高倍率)', { mode: 'few' }, N);
const ante = run('アンティベット(1.5倍賭け)', { ante: true, mode: 'many' }, Math.round(N / 2));

console.log('\n--- 判定 ---');
const modeGap = Math.abs(base - few) / base;
console.log(`モード間のRTP差   ${(modeGap * 100).toFixed(1)}%  ${modeGap < 0.05 ? '✓ ほぼ等価(選択は演出として健全)' : '✗ 偏りすぎ'}`);
const anteGap = Math.abs(ante - base) / base;
console.log(`アンティのRTP差   ${(anteGap * 100).toFixed(1)}%  ${anteGap < 0.06 ? '✓ 許容' : '✗ 偏りすぎ'}`);

// 現行の蛇口(1ゴールド=14,076チップ)を保つための換算値を出す
const TARGET_CHIPS_PER_GOLD = 14_076;
console.log(`\n現行の蛇口を保つ SLOT_CHIPS_PER_GOLD = ${Math.round(TARGET_CHIPS_PER_GOLD / base)}`);
console.log(`  (この値なら 1ゴールドあたりの期待払い出しが ${TARGET_CHIPS_PER_GOLD.toLocaleString()} チップのまま)`);
