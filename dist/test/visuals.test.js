/**
 * カード描画の検証
 *
 * 見た目のテストは「ピクセルが合っているか」ではなく、
 * 「構造として正しいか」を見るのが実用的。
 * ピップの数や指数の文字はコードから決まるので、ここが崩れていれば必ず表示も崩れている。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cardFace, cardBack, cardSlot, VISUAL_CSS, SUIT_KEY, CARD_METRICS, PIP_LAYOUT, indexBox, pipBox, } from '../client/visuals.js';
import { CARD_BACK_CLASSIC, CARD_BACK_NEON, FELT_TEXTURE } from '../client/assets.js';
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
/** 中央に置かれたピップの数を数える（コーナーの指数は除く） */
const countCenterPips = (html) => (html.match(/class="p"/g) ?? []).length;
describe('カード面の構造', () => {
    test('52 枚すべてが生成でき、空の出力にならない', () => {
        for (const s of SUITS) {
            for (const r of RANKS) {
                const html = cardFace(s + r);
                assert.ok(html.length > 200, `${s}${r} の出力が短すぎる`);
                assert.ok(html.includes(`data-card="${s}${r}"`), `${s}${r} のデータ属性が無い`);
            }
        }
    });
    test('ピップの数がランクと一致する', () => {
        const expected = {
            '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10,
        };
        for (const s of SUITS) {
            for (const [rank, n] of Object.entries(expected)) {
                const got = countCenterPips(cardFace(s + rank));
                assert.equal(got, n, `${s}${rank} のピップが ${got} 個（期待 ${n} 個）`);
            }
        }
    });
    test('エースは大きなピップ 1 個で、格子には並べない', () => {
        const html = cardFace('♠A');
        assert.equal(countCenterPips(html), 0, 'エースが格子配置になっている');
        assert.ok(html.includes('center ace'), 'エース専用の中央レイアウトになっていない');
        assert.ok(html.includes('class="pip big"'), '大きなピップが使われていない');
    });
    test('絵札は紋章パネルになる', () => {
        for (const r of ['J', 'Q', 'K']) {
            const html = cardFace('♥' + r);
            assert.equal(countCenterPips(html), 0, `${r} が格子配置になっている`);
            assert.ok(html.includes('center court'), `${r} が絵札レイアウトでない`);
            assert.ok(html.includes('class="motif"'), `${r} に紋章が無い`);
            assert.ok(html.includes(`<span class="letter">${r}</span>`), `${r} の文字が無い`);
        }
    });
    test('コーナーの指数が上下に入る（小サイズでは下を省く）', () => {
        const md = cardFace('♦Q', { size: 'md' });
        assert.equal((md.match(/class="idx/g) ?? []).length, 2, '指数が 2 箇所に無い');
        // 小サイズでも DOM 上は出すが、CSS で隠す方針にしている
        assert.ok(VISUAL_CSS.includes('.card.sm .idx.bot { display:none; }'), '小サイズの指数を隠す指定が無い');
    });
    test('スートごとに色クラスが付く', () => {
        for (const s of SUITS) {
            assert.ok(cardFace(s + 'A').includes(`suit-${SUIT_KEY[s]}`), `${s} の色クラスが無い`);
        }
    });
    test('サイズ指定がクラスに反映される', () => {
        assert.ok(cardFace('♠A', { size: 'sm' }).includes('card face sm'));
        assert.ok(cardFace('♠A', { size: 'lg' }).includes('card face lg'));
    });
    test('ハイライト指定で win クラスが付く', () => {
        assert.ok(cardFace('♠A', { highlight: true }).includes(' win'));
        assert.ok(!cardFace('♠A').includes(' win'));
    });
    test('演出クラスを差し込める', () => {
        assert.ok(cardFace('♠A', { extra: 'dealing' }).includes('dealing'));
        assert.ok(cardBack({ extra: 'flipping' }).includes('flipping'));
    });
    test('ランク文字がそのまま出る', () => {
        for (const r of RANKS) {
            assert.ok(cardFace('♣' + r).includes(`<b>${r}</b>`), `${r} の指数が出ていない`);
        }
    });
});
describe('裏面とスロット', () => {
    test('裏面は模様を持ち、表の要素を含まない', () => {
        const html = cardBack();
        assert.ok(html.includes('backart'), '裏面の模様が無い');
        assert.ok(!html.includes('class="idx'), '裏面に指数が入っている');
        assert.ok(!html.includes('data-card'), '裏面にカード情報が入っている（情報漏洩になる）');
    });
    test('空きスロットは中身を持たない', () => {
        const html = cardSlot();
        assert.ok(html.includes('card slot'));
        assert.ok(!html.includes('pip'), 'スロットにピップが入っている');
    });
});
describe('テーマとアクセシビリティ', () => {
    test('2 つのテーマが CSS 変数で定義されている', () => {
        assert.ok(VISUAL_CSS.includes('[data-theme="classic"]'));
        assert.ok(VISUAL_CSS.includes('[data-theme="neon"]'));
        for (const v of ['--card-paper', '--card-s', '--card-h', '--card-d', '--card-c', '--felt-a', '--glow']) {
            assert.ok(VISUAL_CSS.includes(v), `${v} が定義されていない`);
        }
    });
    test('赤黒 2 色モードに切り替えられる', () => {
        assert.ok(VISUAL_CSS.includes('[data-suits="two"]'), '2色モードの指定が無い');
    });
    test('動きを減らす設定を尊重している', () => {
        assert.ok(VISUAL_CSS.includes('prefers-reduced-motion'), 'アニメーションを止める指定が無い。これが無いと酔う人が出る');
    });
    test('装飾の SVG はスクリーンリーダーから隠されている', () => {
        assert.ok(cardFace('♠A').includes('aria-hidden="true"'), 'ピップが読み上げ対象になっている');
        assert.ok(cardBack().includes('aria-hidden="true"'));
    });
});
describe('画像アセット', () => {
    test('3 枚とも webp の data URI として埋め込まれている', () => {
        for (const [name, uri] of [
            ['クラシック裏面', CARD_BACK_CLASSIC],
            ['ネオン裏面', CARD_BACK_NEON],
            ['フェルト', FELT_TEXTURE],
        ]) {
            assert.ok(uri.startsWith('data:image/webp;base64,'), `${name} が data URI でない`);
            assert.ok(uri.length > 2000, `${name} が小さすぎる（生成に失敗している可能性）`);
        }
    });
    test('合計サイズが 120KB を超えない', () => {
        // 単一 HTML で配布するので、素材が膨らむと配布物が重くなる。
        // 表示サイズに対して過剰な解像度を持たせていないかの歯止め
        const bytes = [CARD_BACK_CLASSIC, CARD_BACK_NEON, FELT_TEXTURE].reduce((a, u) => a + Math.floor((u.length - 23) * 0.75), 0);
        assert.ok(bytes < 120 * 1024, `画像の合計が ${Math.round(bytes / 1024)}KB と大きすぎる`);
    });
    test('テーマごとに裏面の画像が切り替わる', () => {
        assert.ok(VISUAL_CSS.includes('--card-back-img'), '裏面画像の変数が無い');
        // クラシックとネオンで違う画像が指定されていること
        const classicIdx = VISUAL_CSS.indexOf(CARD_BACK_CLASSIC);
        const neonIdx = VISUAL_CSS.indexOf(CARD_BACK_NEON);
        assert.ok(classicIdx >= 0 && neonIdx >= 0, 'どちらかの裏面が CSS に入っていない');
        assert.notEqual(CARD_BACK_CLASSIC, CARD_BACK_NEON, '2 テーマで同じ画像になっている');
    });
    test('フェルトにテクスチャが敷かれている', () => {
        assert.ok(VISUAL_CSS.includes('--felt-tex'), 'フェルトのテクスチャ変数が無い');
        assert.ok(VISUAL_CSS.includes('.felt, .scene'), '卓の背景にテクスチャが適用されていない');
    });
    test('裏面はテーマ変数を参照する（画像を直書きしない）', () => {
        // 直書きすると 52 枚分のマークアップに data URI が入って肥大する
        assert.ok(!cardBack().includes('data:image'), '裏面の HTML に画像が直書きされている');
        assert.ok(cardBack().includes('backart'), '裏面の模様要素が無い');
    });
});
describe('演出の定義', () => {
    test('必要なアニメーションが揃っている', () => {
        for (const k of ['dealIn', 'flipIn', 'winPulse', 'bannerIn', 'allinFlash', 'chipFly', 'fall', 'potBump']) {
            assert.ok(VISUAL_CSS.includes(`@keyframes ${k}`), `${k} のアニメーションが無い`);
        }
    });
    test('負けた側の札を沈める指定がある', () => {
        // 勝ち札を目立たせるには、周りを暗くするのが一番効く
        assert.ok(VISUAL_CSS.includes('.showdown .card.dim .paper'), '敗北札を沈める指定が無い');
    });
});
// ---------------------------------------------------------------------------
// カードの寸法（重なりの検算）
// ---------------------------------------------------------------------------
/**
 * 最初の版は角の数字とピップが重なって読めなくなっていました。
 * CSS を目で見ても気づけない種類の不具合なので、
 * CSS の元になっている数値から矩形を計算して、直接ぶつかりを検査します。
 */
describe('カードの寸法', () => {
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T'];
    const RANK_NUM = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10,
    };
    /** 2 つの矩形が重なっている量（0 なら接触なし） */
    function overlap(a, b) {
        const x = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const y = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        return x > 0 && y > 0 ? Math.min(x, y) : 0;
    }
    /** 下側の指数は 180 度回転して右下に置かれるので、座標を反転して同じ形に直す */
    function bottomIndexBox(rank) {
        const t = indexBox(rank);
        const H = CARD_METRICS.aspect;
        return { x0: 1 - t.x1, y0: H - t.y1, x1: 1 - t.x0, y1: H - t.y0 };
    }
    test('角の数字とピップが重ならない', () => {
        for (const rank of RANKS) {
            const idx = indexBox(rank);
            for (const [x, y] of PIP_LAYOUT[RANK_NUM[rank]]) {
                const pip = pipBox(x, y);
                assert.equal(overlap(idx, pip), 0, `${rank} のピップ (${x}, ${y}) が左上の数字と重なっている`);
                assert.equal(overlap(bottomIndexBox(rank), pip), 0, `${rank} のピップ (${x}, ${y}) が右下の数字と重なっている`);
            }
        }
    });
    test('数字とピップの間に読みやすい隙間がある', () => {
        // 1px 未満の隙間は「ぶつかっていないだけ」で、見た目には窮屈に映る
        const m = CARD_METRICS;
        for (const rank of RANKS) {
            const idx = indexBox(rank);
            for (const [x, y] of PIP_LAYOUT[RANK_NUM[rank]]) {
                const pip = pipBox(x, y);
                // 横に離れているか、縦に離れているかのどちらかを満たせばよい
                const gapX = Math.max(pip.x0 - idx.x1, idx.x0 - pip.x1);
                const gapY = Math.max(pip.y0 - idx.y1, idx.y0 - pip.y1);
                assert.ok(Math.max(gapX, gapY) >= m.minGap, `${rank} のピップ (${x}, ${y}) と数字の隙間が ${Math.max(gapX, gapY).toFixed(3)} しかない`);
            }
        }
    });
    test('ピップ同士が重ならない', () => {
        for (const rank of RANKS) {
            const boxes = PIP_LAYOUT[RANK_NUM[rank]].map(([x, y]) => pipBox(x, y));
            for (let i = 0; i < boxes.length; i++) {
                for (let j = i + 1; j < boxes.length; j++) {
                    const a = boxes[i];
                    const b = boxes[j];
                    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
                    const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
                    assert.ok(ox <= 0 || oy <= 0, `${rank} のピップ ${i} と ${j} が重なっている`);
                }
            }
        }
    });
    test('ピップがカードの外にはみ出さない', () => {
        const H = CARD_METRICS.aspect;
        for (const rank of RANKS) {
            for (const [x, y] of PIP_LAYOUT[RANK_NUM[rank]]) {
                const p = pipBox(x, y);
                assert.ok(p.x0 >= 0 && p.x1 <= 1, `${rank} のピップが左右にはみ出している`);
                assert.ok(p.y0 >= 0 && p.y1 <= H, `${rank} のピップが上下にはみ出している`);
            }
        }
    });
    test('CSS が寸法の定義と一致している', () => {
        // CSS に数字を直書きすると、定義とずれてもテストが素通りしてしまう
        const m = CARD_METRICS;
        for (const v of [m.idxTop, m.idxLeft, m.idxFont, m.idxSuit, m.fieldX, m.fieldY, m.pipW]) {
            assert.ok(VISUAL_CSS.includes(`* ${v})`), `CSS に ${v} が出てこない（直書きに戻っていないか）`);
        }
    });
    test('カードの縦横比が定義どおり', () => {
        // .card.sm / .md / .lg の実寸が aspect と食い違うと、内側の比率計算が全部ずれる
        const found = [...VISUAL_CSS.matchAll(/\.card\.(sm|md|lg) \{ --cw:(\d+)px; width:\d+px; height:(\d+)px/g)];
        // 画面幅が狭いときの上書きも含むので 3 つ以上
        assert.ok(found.length >= 3, `サイズ定義が見つからない: ${found.length}`);
        for (const [, name, w, h] of found) {
            const ratio = Number(h) / Number(w);
            assert.ok(Math.abs(ratio - CARD_METRICS.aspect) < 0.02, `${name} の縦横比が ${ratio.toFixed(3)}（${CARD_METRICS.aspect} のはず）`);
        }
    });
    test('小さいカードはピップを並べずスート 1 個で表す', () => {
        // 32px に 10 個並べても黒い塊になるだけ
        const small = cardFace('♣T', { size: 'sm' });
        assert.ok(small.includes('center solo'), '小さいカードでピップを並べている');
        const big = cardFace('♣T', { size: 'lg' });
        assert.ok(big.includes('center pips'), '大きいカードでピップが並んでいない');
        assert.equal((big.match(/class="p"/g) ?? []).length, 10, '10 のピップが 10 個ない');
    });
});
//# sourceMappingURL=visuals.test.js.map