/**
 * ソロプレイ（CPU 対戦）
 *
 * サーバー版と同じエンジン（src/table.ts）をブラウザ内で直接回します。
 * 1 人プレイなので通信も不正対策も不要ですが、**相手のカードは画面に出しません**。
 * ここを緩めると、覗けば勝ててしまってゲームが成立しなくなります。
 */
import { Hand } from '../src/table.js';
import { createSecureRng, cardToDisplay } from '../src/cards.js';
import { describeHand } from '../src/evaluator.js';
import { cardFace, cardBack, cardSlot, VISUAL_CSS, showHandBanner, flashAllIn, flyChips, confetti, bumpPot, } from '../client/visuals.js';
import { decideAi, OpponentModel, PERSONALITIES } from './ai.js';
import { Profile, STAKES, RANKS, ACHIEVEMENTS, fmtDuration, } from './meta.js';
import { renderShareCard, shareText, downloadCard, copyCard } from './share.js';
import { buildRevealScript } from './showdown.js';
import { play, playAction, stopTension, unlockAudio, isMuted, setMuted } from './audio.js';
const $ = (id) => document.getElementById(id);
const each = (sel, fn) => Array.from(document.querySelectorAll(sel)).forEach(fn);
const fmt = (n) => n.toLocaleString('ja-JP');
const rng = createSecureRng();
const seatActions = new Map();
let actionNonce = 0;
let reveal = null;
/** 1 枚めくるまでの間。しっかり焦らす */
const REVEAL_GAP_MS = 1500;
// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------
const profile = new Profile();
let stake = null;
let hand = null;
let heroStack = 0;
let cpus = [];
let handNo = 0;
let busy = false;
let lastSummaryWinners = new Set();
let lastWinningCards = new Set();
let lastBoardLen = 0;
let theme = 'classic';
/** 直近の見せ場。共有カードの主役に使う */
let highlight = null;
const model = new OpponentModel();
/** 難易度。ランクが上がるほど CPU も強くなる（作業ゲーにしないため） */
const skillFor = () => 0.8 + Math.min(1.2, profile.rankIndex * 0.28);
const CPU_POOL = ['rock', 'tag', 'lag', 'station', 'maniac'];
// ---------------------------------------------------------------------------
// ロビー
// ---------------------------------------------------------------------------
function renderHud() {
    profile.applyRecharge();
    $('chips').textContent = fmt(profile.data.chips);
    const r = profile.rank;
    const badge = $('rank-badge');
    badge.textContent = r.name;
    badge.style.background = r.color;
    const next = profile.nextRank;
    const rp = profile.rp;
    $('rp').textContent = next ? `${rp} / ${next.minRp} RP` : `${rp} RP（最高位）`;
    const pct = next ? Math.min(100, ((rp - r.minRp) / (next.minRp - r.minRp)) * 100) : 100;
    $('rp-bar').style.width = `${pct}%`;
    $('rp-bar').style.background = r.color;
    // 回復の状況。ここが「今は無理をしない方がいい」という判断材料になる
    const ms = profile.msUntilNextRecharge();
    const cap = r.rechargeCap;
    const el = $('recharge');
    if (profile.data.chips >= cap) {
        el.innerHTML = `<span class="ok">補充上限に到達（${fmt(cap)}）</span><br><span class="sub">これ以上は勝って増やすしかありません</span>`;
    }
    else {
        el.innerHTML = `次の補充まで <b>${fmtDuration(ms ?? 0)}</b>（+${fmt(r.rechargeAmount)}）<br>
      <span class="sub">補充は ${fmt(cap)} まで。${next ? `${next.name} になると ${fmt(next.rechargeAmount)} / ${Math.round(next.rechargeIntervalMs / 60000)}分・上限 ${fmt(next.rechargeCap)}` : ''}</span>`;
    }
}
function renderLobby() {
    renderHud();
    const avail = new Set(profile.availableStakes().map((s) => s.key));
    $('stakes').innerHTML = STAKES.map((s) => {
        const unlocked = avail.has(s.key);
        const affordable = profile.data.chips >= s.buyIn;
        const need = RANKS[s.minRankIndex];
        return `<div class="tcard ${unlocked ? '' : 'locked'}">
      <h3>${s.name}</h3>
      <div class="blinds">${fmt(s.smallBlind)} / ${fmt(s.bigBlind)}</div>
      <dl>
        <dt>バイイン</dt><dd>${fmt(s.buyIn)}</dd>
        <dt>席</dt><dd>${s.seats === 2 ? 'ヘッズアップ' : `${s.seats} 人`}</dd>
        <dt>解禁</dt><dd>${need.name}</dd>
      </dl>
      <button class="${unlocked && affordable ? 'primary' : ''}" data-stake="${s.key}"
        ${unlocked && affordable ? '' : 'disabled'}>
        ${!unlocked ? `${need.name}で解禁` : !affordable ? 'チップ不足' : '座る'}
      </button>
    </div>`;
    }).join('');
    each('[data-stake]', (b) => {
        b.onclick = () => sitDown(STAKES.find((s) => s.key === b.dataset.stake));
    });
    renderAchievements();
}
function renderAchievements() {
    const done = ACHIEVEMENTS.filter((a) => profile.isAchieved(a));
    const todo = ACHIEVEMENTS.filter((a) => !profile.isAchieved(a));
    // 達成に近いものから見せる。遠い目標ばかり並ぶとやる気が出ない
    todo.sort((a, b) => profile.progressOf(b) - profile.progressOf(a));
    $('ach-count').textContent = `${done.length} / ${ACHIEVEMENTS.length}`;
    $('achievements').innerHTML = [...todo.slice(0, 6), ...done.slice(-4).reverse()]
        .map((a) => {
        const p = profile.progressOf(a);
        const cleared = p >= 1;
        const cur = profile.data.stats[a.stat];
        return `<div class="ach ${cleared ? 'done' : ''}">
        <div class="grow">
          <div class="nm">${a.name} <span class="rp">+${a.rp} RP</span></div>
          <div class="bar"><div style="width:${Math.round(p * 100)}%"></div></div>
          <div class="sub">${a.detail}　${cleared ? '達成' : `${fmt(Math.min(cur, a.target))} / ${fmt(a.target)}`}</div>
        </div>
      </div>`;
    })
        .join('');
}
// ---------------------------------------------------------------------------
// 卓
// ---------------------------------------------------------------------------
function sitDown(s) {
    if (!profile.spend(s.buyIn))
        return;
    stake = s;
    heroStack = s.buyIn;
    handNo = 0;
    // CPU の顔ぶれ。毎回同じだと読みが固定されるので、性格をランダムに配る
    const pool = [...CPU_POOL];
    cpus = [];
    for (let i = 1; i < s.seats; i++) {
        const pick = pool.splice(rng.randomInt(pool.length), 1)[0] ?? CPU_POOL[rng.randomInt(CPU_POOL.length)];
        cpus.push({ seat: i, name: PERSONALITIES[pick].name, profile: PERSONALITIES[pick], stack: s.buyIn });
    }
    $('lobby').classList.add('hidden');
    $('table-view').classList.remove('hidden');
    $('log').innerHTML = '';
    $('stake-name').textContent = `${s.name}　${fmt(s.smallBlind)}/${fmt(s.bigBlind)}`;
    log(`${s.name} に着席（${fmt(s.buyIn)} 持ち込み）`, 'hl');
    startHand();
}
function leaveTable() {
    if (hand && !hand.isComplete)
        return;
    if (heroStack > 0) {
        profile.gain(heroStack);
        log(`${fmt(heroStack)} を持って卓を降りました`, 'win');
    }
    heroStack = 0;
    hand = null;
    stake = null;
    $('table-view').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    renderLobby();
}
function startHand() {
    if (!stake)
        return;
    profile.applyRecharge();
    // ヒーローが座れない額になったら卓から降ろす
    if (heroStack < stake.bigBlind) {
        log('チップが尽きました。卓を降ります', 'ng');
        setTimeout(() => {
            showBustDialog();
        }, 600);
        return;
    }
    // 飛んだ CPU は新しい相手と入れ替える（卓が寂しくならないように）
    let busted = 0;
    for (const c of cpus) {
        if (c.stack < stake.bigBlind) {
            busted++;
            const pick = CPU_POOL[rng.randomInt(CPU_POOL.length)];
            c.profile = PERSONALITIES[pick];
            c.name = PERSONALITIES[pick].name;
            c.stack = stake.buyIn;
        }
    }
    if (busted > 0)
        log(`${busted} 人が席を立ちました。新しい相手が来ます`);
    handNo++;
    const seats = [
        { id: 'hero', name: profile.data.playerName, stack: heroStack },
        ...cpus.map((c) => ({ id: `cpu${c.seat}`, name: c.name, stack: c.stack })),
    ];
    hand = new Hand({
        seats,
        buttonIndex: (handNo - 1) % seats.length,
        smallBlind: stake.smallBlind,
        bigBlind: stake.bigBlind,
        rng,
    });
    model.noteHandStart();
    lastSummaryWinners = new Set();
    lastWinningCards = new Set();
    lastBoardLen = 0;
    highlight = null;
    seatActions.clear();
    reveal = null;
    play('deal');
    log(`— ハンド #${handNo} —`, 'hl');
    render();
    scheduleCpu();
}
// ---------------------------------------------------------------------------
// 進行
// ---------------------------------------------------------------------------
function scheduleCpu() {
    const h = hand;
    if (!h || h.isComplete)
        return;
    if (h.actingSeat === 0) {
        busy = false;
        render();
        return;
    }
    busy = true;
    render();
    // 少し「考える」間を置く。即答されると機械感が出て、読み合いの緊張が消える
    const delay = 420 + rng.randomInt(520);
    setTimeout(() => {
        const cur = hand;
        if (!cur || cur.isComplete || cur.actingSeat === null || cur.actingSeat === 0)
            return;
        const seat = cur.actingSeat;
        const cpu = cpus.find((c) => c.seat === seat);
        if (!cpu)
            return;
        const d = decideAi({ hand: cur, seat, profile: cpu.profile, model, rng, skill: skillFor() });
        // ベット round が終わって一気に配られる場合に備えて、打つ前の場札を控えておく
        const beforeBoard = [...cur.board];
        let done = d.action;
        try {
            cur.act(seat, d.action, d.toAmount);
        }
        catch {
            done = cur.getLegalActions(seat).some((l) => l.type === 'check') ? 'check' : 'fold';
            cur.act(seat, done);
        }
        logAction(seat, done, cur);
        afterAction(beforeBoard);
    }, delay);
}
function heroAct(action, toAmount) {
    const h = hand;
    if (!h || h.isComplete || h.actingSeat !== 0 || busy)
        return;
    const facingBet = h.currentBet > h.players[0].streetBet;
    const beforeBoard = [...h.board];
    try {
        h.act(0, action, toAmount);
    }
    catch {
        return;
    }
    model.noteAction(action, facingBet);
    if (action !== 'fold' && action !== 'check')
        model.noteVoluntary();
    logAction(0, action, h);
    afterAction(beforeBoard);
}
function afterAction(beforeBoard) {
    const h = hand;
    if (!h.isComplete) {
        // ストリートが変わったら、前のストリートのアクション表示は消す
        if (h.board.length !== beforeBoard.length) {
            seatActions.clear();
            for (let i = beforeBoard.length; i < h.board.length; i++)
                play('deal');
        }
        render();
        scheduleCpu();
        return;
    }
    // ベットが終わった時点より場札が増えている＝誰も打てないまま配られた、
    // つまりオールインの決着。ここだけは 1 枚ずつ見せる
    const runout = h.board.slice(beforeBoard.length);
    const live = h.players.map((p, i) => ({ p, i })).filter((x) => !x.p.folded);
    if (h.result?.showdown && runout.length > 0 && live.length >= 2) {
        startReveal(beforeBoard, runout, live.map((x) => ({ seat: x.i, hole: x.p.holeCards })));
    }
    else {
        finishHand();
    }
}
// ---------------------------------------------------------------------------
// オールイン後の焦らし
// ---------------------------------------------------------------------------
/**
 * 全員の手札を開き、勝率とアウツを出したうえで、残りを 1 枚ずつめくる。
 *
 * 台本（RevealStep[]）は solo/showdown.ts で先に全部作っておきます。
 * 「めくった後の勝率」を毎回その場で計算すると、描画とずれる事故が起きるためです。
 */
