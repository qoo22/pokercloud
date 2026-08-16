/**
 * 人間っぽい常駐ボット。
 *
 * サーバー自身に WebSocket で接続する「普通のクライアント」として振る舞うので、
 * サーバー側のゲームロジックには一切手を入れていない（不正もできない）。
 *
 * - 人数は時間でゆらぎ、ランダムに入店・退店する
 * - 名前はネトゲのハンドルネーム風（規則性なし）
 * - 強さ・スタイル（タイト/ルース、攻撃性、ブラフ率、ミス率、思考時間）も個体ごとにバラバラ
 *
 * 環境変数 POKER_BOTS=off で無効化。
 */
import { parseCard } from '../cards.js';
import { evaluateBest, HandCategory } from '../evaluator.js';
import { gtoPreflop, gtoPostflop, positionLabel, VILLAIN_PRE } from './botgto.js';
const NAMES = [
    'マグロ半額', 'yuki_0217', 'ぽんず。', 'DarkFlame猫', 'noodle_master', 'Sio*Ramen',
    'kk_88', 'ひよこ隊長', 'Zephyr', 'たまねぎ王子', 'runa_luna', 'ガチ勢のフリ',
    'mocha√', 'ヘッポコ侍', 'JETstream7', 'おこめ戦士', 'ミラクル指圧', 'popo_taro',
    '眠いだけの人', 'シュレ猫', 'A5ランク', 'べーやん', 'Twilight_9', 'メンダコ',
    'よっしー', 'ラス1', 'すあま', 'Fuji_apple', '万年フロップ', 'にゃんこ102',
    'GG_toro', '焼き鳥のタレ', 'Bell_pepper', 'ナナシ', 'kuma×kuma', 'ロケットぱんち',
    'sara_h', '奇跡のフォールド', 'TILT中', 'こたつむり', 'Vega', '鰤しゃぶ',
    'MidnightOil', 'ぴょん吉', 'ryo(本物)', '偽物のryo', 'SunDayDrive', '納豆ヶ丘',
    'Charon_x', 'ちくわ大明神', '低空飛行', 'Aoi_22', '親のスマホ', 'キリン一番',
    'whitesnow_', '裏道のプロ', 'たこ焼き奉行', 'Nia', '見るだけのつもり', '静かなる闘志',
    'coffee_break3', '大阪の虎', 'Pixel_8bit', '夜勤明け', 'ミント強め', 'Go1denTime',
    'しがない配管工', 'runrun', '手が滑った', '2度目の正直',
];
const SYM = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
function fromDisplay(s) {
    return parseCard(s.slice(1) + (SYM[s[0]] ?? 's'));
}
const rnd = Math.random;
const pick = (a) => a[Math.floor(rnd() * a.length)];
/** プリフロップのざっくりハンド強度 (0..1) */
function preflopStrength(a, b) {
    const r1 = (a >> 2) + 2, r2 = (b >> 2) + 2;
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    const suited = (a & 3) === (b & 3);
    if (r1 === r2)
        return 0.52 + ((hi - 2) / 12) * 0.4; // 22=0.52 .. AA=0.92
    let s = 0.1 + (hi - 2) * 0.028 + (lo - 2) * 0.012;
    if (suited)
        s += 0.05;
    const gap = hi - lo;
    if (gap === 1)
        s += 0.05;
    else if (gap === 2)
        s += 0.02;
    if (hi === 14 && lo >= 10)
        s += 0.1;
    return Math.min(s, 0.9);
}
/** ボードあり時のざっくり強度 (0..1) */
function madeStrength(hole, board) {
    const hv = evaluateBest([...hole, ...board]);
    const base = {
        [HandCategory.HighCard]: 0.18, [HandCategory.Pair]: 0.44, [HandCategory.TwoPair]: 0.63,
        [HandCategory.Trips]: 0.76, [HandCategory.Straight]: 0.85, [HandCategory.Flush]: 0.88,
        [HandCategory.FullHouse]: 0.94, [HandCategory.Quads]: 0.98, [HandCategory.StraightFlush]: 1,
    };
    let s = base[hv.category] ?? 0.3;
    // トップレンクの高さで少し補正
    s += ((hv.ranks[0] ?? 8) - 8) * 0.006;
    return Math.max(0.05, Math.min(s, 1));
}
class Bot {
    url;
    onDead;
    preferTableId;
    mode;
    /** 現在着席中(または向かっている)卓。スカウトが重複派遣を避けるために見る */
    tableId2 = null;
    ws = null;
    timers = new Set();
    tableId = null;
    lastActKey = '';
    lastHandId = null;
    handsPlayed = 0;
    lifeHands = 6 + Math.floor(rnd() * 34);
    leaving = false;
    /** 卓のステークスに応じた強さ (0=最弱テーブル, 1=最高額テーブル) */
    tier = 0;
    name = pick(NAMES) + (rnd() < 0.18 ? String(Math.floor(rnd() * 98) + 1) : '');
    p = {
        tight: 0.25 + rnd() * 0.5,
        aggr: 0.15 + rnd() * 0.65,
        bluff: rnd() * 0.28,
        err: rnd() * 0.2,
        thinkMul: 0.6 + rnd() * 1.6,
    };
    /** 参加中のトーナメントID(トーナメントbotのみ) */
    tourId = null;
    tourMisses = 0;
    constructor(url, onDead, preferTableId = null, mode = 'cash') {
        this.url = url;
        this.onDead = onDead;
        this.preferTableId = preferTableId;
        this.mode = mode;
    }
    start() {
        try {
            this.ws = new WebSocket(this.url);
        }
        catch {
            this.dead();
            return;
        }
        const ws = this.ws;
        ws.onopen = () => {
            this.send({ t: 'hello', v: 1, name: this.name, userId: 'bot_' + Math.random().toString(36).slice(2, 12) });
            // 招待コードで軍資金を用意（高額卓にも入れるように）
            this.after(400, () => {
                for (const c of ['LUCKY1B', 'RICH10B', 'VIP100B', 'WHALE1T', 'GOD10T', 'DRAGON100T']) {
                    this.send({ t: 'code.redeem', code: c });
                }
            });
            if (this.mode === 'tour') {
                this.after(1500 + rnd() * 800, () => this.send({ t: 'tour.list' }));
            }
            else {
                this.after(500 + rnd() * 500, () => this.send({ t: 'lobby.list' }));
            }
        };
        ws.onmessage = (ev) => {
            let m;
            try {
                m = JSON.parse(String(ev.data));
            }
            catch {
                return;
            }
            this.handle(m);
        };
        ws.onclose = () => this.dead();
        ws.onerror = () => { };
        // 保険: キャッシュは3〜6分で退店。トーナメント要員は登録先がある限り待機し続ける
        // (常設SNG/MTTで「人間が来たら即開始」の頭数を維持するため)。未登録のまま20分で退店
        if (this.mode === 'tour') {
            this.after(20 * 60000, () => { if (!this.tourId) {
                try {
                    this.ws?.close();
                }
                catch { /* noop */ }
            } });
        }
        else
            this.after(180000 + rnd() * 180000, () => this.leaveSoon());
    }
    handle(m) {
        if (this.mode === 'tour') {
            // 定期大会(tt-)のうち、埋まりが浅いものに1本だけ登録する
            if (m.t === 'tour.tournaments' && !this.tourId) {
                const cands = m.tournaments.filter((t) => {
                    if (t.state !== 'registering')
                        return false;
                    if (t.buyIn + (t.fee ?? 0) > 90_000_000_000_000)
                        return false;
                    // 定期大会(tt-)は9人(=1卓ぶん)まで埋める
                    if (String(t.tournamentId).startsWith('tt-'))
                        return t.entrants < 9;
                    // 常設SNGは「あと人間1人で開始」の状態まで埋めて待つ
                    if (t.type === 'sng')
                        return t.entrants < t.maxPlayers - 1;
                    // 常設MTTは「最低人数以上・9人まで」埋める → 即開催され、人間はレイトレジでいつでも参加できる
                    return t.entrants < Math.max(t.minPlayers ?? 6, 9);
                });
                if (!cands.length) {
                    // 3回続けて空振りなら退店して枠を空ける
                    if (++this.tourMisses >= 3) {
                        this.after(1000, () => { try {
                            this.ws?.close();
                        }
                        catch { /* noop */ } });
                        return;
                    }
                    this.after(15000 + rnd() * 5000, () => this.send({ t: 'tour.list' }));
                    return;
                }
                cands.sort((a, b) => a.entrants - b.entrants);
                const t = cands[0];
                this.tourId = t.tournamentId;
                this.tier = Math.max(0, Math.min(1, (Math.log10(Math.max(10, t.buyIn)) - 1.7) / 10.7));
                this.after(400 + rnd() * 1500, () => this.send({ t: 'tour.register', tournamentId: this.tourId }));
                return;
            }
            if (m.t === 'tournament.state' && m.view && m.view.tournamentId === this.tourId) {
                const v = m.view;
                if (v.state === 'finished' || v.state === 'cancelled' || v.yourFinishPosition) {
                    // 大会終了 or 自分が脱落(リエントリーはしない) → 退店
                    this.after(2000 + rnd() * 4000, () => { try {
                        this.ws?.close();
                    }
                    catch { /* noop */ } });
                    return;
                }
                if (v.yourTableId && v.yourTableId !== this.tableId) {
                    // 開始・卓再編成で割り当てられた卓へ移動して観戦(席は主催側が用意済み)
                    this.tableId = v.yourTableId;
                    this.tableId2 = v.yourTableId;
                    this.after(200 + rnd() * 500, () => this.send({ t: 'table.watch', tableId: this.tableId }));
                }
                return;
            }
        }
        if (m.t === 'lobby.tables' && !this.tableId && this.mode === 'cash') {
            const cands = m.tables.filter((t) => t.seatedCount < t.maxSeats && t.minBuyIn <= 90_000_000_000_000);
            if (!cands.length) {
                this.leaveSoon();
                return;
            }
            // スカウト派遣: 指定卓が空いていればそこへ直行
            const pref = this.preferTableId ? cands.find((t) => t.tableId === this.preferTableId) : null;
            if (pref) {
                this.tableId = pref.tableId;
                this.tableId2 = pref.tableId;
                this.tier = Math.max(0, Math.min(1, (Math.log10(pref.bigBlind) - 1.7) / 10.7));
                this.after(200 + rnd() * 600, () => {
                    this.send({ t: 'table.watch', tableId: this.tableId });
                    this.after(250 + rnd() * 500, () => {
                        const maxAff = Math.min(pref.maxBuyIn ?? pref.minBuyIn * 5, 100_000_000_000_000);
                        const buyIn = Math.round(pref.minBuyIn + rnd() * Math.max(0, maxAff - pref.minBuyIn));
                        this.send({ t: 'table.sit', tableId: this.tableId, buyIn });
                    });
                });
                return;
            }
            // 人がいる卓に吸い寄せられる（誰もいなければランダム）
            // 「誰かはいるが人数が少ない卓」を最優先(=待っているプレイヤーの卓へ真っ先に行く)。
            // 大きなクラスタに固まらないよう、満席に近いほど重みを下げる
            const weighted = [];
            for (const t of cands) {
                // 空卓にもある程度流れ、5人以上埋まった卓には行きにくくする(固まり防止)
                const w = t.seatedCount === 0 ? 4 : t.seatedCount >= 5 ? 2 : 8 + Math.max(0, 4 - t.seatedCount) * 5;
                for (let i = 0; i < w; i++)
                    weighted.push(t);
            }
            const t = pick(weighted);
            this.tableId = t.tableId;
            this.tableId2 = t.tableId;
            // バイインが上がるほど強い（ミスが減り、判断が正確になる）
            this.tier = Math.max(0, Math.min(1, (Math.log10(t.bigBlind) - 1.7) / 10.7));
            this.after(250 + rnd() * 900, () => {
                this.send({ t: 'table.watch', tableId: this.tableId });
                this.after(300 + rnd() * 800, () => {
                    const maxAffordable = Math.min(t.maxBuyIn ?? t.minBuyIn * 5, 100_000_000_000_000);
                    const buyIn = Math.round(t.minBuyIn + rnd() * Math.max(0, maxAffordable - t.minBuyIn));
                    this.send({ t: 'table.sit', tableId: this.tableId, buyIn });
                });
            });
            return;
        }
        if (m.t === 'table.state' && m.state)
            this.onState(m.state);
        if (m.t === 'error') {
            // 手番のままエラーになった場合の安全弁
            this.after(500, () => {
                if (this.pendingSt) {
                    const st = this.pendingSt;
                    this.pendingSt = null;
                    const check = st.legalActions.find((a) => a.type === 'check');
                    this.act(st, check ? 'check' : 'fold');
                }
            });
        }
    }
    pendingSt = null;
    aloneSince = 0;
    /** GTO用: このストリートで自分が最後の攻撃側か / 前ストリートで攻撃側だったか */
    aggro = false;
    wasAggro = false;
    streetKey = '';
    /** 卓の相手傾向の観測統計(仕様書§39-42)。同一(ハンド,ストリート,席,行動)は1回だけ数える。
     *  betInit(自分から打つ)とraiseFacing(打たれてレイズ)を分ける(V2 §31) */
    statSeen = new Set();
    stat = { fold: 0, passive: 0, betInit: 0, raiseFacing: 0 };
    /** 相手のプリフロップの行動から推定したレンジ(V2 §6)と、ポストフロップで攻めたストリート */
    preRange = new Map();
    aggBySeat = new Map();
    /** 自分自身のレンジ(自分のプリフロップの行動から。リバーソルバーのunsafe re-solve用) */
    myPreSpec = null;
    myAggSet = new Set();
    onState(st) {
        if (st.tableId !== this.tableId)
            return;
        // ハンド区切りの検知
        if (st.handId && st.handId !== this.lastHandId) {
            this.lastHandId = st.handId;
            this.handsPlayed++;
            this.aggro = false;
            this.wasAggro = false;
            this.streetKey = '';
            this.preRange.clear();
            this.aggBySeat.clear();
            this.myPreSpec = null;
            this.myAggSet.clear();
        }
        const sk = `${st.handId}:${st.street}`;
        if (sk !== this.streetKey) {
            this.streetKey = sk;
            this.wasAggro = this.aggro;
            this.aggro = false;
        }
        // 相手傾向の観測(fold / 受動 / 自発ベット / 対抗レイズ) + 相手レンジの推定(V2 §6)
        if (st.handId && st.street !== 'waiting') {
            for (const x of st.seats) {
                if (!x.userId || x.seat === st.yourSeat || !x.lastAction)
                    continue;
                const key = `${st.handId}:${st.street}:${x.seat}:${x.lastAction}`;
                if (this.statSeen.has(key))
                    continue;
                this.statSeen.add(key);
                const isAggr = x.lastAction === 'bet' || x.lastAction === 'raise' || x.lastAction === 'allin';
                if (x.lastAction === 'fold')
                    this.stat.fold++;
                else if (x.lastAction === 'check' || x.lastAction === 'call')
                    this.stat.passive++;
                else if (x.lastAction === 'bet')
                    this.stat.betInit++;
                else if (x.lastAction === 'raise' || x.lastAction === 'allin')
                    this.stat.raiseFacing++;
                if (st.street === 'preflop') {
                    // プリフロップの行動 → 初期レンジ信念
                    if (isAggr) {
                        if (x.streetBet >= st.bigBlind * 7)
                            this.preRange.set(x.seat, VILLAIN_PRE.threeBettor);
                        else {
                            const dealt = st.seats.filter((y) => y.userId && !y.sittingOut).map((y) => y.seat);
                            const p = positionLabel(x.seat, st.buttonIndex, dealt, st.maxSeats);
                            this.preRange.set(x.seat, p === 'UTG' || p === 'HJ' ? VILLAIN_PRE.raiserEarly :
                                p === 'CO' ? VILLAIN_PRE.raiserMid : VILLAIN_PRE.raiserLate);
                        }
                    }
                    else if (x.lastAction === 'call' && !this.preRange.has(x.seat)) {
                        this.preRange.set(x.seat, VILLAIN_PRE.caller);
                    }
                    else if (x.lastAction === 'check' && !this.preRange.has(x.seat)) {
                        this.preRange.set(x.seat, VILLAIN_PRE.wide);
                    }
                }
                else if (isAggr) {
                    let set = this.aggBySeat.get(x.seat);
                    if (!set) {
                        set = new Set();
                        this.aggBySeat.set(x.seat, set);
                    }
                    set.add(st.street);
                }
            }
            if (this.statSeen.size > 4000)
                this.statSeen.clear(); // メモリ保険
        }
        // ひとりぼっち検知：45秒誰も来なければ席を立って別の卓へ(実際は退店→補充で人気卓に入る)
        if (st.yourSeat !== null && st.street === 'waiting') {
            const occupied = st.seats.filter((x) => x.userId).length;
            if (occupied <= 1) {
                if (!this.aloneSince)
                    this.aloneSince = Date.now();
                else if (Date.now() - this.aloneSince > 45000)
                    this.leaving = true;
            }
            else
                this.aloneSince = 0;
        }
        else
            this.aloneSince = 0;
        // 退店タイミング：ハンドとハンドの「合間」(street==='waiting')に限る。
        // ショーダウンの段階公開中(street==='complete')に飛んだプレイヤーが席を立つと、
        // 場札を開ききる前に「その席が消えた＝負けた」とバレてしまうため、必ず結果が
        // 出て精算(settle)が終わった waiting のタイミングまで待ってから退店する。
        // さらにこの間はスタックがペイアウト前の値で送られる(残高ネタバレ防止)ので、
        // 勝ったプレイヤーの一時的な低残高で誤って退店しないためにも waiting 限定が要る。
        const settledBetweenHands = st.street === 'waiting';
        if (this.mode === 'cash' && settledBetweenHands &&
            (this.leaving || this.handsPlayed > this.lifeHands ||
                (st.yourSeat !== null && (st.seats[st.yourSeat]?.stack ?? 0) < st.bigBlind * 4))) {
            this.goodbye();
            return;
        }
        // 手番なら考えてから行動
        if (st.yourSeat === null || st.actingSeat !== st.yourSeat || !st.legalActions?.length || !st.handId)
            return;
        const key = `${st.handId}:${st.street}:${st.currentBet}:${st.pot}`;
        if (key === this.lastActKey)
            return;
        this.lastActKey = key;
        this.pendingSt = st;
        // 思考時間(仕様書§66-68): ストリートで基準を変え、「決断の重さ」でだけ長考する。
        // ハンドの強弱では変えない(タイミングテル防止)
        const range = st.street === 'preflop' ? [400, 1500] :
            st.street === 'flop' ? [800, 3000] :
                st.street === 'turn' ? [1000, 4000] : [1500, 6000];
        let think = (range[0] + rnd() * (range[1] - range[0])) * this.p.thinkMul;
        const toCallNow = st.legalActions.find((a) => a.type === 'call')?.amount ?? 0;
        const bigDecision = toCallNow > Math.max(st.pot, 1) * 0.6 ||
            toCallNow > (st.seats[st.yourSeat]?.stack ?? 1) * 0.35;
        if (bigDecision)
            think += 1500 + rnd() * 4500;
        else if (rnd() < 0.05)
            think += 2000 + rnd() * 4000;
        this.after(Math.min(think, 11000), () => {
            if (this.pendingSt !== st)
                return;
            this.pendingSt = null;
            this.decide(st);
        });
    }
    decide(st) {
        const legal = st.legalActions;
        const check = legal.find((a) => a.type === 'check');
        const call = legal.find((a) => a.type === 'call');
        const raise = legal.find((a) => a.type === 'raise' || a.type === 'bet');
        // 人間的なミス：たまに変な行動（高額卓ほどミスしない）
        if (rnd() < this.p.err * 0.3 * (1 - 0.9 * this.tier)) {
            this.act(st, pick(legal).type, raise?.min);
            return;
        }
        const hole = (st.seats[st.yourSeat].holeCards ?? []).map(fromDisplay);
        const board = (st.board ?? []).map(fromDisplay);
        if (hole.length < 2) {
            this.act(st, check ? 'check' : 'fold');
            return;
        }
        // GTO頭脳(botgto.ts)。低レート卓ほど「我流」が残り、高レート卓ほどGTOに忠実
        if (rnd() >= 0.25 * (1 - 0.8 * this.tier)) {
            try {
                const g = this.gtoDecide(st, hole, board);
                if (g) {
                    this.applyGto(st, g);
                    return;
                }
            }
            catch { /* 失敗時は従来ロジックへ */ }
        }
        let s = board.length >= 3 ? madeStrength(hole, board) : preflopStrength(hole[0], hole[1]);
        s += (rnd() - 0.5) * 0.12 * (1 - 0.75 * this.tier); // ゆらぎ（高額卓ほど判断がブレない）
        const bluffing = rnd() < this.p.bluff && board.length >= 3;
        if (bluffing)
            s = Math.max(s, 0.68 + rnd() * 0.2);
        const toCall = call?.amount ?? 0;
        const pot = Math.max(st.pot, st.bigBlind * 2);
        const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
        const myStack = st.seats[st.yourSeat].stack ?? 0;
        const raiseTo = (mult) => {
            if (!raise)
                return null;
            const to = Math.round(Math.min(raise.max, Math.max(raise.min, st.currentBet + pot * mult)));
            return to;
        };
        if (toCall === 0) {
            // チェック可
            const wantBet = s > 0.62 - this.p.aggr * 0.12 || (bluffing && rnd() < 0.7);
            if (wantBet && raise && rnd() < 0.45 + this.p.aggr * 0.4) {
                this.act(st, raise.type, raiseTo(0.4 + rnd() * 0.6));
            }
            else {
                this.act(st, check ? 'check' : 'fold');
            }
            return;
        }
        // コールが必要
        const threshold = potOdds +
            (this.p.tight - 0.4) * 0.18 * (1 - 0.5 * this.tier) +
            this.tier * 0.03 +
            (toCall > myStack * 0.5 ? 0.12 - this.tier * 0.04 : 0);
        if (s < threshold) {
            this.act(st, 'fold');
            return;
        }
        if (raise && (s > 0.8 || (s > 0.68 && rnd() < this.p.aggr))) {
            const allin = s > 0.92 && rnd() < this.p.aggr * 0.5;
            this.act(st, raise.type, allin ? raise.max : raiseTo(0.6 + rnd() * 0.7));
            return;
        }
        this.act(st, 'call');
    }
    /** 状況をGTOモジュール用のコンテキストに変換して意思決定する */
    gtoDecide(st, hole, board) {
        const call = st.legalActions.find((a) => a.type === 'call');
        const toCall = call?.amount ?? 0;
        const me = st.seats[st.yourSeat];
        const bb = st.bigBlind;
        const dealt = st.seats.filter((x) => x.userId && !x.sittingOut).map((x) => x.seat);
        const active = st.seats.filter((x) => x.userId && !x.sittingOut && !x.folded &&
            (x.stack > 0 || x.streetBet > 0 || x.totalBet > 0 || x.allIn));
        const pos = positionLabel(st.yourSeat, st.buttonIndex, dealt, st.maxSeats);
        const rndFn = rnd;
        if (st.street === 'preflop') {
            let openerSeat = -1, openerBet = 0, openerAllIn = false;
            for (const x of st.seats) {
                if (x.seat === st.yourSeat || !x.userId)
                    continue;
                if (x.streetBet > openerBet) {
                    openerBet = x.streetBet;
                    openerSeat = x.seat;
                    openerAllIn = !!x.allIn;
                }
            }
            const openerPos = openerSeat >= 0 && openerBet > bb
                ? positionLabel(openerSeat, st.buttonIndex, dealt, st.maxSeats) : null;
            const limpers = st.seats.filter((x) => x.seat !== st.yourSeat && x.userId && !x.folded && x.streetBet === bb && x.lastAction === 'call').length;
            // ビッグスタックプレッシャー(§57): トナメで自分が突出したスタックならレンジを広げ圧をかける
            const maxOpp = Math.max(1, ...st.seats.filter((x) => x.userId && x.seat !== st.yourSeat && !x.sittingOut)
                .map((x) => x.stack + x.streetBet));
            const bigStackPressure = this.mode === 'tour' && (me.stack + me.streetBet) > maxOpp * 1.8 ? 0.05 : 0;
            const g = gtoPreflop({
                hole: [hole[0], hole[1]], pos, headsUp: dealt.length === 2, bb,
                myStack: me.stack, myStreetBet: me.streetBet, toCall,
                currentBet: st.currentBet, pot: Math.max(st.pot, bb * 2), limpers,
                openerPos, opponentAllIn: openerAllIn, tourMode: this.mode === 'tour',
                rnd: rndFn, aggr: Math.min(1, this.p.aggr + bigStackPressure * 2),
                loose: (0.45 - this.p.tight) * 0.15 + bigStackPressure,
            });
            // 自分のレンジ信念(リバーソルバーのunsafe re-solve用)
            if (g.action === 'raise' || g.action === 'allin') {
                this.myPreSpec = st.currentBet >= bb * 4.5 ? VILLAIN_PRE.threeBettor :
                    pos === 'UTG' || pos === 'HJ' ? VILLAIN_PRE.raiserEarly :
                        pos === 'CO' ? VILLAIN_PRE.raiserMid : VILLAIN_PRE.raiserLate;
            }
            else if (g.action === 'call') {
                this.myPreSpec = pos === 'BB' ? VILLAIN_PRE.bbDefend : VILLAIN_PRE.caller;
            }
            else if (g.action === 'check') {
                this.myPreSpec = VILLAIN_PRE.wide;
            }
            return g;
        }
        if (board.length < 3)
            return null;
        const order = (s) => (s - (st.buttonIndex + 1) + st.maxSeats * 2) % st.maxSeats;
        const inPosition = active.every((x) => x.seat === st.yourSeat || order(x.seat) <= order(st.yourSeat));
        // 観測統計 → 相手傾向(0.5=平均)と確信度。高レート卓のbotほど正しくExploitする
        const samples = this.stat.fold + this.stat.passive + this.stat.betInit + this.stat.raiseFacing;
        const foldShare = samples > 0 ? this.stat.fold / samples : 0.38;
        const aggrShare = samples > 0 ? (this.stat.betInit + this.stat.raiseFacing) / samples : 0.25;
        const raiseShare = samples > 0 ? this.stat.raiseFacing / samples : 0.1;
        const clamp01 = (v) => Math.max(0, Math.min(1, v));
        // 主対戦相手 = このストリートで最も多く入れている席(いなければ攻撃回数が多い席)
        let villain = null;
        for (const x of active) {
            if (x.seat === st.yourSeat)
                continue;
            if (!villain || x.streetBet > villain.streetBet ||
                (x.streetBet === villain.streetBet &&
                    (this.aggBySeat.get(x.seat)?.size ?? 0) > (this.aggBySeat.get(villain.seat)?.size ?? 0)))
                villain = x;
        }
        return gtoPostflop({
            hole, board,
            street: st.street === 'flop' || st.street === 'turn' || st.street === 'river' ? st.street : 'river',
            pot: Math.max(st.pot, bb * 2), toCall, currentBet: st.currentBet, bb,
            myStack: me.stack, inPosition, nActive: active.length,
            wasAggressor: this.wasAggro || this.aggro, tourMode: this.mode === 'tour',
            rnd: rndFn, aggr: this.p.aggr, bluff: this.p.bluff, tight: this.p.tight, tier: this.tier,
            oppFold: clamp01(0.5 + (foldShare - 0.38) * 1.5),
            oppAggr: clamp01(0.5 + (aggrShare - 0.25) * 1.5),
            oppRaisey: clamp01(0.5 + (raiseShare - 0.1) * 2.5),
            conf: Math.min(1, samples / 80) * (0.3 + 0.7 * this.tier),
            villainSpec: villain ? (this.preRange.get(villain.seat) ?? VILLAIN_PRE.bbDefend) : null,
            villainAggStreets: villain ? (this.aggBySeat.get(villain.seat)?.size ?? 0) : 0,
            heroSpec: this.myPreSpec,
            heroAggStreets: this.myAggSet.size,
            heroStreetBet: me.streetBet,
        });
    }
    /** GTOの推奨アクションを合法手に丸めて送信する */
    applyGto(st, g) {
        const legal = st.legalActions;
        const check = legal.find((a) => a.type === 'check');
        const call = legal.find((a) => a.type === 'call');
        const raise = legal.find((a) => a.type === 'raise' || a.type === 'bet');
        if (g.action === 'fold') {
            this.act(st, check ? 'check' : 'fold');
            return;
        }
        if (g.action === 'check') {
            this.act(st, check ? 'check' : call ? 'call' : 'fold');
            return;
        }
        if (g.action === 'call') {
            this.act(st, call ? 'call' : check ? 'check' : 'fold');
            return;
        }
        if (!raise) {
            this.act(st, call ? 'call' : check ? 'check' : 'fold');
            return;
        }
        if (g.action === 'allin') {
            this.act(st, raise.type, raise.max);
            return;
        }
        const to = Math.round(Math.min(raise.max, Math.max(raise.min, g.to ?? raise.min)));
        this.act(st, raise.type, to);
    }
    act(st, action, toAmount) {
        if (action === 'raise' || action === 'bet') {
            this.aggro = true;
            if (st.street !== 'preflop')
                this.myAggSet.add(st.street);
        }
        this.send({ t: 'hand.act', tableId: this.tableId, handId: st.handId, action, toAmount });
    }
    leaveSoon() { this.leaving = true; }
    goodbye() {
        if (this.tableId) {
            this.send({ t: 'table.stand', tableId: this.tableId });
            this.send({ t: 'table.leave', tableId: this.tableId });
        }
        this.after(300 + rnd() * 900, () => this.ws?.close());
    }
    send(msg) {
        try {
            if (this.ws && this.ws.readyState === 1)
                this.ws.send(JSON.stringify(msg));
        }
        catch { /* noop */ }
    }
    after(ms, fn) {
        const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
        this.timers.add(id);
    }
    dead() {
        for (const id of this.timers)
            clearTimeout(id);
        this.timers.clear();
        this.onDead();
    }
}
export function startBots(url) {
    // 群れ全体の規模係数。POKER_BOT_SCALE=0.5 で半分、2 で倍(既定1)
    const SCALE = Math.max(0.25, Math.min(3, Number(process.env.POKER_BOT_SCALE ?? 1) || 1));
    if (typeof WebSocket === 'undefined') {
        console.warn('この Node には WebSocket が無いためボットは無効です（Node 22+ が必要）');
        return;
    }
    const alive = new Set();
    let target = Math.round((26 + Math.floor(rnd() * 7)) * SCALE);
    const spawn = (preferTableId = null) => {
        const bot = new Bot(url, () => {
            alive.delete(bot);
            // 退店したら数秒で別人格を補充(人数が足りない場合)
            if (alive.size < target)
                setTimeout(() => spawn(), 2500 + rnd() * 6000);
        }, preferTableId);
        alive.add(bot);
        bot.start();
    };
    // ---- スカウト: プレイヤーが座った卓を検知し、ボット不在ならすぐ1体派遣する ----
    const scoutCooldown = new Map();
    const scout = () => {
        try {
            const ws = new WebSocket(url);
            ws.onopen = () => {
                ws.send(JSON.stringify({ t: 'hello', v: 1, name: '\u898B\u5B66\u4E2D', userId: 'bot_scout' + Math.random().toString(36).slice(2, 8) }));
                setInterval(() => { try {
                    ws.send(JSON.stringify({ t: 'lobby.list' }));
                }
                catch { /* noop */ } }, 8000);
            };
            ws.onmessage = (ev) => {
                let m;
                try {
                    m = JSON.parse(String(ev.data));
                }
                catch {
                    return;
                }
                if (m.t !== 'lobby.tables')
                    return;
                const now = Date.now();
                for (const t of m.tables) {
                    if (t.seatedCount < 1 || t.seatedCount >= t.maxSeats)
                        continue;
                    if (t.minBuyIn > 90_000_000_000_000)
                        continue;
                    const hasBot = [...alive].some((b) => b.tableId2 === t.tableId);
                    if (hasBot)
                        continue;
                    if ((scoutCooldown.get(t.tableId) ?? 0) > now)
                        continue;
                    if (alive.size >= Math.round(42 * SCALE))
                        break;
                    scoutCooldown.set(t.tableId, now + 30000);
                    setTimeout(() => spawn(t.tableId), 500 + rnd() * 2500);
                    break; // 1ティックにつき1派遣
                }
            };
            ws.onclose = () => setTimeout(scout, 5000);
            ws.onerror = () => { };
        }
        catch {
            setTimeout(scout, 10000);
        }
    };
    setTimeout(scout, 3000);
    // ---- トーナメント要員: 定期大会(tt-)の最低人数をbotで担保する ----
    const tourAlive = new Set();
    const spawnTour = () => {
        const bot = new Bot(url, () => { tourAlive.delete(bot); }, null, 'tour');
        tourAlive.add(bot);
        bot.start();
    };
    const TOUR_POOL = Math.round(180 * SCALE);
    setTimeout(() => { for (let i = 0; i < Math.round(60 * SCALE); i++)
        setTimeout(spawnTour, i * 700 + rnd() * 600); }, 4000);
    setInterval(() => {
        const deficit = TOUR_POOL - tourAlive.size;
        for (let i = 0; i < Math.min(5, deficit); i++)
            setTimeout(spawnTour, i * 1200 + rnd() * 800);
    }, 8000);
    // 起動直後に時間差で入店
    for (let i = 0; i < target; i++)
        setTimeout(spawn, 800 + i * (900 + rnd() * 1500));
    // 人口をゆらす：ときどき目標人数を変え、不足はすばやく補充
    setInterval(() => {
        if (rnd() < 0.4)
            target = Math.max(Math.round(20 * SCALE), Math.min(Math.round(38 * SCALE), target + (rnd() < 0.5 ? -1 : 1)));
        const deficit = target - alive.size;
        for (let i = 0; i < Math.min(deficit, 2); i++)
            setTimeout(spawn, i * 3000 + rnd() * 4000);
        if (deficit < 0 && alive.size > 0)
            pick([...alive]).leaveSoon();
    }, 12000);
}
//# sourceMappingURL=bots.js.map