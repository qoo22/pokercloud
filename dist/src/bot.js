/**
 * 検証用の簡易ボット
 *
 * 目的は「強いAI」ではなく、
 *   ・エンジンを何万ハンドも自動で回して不整合を炙り出す
 *   ・動作確認UIで人間の対戦相手になる
 * の 2 点。戦略的な質は P1 以降の課題。
 */
import { scoreBest, HandCategory } from './evaluator.js';
/**
 * ハンドの現在の強さを 0〜1 でざっくり見積もる。
 * プリフロップは 2 枚だけなので簡易的なチェン式に近いスコアを使う。
 */
function handStrength(hand, seat) {
    const p = hand.players[seat];
    const hole = p.holeCards;
    if (hand.board.length === 0) {
        const r1 = (hole[0] >> 2) + 2;
        const r2 = (hole[1] >> 2) + 2;
        const hi = Math.max(r1, r2);
        const lo = Math.min(r1, r2);
        const suited = (hole[0] & 3) === (hole[1] & 3);
        const gap = hi - lo;
        let score = (hi - 2) / 12 * 0.5;
        if (r1 === r2)
            score += 0.35 + (hi - 2) / 12 * 0.15;
        if (suited)
            score += 0.08;
        if (gap === 1 && r1 !== r2)
            score += 0.05;
        if (gap > 4)
            score -= 0.1;
        return Math.max(0, Math.min(1, score));
    }
    // 役名は不要でカテゴリだけ分かればよいので、オブジェクトを作らない scoreBest を使う
    const category = Math.floor(scoreBest([...hole, ...hand.board]) / 759375);
    const table = {
        [HandCategory.HighCard]: 0.12,
        [HandCategory.Pair]: 0.35,
        [HandCategory.TwoPair]: 0.6,
        [HandCategory.Trips]: 0.75,
        [HandCategory.Straight]: 0.85,
        [HandCategory.Flush]: 0.9,
        [HandCategory.FullHouse]: 0.95,
        [HandCategory.Quads]: 0.99,
        [HandCategory.StraightFlush]: 1.0,
    };
    return table[category];
}
export function decide(hand, seat, rng, style = 'tight') {
    const legal = hand.getLegalActions(seat);
    if (legal.length === 0)
        throw new Error('合法手がありません');
    const has = (t) => legal.find((l) => l.type === t);
    const roll = () => rng.randomInt(1000) / 1000;
    if (style === 'random') {
        const pick = legal[rng.randomInt(legal.length)];
        if (pick.type === 'bet' || pick.type === 'raise') {
            const min = pick.min;
            const max = pick.max;
            const to = min + (max > min ? rng.randomInt(max - min + 1) : 0);
            return { action: pick.type, toAmount: to };
        }
        return { action: pick.type };
    }
    if (style === 'calling-station') {
        if (has('call'))
            return { action: 'call' };
        if (has('check'))
            return { action: 'check' };
        return { action: 'fold' };
    }
    const strength = handStrength(hand, seat);
    const aggression = style === 'loose' ? 0.18 : 0.1;
    const foldThreshold = style === 'loose' ? 0.18 : 0.3;
    const raiseOpt = has('raise') ?? has('bet');
    const callOpt = has('call');
    const checkOpt = has('check');
    // 強いハンドは積極的にベット／レイズ
    if (raiseOpt && (strength > 0.7 || roll() < aggression)) {
        const min = raiseOpt.min;
        const max = raiseOpt.max;
        // ポットの 2/3 程度を目安に、スタック上限で丸める
        const target = Math.round(hand.totalPot * 0.66) + hand.currentBet;
        const to = Math.max(min, Math.min(max, target));
        return { action: raiseOpt.type, toAmount: to };
    }
    if (checkOpt)
        return { action: 'check' };
    if (callOpt) {
        const price = callOpt.amount ?? 0;
        const potOdds = price / Math.max(1, hand.totalPot + price);
        if (strength >= foldThreshold && strength >= potOdds * 0.9)
            return { action: 'call' };
        return { action: 'fold' };
    }
    return { action: 'fold' };
}
/** ハンドが終わるまでボットに打たせる。UI や大量シミュレーションで使う */
export function playOut(hand, rng, style = 'tight', maxSteps = 500) {
    let steps = 0;
    while (!hand.isComplete) {
        if (steps++ > maxSteps)
            throw new Error('ハンドが終了しません（進行ロジックのバグの可能性）');
        const seat = hand.actingSeat;
        if (seat === null)
            throw new Error('アクション権を持つ席がないのにハンドが完了していません');
        const d = decide(hand, seat, rng, style);
        hand.act(seat, d.action, d.toAmount);
    }
}
//# sourceMappingURL=bot.js.map