function startReveal(board, runout, players) {
    busy = true;
    seatActions.clear();
    const steps = buildRevealScript(players, board, runout, rng);
    // 手札はまず伏せたまま。コール成立の“間”を置いてから開く（ライブの「ハンド公開」の呼吸）
    reveal = { steps, index: 0, board: [...board], open: new Set() };
    // ストリートごとの「間」（ミリ秒）。毎回ランダム化し、テレビ中継のようにリバー前を一番長く取る。
    // 演出は「事前に組んだ拍（beat）の列」を1本のドライバで回す。各拍は try で囲うので、
    // 万一 render 等が例外を投げても次の拍へ進む。さらにウォッチドッグで、何があっても
    // 最後は必ずハンドを終える（＝絶対に固まらせない）。
    const rand = (lo, hi) => lo + rng.randomInt(hi - lo + 1);
    const PRE = {
        flop: [1200, 2200], // 手札公開 → フロップ（3枚まとめて一気に）
        turn: [1500, 2500], // フロップ → ターン
        river: [2000, 3600], // ターン → リバー（ここが最大の焦らし）
    };
    const streetOf = (len) => len <= 3 ? 'flop' : len === 4 ? 'turn' : 'river';
    // steps を「ストリート単位」に束ねる。フロップは3枚を1段に、ターン/リバーは1枚ずつ。
    const segments = [];
    for (let i = 1; i < steps.length; i++) {
        const st = streetOf(steps[i].board.length);
        const last = segments[segments.length - 1];
        if (last && last.street === st)
            last.index = i;
        else
            segments.push({ street: st, index: i, from: i - 1 });
    }
    // 拍を先に全部組む（遅延もこの時点で確定させる）
    const beats = [];
    beats.push({
        delay: rand(1000, 1700), // コール成立 → 両者の手札公開
        apply: () => {
            for (const p of players)
                reveal.open.add(p.seat);
            play('tension');
        },
    });
    for (const seg of segments) {
        beats.push({
            delay: rand(...PRE[seg.street]),
            apply: () => {
                reveal.index = seg.index;
                reveal.board = [...steps[seg.index].board];
                play(seg.street === 'flop' ? 'deal' : 'reveal');
                // このストリートで首位が入れ替わったか（束ねたぶんもまとめて判定）
                const before = steps[seg.from].leaders;
                const after = steps[seg.index].leaders;
                if (before.length > 0 &&
                    (after.length !== before.length || after.some((s) => !before.includes(s)))) {
                    setTimeout(() => play('outHit'), 180);
                    const names = after.map((s) => hand?.players[s]?.name ?? '').filter(Boolean);
                    log(`逆転！ ${names.join(' / ')} が前に出た`, 'hl');
                }
            },
        });
    }
    beats.push({ delay: rand(1500, 2500), apply: () => { } }); // 最後の1枚 → 勝敗確定
    const endReveal = () => {
        if (!reveal)
            return;
        stopTension();
        const last = reveal.steps[reveal.steps.length - 1];
        reveal.board = [...last.board];
        reveal = null;
        finishHand();
    };
    let bi = 0;
    const run = () => {
        if (!reveal)
            return;
        const beat = beats[bi++];
        setTimeout(() => {
            if (!reveal)
                return;
            try {
                beat.apply();
            }
            catch {
                /* 見た目の失敗で進行を止めない */
            }
            try {
                render();
            }
            catch {
                /* 同上 */
            }
            if (bi >= beats.length)
                endReveal();
            else
                run();
        }, beat.delay);
    };
    play('allIn');
    render();
    run();
    // ウォッチドッグ：想定総時間＋余裕を過ぎてもまだ演出中なら、強制的に決着させる
    const budget = beats.reduce((a, b) => a + b.delay, 0) + 5000;
    setTimeout(() => {
        if (!reveal)
            return;
        try {
            reveal.index = reveal.steps.length - 1;
            reveal.board = [...reveal.steps[reveal.steps.length - 1].board];
            render();
        }
        catch {
            /* noop */
        }
        endReveal();
    }, budget);
}
function finishHand() {
    const h = hand;
    const r = h.result;
    busy = true;
    const winners = new Set();
    for (const p of r.pots)
        for (const w of p.winners)
            winners.add(w);
    lastSummaryWinners = winners;
    lastWinningCards = new Set();
    for (let e = 0; e < h.players.length; e++) {
        const hv = r.hands[e];
        if (hv && winners.has(e))
            for (const c of hv.cards)
                lastWinningCards.add(cardToDisplay(c));
    }
    // スタックを卓に書き戻す
    const before = heroStack;
    heroStack = h.players[0].stack;
    for (const c of cpus)
        c.stack = h.players[c.seat].stack;
    const heroWon = winners.has(0);
    const potTotal = r.pots.reduce((a, p) => a + p.pot.amount, 0);
    const bustedCpu = cpus.filter((c) => c.stack < (stake?.bigBlind ?? 1)).length;
    const heroHv = r.hands[0];
    profile.recordHand({
        won: heroWon,
        showdown: r.showdown,
        potWon: heroWon ? potTotal : 0,
        bustedCpu,
        handCategory: heroHv ? heroHv.category : -1,
        handName: heroHv ? describeHand(heroHv) : '—',
        handCards: heroHv ? heroHv.cards.map(cardToDisplay).join(' ') : '',
    });
    // 卓上のスタックも「今の資産」として見せる。財布と分けると自慢しづらい
    profile.data.stats.peakChips = Math.max(profile.data.stats.peakChips, profile.data.chips + heroStack);
    profile.save();
    const diff = heroStack - before;
    log(`結果 ${diff >= 0 ? '+' : ''}${fmt(diff)}（残り ${fmt(heroStack)}）`, diff > 0 ? 'win' : '');
    render();
    play(heroWon ? 'win' : 'lose');
    if (heroWon && potTotal > 0)
        setTimeout(() => play('chipBig'), 220);
    celebrate(potTotal, heroWon, r.showdown, heroHv ? describeHand(heroHv) : '');
    const fresh = profile.collectNewAchievements();
    if (fresh.length) {
        setTimeout(() => {
            play('achieve');
            showAchievementToast(fresh);
        }, 900);
    }
    setTimeout(() => {
        busy = false;
        startHand();
    }, 2600);
}
function celebrate(pot, won, showdown, handName) {
    const felt = $('felt');
    if (won) {
        const el = felt.querySelector('.seat[data-seat="0"]');
        if (el)
            flyChips(felt, el, 6);
        if (showdown && handName)
            showHandBanner(felt, handName);
        const big = pot > heroStack * 0.6;
        const strong = /ロイヤル|ストレートフラッシュ|フォーカード|フルハウス/.test(handName);
        if (big || strong) {
            confetti(felt, strong ? 90 : 50);
            highlight = {
                title: strong ? handName : `${fmt(pot)} のポットを獲得`,
                detail: strong ? `${fmt(pot)} のポットを獲得` : `${stake?.name ?? ''} で炸裂`,
            };
        }
    }
}
// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------
const STREET_LABEL = {
    preflop: 'プリフロップ',
    flop: 'フロップ',
    turn: 'ターン',
    river: 'リバー',
    showdown: 'ショーダウン',
    complete: '結果',
};
function render() {
    renderHud();
    const h = hand;
    const felt = $('felt');
    if (!h) {
        felt.innerHTML = '';
        return;
    }
    const n = h.players.length;
    const showdownOpen = h.isComplete && h.result?.showdown === true;
    // 焦らし演出中は、エンジンが持っている最終の場札ではなく、
    // 「今めくったところまで」を映す
    const shownBoard = reveal ? reveal.board : h.board;
    const step = reveal ? reveal.steps[reveal.index] : null;
    const board = shownBoard
        .map((c, i) => cardFace(cardToDisplay(c), {
        size: 'md',
        highlight: !reveal && lastWinningCards.has(cardToDisplay(c)),
        extra: i >= lastBoardLen ? 'dealing' : '',
    }))
        .join('');
    lastBoardLen = shownBoard.length;
    const slots = cardSlot('md').repeat(Math.max(0, 5 - shownBoard.length));
    const tag = reveal
        ? `<div class="street-tag hot">オールイン — 残り ${5 - shownBoard.length} 枚</div>`
        : `<div class="street-tag">${STREET_LABEL[h.street] ?? h.street}</div>`;
    let html = `<div class="center">
    ${tag}
    <div class="board">${board + slots}</div>
    <div class="pot">ポット <b>${fmt(h.totalPot)}</b></div>
  </div>`;
    for (let i = 0; i < n; i++) {
        const p = h.players[i];
        const k = i; // ヒーローは席 0 で、常に手前
        const a = ((180 + (k * 360) / n) * Math.PI) / 180;
        const x = 50 + 40 * Math.sin(a);
        const y = 47 - 36 * Math.cos(a);
        const isMe = i === 0;
        // 相手の手札はショーダウンまで絶対に出さない。
        // オールインの焦らし演出中は、参加している席だけを開く
        const open = isMe || (reveal ? reveal.open.has(i) : showdownOpen && !p.folded);
        const cards = p.folded && h.isComplete && !reveal
            ? ''
            : open
                ? p.holeCards
                    .map((c) => cardFace(cardToDisplay(c), {
                    size: isMe ? 'lg' : 'sm',
                    highlight: !reveal && lastWinningCards.has(cardToDisplay(c)),
                    extra: (showdownOpen || reveal) && !isMe ? 'flipping' : '',
                }))
                    .join('')
                : cardBack({ size: 'sm' }) + cardBack({ size: 'sm' });
        const cpu = cpus.find((c) => c.seat === i);
        const badges = (i === h.buttonIndex ? '<span class="badge">D</span>' : '') +
            (isMe ? '<span class="badge you">YOU</span>' : '') +
            (p.allIn ? '<span class="badge allin">ALL IN</span>' : '') +
            (!reveal && lastSummaryWinners.has(i) ? '<span class="badge win">WIN</span>' : '');
        // 直前のアクションの吹き出し
        const act = seatActions.get(i);
        const bubble = act
            ? `<div class="act-bubble ${act.kind}" data-nonce="${act.nonce}">${act.label}</div>`
            : '';
        // 焦らし演出中はここに勝率とアウツを出す
        let eq = '';
        if (step) {
            const e = step.equity.find((x) => x.seat === i);
            const o = step.outs.find((x) => x.seat === i);
            if (e) {
                const percent = Math.round(e.equity * 100);
                const leading = step.leaders.includes(i);
                eq = `<div class="eq ${leading ? 'lead' : ''}">
          <div class="eq-bar"><div style="width:${percent}%"></div></div>
          <div class="eq-num">${percent}%${o && !o.leading && o.cards.length ? ` <span class="outs">アウツ ${o.cards.length}</span>` : ''}${leading ? ' <span class="lead-tag">首位</span>' : ''}</div>
        </div>`;
            }
        }
        html += `<div class="seat ${h.actingSeat === i && !reveal ? 'acting' : ''} ${p.folded && !reveal ? 'folded' : ''}"
        data-seat="${i}" style="left:${x}%;top:${y}%">
      ${bubble}
      <div class="cards">${cards}</div>
      <div class="box">
        <div class="nm">${escapeHtml(p.name)}${badges}</div>
        <div class="st">${fmt(p.stack)}</div>
        ${eq}
      </div>
      <div class="bet">${p.streetBet > 0 ? `▸ ${fmt(p.streetBet)}` : cpu && !p.folded ? `<span class="tag">${cpu.profile.tagline.slice(0, 10)}</span>` : ''}</div>
    </div>`;
    }
    felt.innerHTML = html;
    const potEl = felt.querySelector('.pot');
    if (potEl)
        bumpPot(potEl);
    renderActions();
}
function renderActions() {
    const box = $('actions');
    const h = hand;
    // ハンドの途中では卓を降りられない。押せてしまうと「反応しないボタン」になるので、
    // 押せない理由が見えるように無効化しておく
    const leave = $('btn-leave');
    const inHand = !!(h && !h.isComplete);
    leave.disabled = inHand;
    leave.title = inHand ? 'ハンドが終わってから降りられます' : '';
    if (!h || h.isComplete || h.actingSeat !== 0 || busy) {
        box.innerHTML = h?.isComplete
            ? '<div class="hint">次のハンドを配っています…</div>'
            : '<div class="hint">相手が考えています…</div>';
        return;
    }
    const legal = h.getLegalActions(0);
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
        const clamp = (v) => Math.max(raise.min, Math.min(raise.max, Math.round(v)));
        const presets = [
            ['1/2', clamp(h.totalPot * 0.5 + h.currentBet)],
            ['2/3', clamp(h.totalPot * 0.66 + h.currentBet)],
            ['ポット', clamp(h.totalPot + h.currentBet)],
            ['オールイン', raise.max],
        ];
        html += `<div class="slider-wrap">
      <input type="range" id="rs" min="${raise.min}" max="${raise.max}" step="1" value="${raise.min}">
      <div class="btnrow">${presets
            .map(([l, v]) => `<button class="chip" data-set="${v}">${l}<br><span class="sub">${fmt(v)}</span></button>`)
            .join('')}</div>
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
            if (a === 'raise' && raise && slider)
                heroAct(raise.type, +slider.value);
            else
                heroAct(a);
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
// ---------------------------------------------------------------------------
// ログとダイアログ
// ---------------------------------------------------------------------------
const ACTION_JA = {
    fold: 'フォールド',
    check: 'チェック',
    call: 'コール',
    bet: 'ベット',
    raise: 'レイズ',
};
function logAction(seat, action, h) {
    const p = h.players[seat];
    const amt = p.streetBet > 0 && (action === 'bet' || action === 'raise' || action === 'call') ? ` ${fmt(p.streetBet)}` : '';
    log(`${p.name} ${ACTION_JA[action]}${amt}${p.allIn ? '（ALL IN）' : ''}`);
    // 席の上に出す吹き出し。ログを読まなくても何が起きたか分かるようにする。
    // 金額を必ず添えるのは、「レイズ」だけでは大きさが伝わらないため
    const kind = p.allIn
        ? 'allin'
        : action === 'bet' || action === 'raise'
            ? action
            : action === 'call'
                ? 'call'
                : action === 'check'
                    ? 'check'
                    : 'fold';
    const label = p.allIn
        ? `ALL IN ${fmt(p.streetBet)}`
        : action === 'fold'
            ? 'フォールド'
            : action === 'check'
                ? 'チェック'
                : `${ACTION_JA[action]} ${fmt(p.streetBet)}`;
    seatActions.set(seat, { kind, label, nonce: ++actionNonce });
    playAction(action, p.allIn);
    if (p.allIn)
        flashAllIn($('felt'));
}
function log(text, cls = '') {
    const box = $('log');
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    box.appendChild(div);
    while (box.childElementCount > 150)
        box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
}
function modal(html, wire) {
    const root = $('modal-root');
    root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
    const close = () => (root.innerHTML = '');
    wire(close);
}
function showBustDialog() {
    play('bust');
    const r = profile.rank;
    const ms = profile.msUntilNextRecharge();
    const canSitAgain = profile.data.chips >= (STAKES[0]?.buyIn ?? 0);
    modal(`<h3>チップが尽きました</h3>
     <p class="lead">手持ちは <b>${fmt(profile.data.chips)}</b>。補充は <b>${Math.round(r.rechargeIntervalMs / 60000)}分ごとに ${fmt(r.rechargeAmount)}</b>、上限は <b>${fmt(r.rechargeCap)}</b> です。</p>
     <p class="lead sub">${ms !== null ? `次の補充まで ${fmtDuration(ms)}。` : ''}補充だけでは上の卓には戻れません。下の卓で組み立て直してください。</p>
     <div class="row">
       <button id="bd-ok" class="${canSitAgain ? 'primary' : ''}">${canSitAgain ? 'ロビーへ' : '待つ'}</button>
     </div>`, (close) => {
        $('bd-ok').onclick = () => {
            close();
            leaveTable();
        };
    });
}
function showAchievementToast(list) {
    const box = $('toast');
    for (const a of list) {
        const el = document.createElement('div');
        el.className = 'toast-item';
        el.innerHTML = `<b>実績解除</b> ${a.name}<span class="rp">+${a.rp} RP</span>`;
        box.appendChild(el);
        setTimeout(() => el.remove(), 4200);
    }
    renderHud();
}
// ---------------------------------------------------------------------------
// 共有
// ---------------------------------------------------------------------------
async function openShare() {
    modal(`<h3>成績カード</h3>
     <div id="share-preview" class="share-preview">生成中…</div>
     <div class="row">
       <button id="sh-copy">画像をコピー</button>
       <button id="sh-save" class="primary">保存</button>
     </div>
     <div class="row">
       <button id="sh-text">文面をコピー</button>
       <button id="sh-close">閉じる</button>
     </div>`, (close) => {
        $('sh-close').onclick = close;
        void (async () => {
            const canvas = await renderShareCard({ profile, highlight });
            const prev = $('share-preview');
            prev.innerHTML = '';
            canvas.style.width = '100%';
            canvas.style.borderRadius = '10px';
            prev.appendChild(canvas);
            $('sh-save').onclick = () => downloadCard(canvas, `poker-${profile.rank.key}-${Date.now()}.png`);
            $('sh-copy').onclick = async () => {
                const ok = await copyCard(canvas);
                $('sh-copy').textContent = ok ? 'コピーしました' : 'コピー非対応（保存を使ってください）';
            };
            $('sh-text').onclick = async () => {
                try {
                    await navigator.clipboard.writeText(shareText(profile));
                    $('sh-text').textContent = 'コピーしました';
                }
                catch {
                    $('sh-text').textContent = 'コピーできませんでした';
                }
            };
        })();
    });
}
// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
const styleEl = document.createElement('style');
styleEl.textContent = VISUAL_CSS;
document.head.appendChild(styleEl);
function applyTheme(next) {
    theme = next;
    document.documentElement.setAttribute('data-theme', next);
    try {
        localStorage.setItem('poker.solo.theme', next);
    }
    catch {
        /* 無視 */
    }
    $('btn-theme').textContent = next === 'classic' ? '🎨 クラシック' : '🎨 ネオン';
}
let savedTheme = 'classic';
try {
    savedTheme = localStorage.getItem('poker.solo.theme') ?? 'classic';
}
catch {
    /* 無視 */
}
applyTheme(savedTheme);
document.documentElement.setAttribute('data-suits', 'four');
$('btn-theme').onclick = () => applyTheme(theme === 'classic' ? 'neon' : 'classic');
// ブラウザは操作前の再生を止めるので、最初のクリックで音を使える状態にする
function syncMuteButton() {
    const b = $('btn-mute');
    b.textContent = isMuted() ? '🔇 音オフ' : '🔊 音オン';
    b.title = isMuted() ? '効果音を鳴らす' : '効果音を止める';
}
$('btn-mute').onclick = () => {
    setMuted(!isMuted());
    syncMuteButton();
    if (!isMuted())
        play('click');
};
syncMuteButton();
document.addEventListener('pointerdown', () => unlockAudio(), { once: true });
$('btn-share').onclick = () => void openShare();
$('btn-leave').onclick = leaveTable;
$('btn-reset').onclick = () => {
    modal(`<h3>記録を消去しますか</h3>
     <p class="lead">チップ・実績・称号がすべて初期状態に戻ります。元には戻せません。</p>
     <div class="row"><button id="rs-no">やめる</button><button id="rs-yes" class="danger">消去する</button></div>`, (close) => {
        $('rs-no').onclick = close;
        $('rs-yes').onclick = () => {
            profile.reset();
            close();
            renderLobby();
        };
    });
};
const nameInput = $('player-name');
nameInput.value = profile.data.playerName;
nameInput.onchange = () => {
    profile.data.playerName = nameInput.value.trim().slice(0, 16) || 'あなた';
    nameInput.value = profile.data.playerName;
    profile.save();
};
// 補充の残り時間を毎秒更新する。減っていくのが見えないと待つ気になれない
setInterval(() => {
    if (!$('lobby').classList.contains('hidden'))
        renderHud();
}, 1000);
renderLobby();
//# sourceMappingURL=game.js.map