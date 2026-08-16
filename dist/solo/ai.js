/**
 * CPU プレイヤーの思考
 *
 * 「強い」を成立させている要素は 5 つです。どれか 1 つでも欠けると、
 * 人間側にすぐ見抜かれる穴ができます。
 *
 *   1. エクイティ推定  … モンテカルロで「今この手が勝つ確率」を出す
 *   2. ポットオッズ    … 払う額に対して勝率が見合うかを判断する
 *   3. ポジション      … 後ろの席ほど広いレンジで戦う
 *   4. ブラフ          … 強いときだけ賭けると読まれる。頻度を設計して混ぜる
 *   5. 相手のモデル化  … 人間の傾向（降りやすい／付いてくる）を測って寄せる
 *
 * とくに 4 と 5 が無いと「強い手のときだけベットしてくる機械」になり、
 * 人間は降りるだけで勝ててしまいます。ここが単純なボットとの決定的な差です。
 */
import { freshDeck } from '../src/cards.js';
import { scoreBest, HandCategory } from '../src/evaluator.js';
export const PERSONALITIES = {
    rock: { key: 'rock', name: '岩田', looseness: 0.16, aggression: 0.35, bluff: 0.04, sticky: 0.35, tagline: '滅多に参加しない。参加したら強い' },
    tag: { key: 'tag', name: '真田', looseness: 0.26, aggression: 0.68, bluff: 0.16, sticky: 0.5, tagline: '堅く、そして鋭い。一番厄介' },
    lag: { key: 'lag', name: 'カレン', looseness: 0.42, aggression: 0.78, bluff: 0.3, sticky: 0.55, tagline: '広く入って押してくる' },
    station: { key: 'station', name: '大場', looseness: 0.48, aggression: 0.22, bluff: 0.05, sticky: 0.85, tagline: 'とにかく降りない。ブラフは効かない' },
    maniac: { key: 'maniac', name: 'ジョー', looseness: 0.62, aggression: 0.92, bluff: 0.42, sticky: 0.6, tagline: '手が付けられない。付き合うと危険' },
};
// ---------------------------------------------------------------------------
// 相手（人間）のモデル
// ---------------------------------------------------------------------------
/**
 * 人間の傾向を測る。
 * ハンド数が少ないうちは平均的な相手を仮定し、データが溜まるにつれて寄せていく。
 * いきなり実測値を信じると、最初の数ハンドの偶然に引きずられます。
 */
export class OpponentModel {
    hands = 0;
    vpip = 0;
    raises = 0;
    actions = 0;
    foldsToBet = 0;
    facedBets = 0;
    noteHandStart() {
        this.hands++;
    }
    noteVoluntary() {
        this.vpip++;
    }
    noteAction(action, facingBet) {
        this.actions++;
        if (action === 'bet' || action === 'raise')
            this.raises++;
        if (facingBet) {
            this.facedBets++;
            if (action === 'fold')
                this.foldsToBet++;
        }
    }
    /** 事前分布に寄せた推定値。分母に定数を足すのがベイズ的な平滑化 */
    get vpipRate() {
        return (this.vpip + 6) / (this.hands + 24);
    }
    get aggressionRate() {
        return (this.raises + 3) / (this.actions + 15);
    }
    get foldToBetRate() {
        return (this.foldsToBet + 5) / (this.facedBets + 12);
    }
    get sampleSize() {
        return this.hands;
    }
}
// ---------------------------------------------------------------------------
// エクイティ推定
// ---------------------------------------------------------------------------
/**
 * モンテカルロで勝率を出す。
 *
 * 相手のレンジを厳密に扱うのが理想ですが、計算量が跳ね上がるうえに
 * 「相手がどういうレンジで来ているか」の推定誤差のほうが大きくなります。
 * ここでは「ランダムな手」を基準にし、そこから相手のタイトさで補正する方式にしています。
 * 実装が単純で、体感の強さは十分に出ます。
 */
