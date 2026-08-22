/**
 * ブラウザクライアント
 *
 * サーバーから来た状態をそのまま描くだけで、ゲームの判断は一切しない。
 * 「合法手はサーバーが legalActions として送ってきたものが全て」という前提で作ってあるので、
 * クライアント側にルールの知識が漏れず、改造クライアントで不正もできない。
 *
 * 唯一クライアントが計算するのが Provably Fair の検証。
 * これはサーバーを疑うための機能なので、サーバーの言うことを信じては意味がない。
 */
import { PROTOCOL_VERSION } from '../src/server/protocol.js';
import { verifyHand } from '../src/fair.js';
import { cardFace, cardBack as cardBackSvg, cardSlot, VISUAL_CSS, showHandBanner, flashAllIn, flyChips, confetti, bumpPot, } from './visuals.js';
const $ = (id) => document.getElementById(id);
/** NodeList を配列にして回す。tsconfig の target 設定に依存せず動く */
const each = (sel, fn) => Array.from(document.querySelectorAll(sel)).forEach(fn);
const fmt = (n) => n.toLocaleString('ja-JP');
// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------
let ws = null;
let balance = 0;
let tables = [];
let state = null;
let currentTableId = null;
let lastSummary = null;
/** 配牌前に受け取ったコミットメント。開示値と照合するため、こちらを正とする */
let committedHash = null;
let committedFor = null;
let mySeedForHand = null;
let reconnectDelay = 500;
let goldBalance = 0;
/**
 * 直近に検証したハンドの結果。
 * 次のハンドが始まっても消さずに残す。数百ミリ秒で消える表示は、
 * プレイヤーからすると「無い」のと同じだから。
 */
let lastVerdict = null;
/** 直前に描いたボードの枚数。増えた分だけ配布演出を出すために持つ */
let lastBoardLen = 0;
let lastPotShown = 0;
let theme = 'classic';
const store = {
    get(key) {
        try {
            return localStorage.getItem(key);
        }
        catch {
            return null;
        }
    },
    set(key, v) {
        try {
            localStorage.setItem(key, v);
        }
        catch {
            /* プライベートモードなどでは諦める */
        }
    },
};
// ---------------------------------------------------------------------------
// 通信
// ---------------------------------------------------------------------------
function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}`;
    ws = new WebSocket(url);
    ws.onopen = () => {
        setStatus('接続済み', true);
        reconnectDelay = 500;
        send({
            t: 'hello',
            v: PROTOCOL_VERSION,
            name: store.get('poker.name') ?? undefined,
            resumeToken: store.get('poker.resume') ?? undefined,
        });
    };
    ws.onmessage = (ev) => {
        let msg;
        try {
            msg = JSON.parse(ev.data);
        }
        catch {
            return;
        }
        handle(msg);
    };
    ws.onclose = () => {
        setStatus('切断（再接続します）', false);
        // 指数バックオフ。即時リトライを繰り返すとサーバーに負荷をかける
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    };
    ws.onerror = () => {
        /* onclose が続けて呼ばれるのでここでは何もしない */
    };
}
function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(msg));
}
function setStatus(text, on) {
    const el = $('status');
    el.textContent = text;
    el.className = `status ${on ? 'on' : 'off'}`;
}
function handle(msg) {
    switch (msg.t) {
        case 'hello.ok':
            store.set('poker.resume', msg.resumeToken);
            store.set('poker.name', msg.name);
            balance = msg.balance;
            goldBalance = msg.gold;
            renderBalance();
            send({ t: 'lobby.list' });
            send({ t: 'tour.list' });
            // 再接続時は元のテーブルへ戻る
            if (currentTableId)
                send({ t: 'table.watch', tableId: currentTableId });
            break;
        case 'lobby.tables':
            tables = msg.tables;
            renderLobby();
            break;
        case 'balance':
            balance = msg.balance;
            if (msg.gold !== undefined)
                goldBalance = msg.gold;
            renderBalance();
            renderLobby();
            renderTournaments();
            break;
        case 'tour.tournaments':
            tournaments = msg.tournaments;
            renderTournaments();
            break;
        case 'tournament.state': {
            tourView = msg.view;
            renderTournaments();
            renderTourHud();
            // 卓に割り当てられたら自動で卓画面へ移る（MTT の卓移動でも迷子にならない）
            if (tourView.yourTableId && tourView.yourTableId !== currentTableId) {
                currentTableId = tourView.yourTableId;
                send({ t: 'table.watch', tableId: currentTableId });
                $('lobby').classList.add('hidden');
                $('table-view').classList.remove('hidden');
                log(`— ${tourView.name} 卓へ着席しました —`, 'hl');
            }
            break;
        }
        case 'shop.state':
            shop = msg.shop;
            renderShop();
            // マイページ等から購入を待っていたら、ここで確認ダイアログを開く
            if (pendingBuySku) {
                const s = pendingBuySku;
                pendingBuySku = null;
                showPurchaseDialog(s);
            }
            break;
        case 'profile':
            profile = msg.profile;
            goldBalance = msg.profile.gold;
            renderBalance();
            renderProfile();
            break;
        case 'reward':
            showReward(msg.title, msg.chips, msg.gold, msg.detail);
            send({ t: 'profile.get' });
            // 購入直後は履歴と所有状態が変わるので、ショップも取り直す
            if (activeTab === 'shop')
                send({ t: 'shop.list' });
            break;
        case 'slot.info':
            slot = msg.slot;
            renderSlot();
            break;
        case 'slot.result':
            onSlotResult(msg.result);
            break;
        case 'table.state': {
            const prev = state;
            state = msg.state;
            // 新しいハンドのコミットメントを、配牌前の時点で控える
            if (state.fairness.commitment && state.handId && committedFor !== state.handId) {
                committedHash = state.fairness.commitment;
                committedFor = state.handId;
                lastSummary = null;
                maybeSubmitSeed();
            }
            if (prev?.handId !== state.handId && state.handId) {
                log(`— ハンド #${state.handNumber} —`, 'hl');
                lastBoardLen = 0;
                lastPotShown = 0;
            }
            renderTable();
            // ポットが増えたら数字を弾ませる。増えたことに気づかせるのが目的
            if (state.pot > lastPotShown) {
                const potEl = document.querySelector('.pot');
                if (potEl)
                    bumpPot(potEl);
                lastPotShown = state.pot;
            }
            break;
        }
        case 'table.events':
            for (const e of msg.events)
                logEvent(e);
            break;
        case 'hand.result':
            lastSummary = msg.summary;
            logResult(msg.summary);
            renderFairness();
            celebrate(msg.summary);
            break;
        case 'error':
            log(`エラー: ${msg.message}`, 'ng');
            if (msg.code === 'VERSION_MISMATCH') {
                alert('クライアントが古いようです。ページを再読み込みしてください。');
            }
            break;
        case 'pong':
            break;
    }
}
/** シード受付窓が開いていたら、まだ出していない場合に限り提出する */
function maybeSubmitSeed() {
    if (!state || !state.fairness.acceptingSeeds || state.yourSeat === null || !currentTableId)
        return;
    const seed = (store.get('poker.seed') ?? '').trim() || `s${Math.random().toString(36).slice(2, 10)}`;
    mySeedForHand = seed;
    send({ t: 'fair.seed', tableId: currentTableId, seed });
}
// ---------------------------------------------------------------------------
// ロビー
// ---------------------------------------------------------------------------
function renderBalance() {
    $('balance').textContent = fmt(balance);
    const g = document.getElementById('gold');
    if (g)
        g.textContent = fmt(goldBalance);
    const v = document.getElementById('vip-badge');
    if (v && profile)
        v.textContent = `👑 ${profile.vip.tierName}`;
}
function renderLobby() {
    $('tables').innerHTML = tables
        .map((t) => `<div class="tcard">
        <h3>${escapeHtml(t.name)}</h3>
        <div class="blinds">${fmt(t.smallBlind)} / ${fmt(t.bigBlind)}</div>
        <dl>
          <dt>着席</dt><dd>${t.seatedCount} / ${t.maxSeats}</dd>
          <dt>バイイン</dt><dd>${fmt(t.minBuyIn)} 〜 ${fmt(t.maxBuyIn)}</dd>
          <dt>平均ポット</dt><dd>${t.avgPot ? fmt(t.avgPot) : '—'}</dd>
        </dl>
        <button class="primary" data-join="${t.tableId}"
          ${balance < t.minBuyIn ? 'disabled' : ''}>
          ${balance < t.minBuyIn ? '残高不足' : '参加する'}
        </button>
      </div>`)
        .join('');
    each('[data-join]', (b) => {
        b.onclick = () => joinTable(b.dataset.join);
    });
}
function joinTable(tableId) {
    currentTableId = tableId;
    send({ t: 'table.watch', tableId });
    $('lobby').classList.add('hidden');
    $('table-view').classList.remove('hidden');
    $('log').innerHTML = '';
    const info = tables.find((t) => t.tableId === tableId);
    if (info)
        showBuyInDialog(info);
}
function backToLobby() {
    if (currentTableId)
        send({ t: 'table.leave', tableId: currentTableId });
    currentTableId = null;
    state = null;
    $('table-view').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    send({ t: 'lobby.list' });
}
// ---------------------------------------------------------------------------
// バイインダイアログ
// ---------------------------------------------------------------------------
function showBuyInDialog(info) {
    const max = Math.min(info.maxBuyIn, balance);
    if (max < info.minBuyIn) {
        log('残高が足りないため観戦のみになります', 'ng');
        return;
    }
    const def = Math.min(max, info.maxBuyIn);
    modal(`<h3>${escapeHtml(info.name)} に着席</h3>
     <label>持ち込むチップ（${fmt(info.minBuyIn)} 〜 ${fmt(max)}）</label>
     <input type="range" id="bi-range" min="${info.minBuyIn}" max="${max}" step="${info.bigBlind}" value="${def}" style="width:100%">
     <div style="text-align:center;font-size:24px;font-weight:700;margin-top:8px" id="bi-val">${fmt(def)}</div>
     <div class="note">ブラインド ${fmt(info.smallBlind)} / ${fmt(info.bigBlind)}　＝　${Math.round(def / info.bigBlind)} BB</div>
     <div class="row">
       <button id="bi-cancel">観戦する</button>
       <button class="primary" id="bi-ok">着席</button>
     </div>`, (close) => {
        const range = $('bi-range');
        range.oninput = () => ($('bi-val').textContent = fmt(+range.value));
        $('bi-cancel').onclick = close;
        $('bi-ok').onclick = () => {
            send({ t: 'table.sit', tableId: info.tableId, buyIn: +range.value });
            close();
        };
    });
}
function modal(html, wire) {
    const root = $('modal-root');
    root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
    const close = () => (root.innerHTML = '');
    wire(close);
}
// ---------------------------------------------------------------------------
// テーブル描画
// ---------------------------------------------------------------------------
/**
 * カードは SVG で描く（visuals.ts）。
 * サーバーから来るのは "♠A" のような表記なので、そのまま渡せる。
 */
