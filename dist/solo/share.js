/**
 * 自慢用の画像カード
 *
 * 1200x630 は SNS のプレビュー画像で標準的な比率です。
 * ここを外すと、投稿したときに上下が切れて肝心の数字が見えなくなります。
 *
 * 中身の優先順位は「チップ額 → 称号 → 最高役 → 細かい統計」。
 * タイムラインでは一瞬しか見られないので、数字を大きく 1 つだけ主役にしています。
 * 統計を横並びに詰め込むと、どれも読まれません。
 */
import { FELT_TEXTURE } from '../client/assets.js';
const W = 1200;
const H = 630;
const SUIT_COLOR = { '♠': '#16181c', '♥': '#c62233', '♦': '#1666c4', '♣': '#1e7a3c' };
function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}
/** カードを 1 枚描く（共有画像用の簡易版） */
function drawCard(g, code, x, y, w, h) {
    const suit = code[0];
    const rank = code.slice(1);
    g.save();
    g.shadowColor = 'rgba(0,0,0,.45)';
    g.shadowBlur = 12;
    g.shadowOffsetY = 4;
    g.fillStyle = '#fbfaf6';
    roundRect(g, x, y, w, h, w * 0.1);
    g.fill();
    g.restore();
    g.fillStyle = SUIT_COLOR[suit] ?? '#16181c';
    g.textAlign = 'center';
    g.font = `700 ${Math.round(w * 0.52)}px "Hiragino Sans", system-ui, sans-serif`;
    g.fillText(rank, x + w / 2, y + h * 0.46);
    g.font = `${Math.round(w * 0.42)}px "Hiragino Sans", system-ui, sans-serif`;
    g.fillText(suit, x + w / 2, y + h * 0.86);
}
const fmt = (n) => n.toLocaleString('ja-JP');
/** 大きな数字は桁を圧縮する。9 桁の数字は一瞬では読めない */
function compact(n) {
    if (n >= 1e8)
        return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)}億`;
    if (n >= 1e4)
        return `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}万`;
    return fmt(n);
}
export async function renderShareCard(opts) {
    const { profile } = opts;
    const s = profile.data.stats;
    const rank = profile.rank;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    // --- 背景（フェルト）---
    g.fillStyle = '#0b1a14';
    g.fillRect(0, 0, W, H);
    try {
        const tex = await loadImage(FELT_TEXTURE);
        const pat = g.createPattern(tex, 'repeat');
        if (pat) {
            g.save();
            g.globalAlpha = 0.85;
            g.fillStyle = pat;
            g.fillRect(0, 0, W, H);
            g.restore();
        }
    }
    catch {
        /* テクスチャが読めなくても単色で成立する */
    }
    // 中央を明るく、四隅を落として視線を集める
    const vign = g.createRadialGradient(W * 0.5, H * 0.42, 60, W * 0.5, H * 0.5, W * 0.72);
    vign.addColorStop(0, 'rgba(255,255,255,.16)');
    vign.addColorStop(0.55, 'rgba(0,0,0,.15)');
    vign.addColorStop(1, 'rgba(0,0,0,.62)');
    g.fillStyle = vign;
    g.fillRect(0, 0, W, H);
    // 金の枠
    g.strokeStyle = 'rgba(217,180,95,.75)';
    g.lineWidth = 3;
    roundRect(g, 18, 18, W - 36, H - 36, 22);
    g.stroke();
    // --- 称号バッジ ---
    g.save();
    g.font = '600 26px "Hiragino Sans", system-ui, sans-serif';
    const badgeText = `${rank.name}`;
    const bw = g.measureText(badgeText).width + 64;
    g.fillStyle = rank.color;
    roundRect(g, 62, 62, bw, 52, 26);
    g.fill();
    g.fillStyle = '#0d1116';
    g.textAlign = 'center';
    g.fillText(badgeText, 62 + bw / 2, 96);
    g.restore();
    // --- プレイヤー名 ---
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.font = '500 26px "Hiragino Sans", system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(profile.data.playerName, 62 + bw + 22, 96);
    // --- 主役の数字 ---
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,.62)';
    g.font = '500 24px "Hiragino Sans", system-ui, sans-serif';
    g.fillText('所持チップ', 64, 190);
    const chipStr = compact(profile.data.chips);
    g.font = '800 132px "Hiragino Sans", system-ui, sans-serif';
    const grad = g.createLinearGradient(64, 200, 64, 300);
    grad.addColorStop(0, '#fff6d8');
    grad.addColorStop(0.5, '#e8c778');
    grad.addColorStop(1, '#b98f30');
    g.fillStyle = grad;
    g.fillText(chipStr, 62, 296);
    const chipW = g.measureText(chipStr).width;
    g.font = '600 30px "Hiragino Sans", system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.fillText('CHIPS', 74 + chipW, 292);
    // --- 見せ場 ---
    if (opts.highlight) {
        g.fillStyle = 'rgba(255,255,255,.9)';
        g.font = '700 34px "Hiragino Sans", system-ui, sans-serif';
        g.fillText(opts.highlight.title, 64, 356);
        g.fillStyle = 'rgba(255,255,255,.6)';
        g.font = '400 24px "Hiragino Sans", system-ui, sans-serif';
        g.fillText(opts.highlight.detail, 64, 392);
    }
    // --- 最高役 ---
    const cards = s.bestHandCards ? s.bestHandCards.split(' ').filter(Boolean) : [];
    if (cards.length) {
        g.fillStyle = 'rgba(255,255,255,.55)';
        g.font = '500 22px "Hiragino Sans", system-ui, sans-serif';
        g.textAlign = 'right';
        g.fillText('自己ベスト', W - 66, 172);
        g.fillStyle = '#ffd76a';
        g.font = '700 32px "Hiragino Sans", system-ui, sans-serif';
        g.fillText(s.bestHandName, W - 66, 212);
        const cw = 88;
        const ch = 124;
        const gap = 12;
        const total = cards.length * cw + (cards.length - 1) * gap;
        let x = W - 66 - total;
        for (const c of cards) {
            drawCard(g, c, x, 236, cw, ch);
            x += cw + gap;
        }
    }
    // --- 統計 ---
    const winRate = s.handsPlayed > 0 ? Math.round((s.handsWon / s.handsPlayed) * 100) : 0;
    const stats = [
        ['ハンド', fmt(s.handsPlayed)],
        ['勝率', `${winRate}%`],
        ['最高ポット', compact(s.biggestPot)],
        ['撃墜', `${fmt(s.cpuBusted)}人`],
        ['最高連勝', `${s.bestStreak}`],
    ];
    const boxY = H - 138;
    g.save();
    g.fillStyle = 'rgba(0,0,0,.34)';
    roundRect(g, 62, boxY, W - 124, 84, 16);
    g.fill();
    g.restore();
    const colW = (W - 124) / stats.length;
    stats.forEach(([label, value], i) => {
        const cx = 62 + colW * i + colW / 2;
        g.textAlign = 'center';
        g.fillStyle = 'rgba(255,255,255,.5)';
        g.font = '500 19px "Hiragino Sans", system-ui, sans-serif';
        g.fillText(label, cx, boxY + 30);
        g.fillStyle = '#ffffff';
        g.font = '700 30px "Hiragino Sans", system-ui, sans-serif';
        g.fillText(value, cx, boxY + 66);
    });
    // --- 署名 ---
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,.34)';
    g.font = '500 18px "Hiragino Sans", system-ui, sans-serif';
    g.fillText('♠ SOLO POKER', W / 2, H - 26);
    return canvas;
}
function loadImage(src) {
    return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
    });
}
/** 共有用の文面。画像と一緒に貼れるように、数字を読みやすく整える */
export function shareText(profile) {
    const s = profile.data.stats;
    const winRate = s.handsPlayed > 0 ? Math.round((s.handsWon / s.handsPlayed) * 100) : 0;
    return [
        `♠ SOLO POKER`,
        `${profile.rank.name}｜所持 ${compact(profile.data.chips)} チップ`,
        `${s.handsPlayed} ハンド / 勝率 ${winRate}% / 最高ポット ${compact(s.biggestPot)}`,
        s.bestHandName !== '—' ? `自己ベスト: ${s.bestHandName}` : '',
    ]
        .filter(Boolean)
        .join('\n');
}
export async function downloadCard(canvas, name = 'poker-result.png') {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob)
        return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** クリップボードへ画像をコピー。対応していない環境では false を返す */
export async function copyCard(canvas) {
    try {
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        if (!blob || !navigator.clipboard || !('write' in navigator.clipboard))
            return false;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=share.js.map