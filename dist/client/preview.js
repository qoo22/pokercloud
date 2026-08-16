/**
 * カードデザインの確認用ページ
 *
 * 52 枚を一度に並べて眺めるためのもの。
 * 1 枚ずつゲーム中に見ていては「7 のピップ配置だけ違和感がある」といった
 * 細かい崩れに気づけないので、全部並べて確認できる場所を用意しておく。
 */
import { cardFace, cardBack, cardSlot, VISUAL_CSS, showHandBanner, flyChips, confetti, flashAllIn } from './visuals.js';
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUITS = ['♠', '♥', '♦', '♣'];
const style = document.createElement('style');
style.textContent = VISUAL_CSS;
document.head.appendChild(style);
function render() {
    const size = document.getElementById('size').value;
    const grid = SUITS.map((s) => `<div class="row"><div class="rowlabel">${s}</div>${RANKS.map((r) => cardFace(s + r, { size })).join('')}</div>`).join('');
    document.getElementById('grid').innerHTML = grid;
    document.getElementById('extras').innerHTML = `
    <div class="row">
      <div class="rowlabel">裏</div>
      ${cardBack({ size })}${cardBack({ size })}${cardSlot(size)}
      ${cardFace('♠A', { size, highlight: true })}
      ${cardFace('♥K', { size, highlight: true })}
      ${cardFace('♦Q', { size, extra: 'dealing' })}
      ${cardFace('♣J', { size, extra: 'flipping' })}
    </div>`;
    // 実際の卓での見え方（役が成立した 5 枚を光らせた状態）
    document.getElementById('scene').innerHTML = `
    <div class="board">
      ${['♠A', '♠K', '♠Q', '♠J', '♠T'].map((c) => cardFace(c, { size: 'md', highlight: true })).join('')}
    </div>
    <div class="hole">
      ${cardFace('♥2', { size: 'lg' })}${cardFace('♦7', { size: 'lg' })}
    </div>`;
}
document.getElementById('size').addEventListener('change', render);
document.getElementById('theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') ?? 'classic';
    const next = cur === 'classic' ? 'neon' : 'classic';
    document.documentElement.setAttribute('data-theme', next);
    document.getElementById('theme').textContent =
        next === 'classic' ? 'テーマ：クラシック' : 'テーマ：ネオン';
});
document.getElementById('suits').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-suits') ?? 'four';
    const next = cur === 'four' ? 'two' : 'four';
    document.documentElement.setAttribute('data-suits', next);
    document.getElementById('suits').textContent = next === 'four' ? 'スート：4色' : 'スート：赤黒2色';
});
document.getElementById('fx').addEventListener('click', () => {
    const felt = document.getElementById('scene');
    showHandBanner(felt, 'ロイヤルフラッシュ');
    flashAllIn(felt);
    confetti(felt, 80);
    const src = felt.querySelector('.hole');
    if (src)
        flyChips(felt, src, 8);
});
document.documentElement.setAttribute('data-theme', 'classic');
document.documentElement.setAttribute('data-suits', 'four');
render();
//# sourceMappingURL=preview.js.map