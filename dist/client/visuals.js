/**
 * カードの見た目と演出
 *
 * カードの表（52枚）は SVG、裏面とフェルトは画像です。
 *
 * なぜカードの表を画像にしないのか：
 *   1. カードは 52 枚が一貫している必要がある。AI 生成や手描き素材だと
 *      ランクごとに微妙に太さや位置がずれ、並べたときに必ず気づかれる。
 *   2. 拡大縮小で崩れない。同じ卓でも自分の手札は大きく、相手の手札は小さく出したい。
 *   3. テーマ（クラシック / ネオン）を CSS 変数だけで切り替えられる。
 *      画像だと 2 セット用意することになり、追加のたびに枚数が倍々で増える。
 *   4. 外部ファイルが増えないので、単一 HTML のまま配布できる。
 *
 * 逆に裏面とフェルトは 1 枚あれば足り、模様の細かさが質感に直結するので画像にしています
 * （生成画像を縮小して data URI で埋め込み、3 枚で 44KB）。
 *
 * ピップ（スート記号）の配置は実際のトランプの配置に合わせてあります。
 * ここを適当な等間隔にすると「なんとなく安っぽい」印象になり、
 * しかも理由が言語化されにくいので直しづらいバグになります。
 */
import { CARD_BACK_CLASSIC, CARD_BACK_NEON, FELT_TEXTURE } from './assets.js';
// ---------------------------------------------------------------------------
// スートの形
// ---------------------------------------------------------------------------
/** 100x100 のビューボックスに収まるスート図形 */
const SUIT_SHAPES = {
    '♠': `<path d="M50 6 C50 6 91 35 91 58 C91 72 80 81 68 81 C60 81 54 77 50 71 C46 77 40 81 32 81 C20 81 9 72 9 58 C9 35 50 6 50 6 Z"/>
        <path d="M43 64 C43 78 37 90 28 97 L72 97 C63 90 57 78 57 64 Z"/>`,
    '♥': `<path d="M50 93 C50 93 7 62 7 35 C7 19 19 9 32 9 C41 9 47 13 50 20 C53 13 59 9 68 9 C81 9 93 19 93 35 C93 62 50 93 50 93 Z"/>`,
    '♦': `<path d="M50 4 L88 50 L50 96 L12 50 Z"/>`,
    '♣': `<circle cx="50" cy="27" r="20"/><circle cx="25" cy="58" r="20"/><circle cx="75" cy="58" r="20"/>
        <path d="M43 62 C43 77 37 90 28 97 L72 97 C63 90 57 77 57 62 Z"/>`,
};
/** スートごとの色クラス。色覚特性に配慮して 4 色に分ける（設定で 2 色にも戻せる） */
export const SUIT_KEY = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
// ---------------------------------------------------------------------------
// カードの寸法
// ---------------------------------------------------------------------------
/**
 * カードの各要素の寸法。すべてカード幅（--cw）に対する比率です。
 *
 * ここを数値として持っているのは、CSS をこの値から組み立てたうえで、
 * **同じ値を使って「角の指数とピップが重なっていないか」をテストで検算する**ためです。
 * CSS に直接数字を書くと、少し変えただけで重なりが復活しても誰も気づけません。
 * 実際、最初の版は指数が大きすぎてピップと重なっていました。
 *
 * 角の指数は本物のトランプではカード幅の 1 割ほどしかありませんが、
 * 画面上の 50px 前後のカードでそれをやると読めないので、
 * 読める大きさまで拡大したうえで、ピップの領域を内側に寄せて衝突を避けています。
 */
