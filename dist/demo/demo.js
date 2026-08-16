/**
 * ブラウザ動作確認ビューア
 *
 * これは開発用のデバッグツールであり、製品の UI ではない。
 * 特に「全員の手札を表示」はサーバーが本来クライアントに送ってはいけない情報を
 * 意図的に表示している。製品では getStateFor(seat) の結果だけを送ること。
 */
import { Hand, createSecureRng, rankOf, suitOf, RANK_CHARS, SUIT_SYMBOLS, scoreBest, decide, freshDeck, shuffle, FairnessSession, verifyHand, randomSeedHex, } from '../src/index.js';
const $ = (id) => document.getElementById(id);
const HERO = 0;
const rng = createSecureRng();
let hand = null;
let botTimer = null;
/** 配牌前に受け取ったコミットメント。開示後の照合に使うため、ハンドとは別に保持する */
let commitment = null;
let handNonce = 0;
function readCfg() {
    return {
        players: clamp(+$('cfgPlayers').value, 2, 9),
        stack: Math.max(100, +$('cfgStack').value),
        sb: Math.max(1, +$('cfgSb').value),
        bb: Math.max(2, +$('cfgBb').value),
        rakePercent: +$('cfgRake').value / 100,
        rakeCapBB: +$('cfgRakeCap').value,
        style: $('cfgStyle').value,
        vary: $('cfgVary').value === 'varied',
        reveal: $('cfgReveal').checked,
        auto: $('cfgAuto').checked,
        clientSeed: $('cfgClientSeed').value || 'anonymous',
    };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (n) => n.toLocaleString('ja-JP');
// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------
const SUIT_CLASS = ['', 'red', 'blue', 'green']; // s h d c ※色覚特性対応の 4 色表示
const cardHtml = (c, small = false) => {
    const cls = SUIT_CLASS[suitOf(c)];
    return `<div class="card ${small ? 'sm' : ''} ${cls}"><div class="r">${RANK_CHARS[rankOf(c) - 2]}</div><div class="s">${SUIT_SYMBOLS[suitOf(c)]}</div></div>`;
};
const backHtml = (small = false) => `<div class="card back ${small ? 'sm' : ''}"></div>`;
const STREET_LABEL = {
    preflop: 'プリフロップ',
    flop: 'フロップ',
    turn: 'ターン',
    river: 'リバー',
    showdown: 'ショーダウン',
    complete: '終了',
};
function render() {
    const cfg = readCfg();
    const el = $('table');
    if (!hand) {
        el.innerHTML = `<div class="center" style="color:rgba(255,255,255,.5)">「新しいハンド」を押してください</div>`;
        $('actions').innerHTML = '';
        return;
    }
    const h = hand;
    const n = h.players.length;
    const winnersSet = new Set();
    if (h.result)
        for (const pr of h.result.pots)
            for (const w of pr.winners)
                winnersSet.add(w);
    let html = `<div class="center">
    <div class="street-tag">${STREET_LABEL[h.street]}</div>
    <div class="board">${h.board.map((c) => cardHtml(c)).join('') || '<span style="color:rgba(255,255,255,.3);font-size:12px">— ボード未公開 —</span>'}</div>
    <div class="pot">ポット <b>${fmt(h.totalPot)}</b></div>
  </div>`;
    for (let i = 0; i < n; i++) {
        const p = h.players[i];
        const k = (i - HERO + n) % n;
        const a = ((180 + (k * 360) / n) * Math.PI) / 180;
        const x = 50 + 40 * Math.sin(a);
        const y = 48 - 37 * Math.cos(a);
        const showCards = cfg.reveal || i === HERO || (h.isComplete && h.result?.showdown && !p.folded);
        const cards = p.folded && h.isComplete
            ? ''
            : showCards
                ? p.holeCards.map((c) => cardHtml(c, true)).join('')
                : backHtml(true) + backHtml(true);
        const badges = (i === h.buttonIndex ? '<span class="badge">D</span>' : '') +
            (p.totalBet > 0 && h.street === 'preflop' && i === (n === 2 ? h.buttonIndex : (h.buttonIndex + 1) % n)
                ? '<span class="badge sb">SB</span>'
                : '') +
            (h.street === 'preflop' && i === (n === 2 ? (h.buttonIndex + 1) % n : (h.buttonIndex + 2) % n)
                ? '<span class="badge bb">BB</span>'
                : '') +
            (p.allIn ? '<span class="badge allin">ALL IN</span>' : '') +
            (winnersSet.has(i) ? '<span class="badge win">WIN</span>' : '');
        const actTag = p.lastAction ? `<span class="act-tag">${ACTION_LABEL[p.lastAction]}</span>` : '';
        html += `<div class="seat ${h.actingSeat === i ? 'acting' : ''} ${p.folded ? 'folded' : ''}"
       style="left:${x}%;top:${y}%">
      <div class="cards">${cards}</div>
      <div class="box">
        <div class="nm">${i === HERO ? '★ ' : ''}${p.name}${badges}</div>
        <div class="st">${fmt(p.stack)}</div>
      </div>
      <div class="bet">${p.streetBet > 0 ? `▸ ${fmt(p.streetBet)}` : actTag}</div>
    </div>`;
    }
    el.innerHTML = html;
    renderActions(cfg);
    renderResult();
    renderFairness();
}
const ACTION_LABEL = {
    fold: 'フォールド',
    check: 'チェック',
    call: 'コール',
    bet: 'ベット',
    raise: 'レイズ',
};
function renderActions(cfg) {
    const box = $('actions');
    const h = hand;
    if (!h || h.isComplete) {
        box.innerHTML = h?.isComplete
            ? `<div class="btnrow"><button class="primary big" onclick="window.__newHand()">次のハンドへ</button></div>`
            : '';
        return;
    }
    if (h.actingSeat !== HERO || cfg.auto) {
        box.innerHTML = `<div class="btnrow"><button class="big" disabled>席 ${h.actingSeat} を思考中…</button></div>`;
        return;
    }
    const legal = h.getLegalActions(HERO);
    const p = h.players[HERO];
    const raise = legal.find((l) => l.type === 'raise' || l.type === 'bet');
    const call = legal.find((l) => l.type === 'call');
    const check = legal.find((l) => l.type === 'check');
    let html = '<div class="btnrow">';
    html += `<button class="big danger" onclick="window.__act('fold')">フォールド</button>`;
    if (check)
        html += `<button class="big" onclick="window.__act('check')">チェック</button>`;
    if (call)
        html += `<button class="big" onclick="window.__act('call')">コール ${fmt(call.amount ?? 0)}</button>`;
    if (raise) {
        html += `<button class="big primary" onclick="window.__actRaise()">${raise.type === 'bet' ? 'ベット' : 'レイズ'} <span id="raiseVal">${fmt(raise.min)}</span></button>`;
    }
    html += '</div>';
    if (raise) {
        const pot = h.totalPot;
        const presets = [
            ['1/2 ポット', Math.round(pot * 0.5) + h.currentBet],
            ['2/3 ポット', Math.round(pot * 0.66) + h.currentBet],
            ['ポット', pot + h.currentBet],
            ['オールイン', raise.max],
        ];
        html += `<div style="margin-top:10px">
      <input type="range" id="raiseSlider" min="${raise.min}" max="${raise.max}" step="1" value="${raise.min}">
      <div class="btnrow" style="margin-top:6px">` +
            presets
                .map(([lbl, v]) => {
                const clamped = clamp(v, raise.min, raise.max);
                return `<button class="chip" onclick="window.__setRaise(${clamped})">${lbl}<br><span style="color:var(--muted);font-size:11px">${fmt(clamped)}</span></button>`;
            })
                .join('') +
            `</div>
      <div class="note">最小レイズ ${fmt(raise.min)} / 最大 ${fmt(raise.max)}（スタック ${fmt(p.stack)}）。金額は「このストリートで最終的にいくらまで出すか（raise to）」です。</div>
    </div>`;
    }
    box.innerHTML = html;
    const slider = document.getElementById('raiseSlider');
    if (slider) {
        slider.oninput = () => {
            const v = document.getElementById('raiseVal');
            if (v)
                v.textContent = fmt(+slider.value);
        };
    }
}
function renderResult() {
    const box = $('result');
    const h = hand;
    if (!h || !h.result) {
        box.innerHTML = '<div class="note">ハンド進行中…</div>';
        return;
    }
    const r = h.result;
    const before = h.players.reduce((a, p) => a + p.startingStack, 0);
    const after = h.players.reduce((a, p) => a + p.stack, 0);
    const conserved = after + r.totalRake === before;
    let html = `<table class="res">
    <tr><th>席</th><th>開始</th><th>出資</th><th>終了</th><th>収支</th><th style="text-align:left">成立役</th></tr>`;
    for (const p of h.players) {
        const net = r.netChange[p.seat];
        const hv = r.hands[p.seat];
        html += `<tr>
      <td>${p.seat === HERO ? '★ ' : ''}${p.name}${p.folded ? ' <span style="color:var(--muted)">(降)</span>' : ''}</td>
      <td>${fmt(p.startingStack)}</td>
      <td>${fmt(p.totalBet)}</td>
      <td>${fmt(p.stack)}</td>
      <td class="${net > 0 ? 'ok' : net < 0 ? 'ng' : ''}">${net > 0 ? '+' : ''}${fmt(net)}</td>
      <td style="text-align:left">${hv ? describeShort(hv) : '—'}</td>
    </tr>`;
    }
    html += '</table>';
    html += '<div style="margin-top:10px"><table class="res"><tr><th style="text-align:left">ポット</th><th>金額</th><th>レーキ</th><th style="text-align:left">権利者</th><th style="text-align:left">勝者</th></tr>';
    for (const pr of r.pots) {
        html += `<tr>
      <td>${pr.pot.level === 0 ? 'メイン' : `サイド ${pr.pot.level}`}</td>
      <td>${fmt(pr.pot.amount)}</td>
      <td>${fmt(pr.rake)}</td>
      <td style="text-align:left">${pr.pot.eligible.map((s) => h.players[s].name).join(', ')}</td>
      <td style="text-align:left" class="ok">${pr.winners.map((s) => h.players[s].name).join(', ')}</td>
    </tr>`;
    }
    html += '</table></div>';
    if (r.uncalledReturn) {
        html += `<div class="note">コールされなかったベット <b>${fmt(r.uncalledReturn.amount)}</b> を ${h.players[r.uncalledReturn.seat].name} に返却しました。</div>`;
    }
    html += `<div class="note">チップ総量の検証：開始 ${fmt(before)} ／ 終了 ${fmt(after)} ＋ レーキ ${fmt(r.totalRake)} = ${fmt(after + r.totalRake)}
    <span class="${conserved ? 'ok' : 'ng'}">${conserved ? '✓ 保存されています' : '✗ 不整合！'}</span></div>`;
    box.innerHTML = html;
}
// ---------------------------------------------------------------------------
// 公正性パネル
// ---------------------------------------------------------------------------
function renderFairness() {
    const box = $('fair');
    const h = hand;
    if (!h || !commitment) {
        box.innerHTML = '';
        return;
    }
    // 進行中はコミットメントだけ。シードは伏せたまま
    let html = `<dl class="kv">
    <dt>コミットメント</dt><dd>${commitment.commitment}</dd>
    <dt>クライアントシード</dt><dd>${escapeHtml(commitment.clientSeed)}</dd>
    <dt>ハンド連番</dt><dd>${commitment.nonce}</dd>
    <dt>サーバーシード</dt><dd>${h.isComplete ? h.revealFairness().serverSeed : '<span class="sealed">ハンド終了後に開示されます</span>'}</dd>
  </dl>`;
    if (!h.isComplete) {
        html += `<div class="note">上のコミットメントは<b>カードが配られる前に</b>公開されたものです。ハンドが終わるとサーバーシードが開示され、これがそのハッシュと一致することを確認できます。</div>`;
        box.innerHTML = html;
        return;
    }
    const reveal = h.revealFairness();
    const history = h.getHandHistory();
    const result = verifyHand({
        serverSeed: reveal.serverSeed,
        commitment: commitment.commitment, // 事前に受け取った値と照合する（開示側の値を信用しない）
        clientSeed: commitment.clientSeed,
        nonce: commitment.nonce,
        deck: history.deckOrder,
    });
    html += result.passed
        ? '<div class="verdict ok">✓ このハンドの配牌は、配る前に確定していたものと一致します</div>'
        : '<div class="verdict ng">✗ 検証に失敗しました</div>';
    html += '<ul class="checks">' + result.checks
        .map((c) => `<li><span class="mark ${c.passed ? 'ok' : 'ng'}">${c.passed ? '✓' : '✗'}</span>
        <span><b>${c.label}</b><br><span class="d">${escapeHtml(c.detail)}</span></span></li>`)
        .join('') + '</ul>';
    const q = new URLSearchParams({
        serverSeed: reveal.serverSeed,
        commitment: commitment.commitment,
        clientSeed: commitment.clientSeed,
        nonce: String(commitment.nonce),
        deck: history.deckOrder.join(' '),
    });
    html += `<div class="btnrow" style="margin-top:10px">
    <button class="chip" onclick="window.__copyProof()">検証データをコピー</button>
    <a class="chip" style="text-decoration:none;display:inline-block;padding:5px 11px;border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:12px"
       href="poker-fairness-verifier.html?${q.toString()}" target="_blank">独立検証ツールで開く</a>
  </div>
  <div class="note">「独立検証ツールで開く」は、同じフォルダに <code>poker-fairness-verifier.html</code> がある場合に動きます。あれはサーバーと通信しない単独ファイルなので、プレイヤーに配布して手元で検証してもらえます。</div>`;
    box.innerHTML = html;
}
function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function describeShort(hv) {
    const names = [
        'ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート',
        'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ',
    ];
    return `${names[hv.category]} <span style="color:var(--muted)">${hv.cards.map((c) => RANK_CHARS[rankOf(c) - 2] + SUIT_SYMBOLS[suitOf(c)]).join(' ')}</span>`;
}
// ---------------------------------------------------------------------------
// ログ
// ---------------------------------------------------------------------------
let loggedCount = 0;
function renderLog() {
    const h = hand;
    const box = $('log');
    if (!h)
        return;
    const rows = [];
    for (let i = loggedCount; i < h.events.length; i++)
        rows.push(eventToHtml(h.events[i], h));
    loggedCount = h.events.length;
    box.insertAdjacentHTML('beforeend', rows.join(''));
    box.scrollTop = box.scrollHeight;
}
function eventToHtml(e, h) {
    const nm = (s) => h.players[s].name;
    switch (e.type) {
        case 'hand_start':
            return `<div><span class="k">開始</span>ボタン=${nm(e.button)} SB=${nm(e.sbSeat)} BB=${nm(e.bbSeat)}</div>`;
        case 'ante':
            return `<div><span class="k">アンティ</span>${nm(e.seat)} ${fmt(e.amount)}</div>`;
        case 'blind':
            return `<div><span class="k">${e.blind.toUpperCase()}</span>${nm(e.seat)} ${fmt(e.amount)}</div>`;
        case 'straddle':
            return `<div><span class="k">ストラドル${e.order > 1 ? e.order : ''}</span>${nm(e.seat)} ${fmt(e.amount)}</div>`;
        case 'deal_hole':
            return '';
        case 'street':
            return `<div class="hl">— ${STREET_LABEL[e.street]} ${e.board.length ? e.board.map((c) => RANK_CHARS[rankOf(c) - 2] + SUIT_SYMBOLS[suitOf(c)]).join(' ') : ''} —</div>`;
        case 'action':
            return `<div><span class="k">${nm(e.seat)}</span>${ACTION_LABEL[e.action]}${e.amount ? ` ${fmt(e.amount)}（計 ${fmt(e.toAmount)}）` : ''}${e.allIn ? ' <b class="neg">ALL IN</b>' : ''}</div>`;
        case 'uncalled_return':
            return `<div><span class="k">返却</span>${nm(e.seat)} へ ${fmt(e.amount)}</div>`;
        case 'pots':
            return `<div><span class="k">ポット</span>${e.pots.map((p, i) => `${i === 0 ? 'メイン' : `サイド${i}`} ${fmt(p.amount)}[${p.eligible.map(nm).join('/')}]`).join(' , ')}</div>`;
        case 'showdown':
            return `<div><span class="k">公開</span>${nm(e.seat)} ${e.cards.map((c) => RANK_CHARS[rankOf(c) - 2] + SUIT_SYMBOLS[suitOf(c)]).join(' ')} → ${e.hand}</div>`;
        case 'award':
            return `<div class="win"><span class="k">獲得</span>${nm(e.seat)} +${fmt(e.amount)}${e.potLevel > 0 ? `（サイド${e.potLevel}）` : ''}</div>`;
        case 'rake':
            return `<div><span class="k">レーキ</span>${fmt(e.amount)}</div>`;
        case 'hand_end':
            return `<div class="hl">— ハンド終了 —</div>`;
    }
}
// ---------------------------------------------------------------------------
// 進行制御
// ---------------------------------------------------------------------------
function newHand() {
    const cfg = readCfg();
    if (botTimer !== null)
        clearTimeout(botTimer);
    const seatsCfg = [];
    for (let i = 0; i < cfg.players; i++) {
        const stack = cfg.vary
            ? Math.max(cfg.bb, Math.round(cfg.stack * (0.15 + rng.randomInt(200) / 100)))
            : cfg.stack;
        seatsCfg.push({ id: `p${i}`, name: i === HERO ? 'あなた' : `BOT ${i}`, stack });
    }
    // Provably Fair：ヒーローのシードは入力欄から、ボットのシードは自動生成。
    // 実サーバーでも同じで、シードを出さないプレイヤーの分はサーバーが乱数で埋める。
    const clientSeeds = seatsCfg.map((_, i) => (i === HERO ? cfg.clientSeed : randomSeedHex(6)));
    const fairness = new FairnessSession({ clientSeeds, nonce: handNonce++ });
    // 配牌前にコミットメントを受け取る。この順序が仕組みの核心
    commitment = fairness.getCommitment();
    hand = new Hand({
        seats: seatsCfg,
        buttonIndex: rng.randomInt(cfg.players),
        smallBlind: cfg.sb,
        bigBlind: cfg.bb,
        rakePercent: cfg.rakePercent,
        rakeCap: cfg.rakeCapBB * cfg.bb,
        rng,
        fairness,
    });
    loggedCount = 0;
    $('log').innerHTML = '';
    render();
    renderLog();
    scheduleBot();
}
/** ボットの思考時間（ms）。スモークテストから 0 に落として一気に進めるために変数にしている */
let botDelayMs = 550;
function scheduleBot() {
    const cfg = readCfg();
    if (!hand || hand.isComplete)
        return;
    if (hand.actingSeat === HERO && !cfg.auto)
        return;
    if (botTimer !== null)
        clearTimeout(botTimer);
    botTimer = window.setTimeout(() => {
        if (!hand || hand.isComplete)
            return;
        const seat = hand.actingSeat;
        const d = decide(hand, seat, rng, cfg.style);
        hand.act(seat, d.action, d.toAmount);
        render();
        renderLog();
        scheduleBot();
    }, botDelayMs);
}
function heroAct(action, amount) {
    if (!hand || hand.actingSeat !== HERO)
        return;
    hand.act(HERO, action, amount);
    render();
    renderLog();
    scheduleBot();
}
// ---------------------------------------------------------------------------
// 大量シミュレーション
// ---------------------------------------------------------------------------
const CATEGORY_NAMES = [
    'ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート',
    'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ',
];
// C(52,7) における役の組み合わせ数（理論値）
const THEORY7 = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584];
const TOTAL7 = 133784560;
function runSim(count) {
    const cfg = readCfg();
    const t0 = performance.now();
    let chipErrors = 0;
    let showdowns = 0;
    let sidePots = 0;
    let totalRake = 0;
    let failed = 0;
    const catCounts = new Array(9).fill(0);
    for (let i = 0; i < count; i++) {
        const seatsCfg = [];
        for (let k = 0; k < cfg.players; k++) {
            const stack = cfg.vary
                ? Math.max(cfg.bb, Math.round(cfg.stack * (0.15 + rng.randomInt(200) / 100)))
                : cfg.stack;
            seatsCfg.push({ id: `p${k}`, name: `P${k}`, stack });
        }
        const before = seatsCfg.reduce((a, s) => a + s.stack, 0);
        const h = new Hand({
            seats: seatsCfg,
            buttonIndex: rng.randomInt(cfg.players),
            smallBlind: cfg.sb,
            bigBlind: cfg.bb,
            rakePercent: cfg.rakePercent,
            rakeCap: cfg.rakeCapBB * cfg.bb,
            rng,
        });
        try {
            let guard = 0;
            while (!h.isComplete) {
                if (guard++ > 500)
                    throw new Error('進行が終わらない');
                const seat = h.actingSeat;
                const d = decide(h, seat, rng, cfg.style);
                h.act(seat, d.action, d.toAmount);
            }
        }
        catch {
            failed++;
            continue;
        }
        const after = h.players.reduce((a, p) => a + p.stack, 0);
        if (after + h.result.totalRake !== before)
            chipErrors++;
        totalRake += h.result.totalRake;
        if (h.result.showdown)
            showdowns++;
        if (h.result.pots.length > 1)
            sidePots++;
    }
    // 役の出現頻度はハンド進行とは独立に、素の 7 枚で測る
    const deck = freshDeck();
    const sampleN = Math.min(count, 40000);
    for (let i = 0; i < sampleN; i++) {
        shuffle(deck, rng);
        const score = scoreBest(deck.slice(0, 7));
        catCounts[Math.floor(score / 759375)]++;
    }
    const ms = performance.now() - t0;
    let out = `<pre class="stats">`;
    out += `ハンド数        : ${fmt(count)}  (${ms.toFixed(0)} ms / ${(count / (ms / 1000)).toFixed(0)} hands/s)\n`;
    out += `チップ不整合    : ${chipErrors}  ${chipErrors === 0 ? '✓' : '✗ バグあり'}\n`;
    out += `エンジン例外    : ${failed}  ${failed === 0 ? '✓' : '✗ バグあり'}\n`;
    out += `ショーダウン率  : ${((showdowns / count) * 100).toFixed(1)}%\n`;
    out += `サイドポット発生: ${((sidePots / count) * 100).toFixed(1)}%\n`;
    out += `レーキ総額      : ${fmt(totalRake)}\n\n`;
    out += `7枚役の出現率（${fmt(sampleN)} サンプル）\n`;
    out += `${'役'.padEnd(22)} 実測      理論      ズレ(σ)\n`;
    for (let c = 8; c >= 0; c--) {
        const p = THEORY7[c] / TOTAL7;
        const exp = p * sampleN;
        const sd = Math.sqrt(sampleN * p * (1 - p));
        const z = sd > 0 ? (catCounts[c] - exp) / sd : 0;
        const name = CATEGORY_NAMES[c];
        out += `${name}${' '.repeat(Math.max(1, 22 - name.length * 2))}`;
        out += `${((catCounts[c] / sampleN) * 100).toFixed(3)}%   ${(p * 100).toFixed(3)}%   ${z >= 0 ? '+' : ''}${z.toFixed(2)}${Math.abs(z) > 4 ? '  ← 要確認' : ''}\n`;
    }
    out += `</pre>`;
    $('simOut').innerHTML = out;
}
window.__setBotDelay = (ms) => {
    botDelayMs = Math.max(0, ms);
};
window.__copyProof = () => {
    if (!hand || !hand.isComplete || !commitment)
        return;
    const reveal = hand.revealFairness();
    const payload = {
        commitment: commitment.commitment,
        serverSeed: reveal.serverSeed,
        clientSeed: commitment.clientSeed,
        clientSeedParts: commitment.clientSeedParts,
        nonce: commitment.nonce,
        deck: hand.getHandHistory().deckOrder.join(' '),
    };
    const text = JSON.stringify(payload, null, 2);
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => alert(text));
    }
    else {
        alert(text);
    }
};
window.__newHand = newHand;
window.__act = (a) => heroAct(a);
window.__actRaise = () => {
    const slider = document.getElementById('raiseSlider');
    if (!slider || !hand)
        return;
    const legal = hand.getLegalActions(HERO);
    const r = legal.find((l) => l.type === 'raise' || l.type === 'bet');
    if (!r)
        return;
    heroAct(r.type, +slider.value);
};
window.__setRaise = (v) => {
    const slider = document.getElementById('raiseSlider');
    if (!slider)
        return;
    slider.value = String(v);
    const label = document.getElementById('raiseVal');
    if (label)
        label.textContent = fmt(v);
};
$('btnNew').addEventListener('click', newHand);
$('cfgReveal').addEventListener('change', render);
$('cfgAuto').addEventListener('change', () => {
    render();
    scheduleBot();
});
document.querySelectorAll('[data-sim]').forEach((b) => {
    b.addEventListener('click', () => {
        $('simOut').innerHTML = '<div class="note">実行中…</div>';
        setTimeout(() => runSim(+b.dataset.sim), 30);
    });
});
newHand();
//# sourceMappingURL=demo.js.map