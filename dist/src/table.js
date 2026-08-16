/**
 * ハンド進行ステートマシン（ノーリミット・テキサスホールデム）
 *
 * 重要な前提：
 *   このクラスはサーバー側でのみ動く。クライアントには getStateFor(seat) で
 *   「その席から見える情報だけ」を返す。他人のホールカードを絶対に送らないこと。
 *   （クライアントに全カードを送って表示側で隠す実装は、通信を覗くだけで破られる）
 *
 * ベット額の表記について：
 *   bet / raise の amount は「このストリートで最終的にいくらまで出すか（raise to）」で統一している。
 *   "raise by"（上乗せ額）と混同するのが定番のバグなので、API 全体で to に固定した。
 */
import { Deck, createSecureRng, cardToString, } from './cards.js';
import { evaluateBest, findWinners, describeHand, } from './evaluator.js';
import { buildPots, computeUncalledReturn, awardPot, computeRake, } from './pot.js';
export class Hand {
    players;
    buttonIndex;
    smallBlind;
    bigBlind;
    ante;
    straddles;
    rakePercent;
    rakeCap;
    board = [];
    street = 'preflop';
    currentBet = 0;
    /** 直近の「フルレイズ」の上乗せ幅。最小レイズ額の計算に使う */
    lastRaiseSize = 0;
    actingSeat = null;
    events = [];
    result = null;
    /** Provably Fair を有効にしている場合のセッション */
    fairness;
    deck;
    deckOrder;
    sbSeat;
    bbSeat;
    constructor(opts) {
        if (opts.seats.length < 2)
            throw new Error('プレイヤーは 2 人以上必要です');
        if (opts.seats.length > 9)
            throw new Error('席は最大 9 です');
        if (opts.seats.some((s) => s.stack <= 0))
            throw new Error('スタックが 0 以下の席は着席できません');
        this.buttonIndex = opts.buttonIndex % opts.seats.length;
        this.smallBlind = opts.smallBlind;
        this.bigBlind = opts.bigBlind;
        this.ante = opts.ante ?? 0;
        this.straddles = (opts.straddles ?? []).slice().sort((a, b) => a.amount - b.amount);
        this.rakePercent = opts.rakePercent ?? 0;
        this.rakeCap = opts.rakeCap ?? Number.MAX_SAFE_INTEGER;
        this.players = opts.seats.map((s, i) => ({
            seat: i,
            id: s.id,
            name: s.name ?? s.id,
            stack: s.stack,
            startingStack: s.stack,
            holeCards: [],
            folded: false,
            allIn: false,
            streetBet: 0,
            totalBet: 0,
            mustAct: false,
            canRaise: true,
            lastAction: null,
        }));
        // デッキの決め方は 3 通り：プリセット（テスト用） > Provably Fair の導出 > CSPRNG シャッフル
        this.fairness = opts.fairness ?? null;
        const preset = opts.presetDeck ?? this.fairness?.deriveDeck();
        const rng = opts.rng ?? createSecureRng();
        this.deck = new Deck(rng, preset);
        this.deckOrder = this.deck.snapshot();
        const n = this.players.length;
        if (n === 2) {
            // ヘッズアップだけ特別ルール：ボタンが SB を出し、プリフロップは先に動く
            this.sbSeat = this.buttonIndex;
            this.bbSeat = (this.buttonIndex + 1) % n;
        }
        else {
            this.sbSeat = (this.buttonIndex + 1) % n;
            this.bbSeat = (this.buttonIndex + 2) % n;
        }
        this.begin();
    }
    // -------------------------------------------------------------------------
    // 開始処理
    // -------------------------------------------------------------------------
    begin() {
        this.events.push({
            type: 'hand_start',
            button: this.buttonIndex,
            sbSeat: this.sbSeat,
            bbSeat: this.bbSeat,
        });
        // ホールカードを 1 枚ずつ、SB から時計回りに 2 周配る（実際のディール順に合わせる）
        for (let round = 0; round < 2; round++) {
            for (let i = 0; i < this.players.length; i++) {
                const seat = (this.sbSeat + i) % this.players.length;
                this.players[seat].holeCards.push(this.deck.draw());
            }
        }
        for (const p of this.players) {
            this.events.push({ type: 'deal_hole', seat: p.seat, cards: p.holeCards.slice() });
        }
        if (this.ante > 0) {
            for (const p of this.players) {
                const amt = Math.min(this.ante, p.stack);
                this.commit(p, amt);
                this.events.push({ type: 'ante', seat: p.seat, amount: amt });
            }
            // アンティはストリート出資ではなくポットへの直接投入として扱う
            for (const p of this.players)
                p.streetBet = 0;
        }
        const sb = this.players[this.sbSeat];
        const sbAmt = Math.min(this.smallBlind, sb.stack);
        this.commit(sb, sbAmt);
        this.events.push({ type: 'blind', seat: sb.seat, amount: sbAmt, blind: 'sb' });
        const bb = this.players[this.bbSeat];
        const bbAmt = Math.min(this.bigBlind, bb.stack);
        this.commit(bb, bbAmt);
        this.events.push({ type: 'blind', seat: bb.seat, amount: bbAmt, blind: 'bb' });
        // ブラインドを払いきれなくても、卓のベット水準は BB のまま
        this.currentBet = Math.max(this.bigBlind, sbAmt, bbAmt);
        this.lastRaiseSize = this.bigBlind;
        // ストラドル：BB の左隣から順に置かれる追加の強制ベット。
        // 実質的に「BB がその額まで上がった」のと同じ扱いにするので、
        // 最小レイズはストラドル額の 2 倍になる（オンラインで一般的なルール）。
        let lastStraddleSeat = null;
        this.straddles.forEach((st, i) => {
            const p = this.players[st.seat];
            if (!p)
                return;
            const amt = Math.min(st.amount, p.stack);
            this.commit(p, amt);
            this.events.push({ type: 'straddle', seat: st.seat, amount: amt, order: i + 1 });
            if (st.amount > this.currentBet) {
                this.currentBet = st.amount;
                this.lastRaiseSize = st.amount;
            }
            lastStraddleSeat = st.seat;
        });
        this.events.push({ type: 'street', street: 'preflop', board: [] });
        // ストラドルがあれば、その左隣から始まる（ストラドラーが最後に action する）
        const first = lastStraddleSeat !== null
            ? this.nextOccupied(lastStraddleSeat)
            : this.players.length === 2
                ? this.sbSeat
                : this.nextOccupied(this.bbSeat);
        this.beginBettingRound(first);
    }
    /** チップをスタックからポットへ移す。オールイン判定もここで行う */
    commit(p, amount) {
        const amt = Math.min(amount, p.stack);
        p.stack -= amt;
        p.streetBet += amt;
        p.totalBet += amt;
        if (p.stack === 0)
            p.allIn = true;
    }
    nextOccupied(from) {
        const n = this.players.length;
        for (let i = 1; i <= n; i++) {
            const seat = (from + i) % n;
            if (!this.players[seat].folded)
                return seat;
        }
        return from;
    }
    beginBettingRound(startSeat) {
        for (const p of this.players) {
            const active = !p.folded && !p.allIn;
            p.mustAct = active;
            p.canRaise = active;
        }
        this.actingSeat = null;
        // startSeat 自身から探させるため、1 つ手前を起点にする
        const n = this.players.length;
        this.advanceFrom((startSeat + n - 1) % n);
    }
    /** 次にアクションすべき席を探す。見つからなければストリートを終了する */
    advanceFrom(from) {
        const n = this.players.length;
        if (this.countNotFolded() <= 1) {
            this.finish(false);
            return;
        }
        for (let i = 1; i <= n; i++) {
            const seat = (from + i) % n;
            const p = this.players[seat];
            if (p.mustAct && !p.folded && !p.allIn) {
                this.actingSeat = seat;
                return;
            }
        }
        this.actingSeat = null;
        this.endStreet();
    }
    countNotFolded() {
        return this.players.filter((p) => !p.folded).length;
    }
    countCanAct() {
        return this.players.filter((p) => !p.folded && !p.allIn).length;
    }
    // -------------------------------------------------------------------------
    // アクション
    // -------------------------------------------------------------------------
    /** 現在アクション権のあるプレイヤーの合法手 */
    getLegalActions(seat) {
        const s = seat ?? this.actingSeat;
        if (s === null || s !== this.actingSeat)
            return [];
        const p = this.players[s];
        if (p.folded || p.allIn)
            return [];
        const out = [];
        const toCall = this.currentBet - p.streetBet;
        out.push({ type: 'fold' });
        if (toCall <= 0) {
            out.push({ type: 'check' });
        }
        else {
            out.push({ type: 'call', amount: Math.min(toCall, p.stack) });
        }
        const maxTo = p.streetBet + p.stack;
        if (p.stack > 0 && maxTo > this.currentBet) {
            if (this.currentBet === 0) {
                // ベット可能。最小はビッグブラインド（スタックが足りなければオールイン）
                const minTo = Math.min(this.bigBlind, maxTo);
                out.push({ type: 'bet', min: minTo, max: maxTo });
            }
            else if (p.canRaise) {
                const minTo = Math.min(this.currentBet + this.lastRaiseSize, maxTo);
                out.push({ type: 'raise', min: minTo, max: maxTo });
            }
        }
        return out;
    }
    /**
     * アクションを適用する。
     * @param seat   アクションする席（サーバーでは必ず認証済みの席と照合すること）
     * @param action 種別
     * @param toAmount bet / raise のときの「このストリートでの最終出資額（raise to）」
     */
    act(seat, action, toAmount) {
        if (this.street === 'complete')
            throw new Error('ハンドは既に終了しています');
        if (seat !== this.actingSeat) {
            throw new Error(`席 ${seat} にアクション権がありません（現在は席 ${this.actingSeat}）`);
        }
        const p = this.players[seat];
        const legal = this.getLegalActions(seat);
        const entry = legal.find((l) => l.type === action);
        if (!entry)
            throw new Error(`不正なアクション: ${action}（合法手: ${legal.map((l) => l.type).join(', ')}）`);
        let paid = 0;
        let allInNow = false;
        switch (action) {
            case 'fold': {
                p.folded = true;
                p.mustAct = false;
                break;
            }
            case 'check': {
                p.mustAct = false;
                break;
            }
            case 'call': {
                paid = Math.min(this.currentBet - p.streetBet, p.stack);
                this.commit(p, paid);
                p.mustAct = false;
                allInNow = p.allIn;
                break;
            }
            case 'bet':
            case 'raise': {
                const to = toAmount ?? 0;
                const maxTo = p.streetBet + p.stack;
                if (to > maxTo)
                    throw new Error(`スタックを超えています（最大 ${maxTo}）`);
                const isAllIn = to === maxTo;
                if (!isAllIn && to < (entry.min ?? 0)) {
                    throw new Error(`最小額に達していません（最小 ${entry.min}、指定 ${to}）`);
                }
                const prevBet = this.currentBet;
                paid = to - p.streetBet;
                this.commit(p, paid);
                this.currentBet = Math.max(this.currentBet, p.streetBet);
                allInNow = p.allIn;
                const raiseSize = this.currentBet - prevBet;
                p.mustAct = false;
                if (raiseSize >= this.lastRaiseSize) {
                    // フルレイズ：他の全員に再度アクション権とレイズ権が戻る
                    this.lastRaiseSize = raiseSize;
                    for (const q of this.players) {
                        if (q.seat === p.seat || q.folded || q.allIn)
                            continue;
                        q.mustAct = true;
                        q.canRaise = true;
                    }
                }
                else {
                    // ショートオールイン：まだコールしていない人はアクションが必要だが、
                    // 既にアクション済みだった人にはレイズ権を戻さない（standard rule）
                    for (const q of this.players) {
                        if (q.seat === p.seat || q.folded || q.allIn)
                            continue;
                        if (q.streetBet < this.currentBet && !q.mustAct) {
                            q.mustAct = true;
                            q.canRaise = false;
                        }
                    }
                }
                break;
            }
        }
        p.lastAction = action;
        this.events.push({
            type: 'action',
            seat,
            action,
            amount: paid,
            toAmount: p.streetBet,
            stack: p.stack,
            allIn: allInNow,
        });
        this.advanceFrom(seat);
    }
    // -------------------------------------------------------------------------
    // ストリート進行
    // -------------------------------------------------------------------------
    endStreet() {
        for (const p of this.players) {
            p.streetBet = 0;
            p.mustAct = false;
            p.lastAction = null; // 席のアクションタグはストリートごとに消す
        }
        this.currentBet = 0;
        this.lastRaiseSize = this.bigBlind;
        if (this.street === 'river') {
            this.finish(true);
            return;
        }
        // これ以上ベットできる人が 1 人以下なら、残りのボードを一気に開いてショーダウン
        if (this.countCanAct() <= 1) {
            while (this.board.length < 5)
                this.dealNextStreet();
            this.finish(true);
            return;
        }
        this.dealNextStreet();
        this.beginBettingRound(this.nextOccupied(this.buttonIndex));
    }
    dealNextStreet() {
        if (this.board.length === 0) {
            this.board.push(...this.deck.drawMany(3));
            this.street = 'flop';
        }
        else if (this.board.length === 3) {
            this.board.push(this.deck.draw());
            this.street = 'turn';
        }
        else if (this.board.length === 4) {
            this.board.push(this.deck.draw());
            this.street = 'river';
        }
        else {
            return;
        }
        this.events.push({ type: 'street', street: this.street, board: this.board.slice() });
    }
    // -------------------------------------------------------------------------
    // 決着
    // -------------------------------------------------------------------------
    finish(showdown) {
        this.actingSeat = null;
        // 1) コールされなかったベットを返す
        const contributions = this.players.map((p) => p.totalBet);
        const uncalled = computeUncalledReturn(contributions);
        if (uncalled && uncalled.amount > 0) {
            const p = this.players[uncalled.seat];
            p.stack += uncalled.amount;
            p.totalBet -= uncalled.amount;
            if (p.stack > 0)
                p.allIn = false;
            contributions[uncalled.seat] -= uncalled.amount;
            this.events.push({ type: 'uncalled_return', seat: uncalled.seat, amount: uncalled.amount });
        }
        // 2) ポットを構築
        const folded = this.players.map((p) => p.folded);
        const pots = buildPots(contributions, folded);
        this.events.push({ type: 'pots', pots: pots.map((p) => ({ ...p, eligible: p.eligible.slice() })) });
        // 3) 役を判定（ショーダウンに来た人のみ）
        const hands = this.players.map(() => null);
        const reachedShowdown = showdown && this.countNotFolded() > 1;
        if (reachedShowdown) {
            for (const p of this.players) {
                if (p.folded)
                    continue;
                const hv = evaluateBest([...p.holeCards, ...this.board]);
                hands[p.seat] = hv;
                this.events.push({
                    type: 'showdown',
                    seat: p.seat,
                    cards: p.holeCards.slice(),
                    hand: describeHand(hv),
                });
            }
        }
        // 4) ポットごとに勝者を決めて分配
        const sawFlop = this.board.length >= 3;
        const potResults = [];
        let totalRake = 0;
        for (const pot of pots) {
            let winners;
            if (!reachedShowdown) {
                winners = pot.eligible.filter((s) => !this.players[s].folded);
            }
            else {
                const candidates = this.players.map((p) => pot.eligible.includes(p.seat) ? hands[p.seat] : null);
                winners = findWinners(candidates);
            }
            const rake = computeRake(pot.amount, this.rakePercent, this.rakeCap, sawFlop);
            totalRake += rake;
            const distributable = { ...pot, amount: pot.amount - rake };
            const award = awardPot(distributable, winners, this.buttonIndex, this.players.length);
            for (const [seat, amt] of award.shares) {
                this.players[seat].stack += amt;
                this.events.push({ type: 'award', seat, amount: amt, potLevel: pot.level });
            }
            potResults.push({ pot, rake, winners, shares: award.shares });
        }
        if (totalRake > 0)
            this.events.push({ type: 'rake', amount: totalRake });
        this.events.push({ type: 'hand_end' });
        this.street = 'complete';
        this.result = {
            pots: potResults,
            uncalledReturn: uncalled,
            totalRake,
            showdown: reachedShowdown,
            hands,
            netChange: this.players.map((p) => p.stack - p.startingStack),
        };
    }
    // -------------------------------------------------------------------------
    // 状態の取得
    // -------------------------------------------------------------------------
    get totalPot() {
        return this.players.reduce((sum, p) => sum + p.totalBet, 0);
    }
    get isComplete() {
        return this.street === 'complete';
    }
    /**
     * 指定席から見える状態。他人のホールカードは含まない。
     * ショーダウン後は公開された手札のみ含める。
     */
    getStateFor(seat) {
        return {
            street: this.street,
            board: this.board.slice(),
            pot: this.totalPot,
            currentBet: this.currentBet,
            minRaiseSize: this.lastRaiseSize,
            actingSeat: this.actingSeat,
            buttonIndex: this.buttonIndex,
            smallBlind: this.smallBlind,
            bigBlind: this.bigBlind,
            legalActions: seat !== null && seat === this.actingSeat ? this.getLegalActions(seat) : [],
            players: this.players.map((p) => ({
                seat: p.seat,
                id: p.id,
                name: p.name,
                stack: p.stack,
                streetBet: p.streetBet,
                totalBet: p.totalBet,
                folded: p.folded,
                allIn: p.allIn,
                lastAction: p.lastAction,
                holeCards: p.seat === seat || (this.isComplete && this.result?.showdown && !p.folded)
                    ? p.holeCards.slice()
                    : null,
            })),
            result: this.result,
        };
    }
    /**
     * 配牌前にクライアントへ送るコミットメント。
     * Provably Fair を有効にしていない場合は null。
     *
     * サーバー実装では、これを送ってからでなければカードを配ってはいけない。
     * 順序を逆にすると仕組み全体が意味を失う。
     */
    getFairnessCommitment() {
        return this.fairness ? this.fairness.getCommitment() : null;
    }
    /**
     * ハンド終了後に serverSeed を開示する。
     * 進行中に呼ぶと、そのハンドの残りのカードが計算できてしまうため例外にしている。
     */
    revealFairness() {
        if (!this.fairness)
            throw new Error('このハンドは Provably Fair を有効にしていません');
        if (!this.isComplete)
            throw new Error('ハンドが終了する前にシードを開示することはできません');
        return this.fairness.reveal();
    }
    /** ハンド履歴（配布順のデッキ全体を含む）。Provably Fair の検証に使う */
    getHandHistory() {
        return {
            button: this.buttonIndex,
            blinds: { sb: this.smallBlind, bb: this.bigBlind, ante: this.ante, straddles: this.straddles },
            seats: this.players.map((p) => ({
                seat: p.seat,
                id: p.id,
                startingStack: p.startingStack,
                holeCards: p.holeCards.map(cardToString),
            })),
            board: this.board.map(cardToString),
            deckOrder: this.deckOrder.map(cardToString),
            events: this.events,
            result: this.result,
            // 終了後のみシードを含める。進行中は commitment だけ
            fairness: this.fairness
                ? this.isComplete
                    ? this.fairness.reveal()
                    : this.fairness.getCommitment()
                : null,
        };
    }
}
//# sourceMappingURL=table.js.map