export const CARD_METRICS = {
    /** 高さ / 幅。実物のトランプ（63×88mm）とほぼ同じ */
    aspect: 1.4,
    /** 角の指数の位置 */
    idxTop: 0.05,
    idxLeft: 0.06,
    /** 数字の大きさ */
    idxFont: 0.28,
    /** 「10」だけは 2 文字ぶん横に広がるので、その場合は縮める */
    idxWideScale: 0.58,
    /** 数字とスート記号の間隔 */
    idxGap: 0.02,
    /** 指数に添えるスート記号（小さすぎて見えなかったので拡大。横幅は数字側が支配的なので隙間には影響しない） */
    idxSuit: 0.17,
    /**
     * ピップを並べる領域の余白（左右／上下）。
     * 角の指数を避けようとしてここを広げすぎると、今度は列の間隔が詰まって
     * ピップ同士がぶつかります。避けるのは領域ではなく指数を小さくする側で、
     * 本物のトランプもそうなっています
     */
    fieldX: 0.14,
    fieldY: 0.22,
    /**
     * ピップ 1 個の大きさ。
     * 中央の列（0.5）と両脇の列（0.28 / 0.72）の間隔より小さくないと、
     * 7 や 9 のように列をまたぐ配置で重なります
     */
    pipW: 0.14,
    /** 指数とピップの間に最低限空けたい距離 */
    minGap: 0.02,
};
/**
 * 文字の横幅の見積もり（フォントサイズに対する比率）。
 * 正確な値はフォントに依るので、太字の数字として安全側に大きめを取っている。
 */
export const GLYPH_WIDTH = { single: 0.68, double: 1.15 };
/** 角の指数が占める矩形（カード幅を 1 とした座標） */
export function indexBox(rank) {
    const m = CARD_METRICS;
    const wide = rank.length > 1;
    const font = wide ? m.idxFont * m.idxWideScale : m.idxFont;
    const textW = font * (wide ? GLYPH_WIDTH.double : GLYPH_WIDTH.single);
    const w = Math.max(textW, m.idxSuit);
    return {
        x0: m.idxLeft,
        y0: m.idxTop,
        x1: m.idxLeft + w,
        y1: m.idxTop + font + m.idxGap + m.idxSuit,
    };
}
/** ピップ 1 個が占める矩形（カード幅を 1 とした座標） */
export function pipBox(x, y) {
    const m = CARD_METRICS;
    const fieldW = 1 - m.fieldX * 2;
    const fieldH = m.aspect - m.fieldY * 2;
    const cx = m.fieldX + x * fieldW;
    const cy = m.fieldY + y * fieldH;
    const h = m.pipW; // ピップは正方形
    return { x0: cx - m.pipW / 2, y0: cy - h / 2, x1: cx + m.pipW / 2, y1: cy + h / 2 };
}
// ---------------------------------------------------------------------------
// ピップ配置
// ---------------------------------------------------------------------------
/**
 * 実際のトランプのピップ配置。x は 0〜1（左右）、y は 0〜1（上下）。
 * y > 0.5 のピップは 180 度回転させる（本物のカードと同じ）。
 */
export const PIP_LAYOUT = {
    2: [[0.5, 0.14], [0.5, 0.86]],
    3: [[0.5, 0.14], [0.5, 0.5], [0.5, 0.86]],
    4: [[0.28, 0.14], [0.72, 0.14], [0.28, 0.86], [0.72, 0.86]],
    5: [[0.28, 0.14], [0.72, 0.14], [0.5, 0.5], [0.28, 0.86], [0.72, 0.86]],
    6: [[0.28, 0.14], [0.72, 0.14], [0.28, 0.5], [0.72, 0.5], [0.28, 0.86], [0.72, 0.86]],
    7: [[0.28, 0.14], [0.72, 0.14], [0.5, 0.32], [0.28, 0.5], [0.72, 0.5], [0.28, 0.86], [0.72, 0.86]],
    8: [
        [0.28, 0.14], [0.72, 0.14], [0.5, 0.32], [0.28, 0.5], [0.72, 0.5],
        [0.5, 0.68], [0.28, 0.86], [0.72, 0.86],
    ],
    9: [
        [0.28, 0.14], [0.72, 0.14], [0.28, 0.38], [0.72, 0.38], [0.5, 0.5],
        [0.28, 0.62], [0.72, 0.62], [0.28, 0.86], [0.72, 0.86],
    ],
    10: [
        [0.28, 0.14], [0.72, 0.14], [0.5, 0.26], [0.28, 0.38], [0.72, 0.38],
        [0.28, 0.62], [0.72, 0.62], [0.5, 0.74], [0.28, 0.86], [0.72, 0.86],
    ],
};
const RANK_VALUE = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10,
};
// ---------------------------------------------------------------------------
// 絵札の意匠
// ---------------------------------------------------------------------------
/**
 * J / Q / K の中身。
 *
 * 伝統的な人物画を SVG で描き起こすのは現実的ではなく、
 * 中途半端に真似ると「下手な模写」に見えてしまう。
 * そこで狙いを変え、点対称の紋章パネル（王冠・ティアラ・羽根）にしている。
 * これなら意図した意匠に見えるし、テーマの色替えにもそのまま追従する。
 */
