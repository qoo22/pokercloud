/** パッチ適用後のリッチ版クライアントの静的検証 */
import { readFileSync, existsSync } from 'node:fs';
const dir = decodeURIComponent(new URL('.', import.meta.url).pathname);
// 置き場所は環境で変わる(第170弾)。ローカルの作業場では隣、リポジトリでは public/。
// どこで動かしても同じコマンドで通るよう、順に探して最初に見つかったものを読む
const cands = [dir + 'poker-client.html', dir + 'public/poker-client.html', dir + 'docs/poker-client.html'];
const found = cands.find((c) => existsSync(c));
if (!found) {
  console.error('poker-client.html が見つかりません:\n  ' + cands.join('\n  '));
  process.exit(1);
}
const s = readFileSync(found, 'utf8');

let ok = true;
const check = (label, cond) => { console.log((cond ? '✓' : '✗') + ' ' + label); if (!cond) ok = false; };

// 構文
const scripts = [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
for (let i = 0; i < scripts.length; i++) {
  let e = null;
  try { new Function(scripts[i]); } catch (err) { e = err; }
  check(`script#${i} 構文 (${(scripts[i].length / 1024).toFixed(0)}KB)`, !e);
  if (e) console.log('   →', e.message);
}

// 画像が全て残っているか(第42弾時点100枚+第43弾スロット8枚)
// 第58弾でワイルド/スキャッターを足して110枚。再生成品(画像3枚程度)との判別が目的なので
// 「90枚以上あること」を条件にし、枚数の増減で落ちないようにする
check('AI画像が残存(90枚以上)', (s.match(/data:image\//g) || []).length >= 90);
check('スロット画像が埋め込まれている', s.includes('SLOT_IMG = {') && s.includes('SLOT_MARQUEE ='));

// 配置: パス見出しはショップとプロフィールに1つずつ
const shop = s.indexOf('function renderShop');
const prof = s.indexOf('function renderProfile');
const heading = 'html += `<div class="sec"><h3>\\u30C1\\u30E3\\u30EC\\u30F3\\u30B8\\u30D1\\u30B9';
const h1 = s.indexOf(heading);
const h2 = s.indexOf(heading, h1 + 1);
const h3 = h2 >= 0 ? s.indexOf(heading, h2 + 1) : -1;
check('パス見出しが2箇所(ショップ+プロフィール)', h1 >= 0 && h2 >= 0 && h3 < 0);
check('1つ目はショップ内', h1 > shop && h1 < prof);
check('2つ目はプロフィール内', h2 > prof);
check('ウィークリーはプロフィール側', s.indexOf('\\u30A6\\u30A3\\u30FC\\u30AF\\u30EA\\u30FC\\u30DF\\u30C3\\u30B7\\u30E7\\u30F3') > prof);

// 新機能の存在
check('スロットタブ', s.includes('data-tab="slot"'));
check('スロット送信', s.includes('t: "slot.spin"'));
check('スロット受信', s.includes('case "slot.info"'));
check('警告音 warn30/warn15/timeTick', s.includes('case "warn30"') && s.includes('case "warn15"') && s.includes('case "timeTick"'));
check('カウントダウンが actionTotalMs 参照', s.includes('state.actionTotalMs || state.baseActionMs'));
check('タイマー残量色CSS', s.includes('.timer[data-level="crit"]'));
check('パス購入ボタン(価格つき)', s.includes('data-buy="pass_premium" data-price="980"'));
check('完走ボーナス箱表示', s.includes('boxesEarned'));
check('購入プレビュー表示', s.includes('pv.preview'));

// リッチ版の既存機能が壊れていないか(代表)
check('ディーラー配列', s.includes('DEALERS_DEAL'));
check('チェックアウト', s.includes('function startCheckout'));
check('FABドロワー', s.includes('fab-info'));
check('縦スライダー', s.includes('vsl-wrap') || s.includes('vsl-thumb') || s.includes('.vsl'));

console.log(ok ? '\nすべて通過' : '\n失敗あり');
process.exit(ok ? 0 : 1);