export function equity(hole, board, opponents, trials, rng) {
    const known = new Set([...hole, ...board]);
    const deck = [];
    for (const c of freshDeck())
        if (!known.has(c))
            deck.push(c);
    const need = 5 - board.length;
    let wins = 0;
    let ties = 0;
    const mine = new Array(7);
    const theirs = new Array(7);
    for (let t = 0; t < trials; t++) {
        // 必要な枚数だけ部分シャッフルする。毎回 52 枚を混ぜるのは無駄
        const take = need + opponents * 2;
        for (let i = 0; i < take; i++) {
            const j = i + rng.randomInt(deck.length - i);
            const tmp = deck[i];
            deck[i] = deck[j];
            deck[j] = tmp;
        }
        let k = 0;
        const fullBoard = board.slice();
        for (let i = 0; i < need; i++)
            fullBoard.push(deck[k++]);
        mine[0] = hole[0];
        mine[1] = hole[1];
        for (let i = 0; i < 5; i++)
            mine[2 + i] = fullBoard[i];
        const myScore = scoreBest(mine);
        let best = -1;
        for (let o = 0; o < opponents; o++) {
            theirs[0] = deck[k++];
            theirs[1] = deck[k++];
            for (let i = 0; i < 5; i++)
                theirs[2 + i] = fullBoard[i];
            const s = scoreBest(theirs);
            if (s > best)
                best = s;
        }
        if (myScore > best)
            wins++;
        else if (myScore === best)
            ties++;
    }
    return (wins + ties * 0.5) / trials;
}
/** プリフロップの手の強さ（0〜1）。チェンの式に近い評価を正規化したもの */
export function preflopStrength(hole) {
    const r1 = (hole[0] >> 2) + 2;
    const r2 = (hole[1] >> 2) + 2;
    const hi = Math.max(r1, r2);
    const lo = Math.min(r1, r2);
    const suited = (hole[0] & 3) === (hole[1] & 3);
    const gap = hi - lo;
    // 高いカードほど価値がある。A を 10 点として線形に落とす
    let pts = (hi - 2) * 0.9;
    if (r1 === r2)
        pts = Math.max(10, (hi - 2) * 1.6); // ペアは別枠で高く
    if (suited)
        pts += 3;
    if (gap === 1 && r1 !== r2)
        pts += 2;
    else if (gap === 2)
        pts += 1;
    else if (gap >= 4)
        pts -= gap;
    if (hi <= 11 && gap <= 2 && r1 !== r2)
        pts += 1; // 低いコネクター
    return Math.max(0, Math.min(1, pts / 22));
}
/** ボードの危険度（0〜1）。高いほど相手に強い手が入っている可能性がある */
export function boardDanger(board) {
    if (board.length === 0)
        return 0;
    const suits = new Array(4).fill(0);
    const ranks = new Array(15).fill(0);
    for (const c of board) {
        suits[c & 3]++;
        ranks[(c >> 2) + 2]++;
    }
    let d = 0;
    const maxSuit = Math.max(...suits);
    if (maxSuit >= 3)
        d += 0.3;
    if (maxSuit >= 4)
        d += 0.2;
    if (ranks.some((n) => n >= 2))
        d += 0.2; // ペアボード
    // 連続性
    let run = 0;
    let maxRun = 0;
    for (let r = 2; r <= 14; r++) {
        run = ranks[r] > 0 ? run + 1 : 0;
        maxRun = Math.max(maxRun, run);
    }
    if (maxRun >= 3)
        d += 0.25;
    if (ranks[14] || ranks[13])
        d += 0.1; // ハイカードのボード
    return Math.min(1, d);
}
export function decideAi(ctx) {
    const { hand, seat, profile, model, rng, skill } = ctx;
    const legal = hand.getLegalActions(seat);
    if (legal.length === 0)
        return { action: 'fold', reason: '合法手なし' };
    const me = hand.players[seat];
    const check = legal.find((l) => l.type === 'check');
    const call = legal.find((l) => l.type === 'call');
    const raise = legal.find((l) => l.type === 'raise' || l.type === 'bet');
    const activeOpponents = hand.players.filter((p) => !p.folded && p.seat !== seat).length;
    const pot = hand.totalPot;
    const toCall = call?.amount ?? 0;
    // --- 1) 勝率の推定 ---
    // 試行回数は難易度で変える。多いほど推定が安定し、判断がブレなくなる
    const trials = hand.board.length === 0 ? 0 : Math.round(160 + 240 * skill);
    const raw = hand.board.length === 0
        ? preflopStrength(me.holeCards)
        : equity(me.holeCards, hand.board, Math.max(1, activeOpponents), trials, rng);
    // プリフロップの手の強さは「勝率」ではないので、人数で薄める
    let eq = hand.board.length === 0 ? Math.max(0.12, raw * (1 - activeOpponents * 0.06)) : raw;
    // --- 2) ポジション ---
    // ボタンに近いほど後で動けるので、同じ手でも強く扱ってよい
    const n = hand.players.length;
    const distFromButton = (seat - hand.buttonIndex + n) % n;
    const late = distFromButton === 0 || distFromButton >= n - 2;
    const positionBonus = late ? 0.05 : distFromButton <= 2 ? -0.03 : 0;
    eq += positionBonus;
    // --- 3) 相手のモデルで補正 ---
    // よく降りる相手にはブラフが通る。付いてくる相手にはブラフを捨てて価値で取る
    const foldEquity = Math.min(0.6, model.foldToBetRate) * (0.5 + skill * 0.5);
    const bluffable = foldEquity > 0.36 && activeOpponents <= 2;
    // --- 4) ドローの評価 ---
    const danger = boardDanger(hand.board);
    const myCat = hand.board.length >= 3 ? Math.floor(scoreBest([...me.holeCards, ...hand.board]) / 759375) : -1;
    const hasDraw = hand.board.length >= 3 && hand.board.length <= 4 && eq > 0.3 && myCat <= HandCategory.Pair;
    // --- 5) ポットオッズ ---
    const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    const callProfitable = eq > potOdds * (1.0 - profile.sticky * 0.15);
    // --- 判断 ---
    const roll = () => rng.randomInt(1000) / 1000;
    const aggression = profile.aggression * (0.85 + skill * 0.3);
    // 強い手：バリューで取りに行く
    const strongThreshold = 0.66 - profile.looseness * 0.12;
    if (raise && eq >= strongThreshold) {
        // 危険なボードでは薄く、安全なボードでは厚く
        const frac = 0.55 + (eq - strongThreshold) * 1.2 - danger * 0.2;
        return sizedRaise(raise, hand, frac, `勝率 ${(eq * 100) | 0}% のバリュー`);
    }
    // セミブラフ：ドローがあるときは押す価値がある
    if (raise && hasDraw && roll() < aggression * 0.55) {
        return sizedRaise(raise, hand, 0.5 + roll() * 0.2, 'ドローでセミブラフ');
    }
    // 純粋なブラフ：相手が降りやすいときだけ、頻度を絞って
    if (raise && bluffable && eq < 0.35 && roll() < profile.bluff * (0.6 + foldEquity)) {
        return sizedRaise(raise, hand, 0.45 + roll() * 0.25, 'ブラフ（相手が降りやすい）');
    }
    // 中くらいの手：ポットを膨らませすぎない
    if (check && eq < strongThreshold) {
        // たまに薄いバリューベットを混ぜて、チェック＝弱いと読まれないようにする
        if (raise && eq > 0.5 && roll() < aggression * 0.35) {
            return sizedRaise(raise, hand, 0.33, '薄いバリュー');
        }
        return { action: 'check', reason: `勝率 ${(eq * 100) | 0}% でコントロール` };
    }
    if (call) {
        if (callProfitable)
            return { action: 'call', reason: `オッズ ${(potOdds * 100) | 0}% に対し勝率 ${(eq * 100) | 0}%` };
        // 付いてくる性格は、多少不利でもコールする
        if (roll() < profile.sticky * 0.35 && eq > potOdds * 0.7) {
            return { action: 'call', reason: '性格的に降りない' };
        }
        return { action: 'fold', reason: `オッズ ${(potOdds * 100) | 0}% に勝率 ${(eq * 100) | 0}% が足りない` };
    }
    if (check)
        return { action: 'check', reason: 'チェック' };
    return { action: 'fold', reason: 'フォールド' };
}
/** ポットに対する割合でレイズ額を決め、合法範囲へ丸める */
function sizedRaise(opt, hand, potFraction, reason) {
    const target = Math.round(hand.totalPot * potFraction) + hand.currentBet;
    const to = Math.max(opt.min, Math.min(opt.max, target));
    // 中途半端な額は読まれやすいので、キリのいい数字に丸める
    const unit = hand.bigBlind;
    const rounded = Math.max(opt.min, Math.min(opt.max, Math.round(to / unit) * unit));
    return { action: opt.type, toAmount: rounded, reason };
}
//# sourceMappingURL=ai.js.map