const COURT_MOTIF = {
    // 王冠
    K: `<path d="M22 62 L16 30 L32 42 L50 20 L68 42 L84 30 L78 62 Z" />
      <rect x="20" y="64" width="60" height="10" rx="3" />
      <circle cx="50" cy="16" r="5" /><circle cx="16" cy="26" r="4" /><circle cx="84" cy="26" r="4" />`,
    // ティアラ
    Q: `<path d="M24 64 C24 42 34 26 50 26 C66 26 76 42 76 64 Z" />
      <path d="M50 20 L56 30 L50 34 L44 30 Z" />
      <rect x="22" y="66" width="56" height="9" rx="4" />
      <circle cx="34" cy="46" r="4" /><circle cx="66" cy="46" r="4" /><circle cx="50" cy="42" r="5" />`,
    // 羽根飾り
    J: `<path d="M50 16 C36 30 30 48 32 72 C42 66 50 54 50 40 C50 54 58 66 68 72 C70 48 64 30 50 16 Z" />
      <rect x="30" y="74" width="40" height="8" rx="4" />`,
};
const suitSvg = (suit, cls) => `<svg class="pip ${cls}" viewBox="0 0 100 100" aria-hidden="true">${SUIT_SHAPES[suit] ?? ''}</svg>`;
/**
 * 表向きのカード。code は "♠A" のような「スート記号 + ランク」。
 * サーバーから届く表記をそのまま受け取れるようにしてある。
 */
export function cardFace(code, opts = {}) {
    const suit = code[0];
    const rank = code.slice(1);
    // 角の表示は「T」ではなく「10」。カジュアル層には T が 10 と伝わりにくいので
    const rankLabel = rank === 'T' ? '10' : rank;
    const key = SUIT_KEY[suit] ?? 's';
    const size = opts.size ?? 'md';
    const cls = `card face ${size} suit-${key}${opts.highlight ? ' win' : ''}${opts.extra ? ` ${opts.extra}` : ''}`;
    // 2 文字のランク（"10" 表記）は角で横に広がり、ピップとぶつかるので縮める
    const wide = rankLabel.length > 1 ? ' class="wide"' : '';
    const corner = `<span class="idx"><b${wide}>${rankLabel}</b>${suitSvg(suit, 'ci')}</span>`;
    let center;
    if (rank === 'A') {
        // エースは大きな 1 個。カードの主役なので堂々と真ん中に置く
        center = `<div class="center ace">${suitSvg(suit, 'big')}</div>`;
    }
    else if (size === 'sm' && rank in RANK_VALUE) {
        // 32px のカードにピップを 10 個並べても黒い塊にしかならない。
        // 相手の手札は「何のカードか」が分かれば十分なので、スート 1 個で表す
        center = `<div class="center solo">${suitSvg(suit, 'big')}</div>`;
    }
    else if (rank in RANK_VALUE) {
        const pips = PIP_LAYOUT[RANK_VALUE[rank]] ?? [];
        center = `<div class="center pips">${pips
            .map(([x, y]) => `<span class="p" style="left:${x * 100}%;top:${y * 100}%${y > 0.5 ? ';transform:translate(-50%,-50%) rotate(180deg)' : ''}">${suitSvg(suit, 'sm')}</span>`)
            .join('')}</div>`;
    }
    else {
        // 絵札
        center = `<div class="center court">
        <svg viewBox="0 0 100 100" class="motif" aria-hidden="true">${COURT_MOTIF[rank] ?? ''}</svg>
        <span class="letter">${rank}</span>
      </div>`;
    }
    return `<div class="${cls}" data-card="${code}">
    <div class="paper">
      ${corner}
      ${center}
      <span class="idx bot"><b${wide}>${rankLabel}</b>${suitSvg(suit, 'ci')}</span>
    </div>
  </div>`;
}
/**
 * 裏向きのカード。
 * 幾何学模様を SVG で組み立てているので、テーマの色をそのまま受け取れる。
 */
