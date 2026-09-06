/**
 * テーブルルーム：1 卓分の状態と、ハンドを回し続けるループ
 *
 * ここが「エンジン（1 ハンドの純粋なルール）」と「サーバー（時間・接続・お金）」の境界。
 * Hand クラスは時間を知らないしプレイヤーの接続状態も知らない。
 * その外側の面倒ごと——手番のタイムアウト、切断、バイイン、次のハンドの開始——を全部ここで見る。
 *
 * Provably Fair の順序保証：
 *   waiting → seed_window（コミットメント公開・シード受付）→ hand（配牌）→ settling（シード開示）
 *   この順序は状態機械で強制する。「うっかり配牌後にシードを受け付ける」ことが起きないよう、
 *   受付は phase === 'seed_window' のときだけ通す。
 */
import { Hand } from '../table.js';
import { FairnessSession } from '../fair.js';
import { cardToString, cardToDisplay } from '../cards.js';
import { describeHand, evaluateBest } from '../evaluator.js';
// オールイン公開中の勝率・アウツ計算。solo/showdown は src/ の評価器だけに依存する純粋ロジックで、
// ブラウザ専用のものは含まないためサーバーからも安全に使える。
import { showdownEquity, outsFor, currentLeaders } from '../../solo/showdown.js';
import { heroEquityVsUnknown } from '../../solo/equity.js';
export const realScheduler = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
        const h = setTimeout(fn, ms);
        // unref しておかないと、卓の手番タイマー(60秒)が再アームされ続ける限り
        // イベントループが終われず、Room を dispose しないコード(テスト等)がハングする。
        // 本番プロセスは HTTP/WebSocket サーバーのハンドルで生き続けるので影響しない
        h.unref?.();
        return h;
    },
    clearTimeout: (h) => clearTimeout(h),
};
/**
 * 1アクションの持ち時間(ミリ秒)。全ストリート・全卓で共通。
 * ここを変えるだけで全卓のアクション制限が変わる(卓ごとの上書きはしない方針)。
 */
