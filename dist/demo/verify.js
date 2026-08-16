/**
 * 独立検証ページ
 *
 * プレイヤーに配布して、手元で配牌の公正性を確認してもらうためのツール。
 * サーバーとは一切通信しない（通信していたら、それ自体が疑いの対象になる）。
 * 検証ロジックはサーバーが使っているものと同一のソース（src/fair.ts）から取り込んでいる。
 */
import { verifyHand, deriveDeck, commitmentOf } from '../src/fair.js';
import { cardToString } from '../src/cards.js';
const $ = (id) => document.getElementById(id);
const SUIT_CLASS = { s: '', h: 'h', d: 'd', c: 'c' };
const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
function cardHtml(code, index, bad) {
    const r = code[0];
    const u = code[1];
    return `<div class="c ${SUIT_CLASS[u] ?? ''} ${bad ? 'bad' : ''}" title="${index + 1} 枚目">${r}${SUIT_SYM[u] ?? '?'}<small>${index + 1}</small></div>`;
}
function parseDeckInput(raw) {
    return raw
        .trim()
        .split(/[\s,]+/)
        .filter((s) => s.length > 0)
        .map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase());
}
function render(result, deckGiven) {
    // 判定の優先順位に注意：1 つでも失敗があれば、デッキ未入力かどうかに関係なく「失敗」を出す。
    // 「デッキを入れていないから中立表示」で失敗を隠すと、検証ツールとして有害になる。
    const verdict = !result.passed
        ? '<div class="verdict ng">✗ 検証に失敗しました。下の内訳を確認してください</div>'
        : deckGiven
            ? '<div class="verdict ok">✓ このハンドの配牌は、カードが配られる前に確定していたものと一致します</div>'
            : '<div class="verdict ok" style="background:rgba(217,180,95,.12);border-color:var(--gold);color:var(--gold)">コミットメントは一致しました。デッキ未入力のため、配牌の照合は行っていません</div>';
    const checks = result.checks
        .map((c) => `<li>
        <span class="mark ${c.passed ? 'ok' : 'ng'}">${c.passed ? '✓' : '✗'}</span>
        <span class="body"><b>${c.label}</b><span>${escapeHtml(c.detail)}</span></span>
      </li>`)
        .join('');
    const bad = new Set(result.mismatchIndexes);
    const deck = result.derivedDeck.map((c, i) => cardHtml(c, i, deckGiven && bad.has(i))).join('');
    $('out').innerHTML = `
    <div class="panel">
      <h2>検証結果</h2>
      ${verdict}
      <ul class="checks">${checks}</ul>
      <div style="margin-top:16px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">シードから再現したデッキ（配布順）${deckGiven && bad.size ? ' — 赤枠が実際の配牌と食い違った位置' : ''}</div>
        <div class="deck">${deck}</div>
        <div class="note" style="font-family:ui-monospace,Menlo,monospace;word-break:break-all">${result.derivedDeck.join(' ')}</div>
      </div>
    </div>`;
}
function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
$('run').addEventListener('click', () => {
    const serverSeed = $('serverSeed').value.trim();
    const commitment = $('commitment').value.trim();
    const clientSeed = $('clientSeed').value;
    const nonce = +$('nonce').value;
    const deck = parseDeckInput($('deck').value);
    if (!serverSeed) {
        $('out').innerHTML = '<div class="panel"><div class="verdict ng">サーバーシードを入力してください</div></div>';
        return;
    }
    const result = verifyHand({
        serverSeed,
        commitment: commitment || '（未入力）',
        clientSeed,
        nonce,
        deck: deck.length > 0 ? deck : [],
    });
    // デッキ未入力のときは「デッキの一致」チェックを結果から外す
    if (deck.length === 0) {
        result.checks = result.checks.filter((c) => c.label !== 'デッキの一致');
        result.mismatchIndexes.length = 0;
        result.passed = result.checks.every((c) => c.passed);
    }
    render(result, deck.length > 0);
});
$('sample').addEventListener('click', () => {
    // 検証が「通る」サンプル。ここで通らなければ検証ツール自体が壊れている
    const serverSeed = '11'.repeat(32);
    const clientSeed = 'alice|bob|carol';
    const nonce = 3;
    $('serverSeed').value = serverSeed;
    $('commitment').value = commitmentOf(serverSeed);
    $('clientSeed').value = clientSeed;
    $('nonce').value = String(nonce);
    $('deck').value = deriveDeck({ serverSeed, clientSeed, nonce })
        .map(cardToString)
        .join(' ');
    $('run').click();
});
$('clear').addEventListener('click', () => {
    for (const id of ['serverSeed', 'commitment', 'clientSeed', 'deck']) {
        $(id).value = '';
    }
    $('nonce').value = '0';
    $('out').innerHTML = '';
});
// URL のクエリからハンド情報を受け取れるようにする（ゲーム側から「検証する」リンクを張る用）
const params = new URLSearchParams(location.search);
if (params.has('serverSeed')) {
    $('serverSeed').value = params.get('serverSeed') ?? '';
    $('commitment').value = params.get('commitment') ?? '';
    $('clientSeed').value = params.get('clientSeed') ?? '';
    $('nonce').value = params.get('nonce') ?? '0';
    $('deck').value = params.get('deck') ?? '';
    $('run').click();
}
//# sourceMappingURL=verify.js.map