const cardHtml = (code, size = 'md', highlight = false, extra = '') => cardFace(code, { size, highlight, extra });
const backHtml = (size = 'sm', extra = '') => cardBackSvg({ size, extra });
const STREET_LABEL = {
    waiting: '待機中',
    preflop: 'プリフロップ',
    flop: 'フロップ',
    turn: 'ターン',
    river: 'リバー',
    showdown: 'ショーダウン',
    complete: '結果',
};
function renderTable() {
    const st = state;
    if (!st)
        return;
    const winners = new Set();
    const winningCards = new Set();
    if (lastSummary && lastSummary.handId === st.handId) {
        for (const p of lastSummary.pots)
            for (const w of p.winners)
                winners.add(w);
        // 勝者の役を構成した 5 枚だけを光らせる。
        // 手札全部を光らせると「どの 5 枚で勝ったのか」が伝わらない
        for (const hnd of lastSummary.hands) {
            if (!winners.has(hnd.seat))
                continue;
            for (const c of hnd.best ?? [])
                winningCards.add(c);
        }
    }
    const n = st.maxSeats;
    const myIndex = st.yourSeat ?? 0;
    let html = `<div class="center">
    <div class="street-tag">${STREET_LABEL[st.street] ?? st.street}</div>
    <div class="board">${renderBoard(st, winningCards)}</div>
    <div class="pot">ポット <b>${fmt(st.pot)}</b></div>
  </div>`;
    for (let i = 0; i < n; i++) {
        const s = st.seats[i];
        // 自分の席が常に手前（下）に来るよう回転させる
        const k = (i - myIndex + n) % n;
        const a = ((180 + (k * 360) / n) * Math.PI) / 180;
        const x = 50 + 40 * Math.sin(a);
        const y = 47 - 36 * Math.cos(a);
        if (!s.userId) {
            const canSit = st.yourSeat === null && balance > 0;
            html += `<div class="seat empty" style="left:${x}%;top:${y}%">
        <div class="cards"></div>
        <div class="box"><div class="nm">空席</div>
        ${canSit ? `<button class="chip" data-sit="${i}" style="margin-top:3px">座る</button>` : '<div class="st">—</div>'}
        </div><div class="bet"></div></div>`;
            continue;
        }
        const isMe = s.seat === st.yourSeat;
        const showdownOpen = st.street === 'complete';
        const cards = s.holeCards
            ? s.holeCards
                .map((c) => cardHtml(c, isMe ? 'lg' : 'sm', winningCards.has(c), 
            // ショーダウンで公開されたときはめくる演出を付ける
            showdownOpen && !isMe ? 'flipping' : ''))
                .join('')
            : st.street === 'waiting' || s.folded
                ? ''
                : backHtml('sm') + backHtml('sm');
        const badges = (i === st.buttonIndex ? '<span class="badge">D</span>' : '') +
            (isMe ? '<span class="badge you">YOU</span>' : '') +
            (s.allIn ? '<span class="badge allin">ALL IN</span>' : '') +
            (s.sittingOut ? '<span class="badge out">休憩</span>' : '') +
            (winners.has(i) ? '<span class="badge win">WIN</span>' : '');
        // 残り時間バー。分母はサーバーが送る総時間(既定60秒)。固定値にするとズレる
        const totalMs = st.actionTotalMs && st.actionTotalMs > 0 ? st.actionTotalMs : 60_000;
        const acting = st.actingSeat === i && s.timeLeftMs !== null && s.timeLeftMs !== undefined;
        const timerPct = acting ? Math.max(0, Math.min(100, (s.timeLeftMs / totalMs) * 100)) : 0;
        const timerLevel = timerPct <= 16.7 ? 'crit' : timerPct <= 33.3 ? 'warn' : 'ok';
        const timerSec = acting ? Math.ceil(s.timeLeftMs / 1000) : 0;
        html += `<div class="seat ${st.actingSeat === i ? 'acting' : ''} ${s.folded ? 'folded' : ''}"
        data-seat="${i}" style="left:${x}%;top:${y}%">
      <div class="cards">${cards}</div>
      <div class="box">
        <div class="nm">${escapeHtml(s.name ?? '')}${badges}</div>
        <div class="st">${fmt(s.stack)}</div>
        ${acting ? `<div class="timer-sec">${timerSec}</div>` : ''}
        ${acting ? `<div class="timer" data-level="${timerLevel}" style="width:${timerPct}%"></div>` : ''}
      </div>
      <div class="bet">${s.streetBet > 0 ? `▸ ${fmt(s.streetBet)}` : ''}</div>
    </div>`;
    }
    $('felt').innerHTML = html;
    each('[data-sit]', (b) => {
        b.onclick = () => {
            const info = tables.find((t) => t.tableId === st.tableId);
            if (info)
                showBuyInDialog({ ...info, tableId: st.tableId });
        };
    });
    renderActions();
    renderFairness();
    // ストラドルは許可された卓でのみ出す。押すと次に UTG になったハンドで自動的に置かれる
    const sb = document.getElementById('btn-straddle');
    if (sb) {
        sb.classList.toggle('hidden', !st.straddleAllowed || st.yourSeat === null);
        sb.textContent = st.straddleArmed ? 'ストラドル ON' : 'ストラドル';
        sb.classList.toggle('primary', st.straddleArmed);
    }
}
/**
 * ボードの描画。
 * まだ開いていない位置には空きスロットを置く。
 * 「5 枚のうち何枚目まで開いたか」が一目で分かるので、初心者の理解を助ける。
 */