export const ACTION_MS = 60_000;
// ---------------------------------------------------------------------------
export class Room {
    io;
    bank;
    clock;
    cfg;
    seats;
    members = new Map();
    /** userId → 装着ブレスレット。着席前に届いても sit 時に反映できるよう卓側で保持 */
    cosmetics = new Map();
    phase = 'waiting';
    hand = null;
    handId = null;
    handNumber = 0;
    buttonIndex = 0;
    fairness = null;
    /** 今のハンドで席 → クライアントシード提出済みか */
    seedSubmitted = new Set();
    lastReveal = null;
    actionDeadline = null;
    /** 現在の手番の基本持ち時間 */
    actionBaseMs = ACTION_MS;
    /** 現在の手番に実際に与えられた総時間(クライアントの残り時間バーの分母) */
    actionTotalMs = ACTION_MS;
    actionStartedAt = null;
    timers = [];
    eventCursor = 0;
    potHistory = [];
    handTimestamps = [];
    /** 直近のハンドで飛んだ席と、その撃墜者 */
    lastBusts = new Map();
    /** 現在のブラインド。トーナメントではレベルごとに書き換わる */
    blinds;
    hooks = {};
    constructor(cfg, io, bank, clock = realScheduler) {
        this.io = io;
        this.bank = bank;
        this.clock = clock;
        this.cfg = {
            mode: 'cash',
            blindsProvider: undefined,
            minBuyInBB: 20,
            maxBuyInBB: 100,
            secretUnlockAt: 0,
            rakePercent: 0.04,
            rakeCapBB: 4,
            actionTimeoutMs: ACTION_MS,
            timeBankMs: 0,
            seedWindowMs: 1200,
            handIntervalMs: 2500,
            disconnectGraceMs: 30000,
            straddleAllowed: false,
            maxStraddles: 1,
            ...cfg,
        };
        if (this.cfg.maxSeats < 2 || this.cfg.maxSeats > 9)
            throw new Error('maxSeats は 2〜9 です');
        this.seats = new Array(this.cfg.maxSeats).fill(null);
        this.blinds = { smallBlind: this.cfg.smallBlind, bigBlind: this.cfg.bigBlind, ante: 0 };
    }
    get isTournament() {
        return this.cfg.mode === 'tournament';
    }
    /** 現在のブラインド（トーナメントではレベルに応じて変わる） */
    get currentBlinds() {
        return { ...this.blinds };
    }
    /** 秘密卓の解禁額(0なら公開卓) */
    get secretUnlockAt() {
        return this.cfg.secretUnlockAt ?? 0;
    }
    get tableId() {
        return this.cfg.tableId;
    }
    get minBuyIn() {
        return this.cfg.minBuyInBB * this.cfg.bigBlind;
    }
    get maxBuyIn() {
        return this.cfg.maxBuyInBB * this.cfg.bigBlind;
    }
    // -------------------------------------------------------------------------
    // 入退室
    // -------------------------------------------------------------------------
    /** ニックネーム・装着ブレスレットの更新（コスメ。着席中なら即反映して配信） */
    setStyle(userId, name, bracelet) {
        if (bracelet !== undefined)
            this.cosmetics.set(userId, bracelet);
        if (name)
            for (const m of this.members.values())
                if (m.userId === userId)
                    m.name = name;
        const seat = this.seatOfUser(userId);
        if (!seat)
            return;
        let changed = false;
        if (name && seat.name !== name) {
            seat.name = name;
            changed = true;
        }
        if (bracelet !== undefined && seat.bracelet !== bracelet) {
            seat.bracelet = bracelet;
            changed = true;
        }
        if (changed)
            this.broadcastState();
    }
    join(sessionId, userId, name) {
        this.members.set(sessionId, { sessionId, userId, name });
        // 同じユーザーが座っていた席があれば、再接続として扱う
        const seat = this.seatOfUser(userId);
        if (seat)
            seat.disconnectedAt = null;
        this.sendStateTo(sessionId);
    }
    leave(sessionId) {
        const m = this.members.get(sessionId);
        if (!m)
            return;
        this.members.delete(sessionId);
        // 同じユーザーの別セッションがまだ繋がっているなら、席は生きたまま
        const stillHere = [...this.members.values()].some((x) => x.userId === m.userId);
        if (stillHere)
            return;
        const seat = this.seatOfUser(m.userId);
        if (!seat)
            return;
        // 進行中のハンドに参加していない席はその場で撤収させる。
        // 参加中なら席は残す（チップがポットに入っているため）。切断猶予を過ぎたら Sit Out にする。
        seat.disconnectedAt = this.clock.now();
        // トーナメントでは切断しても席とチップは残す（現実の大会と同じで、ブラインドを払い続ける）
        if (!this.isTournament && !this.isInCurrentHand(seat.seat)) {
            this.cashOut(seat);
        }
        else {
            this.broadcastState();
        }
    }
    /** 接続は生きているがユーザーが明示的に卓を降りる */
    stand(sessionId) {
        // トーナメント中に降りることはできない（降りたければフォールドし続けるしかない）
        if (this.isTournament)
            return 'ILLEGAL_ACTION';
        const m = this.members.get(sessionId);
        if (!m)
            return 'NOT_AUTHENTICATED';
        const seat = this.seatOfUser(m.userId);
        if (!seat)
            return 'NOT_SEATED';
        if (this.isInCurrentHand(seat.seat)) {
            // ハンドの途中で持ち逃げはできない。次のハンドが終わってから降りる
            seat.standPending = true;
            seat.sittingOut = true;
            this.broadcastState();
            return null;
        }
        this.cashOut(seat);
        return null;
    }
    cashOut(seat) {
        if (seat.stack > 0) {
            this.bank.deposit(seat.userId, seat.stack, `${this.cfg.tableId}:cashout`);
            this.sendBalanceTo(seat.userId);
        }
        this.bank.clearSeat?.(seat.userId, this.cfg.tableId); // 精算済み → 復旧対象から外す
        this.seats[seat.seat] = null;
        this.broadcastState();
        this.maybeStartHand();
    }
    /**
     * 着席中スタックを永続化する。ハンドごと・着席ごとに呼ぶ。
     * ここに書いておけば、サーバーが落ちても次の起動で残高へ払い戻せる。
     * トーナメントのスタックは現金ではない(賞金は別途配分される)ので対象外。
     */
    noteSeats() {
        if (!this.bank.noteSeat || this.isTournament)
            return;
        for (const s of this.seats)
            if (s)
                this.bank.noteSeat(s.userId, this.cfg.tableId, s.stack);
    }
    /** 精算(bank.deposit)と着席記録の抹消をまとめて行う */
    payOutSeat(s) {
        if (s.stack > 0)
            this.bank.deposit(s.userId, s.stack, `${this.cfg.tableId}:cashout`);
        this.bank.clearSeat?.(s.userId, this.cfg.tableId);
        this.sendBalanceTo(s.userId);
        this.seats[s.seat] = null;
    }
    /** 全員をその場で精算して席を空ける(サーバー終了時の駆け込み精算) */
    cashOutAll() {
        if (this.isTournament)
            return;
        for (const s of this.seats)
            if (s)
                this.payOutSeat(s);
    }
    /**
     * 切断猶予を過ぎた席を精算する。ハンド終了時(settle)だけに任せると、
     * 以後ハンドが始まらない卓(全員退出など)でチップが永久に戻らないため、
     * 定期チェックからも呼んでいる。
     */
    sweepExpiredSeats() {
        if (this.isTournament)
            return;
        let swept = false;
        for (const s of this.seats) {
            if (!s || this.isInCurrentHand(s.seat))
                continue;
            if (!this.isDisconnectExpired(s) && !s.standPending)
                continue;
            this.payOutSeat(s);
            swept = true;
        }
        if (swept)
            this.broadcastState();
    }
    // -------------------------------------------------------------------------
    // 着席・バイイン
    // -------------------------------------------------------------------------
    sit(sessionId, seatIndex, buyIn) {
        // トーナメントの席はエントリー時に主催側が決める。自由な着席はできない
        if (this.isTournament)
            return 'ILLEGAL_ACTION';
        const m = this.members.get(sessionId);
        if (!m)
            return 'NOT_AUTHENTICATED';
        if (this.seatOfUser(m.userId))
            return 'ALREADY_SEATED';
        if (buyIn < this.minBuyIn || buyIn > this.maxBuyIn)
            return 'INVALID_BUYIN';
        let index = seatIndex;
        if (index === undefined) {
            index = this.seats.findIndex((s) => s === null);
            if (index < 0)
                return 'SEAT_TAKEN';
        }
        if (index < 0 || index >= this.cfg.maxSeats)
            return 'SEAT_TAKEN';
        if (this.seats[index] !== null)
            return 'SEAT_TAKEN';
        if (!this.bank.withdraw(m.userId, buyIn, `${this.cfg.tableId}:buyin`))
            return 'INSUFFICIENT_FUNDS';
        this.seats[index] = {
            seat: index,
            userId: m.userId,
            name: m.name,
            stack: buyIn,
            // 進行中のハンドには参加させない。次のハンドから
            sittingOut: false,
            disconnectedAt: null,
            timeBankMs: this.cfg.timeBankMs,
            standPending: false,
            straddleArmed: false,
            bracelet: this.cosmetics.get(m.userId) ?? null,
        };
        // 残高から引いた分を「卓の上にある」と記録する。この直後に落ちても払い戻せる
        this.bank.noteSeat?.(m.userId, this.cfg.tableId, buyIn);
        this.sendBalanceTo(m.userId);
        this.broadcastState();
        this.maybeStartHand();
        return null;
    }
    rebuy(sessionId, amount) {
        if (this.isTournament)
            return 'ILLEGAL_ACTION';
        const m = this.members.get(sessionId);
        if (!m)
            return 'NOT_AUTHENTICATED';
        const seat = this.seatOfUser(m.userId);
        if (!seat)
            return 'NOT_SEATED';
        if (this.isInCurrentHand(seat.seat))
            return 'ILLEGAL_ACTION'; // ハンド中の増資は不可
        if (amount <= 0 || seat.stack + amount > this.maxBuyIn)
            return 'INVALID_BUYIN';
        if (!this.bank.withdraw(m.userId, amount, `${this.cfg.tableId}:rebuy`))
            return 'INSUFFICIENT_FUNDS';
        seat.stack += amount;
        this.bank.noteSeat?.(m.userId, this.cfg.tableId, seat.stack);
        this.sendBalanceTo(m.userId);
        this.broadcastState();
        this.maybeStartHand();
        return null;
    }
    setSitOut(sessionId, sitOut) {
        const m = this.members.get(sessionId);
        if (!m)
            return 'NOT_AUTHENTICATED';
        const seat = this.seatOfUser(m.userId);
        if (!seat)
            return 'NOT_SEATED';
        seat.sittingOut = sitOut;
        if (!sitOut)
            seat.standPending = false;
        this.broadcastState();
        if (!sitOut)
            this.maybeStartHand();
        return null;
    }
    // -------------------------------------------------------------------------
    // トーナメント用：主催側からの直接操作
    // -------------------------------------------------------------------------
    /** 財布を経由せずに席へ座らせる。チップはトーナメントが配る */
    seatDirect(userId, name, stack, seatIndex) {
        let index = seatIndex;
        if (index === undefined)
            index = this.seats.findIndex((s) => s === null);
        if (index < 0 || index >= this.cfg.maxSeats || this.seats[index] !== null)
            return null;
        this.seats[index] = {
            seat: index,
            userId,
            name,
            stack,
            sittingOut: false,
            disconnectedAt: null,
            timeBankMs: this.cfg.timeBankMs,
            standPending: false,
            straddleArmed: false,
            bracelet: this.cosmetics.get(userId) ?? null,
        };
        this.broadcastState();
        return index;
    }
    /** 席から外してスタックを返す（卓のバランス調整・脱落処理に使う） */
    removeDirect(userId) {
        const seat = this.seatOfUser(userId);
        if (!seat)
            return null;
        const stack = seat.stack;
        this.seats[seat.seat] = null;
        this.broadcastState();
        return stack;
    }
    /** 現在この卓にいるプレイヤー（スタック付き） */
    playersInSeats() {
        return this.seats
            .filter((s) => s !== null)
            .map((s) => ({ userId: s.userId, name: s.name, seat: s.seat, stack: s.stack }));
    }
    /** 席にチップを足す（トーナメントのアドオン用）。適用は次のハンドから */
    addChips(userId, amount) {
        const seat = this.seatOfUser(userId);
        if (!seat || amount <= 0)
            return false;
        seat.stack += amount;
        this.broadcastState();
        return true;
    }
    /** ブラインドを更新する（レベルアップ時に呼ぶ）。適用は次のハンドから */
    setBlinds(b) {
        this.blinds = { ...b };
        this.broadcastState();
    }
    /** 進行を一時停止する（卓の再編成中など） */
    paused = false;
    /**
     * ストラドルの予約。UTG に回ってきたハンドで自動的に置かれる。
     *
     * 実装しているのは「BB の左隣から連続して置く」形だけ。
     * ボタンストラドル／ミシシッピストラドルはアクション順の扱いがカジノごとに違い、
     * 統一された標準が無いため対象外にしている。
     */
    setStraddle(sessionId, enabled) {
        if (!this.straddleEnabled)
            return 'ILLEGAL_ACTION';
        const m = this.members.get(sessionId);
        if (!m)
            return 'NOT_AUTHENTICATED';
        const seat = this.seatOfUser(m.userId);
        if (!seat)
            return 'NOT_SEATED';
        seat.straddleArmed = enabled;
        this.broadcastState();
        return null;
    }
    get straddleEnabled() {
        return this.cfg.straddleAllowed && !this.isTournament;
    }
    // -------------------------------------------------------------------------
    // Provably Fair：シード提出
    // -------------------------------------------------------------------------
    submitSeed(sessionId, seed) {
        const m = this.members.get(sessionId);
        if (!m)
            return 'NOT_AUTHENTICATED';
        // 受付窓の外は絶対に通さない。配牌後に受け付けたら仕組みが崩壊する
        if (this.phase !== 'seed_window' || !this.fairness)
            return 'SEED_WINDOW_CLOSED';
        const seat = this.seatOfUser(m.userId);
        if (!seat)
            return 'NOT_SEATED';
        if (!this.fairness.submitClientSeed(seat.seat, seed))
            return 'SEED_WINDOW_CLOSED';
        this.seedSubmitted.add(seat.seat);
        this.broadcastState();
        return null;
    }
    // -------------------------------------------------------------------------
    // ハンドのループ
    // -------------------------------------------------------------------------
    eligibleSeats() {
        // トーナメントでは切断しても参加は続く（ブラインドを払い続け、時間切れで自動フォールドになる）
        if (this.isTournament) {
            return this.seats.filter((s) => s !== null && s.stack > 0);
        }
        return this.seats.filter((s) => s !== null && !s.sittingOut && s.stack > 0 && !this.isDisconnectExpired(s));
    }
    isDisconnectExpired(s) {
        return s.disconnectedAt !== null && this.clock.now() - s.disconnectedAt > this.cfg.disconnectGraceMs;
    }
    /** 条件が揃っていれば次のハンドを開始する */
    maybeStartHand() {
        if (this.phase !== 'waiting' || this.paused)
            return;
        // トーナメントではブラインドを毎ハンド問い合わせる
        if (this.cfg.blindsProvider)
            this.blinds = this.cfg.blindsProvider();
        // 猶予を過ぎた切断者は Sit Out にする（トーナメントでは席を維持したまま自動フォールド）
        if (!this.isTournament) {
            for (const s of this.seats) {
                if (s && this.isDisconnectExpired(s) && !s.sittingOut)
                    s.sittingOut = true;
            }
        }
        if (this.eligibleSeats().length < 2) {
            this.broadcastState();
            return;
        }
        this.beginSeedWindow();
    }
    /**
     * コミットメントを公開し、クライアントシードの受付を開始する。
     * ここではまだカードを配らない。この順序が Provably Fair の核心。
     */
    beginSeedWindow() {
        this.phase = 'seed_window';
        this.handNumber++;
        if (!this.isTournament && this.handNumber % 20 === 0) {
            for (const s of this.seats)
                if (s)
                    s.timeBankMs = this.cfg.timeBankMs;
        }
        this.handId = `${this.cfg.tableId}#${this.handNumber}`;
        this.fairness = new FairnessSession({ seatCount: this.cfg.maxSeats, nonce: this.handNumber });
        this.seedSubmitted.clear();
        this.lastReveal = null;
        this.broadcastState();
        this.schedule(() => this.startHand(), this.cfg.seedWindowMs);
    }
    startHand() {
        if (this.phase !== 'seed_window' || !this.fairness)
            return;
        const players = this.eligibleSeats();
        if (players.length < 2) {
            // 受付中に人が減った。コミットメントは破棄して待機に戻る
            this.phase = 'waiting';
            this.fairness = null;
            this.handId = null;
            this.broadcastState();
            return;
        }
        // シードを締め切る。ここから先は誰も配牌に影響を与えられない
        this.fairness.lock();
        // ボタンを次の参加者へ進める
        this.buttonIndex = this.nextButton(players.map((p) => p.seat));
        const seatConfigs = players.map((p) => ({
            id: p.userId,
            name: p.name,
            stack: p.stack,
        }));
        // エンジンは 0..n-1 の連番席で動くので、卓の席番号との対応表を持つ
        const engineToTable = players.map((p) => p.seat);
        const buttonInEngine = Math.max(0, engineToTable.indexOf(this.buttonIndex));
        // ストラドル：BB の左隣から順に、予約している席だけ置く。
        // 途中で予約していない席が出たらそこで打ち切る（連続していないと成立しないため）
        const straddles = [];
        if (this.straddleEnabled && players.length >= 3) {
            const bbEngine = (buttonInEngine + 2) % players.length;
            let amount = this.blinds.bigBlind * 2;
            for (let i = 1; i <= this.cfg.maxStraddles; i++) {
                const e = (bbEngine + i) % players.length;
                const seat = this.seats[engineToTable[e]];
                // ボタンや SB まで回り込んだら終わり。スタックが足りない席も置けない
                if (!seat || !seat.straddleArmed || e === buttonInEngine)
                    break;
                if (seat.stack <= amount)
                    break;
                straddles.push({ seat: e, amount });
                amount *= 2;
            }
        }
        this.hand = new Hand({
            seats: seatConfigs,
            buttonIndex: buttonInEngine,
            straddles,
            smallBlind: this.blinds.smallBlind,
            bigBlind: this.blinds.bigBlind,
            ante: this.blinds.ante,
            // トーナメントはレーキを取らない（参加費として先に徴収済み）
            rakePercent: this.isTournament ? 0 : this.cfg.rakePercent,
            rakeCap: this.cfg.rakeCapBB * this.blinds.bigBlind,
            fairness: this.fairness,
        });
        this.engineToTable = engineToTable;
        this.phase = 'hand';
        this.eventCursor = 0;
        this.resultRevealed = false; // 新しいハンド。結果はまだ伏せる
        this.handTimestamps.push(this.clock.now());
        this.pushEvents();
        this.armActionTimer();
        this.broadcastState();
        // 全員オールインなどで即決着していることがある
        if (this.hand.isComplete) {
            if (this.shouldStageRunout(0))
                this.startRunoutReveal(0);
            else
                this.finishHand();
        }
    }
    engineToTable = [];
    // オールイン後の段階公開で、いま全クライアントに見せてよい場札の枚数。null なら全枚数。
    boardRevealLimit = null;
    // 結果（ポットの受け渡し）を公開したか。false の間はスタックをペイアウト前の値で見せ、
    // 場札を開ききって finishHand で結果を出すまでチップの増減をバラさない（ネタバレ防止）。
    resultRevealed = false;
    // 段階公開中に見せる各席の勝率・アウツ。null なら表示しない。
    revealStats = null;
    // 勝率ゲージ用キャッシュ（ストリートごとに 1 回だけモンテカルロを回す）
    equityCacheKey = null;
    equityCacheVal = 0;
    nextButton(seatNumbers) {
        const sorted = [...seatNumbers].sort((a, b) => a - b);
        for (const s of sorted)
            if (s > this.buttonIndex)
                return s;
        return sorted[0];
    }
    tableSeatOf(engineSeat) {
        return this.engineToTable[engineSeat] ?? engineSeat;
    }
    engineSeatOf(tableSeat) {
        return this.engineToTable.indexOf(tableSeat);
    }
    isInCurrentHand(tableSeat) {
        if (this.phase !== 'hand' || !this.hand)
            return false;
        const e = this.engineSeatOf(tableSeat);
        return e >= 0 && !this.hand.players[e].folded;
    }
    // -------------------------------------------------------------------------
    // アクション
    // -------------------------------------------------------------------------
    act(sessionId, handId, action, toAmount) {
        const m = this.members.get(sessionId);
        if (!m)
            return 'NOT_AUTHENTICATED';
        if (this.phase !== 'hand' || !this.hand)
            return 'STALE_HAND';
        // 古いハンドへの遅れたクリックを弾く。これが無いと、次のハンドで意図しない
        // アクションが実行される（通信が遅い環境で頻発する）
        if (handId !== this.handId)
            return 'STALE_HAND';
        const seat = this.seatOfUser(m.userId);
        if (!seat)
            return 'NOT_SEATED';
        const engineSeat = this.engineSeatOf(seat.seat);
        if (engineSeat < 0 || this.hand.actingSeat !== engineSeat)
            return 'NOT_YOUR_TURN';
        const boardBefore = this.hand.board.length;
        try {
            this.hand.act(engineSeat, action, toAmount);
        }
        catch {
            return 'ILLEGAL_ACTION';
        }
        // Triton Tempo: 基本時間を超えて考えた秒数だけタイムバンクから引く
        if (this.actionStartedAt !== null) {
            const over = this.clock.now() - this.actionStartedAt - this.actionBaseMs;
            if (over > 0)
                seat.timeBankMs = Math.max(0, seat.timeBankMs - over);
        }
        this.afterAction(boardBefore);
        return null;
    }
    afterAction(boardBefore = this.hand.board.length) {
        this.pushEvents();
        if (this.hand.isComplete) {
            // オールインで残りの場札が一度に配られた決着なら、1段ずつ開く演出に回す
            if (this.shouldStageRunout(boardBefore))
                this.startRunoutReveal(boardBefore);
            else
                this.finishHand();
        }
        else {
            this.armActionTimer();
            this.broadcastState();
        }
    }
    /** オールインで残りの場札が一度に配られた（＝焦らし演出をする価値がある）決着か */
    shouldStageRunout(committedLen) {
        const h = this.hand;
        if (!h || !h.isComplete || !h.result?.showdown)
            return false;
        if (h.board.length - committedLen <= 0)
            return false; // 新たに配られた札が無い
        return h.players.filter((p) => !p.folded).length >= 2; // 2人以上が見せ合う
    }
    /**
     * オールイン後の場札を、全員同期で 1 段ずつ開く。
     * サーバーが board を小出しに送るだけで、各クライアントは新しい札を配布アニメで描く
     * （クライアント改造は不要）。テレビ中継のようにリバー前を一番長く取り、
     * 演出が終わってから finishHand（結果表示 → 次ハンド）へ進む。
     */
    startRunoutReveal(committedLen) {
        const h = this.hand;
        this.clearTimers();
        this.phase = 'settling'; // これ以上アクションは受け付けない（決着済み）
        // これから開くストリート境界（フロップ=3 / ターン=4 / リバー=5）
        const stops = [3, 4, 5].filter((n) => n > committedLen && n <= h.board.length);
        // 固定だと機械的なので clock 由来の軽い揺らぎを足す（決定的でテストにも安全）。
        // さらにポットのBB数が大きい「大勝負」ほど焦らしを長くする
        const potBB = h.totalPot / Math.max(1, this.blinds.bigBlind);
        const big = potBB >= 150 ? 1.6 : potBB >= 60 ? 1.3 : 1;
        const jitter = (base) => Math.round(base * big) + (this.clock.now() % 350);
        const preDelay = (n) => Math.round((n <= 3 ? 1400 : n === 4 ? 1900 : 2700) * big); // flop / turn / river
        // まず「手札公開・勝率・場札は committed まで」を送る（＝ハンド公開の間）
        this.boardRevealLimit = committedLen;
        this.revealStats = this.computeRevealStats();
        this.broadcastState();
        let i = 0;
        const step = () => {
            if (i >= stops.length) {
                // 最後の1枚のあと、少し置いてから結果へ
                this.schedule(() => {
                    this.boardRevealLimit = null;
                    this.revealStats = null;
                    this.finishHand();
                }, jitter(1600));
                return;
            }
            const n = stops[i++];
            this.schedule(() => {
                this.boardRevealLimit = n;
                this.revealStats = this.computeRevealStats();
                this.broadcastState();
                step();
            }, jitter(preDelay(n)));
        };
        this.schedule(step, jitter(1200)); // コール成立→手札公開のあと、最初のストリートへ
    }
    /** いま公開されている場札での、勝負がついていない席の勝率・アウツを計算する */
    computeRevealStats() {
        const h = this.hand;
        if (!h)
            return [];
        const board = this.boardRevealLimit !== null ? h.board.slice(0, this.boardRevealLimit) : h.board;
        const live = h.players.map((p, e) => ({ p, e })).filter((x) => !x.p.folded);
        const players = live.map((x) => ({ seat: x.e, hole: x.p.holeCards }));
        // フォールドした席の既知ホールカードはマック（デッド）。ランアウトに出得ないので山札から除く。
        // 除かないと残りの勝率・アウツがわずかに歪む（実装指示書 §15/§19 が明示的に禁止する挙動）。
        const dead = h.players
            .filter((p) => p.folded && p.holeCards.length === 2)
            .flatMap((p) => p.holeCards);
        // 残り札が少ないとき（フロップ以降）は数え上げで厳密。多いとき（プリフロップ全公開）だけ乱数を使う。
        const rng = { randomInt: (m) => Math.floor(Math.random() * m) };
        const eq = showdownEquity(players, board, rng, 20_000, dead).seats;
        const outs = outsFor(players, board, dead);
        const leaders = new Set(currentLeaders(players, board));
        return live.map((x) => {
            const e = eq.find((z) => z.seat === x.e);
            const o = outs.find((z) => z.seat === x.e);
            return {
                seat: this.tableSeatOf(x.e),
                equity: e ? e.equity : 0,
                outs: o ? o.cards.length : 0,
                leading: leaders.has(x.e),
            };
        });
    }
    /**
     * 1アクションの持ち時間。全ストリート・全卓で一律 ACTION_MS(60秒)。
     *
     * 以前は Triton Tempo 方式(プリフロップ15秒〜リバー30秒)＋タイムバンク(卓ごとに2〜6分)で、
     * 「合計60秒ハードキャップ」という分かりにくい積み上げになっていた。
     * 卓の設定に残っていた 360_000 等は"予備の貯金"であってアクション制限ではなかったが、
     * 表示にも仕様にも出てこないため誤解のもとだったので、単純な一律60秒に統一した。
     */
    tempoBaseMs() {
        return this.cfg.actionTimeoutMs;
    }
    /** タイムバンクを全席に加算する(トーナメントの FT 到達ボーナス等) */
    grantTimeBank(ms) {
        for (const s of this.seats)
            if (s)
                s.timeBankMs += ms;
        this.broadcastState();
    }
    /** 手番のタイマーを張り直す。持ち時間は一律 60 秒(切断中の席だけ短くする) */
    armActionTimer() {
        this.clearTimers();
        const h = this.hand;
        if (!h || h.isComplete || h.actingSeat === null)
            return;
        const seat = this.seats[this.tableSeatOf(h.actingSeat)];
        const base = this.tempoBaseMs();
        // タイムバンクは既定 0(＝全卓きっかり60秒)。トーナメントのFT特典など、
        // 明示的に配ったときだけ上乗せされるが、下のハードキャップを超えることはない
        const bank = seat?.timeBankMs ?? 0;
        this.actionBaseMs = base;
        this.actionStartedAt = this.clock.now();
        // 卓が固まらないよう、どんな設定でも1アクションは ACTION_MS(60秒)を超えない。
        // 切断中のプレイヤーは待たない(復帰の余地は残しつつ短くする)
        const total = seat !== null && seat.disconnectedAt !== null
            ? Math.min(base, 3000)
            : Math.min(base + bank, ACTION_MS);
        this.actionTotalMs = total;
        this.actionDeadline = this.clock.now() + total;
        this.schedule(() => this.onActionTimeout(), total);
    }
    onActionTimeout() {
        const h = this.hand;
        if (!h || h.isComplete || h.actingSeat === null)
            return;
        const tableSeat = this.tableSeatOf(h.actingSeat);
        const seat = this.seats[tableSeat];
        if (seat) {
            // 基本時間 + タイムバンクを丸ごと使い切ってなお応答が無かった、ということなのでバンクは 0 に
            seat.timeBankMs = 0;
            // キャッシュゲームでは自動 Sit Out にして卓が止まり続けるのを防ぐ。
            // トーナメントでは席を外せないので、以降も自動フォールドで進む
            if (!this.isTournament)
                seat.sittingOut = true;
        }
        // チェックできるならチェック、できないならフォールド。これが標準の扱い
        const legal = h.getLegalActions(h.actingSeat);
        const canCheck = legal.some((l) => l.type === 'check');
        const boardBefore = h.board.length;
        try {
            h.act(h.actingSeat, canCheck ? 'check' : 'fold');
        }
        catch {
            // ここに来るならエンジン側の不整合。ハンドを畳んで卓を止めない
            this.finishHand();
            return;
        }
        this.afterAction(boardBefore);
    }
    // -------------------------------------------------------------------------
    // 決着
    // -------------------------------------------------------------------------
    finishHand() {
        this.clearTimers();
        this.boardRevealLimit = null; // 結果表示は必ず全ボードで
        this.revealStats = null;
        this.resultRevealed = true; // ここで初めてポットの受け渡し（スタック増減）を公開してよい
        const h = this.hand;
        this.phase = 'settling';
        this.pushEvents();
        // エンジンのスタックを卓の席へ書き戻す
        for (let e = 0; e < h.players.length; e++) {
            const seat = this.seats[this.tableSeatOf(e)];
            if (seat)
                seat.stack = h.players[e].stack;
        }
        const reveal = h.revealFairness();
        this.lastReveal = {
            commitment: reveal.commitment,
            serverSeed: reveal.serverSeed,
            clientSeed: reveal.clientSeed,
            nonce: reveal.nonce,
            deck: reveal.deck,
        };
        const r = h.result;
        const netChange = {};
        for (let e = 0; e < h.players.length; e++)
            netChange[this.tableSeatOf(e)] = r.netChange[e];
        const summary = {
            handId: this.handId,
            handNumber: this.handNumber,
            board: h.board.map(cardToString),
            pots: r.pots.map((p) => ({
                amount: p.pot.amount,
                rake: p.rake,
                winners: p.winners.map((w) => this.tableSeatOf(w)),
            })),
            netChange,
            showdown: r.showdown,
            hands: r.hands
                .map((hv, e) => hv
                ? {
                    seat: this.tableSeatOf(e),
                    cards: h.players[e].holeCards.map(cardToDisplay),
                    description: describeHand(hv),
                    best: hv.cards.map(cardToDisplay),
                }
                : null)
                .filter((x) => x !== null),
            fairness: this.lastReveal,
        };
        // 誰が誰を撃墜したかを、このハンドの結果から確定させる。
        // 被害者が権利を持っていた最も下の層のポットを取った人が撃墜者、というのが標準的な帰属。
        this.lastBusts.clear();
        for (let e = 0; e < h.players.length; e++) {
            const p = h.players[e];
            if (p.stack > 0)
                continue;
            const pot = r.pots.find((x) => x.pot.eligible.includes(e));
            const winners = (pot?.winners ?? []).filter((w) => w !== e).map((w) => h.players[w].id);
            this.lastBusts.set(this.tableSeatOf(e), {
                userId: p.id,
                seat: this.tableSeatOf(e),
                eliminatedBy: winners,
                stackAtStart: p.startingStack,
            });
        }
        this.potHistory.push(r.pots.reduce((a, p) => a + p.pot.amount, 0));
        if (this.potHistory.length > 50)
            this.potHistory.shift();
        if (this.handTimestamps.length > 50)
            this.handTimestamps.shift();
        this.broadcast({ t: 'hand.result', tableId: this.cfg.tableId, summary });
        this.broadcastState();
        // 統計・ミッション・永続化はフックへ。Room 自身はそれらを知らない
        this.hooks.onHandResult?.(this, summary, h.players.map((_, e) => ({ seat: this.tableSeatOf(e), userId: h.players[e].id })));
        this.schedule(() => this.settle(), this.cfg.handIntervalMs);
    }
    /** 結果表示の待ち時間が終わったあとの後片付けと、次のハンドの開始 */
    settle() {
        this.hand = null;
        this.phase = 'waiting';
        const busted = [];
        for (const s of this.seats) {
            if (!s)
                continue;
            if (s.stack <= 0) {
                if (this.isTournament) {
                    // トーナメントでは 0 になったら脱落。席は主催側が片付ける
                    busted.push(this.lastBusts.get(s.seat) ?? { userId: s.userId, seat: s.seat, eliminatedBy: [], stackAtStart: 0 });
                    continue;
                }
                // キャッシュゲームでは自動的に Sit Out（リバイを促す）
                s.sittingOut = true;
            }
            if (this.isTournament)
                continue; // 以下はキャッシュゲーム専用の後片付け
            // 「降りる」を予約していた人はここで精算
            if (s.standPending) {
                this.payOutSeat(s);
                continue;
            }
            // 猶予を過ぎた切断者は席を引き払う
            if (this.isDisconnectExpired(s))
                this.payOutSeat(s);
        }
        // 脱落者の処理と卓の再編成は主催側（Tournament）に任せる
        this.hooks.onSettled?.(this, busted);
        // ハンドが終わってスタックが動いたので、着席記録を最新化する(落ちても復旧できるように)
        this.noteSeats();
        this.broadcastState();
        this.maybeStartHand();
    }
    // -------------------------------------------------------------------------
    // 送信
    // -------------------------------------------------------------------------
    pushEvents() {
        const h = this.hand;
        if (!h)
            return;
        const all = h.events;
        if (this.eventCursor >= all.length)
            return;
        const slice = all.slice(this.eventCursor);
        this.eventCursor = all.length;
        // ホールカードの配布イベントは全体には流さない。演出用の匿名イベントに置き換える
        const publicEvents = slice.map((e) => e.type === 'deal_hole' ? { ...e, cards: [] } : e);
        this.broadcast({ t: 'table.events', tableId: this.cfg.tableId, handId: this.handId, events: publicEvents });
    }
    broadcast(msg) {
        for (const sessionId of this.members.keys())
            this.io.send(sessionId, msg);
    }
    broadcastState() {
        for (const sessionId of this.members.keys())
            this.sendStateTo(sessionId);
    }
    sendBalanceTo(userId) {
        for (const m of this.members.values()) {
            if (m.userId === userId)
                this.io.send(m.sessionId, { t: 'balance', balance: this.bank.balanceOf(userId) });
        }
    }
    sendStateTo(sessionId) {
        const m = this.members.get(sessionId);
        if (!m)
            return;
        this.io.send(sessionId, { t: 'table.state', state: this.buildState(m.userId) });
    }
    /**
     * 指定ユーザーから見える状態を組み立てる。
     *
     * ここが情報漏洩の最終防衛線。他人のホールカードは、ショーダウンで公開された場合を除いて
     * 絶対に入れない。「クライアント側で伏せる」実装は通信を覗くだけで破られる。
     */
    buildState(userId) {
        const mySeat = this.seatOfUser(userId);
        const h = this.hand;
        const showdownOpen = h?.isComplete === true && h.result?.showdown === true;
        const seats = this.seats.map((s, i) => {
            if (!s) {
                return {
                    seat: i,
                    userId: null,
                    name: null,
                    stack: 0,
                    streetBet: 0,
                    totalBet: 0,
                    folded: false,
                    allIn: false,
                    sittingOut: false,
                    lastAction: null,
                    holeCards: null,
                    timeLeftMs: null,
                    timeBankMs: 0,
                    bracelet: null,
                };
            }
            const e = this.engineSeatOf(i);
            const p = h && e >= 0 ? h.players[e] : null;
            const isMe = s.userId === userId;
            const reveal = isMe || (showdownOpen && p !== null && !p.folded);
            // ネタバレ防止：ハンドは決着（isComplete）していても、場札を開ききって finishHand で
            // 結果を出すまではポットの受け渡しを見せない。エンジンは決着時に勝者へポットを
            // 加算済みなので、公開前はペイアウト前の残高（＝全ベット投入後・ポット獲得前）で見せる。
            //   ペイアウト前残高 = startingStack − totalBet
            // これでプリフロ/フロップ/ターンのオールインでも、リバーまで開いてから初めて
            // チップが動く（＝勝敗が先にバレない）。
            let shownStack;
            if (p && h.isComplete && !this.resultRevealed) {
                shownStack = Math.max(0, p.startingStack - p.totalBet);
            }
            else {
                shownStack = p ? p.stack : s.stack;
            }
            return {
                seat: i,
                userId: s.userId,
                name: s.name,
                stack: shownStack,
                streetBet: p?.streetBet ?? 0,
                totalBet: p?.totalBet ?? 0,
                folded: p?.folded ?? false,
                allIn: p?.allIn ?? false,
                sittingOut: s.sittingOut,
                lastAction: p?.lastAction ?? null,
                bracelet: s.bracelet,
                holeCards: reveal && p ? p.holeCards.map(cardToDisplay) : null,
                timeLeftMs: h && h.actingSeat === e && this.actionDeadline !== null
                    ? Math.max(0, this.actionDeadline - this.clock.now())
                    : null,
                timeBankMs: s.timeBankMs,
            };
        });
        const myEngineSeat = mySeat ? this.engineSeatOf(mySeat.seat) : -1;
        const isMyTurn = h !== null && myEngineSeat >= 0 && h.actingSeat === myEngineSeat;
        // 見ている本人の「現在の最強役」（ストレート・フラッシュ等）。ハンド中だけ入る。
        let yourHand = null;
        if (h && myEngineSeat >= 0) {
            const me = h.players[myEngineSeat];
            if (me && !me.folded && me.holeCards.length === 2 && !h.isComplete) {
                const shownBoard = this.boardRevealLimit !== null ? h.board.slice(0, this.boardRevealLimit) : h.board;
                const cards = [...me.holeCards, ...shownBoard];
                if (cards.length >= 5)
                    yourHand = describeHand(evaluateBest(cards));
                else
                    yourHand = me.holeCards[0] >> 2 === me.holeCards[1] >> 2 ? 'ワンペア' : 'ハイカード';
            }
        }
        // 自分の現在の勝率（未知の相手ハンドに対するモンテカルロ推定。表示用）
        let yourEquity = null;
        if (h && myEngineSeat >= 0 && !h.isComplete) {
            const me = h.players[myEngineSeat];
            if (me && !me.folded && me.holeCards.length === 2) {
                const shownBoard = this.boardRevealLimit !== null ? h.board.slice(0, this.boardRevealLimit) : h.board;
                const opp = h.players.filter((p, i) => i !== myEngineSeat && !p.folded).length;
                if (opp >= 1) {
                    const key = `${this.handId}:${myEngineSeat}:${shownBoard.length}:${opp}`;
                    if (this.equityCacheKey === key) {
                        yourEquity = this.equityCacheVal;
                    }
                    else {
                        // 主観勝率（自分 vs 未知の相手＝一様ランダム）。相手の実手札は一切見ないので漏れない。
                        // seed をこの局面から決めることで、同じ盤面では毎回同じ数字になり表示がちらつかない。
                        yourEquity = heroEquityVsUnknown(me.holeCards, shownBoard, opp, { seed: hashKey(key), iters: 600 });
                        this.equityCacheKey = key;
                        this.equityCacheVal = yourEquity;
                    }
                }
            }
        }
        return {
            tableId: this.cfg.tableId,
            name: this.cfg.name,
            handId: this.handId,
            handNumber: this.handNumber,
            street: h ? h.street : 'waiting',
            // オールイン後の段階公開中は、boardRevealLimit までに切り詰めて送る（全員同期で1段ずつ開く）
            board: h
                ? (this.boardRevealLimit !== null ? h.board.slice(0, this.boardRevealLimit) : h.board).map(cardToDisplay)
                : [],
            pot: h ? h.totalPot : 0,
            pots: h?.result?.pots.map((p) => ({
                amount: p.pot.amount,
                eligible: p.pot.eligible.map((s) => this.tableSeatOf(s)),
            })) ?? [],
            currentBet: h?.currentBet ?? 0,
            buttonIndex: this.buttonIndex,
            actingSeat: h && h.actingSeat !== null ? this.tableSeatOf(h.actingSeat) : null,
            smallBlind: this.blinds.smallBlind,
            bigBlind: this.blinds.bigBlind,
            maxSeats: this.cfg.maxSeats,
            seats,
            yourSeat: mySeat ? mySeat.seat : null,
            straddleAllowed: this.straddleEnabled,
            straddleArmed: mySeat?.straddleArmed ?? false,
            legalActions: isMyTurn ? h.getLegalActions(myEngineSeat) : [],
            fairness: {
                commitment: this.fairness?.commitment ?? null,
                clientSeed: this.phase === 'settling' || this.phase === 'hand' ? (this.fairness?.clientSeed ?? null) : null,
                nonce: this.fairness?.nonce ?? null,
                // シードはハンドが終わってからしか出さない
                serverSeed: this.phase === 'settling' ? (this.lastReveal?.serverSeed ?? null) : null,
                acceptingSeeds: this.phase === 'seed_window',
            },
            revealStats: this.revealStats ?? undefined,
            yourHand,
            yourEquity,
            baseActionMs: this.actionBaseMs,
            actionTotalMs: this.actionTotalMs,
        };
    }
    lobbyInfo() {
        const seated = this.seats.filter((s) => s !== null).length;
        const avgPot = this.potHistory.length
            ? Math.round(this.potHistory.reduce((a, b) => a + b, 0) / this.potHistory.length)
            : 0;
        let handsPerHour = 0;
        if (this.handTimestamps.length >= 2) {
            const span = this.handTimestamps[this.handTimestamps.length - 1] - this.handTimestamps[0];
            if (span > 0)
                handsPerHour = Math.round(((this.handTimestamps.length - 1) / span) * 3600000);
        }
        return {
            tableId: this.cfg.tableId,
            name: this.cfg.name,
            smallBlind: this.cfg.smallBlind,
            bigBlind: this.cfg.bigBlind,
            maxSeats: this.cfg.maxSeats,
            seatedCount: seated,
            watchingCount: this.members.size,
            minBuyIn: this.minBuyIn,
            maxBuyIn: this.maxBuyIn,
            avgPot,
            handsPerHour,
        };
    }
    // -------------------------------------------------------------------------
    seatOfUser(userId) {
        for (const s of this.seats)
            if (s && s.userId === userId)
                return s;
        return null;
    }
    schedule(fn, ms) {
        this.timers.push(this.clock.setTimeout(fn, ms));
    }
    clearTimers() {
        for (const t of this.timers)
            this.clock.clearTimeout(t);
        this.timers = [];
        this.actionDeadline = null;
    }
    /** 卓を停止する（サーバー終了時など） */
    dispose() {
        this.clearTimers();
    }
    /**
     * テスト・監視用：卓上にあるチップの総量。
     * ハンド中は席の stack が古いので、エンジン側（手札のスタック + ポットへの出資）を見る。
     */
    chipsOnTable() {
        let sum = 0;
        if (this.hand && !this.hand.isComplete) {
            const inHand = new Set();
            for (let e = 0; e < this.hand.players.length; e++) {
                inHand.add(this.tableSeatOf(e));
                sum += this.hand.players[e].stack + this.hand.players[e].totalBet;
            }
            for (const s of this.seats)
                if (s && !inHand.has(s.seat))
                    sum += s.stack;
            return sum;
        }
        for (const s of this.seats)
            if (s)
                sum += s.stack;
        return sum;
    }
    get currentPhase() {
        return this.phase;
    }
    get currentHandId() {
        return this.handId;
    }
    get seatedCount() {
        return this.seats.filter((s) => s !== null).length;
    }
}
/** 局面キー文字列から決定的な seed を作る（勝率ゲージのちらつき防止用） */
function hashKey(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
}
//# sourceMappingURL=room.js.map