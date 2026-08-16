/**
 * 検証用の簡易ボット
 *
 * 目的は「強いAI」ではなく、
 *   ・エンジンを何万ハンドも自動で回して不整合を炙り出す
 *   ・動作確認UIで人間の対戦相手になる
 * の 2 点。戦略的な質は P1 以降の課題。
 */
import { type Rng } from './cards.js';
import { type Hand, type ActionType } from './table.js';
export interface BotDecision {
    action: ActionType;
    toAmount?: number;
}
export type BotStyle = 'random' | 'tight' | 'loose' | 'calling-station';
export declare function decide(hand: Hand, seat: number, rng: Rng, style?: BotStyle): BotDecision;
/** ハンドが終わるまでボットに打たせる。UI や大量シミュレーションで使う */
export declare function playOut(hand: Hand, rng: Rng, style?: BotStyle, maxSteps?: number): void;