function renderBoard(st, winningCards) {
    const cards = st.board
        .map((c, i) => {
        // 直前の描画より増えた札だけにディール演出を付ける（毎回動くとうるさい）
        const isNew = i >= lastBoardLen;
        return cardHtml(c, 'md', winningCards.has(c), isNew ? 'dealing' : '');
    })
        .join('');
    const slots = st.street === 'waiting' ? '' : cardSlot('md').repeat(Math.max(0, 5 - st.board.length));
    lastBoardLen = st.board.length;
    return cards + slots || '<span style="color:rgba(255,255,255,.28);font-size:12px">— 待機中 —</span>';
}
/**
 * 決着の演出。
 *
 * 出し分けの方針：毎回同じ派手さで出すと、数ハンドで「ただのノイズ」になる。
 * 役の強さとポットの大きさで段階を変え、本当に大きいときだけ紙吹雪まで出す。
 */
function celebrate(summary) {
    const felt = document.getElementById('felt');
    if (!felt || !state)
        return;
    const mySeat = state.yourSeat;
    const winners = new Set();
    for (const p of summary.pots)
        for (const w of p.winners)
            winners.add(w);
    // 勝者の席からポットへチップを飛ばす（実際には逆向きだが、視線誘導としてはこちらが自然）
    for (const seatIdx of winners) {
        const el = felt.querySelector(`.seat[data-seat="${seatIdx}"]`);
        if (el)
            flyChips(felt, el, 6);
    }
    const best = summary.hands.find((h) => winners.has(h.seat));
    if (best && summary.showdown) {
        showHandBanner(felt, best.description);
    }
    const potTotal = summary.pots.reduce((a, p) => a + p.amount, 0);
    const iWon = mySeat !== null && winners.has(mySeat);
    const strong = best ? /ロイヤル|ストレートフラッシュ|フォーカード|フルハウス/.test(best.description) : false;
    // 紙吹雪は「自分が強い役で勝った」「ポットが自分のスタックを超えた」ときだけ
    const myStack = mySeat !== null ? (state.seats[mySeat]?.stack ?? 0) : 0;
    if (iWon && (strong || potTotal > myStack * 0.6)) {
        confetti(felt, strong ? 90 : 50);
    }
}
function renderActions() {
    const st = state;
    const box = $('actions');
    if (!st || !st.legalActions.length || !st.handId) {
        box.innerHTML = st?.yourSeat === null
            ? '<div class="hint">観戦中です。空席の「座る」を押すと参加できます。</div>'
            : '<div class="hint">相手の番を待っています…</div>';
        return;
    }
    const legal = st.legalActions;
    const check = legal.find((a) => a.type === 'check');
    const call = legal.find((a) => a.type === 'call');
    const raise = legal.find((a) => a.type === 'raise' || a.type === 'bet');
    let html = '<div class="btnrow main">';
    html += `<button class="danger" data-act="fold">フォールド</button>`;
    if (check)
        html += `<button data-act="check">チェック</button>`;
    if (call)
        html += `<button data-act="call">コール ${fmt(call.amount ?? 0)}</button>`;
    if (raise)
        html += `<button class="primary" data-act="raise">${raise.type === 'bet' ? 'ベット' : 'レイズ'} <span id="rv">${fmt(raise.min)}</span></button>`;
    html += '</div>';
    if (raise) {
        const presets = buildPresets(st, raise);
        html += `<div class="slider-wrap">
      <input type="range" id="rs" min="${raise.min}" max="${raise.max}" step="1" value="${raise.min}" style="width:100%">
      <div class="btnrow" style="margin-top:6px">${presets
            .map(([label, v]) => `<button class="chip" data-set="${v}">${label}<br><span style="color:var(--muted);font-size:11px">${fmt(v)}</span></button>`)
            .join('')}</div>
      <div class="hint">最小 ${fmt(raise.min)} / 最大 ${fmt(raise.max)}（この数字は「このストリートで最終的に出す総額」です）</div>
    </div>`;
    }
    box.innerHTML = html;
    const slider = document.getElementById('rs');
    if (slider) {
        slider.oninput = () => {
            const v = document.getElementById('rv');
            if (v)
                v.textContent = fmt(+slider.value);
        };
    }
    each('[data-act]', (b) => {
        b.onclick = () => {
            const a = b.dataset.act;
            const to = a === 'raise' && slider ? +slider.value : undefined;
            const realType = a === 'raise' ? raise.type : a;
            send({ t: 'hand.act', tableId: st.tableId, handId: st.handId, action: realType, toAmount: to });
            // 送信直後にボタンを消す。二重送信は STALE_HAND で弾かれるが、
            // 「押したのに反応しない」という体感を避けるため即座に見た目を切り替える
            $('actions').innerHTML = '<div class="hint">送信中…</div>';
        };
    });
    each('[data-set]', (b) => {
        b.onclick = () => {
            if (!slider)
                return;
            slider.value = b.dataset.set;
            const v = document.getElementById('rv');
            if (v)
                v.textContent = fmt(+slider.value);
        };
    });
}
function buildPresets(st, raise) {
    const clamp = (v) => Math.max(raise.min, Math.min(raise.max, Math.round(v)));
    return [
        ['1/2 ポット', clamp(st.pot * 0.5 + st.currentBet)],
        ['2/3 ポット', clamp(st.pot * 0.66 + st.currentBet)],
        ['ポット', clamp(st.pot + st.currentBet)],
        ['オールイン', raise.max],
    ];
}
// ---------------------------------------------------------------------------
// 公正性パネル
// ---------------------------------------------------------------------------
function renderFairness() {
    const st = state;
    const box = $('fair');
    if (!st) {
        box.innerHTML = '';
        return;
    }
    // ハンドが終わっていれば、その場で検証して結果を控える
    if (lastSummary && committedHash && lastSummary.handId === st.handId) {
        // 開示されたシードが、配牌前に受け取ったハッシュと合うかを自分で確かめる。
        // サーバーが一緒に送ってきた commitment を使っては検証の意味が無いので、
        // 必ず「先に受け取っておいた値」と照合する
        const f = lastSummary.fairness;
        const r = verifyHand({
            serverSeed: f.serverSeed,
            commitment: committedHash,
            clientSeed: f.clientSeed,
            nonce: f.nonce,
            deck: f.deck,
        });
        lastVerdict = {
            handNumber: lastSummary.handNumber,
            passed: r.passed,
            detail: r.checks.find((c) => !c.passed)?.detail ?? '',
            query: new URLSearchParams({
                serverSeed: f.serverSeed,
                commitment: committedHash,
                clientSeed: f.clientSeed,
                nonce: String(f.nonce),
                deck: f.deck.join(' '),
            }).toString(),
        };
    }
    const revealed = lastSummary && lastSummary.handId === st.handId;
    let html = `<dl class="kv">
    <dt>今のコミットメント</dt><dd>${committedHash ? shorten(committedHash) : '—'}</dd>
    <dt>あなたのシード</dt><dd>${mySeedForHand ? escapeHtml(mySeedForHand) : '—'}</dd>
    <dt>サーバーシード</dt><dd>${revealed
        ? shorten(lastSummary.fairness.serverSeed)
        : '<span class="sealed">ハンド終了後に開示</span>'}</dd>
  </dl>`;
    if (lastVerdict) {
        html += lastVerdict.passed
            ? `<div class="verdict ok">✓ ハンド #${lastVerdict.handNumber}：配る前に確定していた並びと一致</div>`
            : `<div class="verdict ng">✗ ハンド #${lastVerdict.handNumber}：検証に失敗 ${escapeHtml(lastVerdict.detail)}</div>`;
        html += `<div class="btnrow">
      <a class="chip" style="text-decoration:none;display:inline-block;padding:5px 11px;border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:12px"
         href="poker-fairness-verifier.html?${lastVerdict.query}" target="_blank">別ツールで検証</a>
    </div>`;
    }
    html += st.fairness.acceptingSeeds
        ? '<div class="note">シードを受付中です。あなたのシードも配牌に反映されます。</div>'
        : '<div class="note">上のハッシュはカードが配られる前に公開されたものです。ハンド終了後にシードが開示され、この場で自動照合します。</div>';
    box.innerHTML = html;
}
const shorten = (s) => (s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s);
// ---------------------------------------------------------------------------
// ログ
// ---------------------------------------------------------------------------
function log(text, cls = '') {
    const box = $('log');
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    box.appendChild(div);
    while (box.childElementCount > 200)
        box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
}
const ACTION_JA = {
    fold: 'フォールド',
    check: 'チェック',
    call: 'コール',
    bet: 'ベット',
    raise: 'レイズ',
};
function nameOfSeat(seat) {
    return state?.seats[seat]?.name ?? `席${seat}`;
}
function logEvent(e) {
    switch (e.type) {
        case 'blind':
            log(`${nameOfSeat(e.seat)} ${String(e.blind).toUpperCase()} ${fmt(e.amount)}`);
            break;
        case 'straddle':
            log(`${nameOfSeat(e.seat)} ストラドル ${fmt(e.amount)}`, 'hl');
            break;
        case 'street':
            if (e.board.length)
                log(`— ${STREET_LABEL[e.street]} —`, 'hl');
            break;
        case 'action': {
            log(`${nameOfSeat(e.seat)} ${ACTION_JA[e.action]}${e.amount ? ` ${fmt(e.amount)}` : ''}${e.allIn ? ' (ALL IN)' : ''}`);
            if (e.allIn) {
                const felt = document.getElementById('felt');
                if (felt)
                    flashAllIn(felt);
            }
            break;
        }
        case 'uncalled_return':
            log(`${nameOfSeat(e.seat)} へ ${fmt(e.amount)} 返却`);
            break;
        case 'award':
            log(`${nameOfSeat(e.seat)} +${fmt(e.amount)}`, 'win');
            break;
    }
}
function logResult(s) {
    if (s.showdown) {
        for (const h of s.hands)
            log(`公開 ${nameOfSeat(h.seat)} ${h.cards.join(' ')} → ${h.description}`);
    }
    const mySeat = state?.yourSeat;
    if (mySeat !== null && mySeat !== undefined) {
        const net = s.netChange[mySeat] ?? 0;
        log(`結果 ${net >= 0 ? '+' : ''}${fmt(net)}`, net > 0 ? 'win' : '');
    }
}
// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
$('btn-lobby').onclick = backToLobby;
$('btn-straddle').onclick = () => {
    if (!currentTableId || !state)
        return;
    send({ t: 'table.straddle', tableId: currentTableId, enabled: !state.straddleArmed });
};
$('btn-sitout').onclick = () => {
    if (!currentTableId || !state)
        return;
    const me = state.yourSeat !== null ? state.seats[state.yourSeat] : null;
    send({ t: 'table.sitOut', tableId: currentTableId, sitOut: !(me?.sittingOut ?? false) });
};
$('btn-stand').onclick = () => {
    if (!currentTableId)
        return;
    send({ t: 'table.stand', tableId: currentTableId });
};
$('btn-rebuy').onclick = () => {
    if (!currentTableId || !state || state.yourSeat === null)
        return;
    const info = tables.find((t) => t.tableId === currentTableId);
    if (!info)
        return;
    const me = state.seats[state.yourSeat];
    const room = Math.min(info.maxBuyIn - me.stack, balance);
    if (room <= 0) {
        log('これ以上追加できません', 'ng');
        return;
    }
    modal(`<h3>チップを追加</h3>
     <label>追加する額（最大 ${fmt(room)}）</label>
     <input type="range" id="rb-range" min="${Math.min(info.bigBlind, room)}" max="${room}" step="${info.bigBlind}" value="${room}" style="width:100%">
     <div style="text-align:center;font-size:24px;font-weight:700;margin-top:8px" id="rb-val">${fmt(room)}</div>
     <div class="row"><button id="rb-cancel">やめる</button><button class="primary" id="rb-ok">追加</button></div>`, (close) => {
        const range = $('rb-range');
        range.oninput = () => ($('rb-val').textContent = fmt(+range.value));
        $('rb-cancel').onclick = close;
        $('rb-ok').onclick = () => {
            send({ t: 'table.rebuy', tableId: currentTableId, amount: +range.value });
            close();
        };
    });
};
// 定期的にロビー情報を更新し、ping で接続を維持する
setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
        send({ t: 'ping', ts: Date.now() });
        if (!currentTableId)
            send({ t: 'lobby.list' });
    }
}, 5000);
// ---------------------------------------------------------------- 効果音
// 音声ファイルは持たず WebAudio で合成する（アセット追加なし・読み込み待ちなし）。
// ブラウザは操作前の再生を禁じるので、最初のクリック/キー入力で AudioContext を起こす。
let audioCtx = null;
let soundOn = store.get('poker.sound') !== 'off';
function initAudio() {
    if (audioCtx)
        return;
    try {
        const w = window;
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (Ctor)
            audioCtx = new Ctor();
    }
    catch { /* 音が出せない環境でも動作は続ける */ }
}
// 仮想DOM(E2E)には window.addEventListener が無いことがあるので存在確認してから登録する
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pointerdown', initAudio, { once: true });
    window.addEventListener('keydown', initAudio, { once: true });
}
/** 短いビープ。freq=高さ, ms=長さ, gain=音量 */
function beep(freq, ms, gain = 0.14) {
    if (!soundOn)
        return;
    initAudio();
    const ctx = audioCtx;
    if (!ctx)
        return;
    if (ctx.state === 'suspended')
        void ctx.resume();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // 立ち上がり/減衰をつけないとプチッというクリックノイズが乗る
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
}
/** 手番が回ってきた合図（上がる2音） */
function soundYourTurn() { beep(660, 110); setTimeout(() => beep(880, 130), 120); }
/** 残り30秒（落ち着いた単音） */
function soundWarn30() { beep(560, 160); }
/** 残り15秒（強めの2連打） */
function soundWarn15() { beep(760, 130); setTimeout(() => beep(760, 160), 190); }
/** 残り5秒からの毎秒カウント（短く鋭い） */
function soundTick() { beep(980, 70, 0.1); }
export function setSoundEnabled(on) {
    soundOn = on;
    store.set('poker.sound', on ? 'on' : 'off');
    if (on) {
        initAudio();
        beep(880, 120);
    } // オンにした手応えを返す
}
export function isSoundEnabled() { return soundOn; }
// ---------------------------------------------------------------- 残り時間バー
// サーバーの状態更新を待たずローカルで減らし、60秒の残りを視覚と音で伝える。
// 分母は必ずサーバーが送る actionTotalMs を使う（固定値だと切断中の席などでズレる）。
/** 直前に鳴らした警告のしきい値。同じ秒で鳴り続けないための記録 */
let lastWarnAt = -1;
/** 手番開始音を鳴らした対象。手番が変わるまで一度だけ鳴らす */
let turnSoundFor = null;
setInterval(() => {
    if (!state || state.actingSeat === null) {
        lastWarnAt = -1;
        turnSoundFor = null;
        return;
    }
    const seat = state.seats[state.actingSeat];
    if (seat?.timeLeftMs === null || seat?.timeLeftMs === undefined)
        return;
    seat.timeLeftMs = Math.max(0, seat.timeLeftMs - 200);
    const total = state.actionTotalMs && state.actionTotalMs > 0 ? state.actionTotalMs : 60_000;
    const pct = Math.max(0, Math.min(100, (seat.timeLeftMs / total) * 100));
    const bar = document.querySelector('.seat.acting .timer');
    if (bar) {
        bar.style.width = `${pct}%`;
        // 残り 1/3 で黄、1/6 で赤。色でも残量が分かるようにする
        bar.dataset.level = pct <= 16.7 ? 'crit' : pct <= 33.3 ? 'warn' : 'ok';
    }
    const label = document.querySelector('.seat.acting .timer-sec');
    if (label)
        label.textContent = `${Math.ceil(seat.timeLeftMs / 1000)}`;
    // 音は自分の手番のときだけ。他人の手番で鳴ると煩わしい
    const myTurn = state.yourSeat !== null && state.yourSeat === state.actingSeat;
    if (!myTurn) {
        lastWarnAt = -1;
        turnSoundFor = null;
        return;
    }
    const key = `${state.handNumber ?? 0}:${state.actingSeat}:${Math.round(total)}`;
    if (turnSoundFor !== key) {
        turnSoundFor = key;
        lastWarnAt = -1;
        soundYourTurn();
    }
    const sec = Math.ceil(seat.timeLeftMs / 1000);
    if (sec === lastWarnAt)
        return;
    if (sec === 30) {
        lastWarnAt = sec;
        soundWarn30();
    }
    else if (sec === 15) {
        lastWarnAt = sec;
        soundWarn15();
    }
    else if (sec <= 5 && sec >= 1) {
        lastWarnAt = sec;
        soundTick();
    }
}, 200);
// visuals.ts のスタイルを流し込む。テンプレート HTML 側に重複を持たせないため
const styleEl = document.createElement('style');
styleEl.textContent = VISUAL_CSS;
document.head.appendChild(styleEl);
/** テーマは data-theme 属性 1 つで切り替わる。カードも卓もまとめて変わる */
function applyTheme(next) {
    theme = next;
    document.documentElement.setAttribute('data-theme', next);
    store.set('poker.theme', next);
    const btn = document.getElementById('btn-theme');
    if (btn)
        btn.textContent = next === 'classic' ? '🎨 クラシック' : '🎨 ネオン';
}
applyTheme(store.get('poker.theme') ?? 'classic');
const themeBtn = document.getElementById('btn-theme');
if (themeBtn)
    themeBtn.onclick = () => applyTheme(theme === 'classic' ? 'neon' : 'classic');