export function cardBack(opts = {}) {
    const size = opts.size ?? 'md';
    // 模様は画像（テーマごとに CSS 変数で差し替わる）。
    // ここに data-card のような情報を絶対に入れないこと。DOM を覗くだけで手札が読めてしまう
    return `<div class="card back ${size}${opts.extra ? ` ${opts.extra}` : ''}">
    <div class="paper"><div class="backart" aria-hidden="true"></div></div>
  </div>`;
}
/** 空きスロット（まだ配られていないボード） */
export function cardSlot(size = 'md') {
    return `<div class="card slot ${size}"><div class="paper"></div></div>`;
}
// ---------------------------------------------------------------------------
// スタイル
// ---------------------------------------------------------------------------
/**
 * テーマは CSS 変数だけで切り替える。
 * ルート要素の data-theme を書き換えれば、カードも卓もまとめて変わる。
 */
const M = CARD_METRICS;
const round = (n) => Number(n.toFixed(4));
export const VISUAL_CSS = `
:root, [data-theme="classic"] {
  --card-back-img: url("${CARD_BACK_CLASSIC}");
  --felt-tex: url("${FELT_TEXTURE}");
  --felt-a:#1d6b4f; --felt-b:#10432f; --felt-c:#07261a;
  --rail:#2a1a0e; --rail-hi:#5a3a1c;
  --card-paper:#fbfaf6; --card-edge:#d8d2c2;
  --card-s:#1a1c22; --card-h:#c62233; --card-d:#1666c4; --card-c:#1e7a3c;
  --back-1:#8e1c26; --back-2:#a92a34; --back-line:#e6c98a; --back-frame:#e8cf9a;
  --glow:#d9b45f; --winglow:#ffd76a;
  --banner-a:#d9b45f; --banner-b:#8a6a22;
}
[data-theme="neon"] {
  --card-back-img: url("${CARD_BACK_NEON}");
  --felt-a:#141a3a; --felt-b:#0a0e22; --felt-c:#05070f;
  --rail:#0d1020; --rail-hi:#2a3a7a;
  --card-paper:#0f1420; --card-edge:#2b3a5c;
  --card-s:#8fe9ff; --card-h:#ff5f8d; --card-d:#8f7bff; --card-c:#5cff9d;
  --back-1:#101a3a; --back-2:#16255c; --back-line:#3ad1ff; --back-frame:#3ad1ff;
  --glow:#3ad1ff; --winglow:#7cf3ff;
  --banner-a:#3ad1ff; --banner-b:#7b3aff;
}

/* ---- カード本体 ---- */
.card { position:relative; flex:0 0 auto; perspective:600px; }
.card .paper {
  width:100%; height:100%; border-radius:calc(var(--cw) * 0.09);
  background:var(--card-paper);
  border:1px solid var(--card-edge);
  box-shadow:0 2px 6px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.5);
  position:relative; overflow:hidden;
  display:block;
}
[data-theme="neon"] .card .paper {
  box-shadow:0 2px 10px rgba(0,0,0,.6), inset 0 0 0 1px rgba(120,200,255,.18);
}

.card.sm { --cw:32px; width:32px; height:45px; }
.card.md { --cw:52px; width:52px; height:73px; }
.card.lg { --cw:72px; width:72px; height:101px; }
@media (max-width:640px){ .card.lg { --cw:58px; width:58px; height:81px; } }

/* スートの色 */
.suit-s { --ink:var(--card-s); }
.suit-h { --ink:var(--card-h); }
.suit-d { --ink:var(--card-d); }
.suit-c { --ink:var(--card-c); }
/* 2色モード（設定で切替）：赤黒の伝統的な配色に戻す */
[data-suits="two"] .suit-d { --ink:var(--card-h); }
[data-suits="two"] .suit-c { --ink:var(--card-s); }

.card .pip { fill:var(--ink); display:block; }

/* コーナーの指数 */
/* 数値はすべて CARD_METRICS から生成している。直接書き換えないこと（テストが検算している） */
.card .idx {
  position:absolute; top:calc(var(--cw) * ${M.idxTop}); left:calc(var(--cw) * ${M.idxLeft});
  display:flex; flex-direction:column; align-items:center; line-height:1;
  color:var(--ink); font-weight:800; font-variant-numeric:tabular-nums;
}
.card .idx b { font-size:calc(var(--cw) * ${M.idxFont}); letter-spacing:-0.04em; }
/* 「10」は 2 文字ぶん横に広がるので、縮めてピップの領域に食い込ませない */
.card .idx b.wide { font-size:calc(var(--cw) * ${round(M.idxFont * M.idxWideScale)}); }
.card .idx .ci {
  width:calc(var(--cw) * ${M.idxSuit}); height:calc(var(--cw) * ${M.idxSuit});
  margin-top:calc(var(--cw) * ${M.idxGap});
}
.card .idx.bot {
  top:auto; left:auto;
  bottom:calc(var(--cw) * ${M.idxTop}); right:calc(var(--cw) * ${M.idxLeft});
  transform:rotate(180deg);
}
/* 小さいカードでは下の指数を省く。潰れて汚くなるだけなので */
.card.sm .idx.bot { display:none; }

/* 中央 */
/* ページ側のレイアウトに汎用 .center（position/left/top/transform/width を張る。
   例: client/index.html, solo/index.html）があり、クラス名が衝突する。inset より詳細度が
   低いので top/left は勝てるが、transform と width は打ち消さないと漏れてきて、中身が左上へ
   ずれて潰れる。ここで無効化しておく（絵札の .center.court などにも効く）。 */
.card .center {
  position:absolute;
  inset:calc(var(--cw) * ${M.fieldY}) calc(var(--cw) * ${M.fieldX});
  transform:none; width:auto; text-align:initial;
}
.card .center.pips .p { position:absolute; transform:translate(-50%,-50%); }
.card .center.pips .p .pip { width:calc(var(--cw) * ${M.pipW}); height:calc(var(--cw) * ${M.pipW}); }

/* 小さいカードにピップを 10 個並べても潰れて読めないので、スート 1 個で表す */
.card .center.solo { display:flex; align-items:center; justify-content:center; }
.card .center.solo .pip { width:calc(var(--cw) * 0.42); height:calc(var(--cw) * 0.42); }

.card .center.ace { display:flex; align-items:center; justify-content:center; }
.card .center.ace .pip { width:calc(var(--cw) * 0.46); height:calc(var(--cw) * 0.46); }

.card .center.court { display:flex; align-items:center; justify-content:center; position:absolute;
  inset:calc(var(--cw) * 0.24) calc(var(--cw) * 0.2); }
.card .center.court::before {
  content:''; position:absolute; inset:0; border-radius:calc(var(--cw) * 0.06);
  border:1px solid color-mix(in srgb, var(--ink) 35%, transparent);
  background:linear-gradient(160deg, color-mix(in srgb, var(--ink) 9%, transparent), transparent 60%);
}
.card .center.court .motif { position:absolute; width:70%; height:70%; fill:color-mix(in srgb, var(--ink) 22%, transparent); }
.card .center.court .letter {
  position:relative; font-size:calc(var(--cw) * 0.46); font-weight:800; color:var(--ink);
  font-family:Georgia,"Times New Roman",serif;
}
.card.sm .center.court .letter { font-size:calc(var(--cw) * 0.5); }

/* 裏面：模様は画像。テーマ変数で差し替わる */
.card.back .paper { background:var(--back-1); }
.card .backart {
  width:100%; height:100%; display:block;
  background-image:var(--card-back-img);
  background-size:cover; background-position:center;
  border-radius:inherit;
}
[data-theme="neon"] .card.back .paper { box-shadow:0 2px 10px rgba(0,0,0,.6), 0 0 0 1px rgba(58,209,255,.35); }

/* フェルト：生地のテクスチャをテーマ色で染めて敷く。
   平坦なグラデーションだけだと「布」に見えず、卓全体が安っぽくなる */
.felt, .scene {
  background-image:
    radial-gradient(ellipse at 50% 40%, rgba(255,255,255,.13), rgba(255,255,255,0) 58%),
    linear-gradient(180deg,
      color-mix(in srgb, var(--felt-a) 74%, transparent),
      color-mix(in srgb, var(--felt-b) 86%, transparent) 62%,
      color-mix(in srgb, var(--felt-c) 94%, transparent)),
    var(--felt-tex);
  background-size: cover, cover, 190px 190px;
  background-repeat: no-repeat, no-repeat, repeat;
  background-blend-mode: screen, normal, normal;
}

/* 空きスロット */
.card.slot .paper { background:rgba(255,255,255,.04); border:1px dashed rgba(255,255,255,.18); box-shadow:none; }

/* ---- 演出 ---- */

/* 配布：ディーラー位置から飛んでくる */
@keyframes dealIn {
  from { opacity:0; transform:translate(var(--dx,0), var(--dy,-140px)) rotate(var(--dr,-25deg)) scale(.75); }
  to   { opacity:1; transform:translate(0,0) rotate(0) scale(1); }
}
.card.dealing { animation:dealIn .34s cubic-bezier(.2,.9,.3,1) backwards; }

/* めくり：3D で回す。裏返す瞬間に中身が入れ替わる */
@keyframes flipIn {
  from { transform:rotateY(90deg) scale(.9); opacity:.4; }
  to   { transform:rotateY(0) scale(1); opacity:1; }
}
.card.flipping .paper { animation:flipIn .28s ease-out backwards; transform-style:preserve-3d; }

/* 役を構成した札を光らせる */
.card.win .paper {
  box-shadow:0 0 0 2px var(--winglow), 0 0 16px 2px color-mix(in srgb, var(--winglow) 60%, transparent);
  animation:winPulse 1.1s ease-in-out infinite;
}
@keyframes winPulse {
  0%,100% { transform:translateY(0); }
  50%     { transform:translateY(-3px); }
}
/* 負けた側の札は沈める。勝ち札を目立たせるには、周りを暗くするのが一番効く */
.showdown .card.dim .paper { filter:brightness(.55) saturate(.6); }

/* 役名バナー */
.hand-banner {
  position:absolute; left:50%; top:46%; transform:translate(-50%,-50%);
  padding:8px 26px; border-radius:99px; z-index:20; pointer-events:none;
  background:linear-gradient(135deg, var(--banner-a), var(--banner-b));
  color:#1a1206; font-weight:800; letter-spacing:.06em; white-space:nowrap;
  box-shadow:0 6px 24px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.5);
  animation:bannerIn .4s cubic-bezier(.2,1.4,.4,1) both, bannerOut .4s ease-in 2.4s both;
  font-size:15px;
}
[data-theme="neon"] .hand-banner { color:#04101c; }
@keyframes bannerIn { from { opacity:0; transform:translate(-50%,-50%) scale(.6); } to { opacity:1; transform:translate(-50%,-50%) scale(1); } }
@keyframes bannerOut { to { opacity:0; transform:translate(-50%,-70%) scale(.95); } }

/* オールイン */
.allin-flash {
  position:absolute; inset:0; z-index:15; pointer-events:none;
  background:radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--glow) 35%, transparent), transparent 60%);
  animation:allinFlash .8s ease-out forwards;
}
@keyframes allinFlash { from { opacity:0; } 30% { opacity:1; } to { opacity:0; } }

/* チップがポットへ飛ぶ */
.chip-fly {
  position:absolute; width:16px; height:16px; border-radius:50%; z-index:12; pointer-events:none;
  background:radial-gradient(circle at 35% 30%, #fff6d8, var(--glow) 55%, #7a5a18);
  box-shadow:0 2px 5px rgba(0,0,0,.5);
  animation:chipFly .5s cubic-bezier(.4,.1,.6,1) forwards;
}
@keyframes chipFly {
  from { transform:translate(0,0) scale(1); opacity:1; }
  to   { transform:translate(var(--tx), var(--ty)) scale(.6); opacity:0; }
}

/* 紙吹雪（ロイヤル／大勝利のときだけ） */
.confetti { position:absolute; inset:0; overflow:hidden; z-index:18; pointer-events:none; }
.confetti i {
  position:absolute; top:-12px; width:7px; height:12px; opacity:.95;
  animation:fall linear forwards;
}
@keyframes fall {
  to { transform:translateY(115%) rotate(var(--spin,540deg)); opacity:.1; }
}

/* ポット額のカウントアップ */
.pot b { transition:none; }
.pot.bump b { animation:potBump .35s ease-out; }
@keyframes potBump { 0% { transform:scale(1); } 40% { transform:scale(1.25); color:var(--winglow); } 100% { transform:scale(1); } }

/* 手番のリング */
@keyframes actingRing { 0%,100% { box-shadow:0 0 0 2px var(--glow), 0 0 14px rgba(217,180,95,.3); } 50% { box-shadow:0 0 0 2px var(--glow), 0 0 26px rgba(217,180,95,.55); } }
.seat.acting .box { animation:actingRing 1.4s ease-in-out infinite; }

/* 動きを減らす設定を尊重する。ここを無視すると、酔う人が確実に出る */
@media (prefers-reduced-motion: reduce) {
  .card.dealing, .card.flipping .paper, .card.win .paper,
  .hand-banner, .allin-flash, .chip-fly, .confetti i, .seat.acting .box {
    animation:none !important;
  }
}
`;
// ---------------------------------------------------------------------------
// 演出のヘルパー
// ---------------------------------------------------------------------------
/** 役名バナーを出す */
export function showHandBanner(container, text) {
    const el = document.createElement('div');
    el.className = 'hand-banner';
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}
/** オールインの閃光 */
export function flashAllIn(container) {
    const el = document.createElement('div');
    el.className = 'allin-flash';
    container.appendChild(el);
    setTimeout(() => el.remove(), 900);
}
/**
 * チップがポットへ飛ぶ演出。
 * 実座標を測ってから飛ばすので、席数やレイアウトが変わっても追従する。
 */
