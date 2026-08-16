/**
 * ロビー：テーブル・トーナメント・経済のとりまとめと、メッセージのルーティング
 *
 * トランスポート（WebSocket）から切り離してあるので、テストでは偽の送信先を差して
 * ソケットを一切張らずにプロトコル全体を検証できる。
 * 実際のバグの大半はソケットではなくこの層に出るので、ここを高速にテストできることが重要。
 */
import { MemoryStore } from './store.js';
import { Economy, CHIP_PACKS, GOLD_PACKS, PASS_PREMIUM_SKU } from './economy.js';
import { Room, realScheduler } from './room.js';
import { Tournament } from './tournament.js';
import { PROTOCOL_VERSION, parseClientMessage, } from './protocol.js';
import { randomSeedHex } from '../fair.js';
import { hmacSha256 } from '../sha256.js';
const DEFAULTS = {
    signupBonus: 50000,
    signupGold: 100,
    maxMessagesPerSecond: 20,
    authSecret: '',
};
/** 招待コード：入力するとチップがもらえる（1ユーザー1回まで） */
const INVITE_CODES = {
    // --- 入門(マイクロ〜ハイ卓向け) ---
    STARTER10M: 10_000_000, // 1000万
    BRONZE100M: 100_000_000, // 1億
    SILVER500M: 500_000_000, // 5億
    // --- 中堅(ハイローラー〜レジェンド卓向け) ---
    LUCKY1B: 1_000_000_000, // 10億
    GOLD5B: 5_000_000_000, // 50億
    RICH10B: 10_000_000_000, // 100億
    PLATINUM50B: 50_000_000_000, // 500億
    VIP100B: 100_000_000_000, // 1000億
    DIAMOND500B: 500_000_000_000, // 5000億
    // --- 大物(ミリオネア〜神々の卓・高額トーナメント向け) ---
    WHALE1T: 1_000_000_000_000, // 1兆
    SHARK5T: 5_000_000_000_000, // 5兆
    GOD10T: 10_000_000_000_000, // 10兆
    TITAN50T: 50_000_000_000_000, // 50兆
    DRAGON100T: 100_000_000_000_000, // 100兆
    // --- 最終兵器 ---
    PHOENIX500T: 500_000_000_000_000, // 500兆
    INFINITY1000T: 1_000_000_000_000_000, // 1000兆
};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomTableCode() {
    let s = '';
    for (let i = 0; i < 6; i++)
        s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
}
export class Lobby {
    transport;
    clock;
    store;
    economy;
    rooms = new Map();
    /** プライベート卓（ロビー一覧に出さない） */
    privateIds = new Set();
    /** 卓コード → tableId */
    tableCodes = new Map();
    /** 招待コードの使用履歴（メモリ上。再起動でリセットされる点は HANDOFF 参照） */
    redeemedCodes = new Map();
    tournaments = new Map();
    /** 定期開催トーナメントの連番と、終了後の掃除予定時刻 */
    tourSeq = 0;
    tourPruneAt = new Map();
    sessions = new Map();
    resumeTokens = new Map();
    cfg;
    constructor(cfg, transport, clock = realScheduler) {
        this.transport = transport;
        this.clock = clock;
        // 明示的に undefined が渡ることがある（Gateway が options をそのまま流すため）ので、
        // スプレッドの後に必ず既定値へ落とす。ここを ...cfg に任せると undefined で上書きされる
        this.cfg = { ...DEFAULTS, ...cfg, tournaments: cfg.tournaments ?? [] };
        this.store = cfg.store ?? new MemoryStore();
        this.economy = new Economy(this.store, () => this.clock.now());
        const io = { send: (sid, msg) => this.transport.send(sid, msg) };
        const bank = {
            withdraw: (userId, amount, ref) => this.store.post(userId, 'chips', -amount, 'table_buyin', ref) !== null,
            deposit: (userId, amount, ref) => {
                this.store.post(userId, 'chips', amount, 'table_cashout', ref);
            },
            balanceOf: (userId) => this.store.balance(userId, 'chips'),
        };
        this.bank = bank;
        this.io = io;
        for (const t of cfg.tables) {
            const room = new Room(t, io, bank, clock);
            room.hooks.onHandResult = (r, summary, seats) => this.onHandResult(r, summary, seats);
            this.rooms.set(t.tableId, room);
        }
        for (const t of this.cfg.tournaments)
            this.createTournament(t);
        this.startTourScheduler();
    }
    bank;
    io;
    /** 再接続トークンの署名鍵（cfg 未指定ならプロセス限り） */
    get authKey() {
        if (!this.authKeyCache) {
            this.authKeyCache = this.cfg.authSecret && this.cfg.authSecret.length >= 16 ? this.cfg.authSecret : randomSeedHex(16);
        }
        return this.authKeyCache;
    }
    authKeyCache = null;
    signUserId(userId) {
        const enc = new TextEncoder();
        const sig = hmacSha256(enc.encode(this.authKey), enc.encode(userId));
        return Array.from(sig.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    makeResumeToken(userId) {
        return `${userId}.${this.signUserId(userId)}`;
    }
    /** 署名付きトークンを検証して userId を返す。改ざん・形式不正なら null */
    verifyResumeToken(token) {
        const i = token.lastIndexOf('.');
        if (i <= 0)
            return null;
        const userId = token.slice(0, i);
        const sig = token.slice(i + 1);
        if (!/^[\w.-]{1,64}$/.test(userId) || sig.length !== 32)
            return null;
        return sig === this.signUserId(userId) ? userId : null;
    }
    createTournament(cfg) {
        const t = new Tournament(cfg, this.io, this.bank, {
            collectEntry: (userId, amount, ref) => this.store.post(userId, 'chips', -amount, 'tournament_buyin', ref) !== null,
            payPrize: (userId, amount, ref) => {
                this.store.post(userId, 'chips', amount, 'tournament_prize', ref);
                this.sendBalance(userId);
            },
            notify: (userId, msg) => this.sendToUser(userId, msg),
            onEntered: (userId) => this.economy.onTournamentEntered(userId),
        }, this.clock);
        this.tournaments.set(cfg.tournamentId, t);
        return t;
    }
    // -------------------------------------------------------------------------
    // タイムテーブル型の定期開催トーナメント
    //   ・常に5本前後の「これから始まる」大会が並ぶ(名前/バイイン/形式はランダム)
    //   ・定刻になったら開始(最低人数はbotの事前登録が担保する)
    //   ・終了後しばらくして一覧から消え、新しい大会が補充される(一期一会)
    // -------------------------------------------------------------------------
    startTourScheduler() {
        const NAMES = [
            'ベガス・カジノ', 'ACESポーカークラブ', 'ポーカークラブ', 'ベガス・ラグジュアリーカジノ',
            'ミッドナイト・チャレンジ', 'ゴールデンラッシュ', 'ロイヤルフラッシュ杯', 'デイリーグランプリ',
            'サンセット・ショーダウン', 'ダイヤモンドリーグ',
        ];
        // フォーマットのプリセット(現代MTTの主流構成)
        const PRESETS = [
            { label: 'フリーズアウト', reEntryMax: 0, addOn: null },
            { label: 'リエントリー1回', reEntryMax: 1, addOn: null },
            { label: 'リエントリー無制限', reEntryMax: 99, addOn: null },
            { label: 'リバイ&アドオン', reEntryMax: 3, addOn: { price: 0, chips: 30_000 } }, // priceは後でbuyInから設定
        ];
        const BUYINS = [5_000_000, 50_000_000, 500_000_000, 5_000_000_000, 50_000_000_000, 500_000_000_000];
        const tick = () => {
            const now = Date.now();
            // 1) 定刻を過ぎた大会を開始
            for (const t of this.tournaments.values())
                t.tickSchedule();
            // 2) 終了・中止した定期大会は3分後に一覧から消す
            for (const [id, t] of this.tournaments) {
                if (!id.startsWith('tt-'))
                    continue;
                if (t.state === 'finished' || t.state === 'cancelled') {
                    const at = this.tourPruneAt.get(id);
                    if (at === undefined)
                        this.tourPruneAt.set(id, now + 180_000);
                    else if (now >= at) {
                        this.tournaments.delete(id);
                        this.tourPruneAt.delete(id);
                    }
                }
            }
            // 2.5) 常設トーナメント(SNG/MTT)は終了・中止の60秒後に同じ設定で再開設する。
            //      これが無いと一度遊ばれた(またはbot同士で始まってしまった)常設大会が二度と遊べない
            for (const base of this.cfg.tournaments) {
                const cur = this.tournaments.get(base.tournamentId);
                if (cur && (cur.state === 'finished' || cur.state === 'cancelled')) {
                    const at = this.tourPruneAt.get(base.tournamentId);
                    if (at === undefined)
                        this.tourPruneAt.set(base.tournamentId, now + 60_000);
                    else if (now >= at) {
                        this.tourPruneAt.delete(base.tournamentId);
                        this.createTournament(base);
                    }
                }
            }
            // 3) 「登録受付中」の定期大会が5本になるまで補充
            const upcoming = [...this.tournaments.entries()].filter(([id, t]) => id.startsWith('tt-') && t.state === 'registering').length;
            for (let i = upcoming; i < 5; i++) {
                const name = NAMES[Math.floor(Math.random() * NAMES.length)];
                const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
                const buyIn = BUYINS[Math.floor(Math.random() * BUYINS.length)];
                const turbo = Math.random() < 0.35;
                const id = `tt-${++this.tourSeq}`;
                this.createTournament({
                    tournamentId: id,
                    name: `${name}${preset.label === 'フリーズアウト' ? '' : `（${preset.label}）`}`,
                    type: 'mtt',
                    buyIn,
                    fee: Math.round(buyIn * 0.1),
                    startingStack: 30_000,
                    seatsPerTable: 9,
                    maxPlayers: [27, 45, 90][Math.floor(Math.random() * 3)],
                    minPlayers: 4,
                    levelDurationMs: 4 * 60 * 1000,
                    speed: turbo ? 'turbo' : 'normal',
                    scheduledStart: now + (3 + Math.random() * 12) * 60_000,
                    lateRegMs: (8 + Math.random() * 6) * 60_000,
                    reEntryMax: preset.reEntryMax,
                    addOn: preset.addOn ? { price: buyIn, chips: 30_000 } : undefined,
                });
            }
        };
        tick();
        setInterval(tick, 20_000);
    }
    /** ハンド結果を受けて、永続化・ミッション・パス経験値を進める */
    onHandResult(room, summary, seats) {
        const rake = summary.pots.reduce((a, p) => a + p.rake, 0);
        this.store.saveHand({
            handId: summary.handId,
            tableId: room.cfg.tableId,
            handNumber: summary.handNumber,
            board: summary.board.join(' '),
            potTotal: summary.pots.reduce((a, p) => a + p.amount, 0),
            rake,
            fairness: JSON.stringify(summary.fairness),
            seats: JSON.stringify(seats.map((s) => ({ seat: s.seat, userId: s.userId, net: summary.netChange[s.seat] ?? 0 }))),
        });
        const winners = new Set();
        for (const p of summary.pots)
            for (const w of p.winners)
                winners.add(w);
        for (const s of seats) {
            const won = winners.has(s.seat);
            this.economy.onHandPlayed(s.userId, {
                won,
                showdownWin: won && summary.showdown,
                rakeContributed: Math.round(rake / Math.max(1, seats.length)),
            });
        }
    }
    getRoom(tableId) {
        const cash = this.rooms.get(tableId);
        if (cash)
            return cash;
        for (const t of this.tournaments.values()) {
            const r = t.getTable(tableId);
            if (r)
                return r;
        }
        return undefined;
    }
    listRooms() {
        // プライベート卓はロビー一覧から除外（コードを知っている人だけが入れる）
        return [...this.rooms.entries()].filter(([id]) => !this.privateIds.has(id)).map(([, r]) => r);
    }
    listTournaments() {
        return [...this.tournaments.values()];
    }
    getTournament(id) {
        return this.tournaments.get(id);
    }
    // -------------------------------------------------------------------------
    // 接続ライフサイクル
    // -------------------------------------------------------------------------
    onConnect(sessionId) {
        this.sessions.set(sessionId, {
            sessionId,
            userId: '',
            name: '',
            resumeToken: '',
            authenticated: false,
            tables: new Set(),
            windowStart: this.clock.now(),
            windowCount: 0,
            lastSeen: this.clock.now(),
        });
    }
    onDisconnect(sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s)
            return;
        for (const tableId of s.tables)
            this.getRoom(tableId)?.leave(sessionId);
        this.sessions.delete(sessionId);
    }
    onRaw(sessionId, data) {
        let parsed;
        try {
            parsed = JSON.parse(data);
        }
        catch {
            this.err(sessionId, 'BAD_MESSAGE', 'JSON として解釈できません');
            return;
        }
        const r = parseClientMessage(parsed);
        if (!r.ok) {
            this.err(sessionId, 'BAD_MESSAGE', r.reason);
            return;
        }
        this.onMessage(sessionId, r.msg);
    }
    onMessage(sessionId, msg) {
        const s = this.sessions.get(sessionId);
        if (!s)
            return;
        if (!this.rateLimitOk(s)) {
            this.err(sessionId, 'RATE_LIMITED', 'メッセージの送信が速すぎます');
            return;
        }
        s.lastSeen = this.clock.now();
        if (msg.t === 'hello')
            return this.handleHello(s, msg);
        if (msg.t === 'ping')
            return this.transport.send(sessionId, { t: 'pong', ts: msg.ts });
        if (!s.authenticated)
            return this.err(sessionId, 'NOT_AUTHENTICATED', '先に hello を送ってください');
        switch (msg.t) {
            case 'lobby.list':
                return this.transport.send(sessionId, {
                    t: 'lobby.tables',
                    tables: this.listRooms().map((r) => r.lobbyInfo()),
                });
            case 'table.watch': {
                const room = this.getRoom(msg.tableId);
                if (!room)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのテーブルはありません');
                s.tables.add(msg.tableId);
                room.join(sessionId, s.userId, s.name);
                return;
            }
            case 'table.leave': {
                const room = this.getRoom(msg.tableId);
                if (!room)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのテーブルはありません');
                s.tables.delete(msg.tableId);
                room.leave(sessionId);
                return;
            }
            case 'table.sit':
                return this.withRoom(sessionId, msg.tableId, (room) => room.sit(sessionId, msg.seat, msg.buyIn));
            case 'table.stand':
                return this.withRoom(sessionId, msg.tableId, (room) => {
                    const r = room.stand(sessionId);
                    // 精算をロビーの残高表示へ即反映
                    this.sendBalance(s.userId);
                    return r;
                });
            case 'table.straddle':
                return this.withRoom(sessionId, msg.tableId, (room) => room.setStraddle(sessionId, msg.enabled));
            case 'table.sitOut':
                return this.withRoom(sessionId, msg.tableId, (room) => room.setSitOut(sessionId, msg.sitOut));
            case 'table.rebuy':
                return this.withRoom(sessionId, msg.tableId, (room) => room.rebuy(sessionId, msg.amount));
            case 'hand.act':
                return this.withRoom(sessionId, msg.tableId, (room) => room.act(sessionId, msg.handId, msg.action, msg.toAmount));
            case 'fair.seed':
                return this.withRoom(sessionId, msg.tableId, (room) => room.submitSeed(sessionId, msg.seed));
            // --- トーナメント ---
            case 'tour.list':
                return this.transport.send(sessionId, {
                    t: 'tour.tournaments',
                    tournaments: this.listTournaments().map((t) => t.summary()),
                });
            case 'tour.watch': {
                const t = this.tournaments.get(msg.tournamentId);
                if (!t)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのトーナメントはありません');
                this.transport.send(sessionId, { t: 'tournament.state', view: t.view(s.userId) });
                // 自分の卓に自動入室させる（卓移動があっても迷子にならないように）
                const tableId = t.tableOf(s.userId);
                if (tableId) {
                    const room = t.getTable(tableId);
                    if (room) {
                        s.tables.add(tableId);
                        room.join(sessionId, s.userId, s.name);
                    }
                }
                return;
            }
            case 'tour.register': {
                const t = this.tournaments.get(msg.tournamentId);
                if (!t)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのトーナメントはありません');
                const code = t.register(s.userId, s.name);
                if (code)
                    return this.err(sessionId, code, ERROR_MESSAGES[code]);
                this.sendBalance(s.userId);
                this.transport.send(sessionId, { t: 'tournament.state', view: t.view(s.userId) });
                return;
            }
            case 'tour.addon': {
                const t = this.tournaments.get(msg.tournamentId);
                if (!t)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのトーナメントはありません');
                const code = t.addOn(s.userId);
                if (code)
                    return this.err(sessionId, code, ERROR_MESSAGES[code]);
                this.sendBalance(s.userId);
                this.transport.send(sessionId, { t: 'tournament.state', view: t.view(s.userId) });
                return;
            }
            case 'tour.unregister': {
                const t = this.tournaments.get(msg.tournamentId);
                if (!t)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのトーナメントはありません');
                const code = t.unregister(s.userId);
                if (code)
                    return this.err(sessionId, code, ERROR_MESSAGES[code]);
                this.sendBalance(s.userId);
                return;
            }
            // --- 経済 ---
            case 'table.create': {
                const bb = msg.bigBlind;
                const id = 'pvt-' + Math.random().toString(36).slice(2, 8);
                const code = randomTableCode();
                const cfg = {
                    tableId: id,
                    name: (msg.name && msg.name.trim()) || `プライベート卓 ${code}`,
                    smallBlind: Math.max(1, Math.floor(bb / 2)),
                    bigBlind: bb,
                    maxSeats: msg.maxSeats,
                    rakePercent: 0,
                    timeBankMs: bb >= 1_000_000_000 ? 300_000 : bb >= 10_000_000 ? 240_000 : 180_000,
                };
                const room = new Room(cfg, this.io, this.bank, this.clock);
                room.hooks.onHandResult = (r, summary, seats) => this.onHandResult(r, summary, seats);
                this.rooms.set(id, room);
                this.privateIds.add(id);
                this.tableCodes.set(code, id);
                // 5分の猶予ののち、無人になったら片付ける
                const createdAt = Date.now();
                const timer = setInterval(() => {
                    const rm = this.rooms.get(id);
                    if (!rm) {
                        clearInterval(timer);
                        return;
                    }
                    if (Date.now() - createdAt < 300000)
                        return;
                    const info = rm.lobbyInfo();
                    if (info.seatedCount === 0 && info.watchingCount === 0) {
                        rm.dispose();
                        this.rooms.delete(id);
                        this.privateIds.delete(id);
                        this.tableCodes.delete(code);
                        clearInterval(timer);
                    }
                }, 120000);
                this.transport.send(sessionId, { t: 'table.created', code, table: room.lobbyInfo() });
                return;
            }
            case 'code.redeem': {
                const code = msg.code.toUpperCase().replace(/[\s-]/g, '');
                const chips = INVITE_CODES[code];
                if (chips) {
                    // 使用済みチェックは購入レシート台帳で永続化(サーバー再起動しても2重取得できない)
                    const receiptKey = `code:${code}:${s.userId}`;
                    if (this.store.hasReceipt(receiptKey)) {
                        return this.err(sessionId, 'ILLEGAL_ACTION', 'このコードは使用済みです');
                    }
                    let used = this.redeemedCodes.get(s.userId);
                    if (!used) {
                        used = new Set();
                        this.redeemedCodes.set(s.userId, used);
                    }
                    if (used.has(code))
                        return this.err(sessionId, 'ILLEGAL_ACTION', 'このコードは使用済みです');
                    used.add(code);
                    this.store.savePurchase({
                        userId: s.userId,
                        sku: 'invite_code',
                        priceJpy: 0,
                        granted: JSON.stringify({ chips, code }),
                        receipt: receiptKey,
                    });
                    this.store.post(s.userId, 'chips', chips, 'adjustment', `code:${code}`);
                    this.sendBalance(s.userId);
                    this.transport.send(sessionId, {
                        t: 'reward',
                        title: '招待コードを適用しました！',
                        chips,
                        gold: 0,
                    });
                    return;
                }
                const tid = this.tableCodes.get(code);
                if (tid) {
                    const room = this.rooms.get(tid);
                    if (!room)
                        return this.err(sessionId, 'NO_SUCH_TABLE', 'その卓はすでに終了しています');
                    return this.transport.send(sessionId, { t: 'code.table', table: room.lobbyInfo() });
                }
                return this.err(sessionId, 'ILLEGAL_ACTION', 'コードが正しくありません');
            }
            case 'ledger.get': {
                // チップ増減の履歴(台帳)。全増減が永続記録されており、これはその閲覧API
                const entries = this.store.history(s.userId, 80).map((r) => ({
                    at: r.at,
                    currency: r.currency,
                    delta: r.delta,
                    reason: r.reason,
                    ref: r.ref,
                    balanceAfter: r.balanceAfter,
                }));
                return this.transport.send(sessionId, { t: 'ledger.history', entries });
            }
            case 'shop.list':
                return this.transport.send(sessionId, { t: 'shop.state', shop: this.shopView(s.userId) });
            case 'shop.purchase': {
                const r = this.economy.purchase(s.userId, msg.sku, msg.receipt);
                if (!r.ok)
                    return this.err(sessionId, 'ILLEGAL_ACTION', r.error ?? '購入できませんでした');
                this.sendBalance(s.userId);
                this.transport.send(sessionId, {
                    t: 'reward',
                    title: r.granted.tierUp ? `${r.granted.tierUp.name} に昇格！` : '購入が完了しました',
                    chips: r.granted.chips,
                    gold: r.granted.gold,
                    detail: `VIP +${r.granted.vipPoints}`,
                });
                this.transport.send(sessionId, { t: 'shop.state', shop: this.shopView(s.userId) });
                this.sendProfile(sessionId, s.userId);
                return;
            }
            case 'daily.claim': {
                const r = this.economy.claimDailyBonus(s.userId);
                if (!r.ok)
                    return this.err(sessionId, 'ILLEGAL_ACTION', r.error ?? '受け取れませんでした');
                this.sendBalance(s.userId);
                this.transport.send(sessionId, {
                    t: 'reward',
                    title: `デイリーボーナス（${r.streak} 日連続）`,
                    chips: r.amount,
                    gold: 0,
                });
                this.sendProfile(sessionId, s.userId);
                return;
            }
            case 'mission.claim': {
                const r = this.economy.claimMission(s.userId, msg.missionId);
                if (!r.ok)
                    return this.err(sessionId, 'ILLEGAL_ACTION', r.error ?? '受け取れませんでした');
                this.sendBalance(s.userId);
                this.transport.send(sessionId, {
                    t: 'reward',
                    title: 'ミッション達成',
                    chips: r.chips,
                    gold: 0,
                    detail: `パス経験値 +${r.xp}`,
                });
                this.sendProfile(sessionId, s.userId);
                return;
            }
            case 'pass.claim': {
                const r = this.economy.claimPassRewards(s.userId);
                if (r.tiers.length === 0)
                    return this.err(sessionId, 'ILLEGAL_ACTION', '受け取れる報酬がありません');
                this.sendBalance(s.userId);
                this.transport.send(sessionId, {
                    t: 'reward',
                    title: `パス報酬（${r.tiers.length} ティア分）`,
                    chips: r.chips,
                    gold: r.gold,
                });
                this.sendProfile(sessionId, s.userId);
                return;
            }
            case 'profile.get':
                return this.sendProfile(sessionId, s.userId);
            case 'user.style': {
                // ニックネーム変更・ブレスレット装着（コスメ）。名前は1〜16文字に制限
                const name = typeof msg.name === 'string' && msg.name.trim().length > 0
                    ? msg.name.trim().slice(0, 16)
                    : undefined;
                const bracelet = msg.bracelet === null || (typeof msg.bracelet === 'string' && /^b[1-6]$/.test(msg.bracelet))
                    ? msg.bracelet
                    : undefined;
                if (name) {
                    s.name = name;
                    this.store.upsertUser(s.userId, name);
                    if (s.resumeToken)
                        this.resumeTokens.set(s.resumeToken, { userId: s.userId, name });
                }
                for (const room of this.rooms.values())
                    room.setStyle(s.userId, name, bracelet);
                for (const t of this.tournaments.values())
                    t.setStyle(s.userId, name, bracelet);
                this.sendProfile(sessionId, s.userId);
                return;
            }
        }
    }
    // -------------------------------------------------------------------------
    shopView(userId) {
        const offers = this.economy.offersFor(userId);
        const premiumOwned = this.economy.passStatus(userId).premium;
        return {
            chipPacks: CHIP_PACKS.map((p) => ({
                sku: p.sku,
                name: p.name,
                priceJpy: p.priceJpy,
                chips: p.chips,
                perYen: Math.round(p.chips / p.priceJpy),
            })),
            goldPacks: GOLD_PACKS.map((p) => ({ sku: p.sku, name: p.name, priceJpy: p.priceJpy, gold: p.gold })),
            offers: offers.map((o) => ({
                id: o.id,
                sku: o.sku.sku,
                name: o.name,
                description: o.description,
                priceJpy: o.sku.priceJpy,
                reason: o.reason,
                multiplier: o.sku.valueMultiplier ?? null,
                expiresAt: o.expiresAt,
            })),
            passPremium: {
                sku: PASS_PREMIUM_SKU.sku,
                name: PASS_PREMIUM_SKU.name,
                priceJpy: PASS_PREMIUM_SKU.priceJpy,
                owned: premiumOwned,
            },
        };
    }
    profileView(userId) {
        const u = this.store.getUser(userId);
        const pass = this.economy.passStatus(userId);
        const claimable = pass.tiers.some((t) => t.unlocked && (!t.claimedFree || (pass.premium && !t.claimedPremium)));
        return {
            userId,
            name: u?.name ?? userId,
            chips: this.store.balance(userId, 'chips'),
            gold: this.store.balance(userId, 'gold'),
            vip: this.economy.vipStatus(userId),
            daily: { available: this.economy.dailyBonusAvailable(userId), streak: u?.loginStreak ?? 0 },
            missions: this.economy.missionStatus(userId),
            pass: {
                seasonId: pass.seasonId,
                xp: pass.xp,
                tier: pass.tier,
                premium: pass.premium,
                nextTierXp: pass.nextTierXp,
                claimable,
            },
            piggyBank: u?.piggyBank ?? 0,
        };
    }
    sendProfile(sessionId, userId) {
        this.transport.send(sessionId, { t: 'profile', profile: this.profileView(userId) });
    }
    sendBalance(userId) {
        this.sendToUser(userId, {
            t: 'balance',
            balance: this.store.balance(userId, 'chips'),
            gold: this.store.balance(userId, 'gold'),
        });
    }
    sendToUser(userId, msg) {
        for (const s of this.sessions.values())
            if (s.userId === userId)
                this.transport.send(s.sessionId, msg);
    }
    withRoom(sessionId, tableId, fn) {
        const room = this.getRoom(tableId);
        if (!room)
            return this.err(sessionId, 'NO_SUCH_TABLE', 'そのテーブルはありません');
        let code;
        try {
            code = fn(room);
        }
        catch (e) {
            console.error(`[room:${tableId}] 内部エラー`, e);
            return this.err(sessionId, 'INTERNAL', '内部エラーが発生しました');
        }
        if (code)
            this.err(sessionId, code, ERROR_MESSAGES[code]);
    }
    handleHello(s, msg) {
        if (msg.v !== PROTOCOL_VERSION) {
            this.err(s.sessionId, 'VERSION_MISMATCH', `プロトコル版が違います（サーバー: ${PROTOCOL_VERSION}）`);
            this.transport.close?.(s.sessionId, 'version mismatch');
            return;
        }
        let resumed = false;
        let userId;
        let name;
        const prior = msg.resumeToken ? this.resumeTokens.get(msg.resumeToken) : undefined;
        // メモリ上のマップに無くても、署名付きトークンならサーバー再起動をまたいで復帰できる
        const signedId = !prior && msg.resumeToken ? this.verifyResumeToken(msg.resumeToken) : null;
        if (prior) {
            userId = prior.userId;
            name = msg.name ?? prior.name;
            resumed = true;
        }
        else if (signedId) {
            userId = signedId;
            const u = this.store.getUser(signedId);
            name = msg.name ?? u?.name ?? `Player-${signedId.slice(-4)}`;
            resumed = u !== null;
        }
        else {
            userId = msg.userId && /^[\w.-]{1,64}$/.test(msg.userId) ? msg.userId : `u_${randomSeedHex(6)}`;
            name = msg.name ?? `Player-${userId.slice(-4)}`;
        }
        const isNew = this.store.getUser(userId) === null;
        this.store.upsertUser(userId, name);
        if (isNew) {
            this.store.post(userId, 'chips', this.cfg.signupBonus, 'signup_bonus');
            this.store.post(userId, 'gold', this.cfg.signupGold, 'signup_bonus');
        }
        const token = this.makeResumeToken(userId);
        this.resumeTokens.set(token, { userId, name });
        s.userId = userId;
        s.name = name;
        s.resumeToken = token;
        s.authenticated = true;
        this.transport.send(s.sessionId, {
            t: 'hello.ok',
            v: PROTOCOL_VERSION,
            userId,
            name,
            resumeToken: token,
            balance: this.store.balance(userId, 'chips'),
            gold: this.store.balance(userId, 'gold'),
            resumed,
        });
        this.sendProfile(s.sessionId, userId);
    }
    rateLimitOk(s) {
        const now = this.clock.now();
        if (now - s.windowStart >= 1000) {
            s.windowStart = now;
            s.windowCount = 0;
        }
        s.windowCount++;
        return s.windowCount <= this.cfg.maxMessagesPerSecond;
    }
    err(sessionId, code, message) {
        this.transport.send(sessionId, { t: 'error', code, message });
    }
    /**
     * 監視用：全ユーザーの残高 + キャッシュ卓のチップ = 発行総量 になっているはず。
     *
     * トーナメント卓のスタックは意図的に含めない。あれは順位を決めるための点数であって通貨ではなく、
     * 通貨としての出入りは「参加費の徴収」と「賞金の支払い」だけで完結している。
     * ここを混ぜると、大会が始まるたびにチップが増えたように見えてしまう。
     */
    totalChips() {
        let sum = this.store.totalBalance('chips');
        for (const r of this.rooms.values())
            sum += r.chipsOnTable();
        return sum;
    }
    dispose() {
        for (const r of this.rooms.values())
            r.dispose();
        for (const t of this.tournaments.values())
            t.dispose();
    }
    get sessionCount() {
        return this.sessions.size;
    }
}
const ERROR_MESSAGES = {
    BAD_MESSAGE: 'メッセージの形式が不正です',
    VERSION_MISMATCH: 'プロトコルの版が違います',
    NOT_AUTHENTICATED: '認証されていません',
    RATE_LIMITED: '送信が速すぎます',
    NO_SUCH_TABLE: 'そのテーブルはありません',
    SEAT_TAKEN: 'その席は空いていません',
    ALREADY_SEATED: 'すでに参加しています',
    NOT_SEATED: '参加していません',
    INVALID_BUYIN: 'バイイン額が範囲外です',
    INSUFFICIENT_FUNDS: '残高が足りません',
    NOT_YOUR_TURN: 'あなたの手番ではありません',
    ILLEGAL_ACTION: 'その操作はできません',
    STALE_HAND: '古いハンドへの操作です',
    SEED_WINDOW_CLOSED: 'シードの受付時間は終了しています',
    INTERNAL: '内部エラーが発生しました',
};
//# sourceMappingURL=lobby.js.map