// スートの色数（4色 / 赤黒2色）も切り替えられるようにする。
// 4色は色覚特性に配慮した表示だが、慣れた人には 2色の方が読みやすい
function applySuits(mode) {
    document.documentElement.setAttribute('data-suits', mode);
    store.set('poker.suits', mode);
    const btn = document.getElementById('btn-suits');
    if (btn)
        btn.textContent = mode === 'four' ? '♠ 4色' : '♠ 2色';
}
applySuits(store.get('poker.suits') ?? 'four');
const suitsBtn = document.getElementById('btn-suits');
if (suitsBtn)
    suitsBtn.onclick = () => applySuits(document.documentElement.getAttribute('data-suits') === 'four' ? 'two' : 'four');
// 効果音のオン/オフ。設定は localStorage に残す
function applySoundBtn() {
    const btn = document.getElementById('sound-toggle');
    if (!btn)
        return;
    const on = isSoundEnabled();
    btn.textContent = on ? '🔊 音' : '🔇 音';
    btn.classList.toggle('off', !on);
}
applySoundBtn();
const soundBtn = document.getElementById('sound-toggle');
if (soundBtn)
    soundBtn.onclick = () => { setSoundEnabled(!isSoundEnabled()); applySoundBtn(); };
connect();
let tournaments = [];
let tourView = null;
let shop = null;
let profile = null;
let activeTab = 'cash';
/** モック決済のレシート。本番では Apple / Google が発行したものを渡す */
const mockReceipt = () => `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
function switchTab(tab) {
    activeTab = tab;
    each('.tab', (b) => b.classList.toggle('active', b.dataset.tab === tab));
    each('.tabpage', (p) => p.classList.add('hidden'));
    document.getElementById(`tab-${tab}`)?.classList.remove('hidden');
    if (tab === 'tour')
        send({ t: 'tour.list' });
    if (tab === 'shop')
        send({ t: 'shop.list' });
    if (tab === 'me')
        send({ t: 'profile.get' });
    if (tab === 'slot')
        send({ t: 'slot.state' });
}
// ---------------------------------------------------------------- ゴールドスロット
/** 絵柄キー → 表示する絵文字 */
const SLOT_ICON = {
    chip: '🪙', club: '♣️', diamond: '♦️', heart: '♥️', spade: '♠️', crown: '👑', seven: '7️⃣',
};
let slot = null;
let slotBet = 1;
let slotSpinning = false;
/** 直前の結果（表示用に保持する） */
let slotLast = null;
function renderSlot() {
    const el = document.getElementById('slot');
    if (!el)
        return;
    if (!slot) {
        el.innerHTML = '<p class="note">読み込み中…</p>';
        return;
    }
    const s = slot;
    // client/ は旧世代の簡易版。実運用は手編集の poker-client.html なので、
    // ここでは新エンジンの結果から最初の盤面だけ拾って型を通す
    const oc = slotLast?.outcome;
    const reels = oc?.base?.[0]?.grid?.map((col) => col[0]) ?? ['chip', 'club', 'diamond'];
    const canSpin = !slotSpinning && s.gold >= slotBet && s.spinsLeft > 0;
    // 当たりの大きさで見せ方を変える（ジャックポットは別格に）
    let winCls = '', winText = '';
    if (slotLast && !slotSpinning) {
        if (slotLast.kind === 'max') {
            winCls = 'jackpot';
            winText = `🎉 MAX WIN！ +${fmt(slotLast.won)}`;
        }
        else if (slotLast.kind === 'mega') {
            winCls = 'jackpot';
            winText = `🎉 メガウィン！ +${fmt(slotLast.won)}`;
        }
        else if (slotLast.kind === 'big') {
            winCls = 'big';
            winText = `ビッグウィン！ +${fmt(slotLast.won)}`;
        }
        else if (slotLast.kind === 'small') {
            winText = `+${fmt(slotLast.won)}`;
        }
        else {
            winText = 'ハズレ';
        }
    }
    el.innerHTML = `<div class="slot-wrap">
    <div class="slot-machine">
      <div style="font-size:13px;color:var(--muted)">ゴールドを賭けてチップを狙う</div>
      <div class="reels">
        ${reels.map((k) => `<div class="reel ${slotSpinning ? 'spinning' : ''}">${SLOT_ICON[k] ?? '❓'}</div>`).join('')}
      </div>
      <div class="slot-win ${winCls}">${escapeHtml(winText)}</div>
      <div class="bet-row">
        ${s.bets.map((b) => `<button class="bet-btn ${b === slotBet ? 'sel' : ''}" data-bet="${b}">🪙 ${b}</button>`).join('')}
      </div>
      <button class="spin-btn" id="slot-spin" ${canSpin ? '' : 'disabled'}>
        ${slotSpinning ? '回転中…' : s.spinsLeft <= 0 ? '本日は終了' : s.gold < slotBet ? 'ゴールド不足' : 'まわす'}
      </button>
      <div class="note" style="margin-top:9px;font-size:12px">
        所持 🪙 ${fmt(s.gold)} ／ 本日あと ${s.spinsLeft} 回
      </div>
    </div>

    <div class="mult-box">
      <div style="color:var(--muted);margin-bottom:5px">払い出し倍率の内訳</div>
      <div class="row"><span>VIPランク（${escapeHtml(s.vipTierName)}）</span><b>×${s.vipPart}</b></div>
      <div class="row"><span>連続ログイン ${s.streak} 日</span><b>×${s.streakPart}</b></div>
      <div class="row total"><span>現在の倍率</span><b>×${s.multiplier}</b></div>
      <div class="note" style="margin-top:7px;font-size:11px">
        ランクを上げるほど、毎日ログインするほど倍率が上がります（連続は14日で頭打ち）。
      </div>
    </div>

    <table class="paytable">
      <tr><th>絵柄</th><th>5個</th><th>4個</th><th>3個</th></tr>
      ${s.symbols.map((sym) => `<tr>
        <td>${SLOT_ICON[sym.key] ?? ''} ${escapeHtml(sym.name)}</td>
        <td>${fmt(Math.round(sym.pay[2] * slotBet * s.chipsPerGold * s.multiplier))}</td>
        <td>${fmt(Math.round(sym.pay[1] * slotBet * s.chipsPerGold * s.multiplier))}</td>
        <td>${sym.pay[0] > 0 ? fmt(Math.round(sym.pay[0] * slotBet * s.chipsPerGold * s.multiplier)) : '—'}</td>
      </tr>`).join('')}
    </table>
    <p class="note" style="font-size:11px">表の金額は現在の賭け金（🪙${slotBet}）と倍率での払い出しです。</p>
  </div>`;
    each('[data-bet]', (b) => {
        b.onclick = () => { slotBet = Number(b.dataset.bet); renderSlot(); };
    });
    const spinBtn = document.getElementById('slot-spin');
    if (spinBtn)
        spinBtn.onclick = () => {
            if (slotSpinning || !slot || slot.gold < slotBet || slot.spinsLeft <= 0)
                return;
            slotSpinning = true;
            slotLast = null;
            renderSlot();
            send({ t: 'slot.spin', bet: slotBet });
        };
}
/** スロットの結果が届いたら、少し回してから止める（演出） */
function onSlotResult(r) {
    slotLast = r;
    if (slot) {
        slot.gold = r.goldLeft;
        slot.spinsLeft = r.spinsLeft;
    }
    // 即座に確定させると回転が一瞬で終わって手応えが無いので、少しだけ見せる
    setTimeout(() => {
        slotSpinning = false;
        renderSlot();
        if (r.kind === 'max' || r.kind === 'mega') {
            beep(880, 140);
            setTimeout(() => beep(1174, 160), 150);
            setTimeout(() => beep(1568, 260), 320);
        }
        else if (r.kind === 'big') {
            beep(784, 130);
            setTimeout(() => beep(1046, 190), 140);
        }
        else if (r.kind === 'small')
            beep(660, 110);
    }, 700);
}
function renderTournaments() {
    const el = document.getElementById('tournaments');
    if (!el)
        return;
    const STATE_JA = {
        registering: '受付中',
        running: '進行中',
        finished: '終了',
        cancelled: '中止',
    };
    const BOUNTY_JA = {
        none: '',
        classic: 'ノックアウト',
        progressive: 'PKO',
        mystery: 'ミステリーバウンティ',
    };
    const SPEED_JA = { normal: '', turbo: 'ターボ', hyper: 'ハイパー' };
    el.innerHTML = tournaments
        .map((t) => {
        const joined = tourView?.tournamentId === t.tournamentId && tourView.registered;
        const canJoin = t.state === 'registering' || (t.state === 'running' && t.type === 'mtt');
        const tags = [BOUNTY_JA[t.bountyMode], SPEED_JA[t.speed]].filter(Boolean).join('・');
        return `<div class="tcard">
        <h3>${escapeHtml(t.name)}</h3>
        <div class="blinds">${t.type === 'sng' ? 'Sit &amp; Go' : 'マルチテーブル'}・${STATE_JA[t.state]}${tags ? ` <span class="badge">${tags}</span>` : ''}</div>
        <dl>
          <dt>参加費</dt><dd>${fmt(t.buyIn)} + ${fmt(t.fee)}</dd>
          <dt>参加者</dt><dd>${t.entrants} / ${t.maxPlayers}</dd>
          <dt>賞金総額</dt><dd>${fmt(t.prizePool)}</dd>
          <dt>開始</dt><dd>${escapeHtml(t.startsWhen)}</dd>
        </dl>
        <button class="${joined ? '' : 'primary'}" data-tour="${t.tournamentId}" data-act="${joined ? 'open' : 'join'}"
          ${!joined && (!canJoin || balance < t.buyIn + t.fee) ? 'disabled' : ''}>
          ${joined ? '参加中 — 卓へ' : balance < t.buyIn + t.fee ? '残高不足' : '参加する'}
        </button>
      </div>`;
    })
        .join('');
    each('[data-tour]', (b) => {
        b.onclick = () => {
            const id = b.dataset.tour;
            if (b.dataset.act === 'join')
                send({ t: 'tour.register', tournamentId: id });
            send({ t: 'tour.watch', tournamentId: id });
        };
    });
}
function renderTourHud() {
    const hud = document.getElementById('tour-hud');
    const info = document.getElementById('tour-info');
    if (!hud || !info)
        return;
    const v = tourView;
    if (!v || !v.registered || v.state === 'registering') {
        hud.classList.add('hidden');
        return;
    }
    hud.classList.remove('hidden');
    const finished = v.yourFinishPosition !== null;
    const b = v.bounty;
    const bountyHtml = b.mode === 'none'
        ? ''
        : `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
          <dl class="tour-row">
            <dt>方式</dt><dd>${b.mode === 'classic' ? 'ノックアウト' : b.mode === 'progressive' ? 'PKO' : 'ミステリー'}</dd>
            <dt>賞金首プール</dt><dd>${fmt(b.pool)}</dd>
            ${b.mode === 'mystery' ? '' : `<dt>あなたの賞金首</dt><dd>${fmt(b.yourBounty)}</dd>`}
            <dt>獲得済み</dt><dd>${fmt(b.yourEarned)}（${b.yourKnockouts} KO）</dd>
            ${b.mode === 'mystery' && b.active ? `<dt>残り封筒</dt><dd>${b.remainingEnvelopes.length} 枚（最高 ${fmt(b.remainingEnvelopes[0] ?? 0)}）</dd>` : ''}
          </dl>
          ${b.mode === 'mystery' && !b.active ? '<div class="note">残り 15% になると封筒が有効になります</div>' : ''}
          ${b.commitment ? `<div class="note">封筒の並びのコミットメント：${shorten(b.commitment)}${b.serverSeed ? `<br>開示シード：${shorten(b.serverSeed)}` : '（終了後に開示）'}</div>` : ''}
          ${b.recent.length
            ? `<div class="lb">${b.recent
                .slice()
                .reverse()
                .map((r) => `<div><span>${escapeHtml(r.winner)} ➜ ${escapeHtml(r.victim)}</span><span>${fmt(r.cash)}${r.label ? `（${escapeHtml(r.label)}）` : ''}</span></div>`)
                .join('')}</div>`
            : ''}
        </div>`;
    const extraHtml = `<div class="btnrow" style="margin-top:8px">
      ${v.addOnAvailable ? `<button class="chip primary" id="btn-addon">アドオン ${fmt(v.addOnPrice)}（+${fmt(v.addOnChips)}）</button>` : ''}
      ${v.yourFinishPosition !== null && v.reEntriesLeft > 0 && v.lateRegOpen ? `<button class="chip primary" id="btn-reentry">リエントリー（残り ${v.reEntriesLeft}）</button>` : ''}
    </div>`;
    info.innerHTML = `
    <dl class="tour-row">
      <dt>レベル</dt><dd>${v.level}（${fmt(v.smallBlind)}/${fmt(v.bigBlind)}${v.ante ? ` +${fmt(v.ante)}` : ''}）</dd>
      <dt>残り人数</dt><dd>${v.remaining} / ${v.entrants}</dd>
      <dt>平均スタック</dt><dd>${fmt(v.averageStack)}</dd>
      <dt>あなたの順位</dt><dd>${finished ? `${v.yourFinishPosition} 位` : v.yourRank ? `${v.yourRank} 位` : '—'}</dd>
      <dt>入賞ライン</dt><dd>${v.paidPlaces} 位まで</dd>
    </dl>
    ${finished
        ? `<div class="verdict ${v.yourPrize ? 'ok' : 'ng'}">${v.yourFinishPosition} 位 — ${v.yourPrize ? `賞金 ${fmt(v.yourPrize)}` : '入賞なし'}</div>`
        : ''}
    <div class="lb">${v.leaderboard
        .map((l) => `<div><span>${l.rank}. ${escapeHtml(l.name)}</span><span>${fmt(l.stack)}</span></div>`)
        .join('')}</div>
    ${bountyHtml}
    ${extraHtml}`;
    const addon = document.getElementById('btn-addon');
    if (addon)
        addon.onclick = () => send({ t: 'tour.addon', tournamentId: v.tournamentId });
    const reentry = document.getElementById('btn-reentry');
    if (reentry)
        reentry.onclick = () => send({ t: 'tour.register', tournamentId: v.tournamentId });
}
function renderShop() {
    const el = document.getElementById('shop');
    if (!el || !shop)
        return;
    const packHtml = (sku, title, amount, sub, price, offer = false, tagline = '') => `<div class="pack ${offer ? 'offer' : ''}">
      ${tagline ? `<div class="tagline">${escapeHtml(tagline)}</div>` : ''}
      <div class="amt">${amount}</div>
      <div class="per">${escapeHtml(sub)}</div>
      <button class="${offer ? 'primary' : ''}" data-buy="${sku}">¥${fmt(price)}</button>
    </div>`;
    let html = '';
    if (shop.offers.length) {
        html += `<div class="sec"><h3>期間限定オファー</h3><div class="packs">${shop.offers
            .map((o) => packHtml(o.sku, o.name, o.description, `${o.name}・${o.reason}${o.multiplier ? `（通常の ${o.multiplier} 倍）` : ''}`, o.priceJpy, true, o.multiplier ? `${o.multiplier}倍` : 'LIMITED'))
            .join('')}</div></div>`;
    }
    html += `<div class="sec"><h3>チップ</h3><div class="packs">${shop.chipPacks
        .map((p) => packHtml(p.sku, p.name, fmt(p.chips), `${p.name}・1円あたり ${fmt(p.perYen)}`, p.priceJpy))
        .join('')}</div></div>`;
    html += `<div class="sec"><h3>ゴールド</h3><div class="packs">${shop.goldPacks
        .map((p) => packHtml(p.sku, p.name, `🪙 ${fmt(p.gold)}`, p.name, p.priceJpy))
        .join('')}</div></div>`;
    html += `<div class="sec"><h3>チャレンジパス</h3><div class="packs">${shop.passPremium.owned
        ? '<div class="pack"><div class="amt">購入済み</div><div class="per">プレミアム報酬が解放されています</div></div>'
        : packHtml(shop.passPremium.sku, shop.passPremium.name, 'プレミアム', '到達済みティアの報酬もさかのぼって受け取れます', shop.passPremium.priceJpy, true, 'PASS')}</div></div>`;
    if (shop.recentPurchases?.length) {
        html += `<div class="sec"><h3>購入履歴</h3>
      <table class="paytable">
        <tr><th>商品</th><th>金額</th><th>日時</th></tr>
        ${shop.recentPurchases.map((p) => `<tr>
          <td>${escapeHtml(p.name)}</td>
          <td>¥${fmt(p.priceJpy)}</td>
          <td>${new Date(p.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`).join('')}
      </table></div>`;
    }
    html += `<p class="note">決済はモックです。実際には課金されません。ボタンを押すとサーバー側でレシート検証が走り、二重付与が防がれることを確認できます。</p>`;
    el.innerHTML = html;
    each('[data-buy]', (b) => {
        b.onclick = () => showPurchaseDialog(b.dataset.buy);
    });
}
/**
 * 購入前の確認ダイアログ。
 *
 * 以前は押した瞬間に購入が確定していたが、金額のやり取りは必ず一度確認を挟むべきなので、
 * 「何にいくら払い、何を受け取るか」を明示してから支払う流れにした。
 * 決済はモックだが、実決済を差し込むときはこの confirm → 決済 → 付与 の境目に入れる。
 */
function showPurchaseDialog(sku) {
    if (!shop)
        return;
    let item = null;
    const offer = shop.offers.find((o) => o.sku === sku);
    if (offer)
        item = { name: offer.name, priceJpy: offer.priceJpy, detail: offer.description, tag: offer.reason };
    const cp = shop.chipPacks.find((p) => p.sku === sku);
    if (cp)
        item = { name: cp.name, priceJpy: cp.priceJpy, detail: `チップ ${fmt(cp.chips)}` };
    const gp = shop.goldPacks.find((p) => p.sku === sku);
    if (gp)
        item = { name: gp.name, priceJpy: gp.priceJpy, detail: `ゴールド 🪙 ${fmt(gp.gold)}` };
    if (shop.passPremium.sku === sku) {
        item = {
            name: shop.passPremium.name,
            priceJpy: shop.passPremium.priceJpy,
            detail: 'プレミアム報酬トラックが解放され、到達済みティアの報酬もさかのぼって受け取れます',
        };
    }
    if (!item)
        return;
    const vipBonus = shop.vipPurchaseBonus ?? 0;
    modal(`<h3>購入の確認</h3>
     <div style="background:var(--panel-2);border-radius:10px;padding:12px;margin:10px 0">
       <div style="font-size:15px;font-weight:700">${escapeHtml(item.name)}</div>
       <div class="note" style="margin-top:4px">${escapeHtml(item.detail)}</div>
       ${item.tag ? `<div class="note" style="color:var(--gold)">${escapeHtml(item.tag)}</div>` : ''}
       ${vipBonus > 0 ? `<div class="note" style="color:var(--gold)">VIP特典で +${Math.round(vipBonus * 100)}% 増量されます</div>` : ''}
     </div>
     <div style="display:flex;justify-content:space-between;align-items:baseline;margin:12px 0">
       <span class="note">お支払い金額</span>
       <b style="font-size:26px">¥${fmt(item.priceJpy)}</b>
     </div>
     <p class="note" style="font-size:11px">
       これはモック決済です。実際の請求は発生しません。
     </p>
     <div class="row">
       <button id="pay-cancel">やめる</button>
       <button class="primary" id="pay-ok">¥${fmt(item.priceJpy)} を支払う</button>
     </div>`, (close) => {
        $('pay-cancel').onclick = close;
        $('pay-ok').onclick = () => {
            const btn = $('pay-ok');
            btn.disabled = true;
            btn.textContent = '処理中…';
            // レシートは毎回新しく作る。サーバー側で使い回しを弾いて二重付与を防いでいる
            send({ t: 'shop.purchase', sku, receipt: mockReceipt() });
            close();
        };
    });
}
function renderProfile() {
    const el = document.getElementById('profile');
    if (!el || !profile)
        return;
    const p = profile;
    const vipPct = p.vip.pointsToNext
        ? Math.round(((p.vip.points - (p.vip.points + p.vip.pointsToNext - p.vip.pointsToNext)) / 1) * 0)
        : 100;
    void vipPct;
    let html = `<div class="sec">
    <h3>VIP</h3>
    <div class="tcard">
      <h3>${escapeHtml(p.vip.tierName)}</h3>
      <dl class="tour-row">
        <dt>VIP ポイント</dt><dd>${fmt(p.vip.points)}</dd>
        <dt>購入ボーナス</dt><dd>+${Math.round(p.vip.purchaseBonus * 100)}%</dd>
        <dt>デイリー倍率</dt><dd>×${p.vip.dailyMultiplier}</dd>
        ${p.vip.nextTierName ? `<dt>次のティア</dt><dd>${escapeHtml(p.vip.nextTierName)} まで ${fmt(p.vip.pointsToNext ?? 0)}</dd>` : ''}
      </dl>
      ${p.vip.perks.length ? `<div class="note">特典：${p.vip.perks.map(escapeHtml).join('、')}</div>` : ''}
    </div>
  </div>`;
    html += `<div class="sec"><h3>デイリーボーナス</h3>
    <div class="mission">
      <div class="grow">
        <div class="nm">${p.daily.available ? '本日分を受け取れます' : '本日分は受け取り済み'}</div>
        <div class="pg">連続ログイン ${p.daily.streak} 日</div>
      </div>
      <button class="primary" id="btn-daily" ${p.daily.available ? '' : 'disabled'}>受け取る</button>
    </div>
    ${p.piggyBank > 0
        ? `<div class="mission"><div class="grow"><div class="nm">貯金箱</div>
             <div class="pg">プレイで貯まったチップ ${fmt(p.piggyBank)}</div></div>
           <button data-buy="offer_piggy_bank">回収する</button></div>`
        : ''}
  </div>`;
    /** ミッション一覧の共通描画。デイリー/ウィークリー/シーズンで同じ形 */
    const missionList = (list) => list
        .map((m) => `<div class="mission">
        <div class="grow">
          <div class="nm">${escapeHtml(m.name)}</div>
          <div class="bar"><div style="width:${Math.min(100, Math.round((m.progress / m.target) * 100))}%"></div></div>
          <div class="pg">${fmt(m.progress)} / ${fmt(m.target)}　報酬 ${fmt(m.rewardChips)}・XP +${m.rewardXp}</div>
        </div>
        <button data-mission="${m.id}" ${m.claimed || m.progress < m.target ? 'disabled' : ''}>
          ${m.claimed ? '受取済' : '受け取る'}
        </button>
      </div>`)
        .join('');
    html += `<div class="sec"><h3>デイリーミッション</h3>
    ${missionList(p.missions)}
    <div class="note">未消化のデイリーは 7 日ぶん残ります。毎日ログインできなくても追いつけます。</div>
  </div>`;
    if (p.weekly?.length) {
        html += `<div class="sec"><h3>ウィークリーミッション</h3>${missionList(p.weekly)}</div>`;
    }
    if (p.seasonal?.length) {
        html += `<div class="sec"><h3>シーズンミッション</h3>${missionList(p.seasonal)}</div>`;
    }
    // パスの進捗は「完走まであとどれくらいか」が一目で分かるようにする
    const pv = p.pass;
    const donePct = Math.min(100, Math.round((pv.xp / (pv.completeXp || 1)) * 100));
    html += `<div class="sec"><h3>チャレンジパス（${escapeHtml(pv.seasonId)}）</h3>
    <div class="mission">
      <div class="grow">
        <div class="nm">ティア ${pv.tier} / ${pv.tierCount}${pv.premium ? '（プレミアム）' : ''}</div>
        <div class="bar"><div style="width:${donePct}%"></div></div>
        <div class="pg">
          経験値 ${fmt(pv.xp)} / ${fmt(pv.completeXp)}（完走 ${donePct}%）
          ${pv.nextTierXp ? `・次のティアまで ${fmt(Math.max(0, pv.nextTierXp - pv.xp))}` : ''}
        </div>
        <div class="pg">残り ${pv.daysLeft} 日${pv.finalWeek ? '・最終週は獲得経験値アップ中' : ''}</div>
      </div>
      <button class="primary" id="btn-pass" ${pv.claimable ? '' : 'disabled'}>報酬を受け取る</button>
    </div>
    ${pv.boxesEarned > pv.boxesClaimed
        ? `<div class="note" style="color:var(--gold)">完走ボーナス箱 ${pv.boxesEarned - pv.boxesClaimed} 個（各 ${fmt(pv.boxChips)}）を受け取れます</div>`
        : pv.tier >= pv.tierCount
            ? `<div class="note">完走済み。以降は 200XP ごとにボーナス箱（最大 5 個）</div>`
            : ''}
    ${pv.premium
        ? ''
        : `<div class="note">
             プレミアムパスを買うと、<b style="color:var(--gold)">いま ${fmt(pv.preview.chips)} チップ${pv.preview.gold ? ` と 🪙 ${fmt(pv.preview.gold)}` : ''}</b>
             （到達済み ${pv.preview.tiers} ティア分）をその場で受け取れます。
           </div>
           <div class="btnrow"><button class="chip primary" data-buy="pass_premium">プレミアムパスを見る</button></div>`}
  </div>`;
    el.innerHTML = html;
    const daily = document.getElementById('btn-daily');
    if (daily)
        daily.onclick = () => send({ t: 'daily.claim' });
    const pass = document.getElementById('btn-pass');
    if (pass)
        pass.onclick = () => send({ t: 'pass.claim' });
    each('[data-mission]', (b) => {
        b.onclick = () => send({ t: 'mission.claim', missionId: b.dataset.mission });
    });
    // マイページからの購入もショップと同じ確認ダイアログを通す。
    // ショップ情報がまだ無ければ取りに行き、届いてから開く
    each('[data-buy]', (b) => {
        b.onclick = () => {
            const sku = b.dataset.buy;
            if (shop)
                showPurchaseDialog(sku);
            else {
                pendingBuySku = sku;
                send({ t: 'shop.list' });
            }
        };
    });
}
/** ショップ情報の到着を待っている購入。届いたら確認ダイアログを開く */
let pendingBuySku = null;
function showReward(title, chips, gold, detail) {
    modal(`<h3 style="text-align:center">${escapeHtml(title)}</h3>
     <div style="text-align:center;font-size:28px;font-weight:700;color:var(--gold);margin:12px 0">
       ${chips ? `💰 ${fmt(chips)}` : ''} ${gold ? `🪙 ${fmt(gold)}` : ''}
     </div>
     ${detail ? `<div class="note" style="text-align:center">${escapeHtml(detail)}</div>` : ''}
     <div class="row"><button class="primary" id="rw-ok">OK</button></div>`, (close) => {
        const ok = document.getElementById('rw-ok');
        if (ok)
            ok.onclick = close;
    });
}
// タブの配線
each('.tab', (b) => {
    b.onclick = () => switchTab(b.dataset.tab);
});
//# sourceMappingURL=client.js.map