export function flyChips(container, from, count = 5) {
    const box = container.getBoundingClientRect();
    const src = from.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height * 0.4;
    for (let i = 0; i < count; i++) {
        const chip = document.createElement('div');
        chip.className = 'chip-fly';
        const jx = (Math.random() - 0.5) * 26;
        const jy = (Math.random() - 0.5) * 20;
        chip.style.left = `${src.left - box.left + src.width / 2 + jx}px`;
        chip.style.top = `${src.top - box.top + src.height / 2 + jy}px`;
        chip.style.setProperty('--tx', `${cx - src.left - src.width / 2 - jx}px`);
        chip.style.setProperty('--ty', `${cy - src.top - src.height / 2 - jy}px`);
        chip.style.animationDelay = `${i * 45}ms`;
        container.appendChild(chip);
        setTimeout(() => chip.remove(), 900 + i * 45);
    }
}
/** 紙吹雪。大きな勝ちのときだけに絞る（毎回出すと価値が無くなる） */
export function confetti(container, pieces = 60) {
    const wrap = document.createElement('div');
    wrap.className = 'confetti';
    const colors = ['#d9b45f', '#e8534f', '#4dbd7a', '#5a9de0', '#ffffff'];
    for (let i = 0; i < pieces; i++) {
        const p = document.createElement('i');
        p.style.left = `${Math.random() * 100}%`;
        p.style.background = colors[i % colors.length];
        p.style.animationDuration = `${1.4 + Math.random() * 1.2}s`;
        p.style.animationDelay = `${Math.random() * 0.4}s`;
        p.style.setProperty('--spin', `${360 + Math.random() * 720}deg`);
        wrap.appendChild(p);
    }
    container.appendChild(wrap);
    setTimeout(() => wrap.remove(), 3200);
}
/** ポット額の増加を強調する */
export function bumpPot(potEl) {
    potEl.classList.remove('bump');
    void potEl.offsetWidth; // リフローを挟まないとアニメーションが再生されない
    potEl.classList.add('bump');
}
//# sourceMappingURL=visuals.js.map