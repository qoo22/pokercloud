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
import { type Card, type Rng } from '../src/cards.js';
import type { Hand, ActionType } from '../src/table.js';
export type Personality = 'rock' | 'tag' | 'lag' | 'station' | 'maniac';
export interface PersonalityProfile {
    key: Personality;
    name: string;
    /** 参加する手の広さ。高いほどルース */
    looseness: number;
    /** ベット・レイズの傾向 */
    aggression: number;
    /** ブラフの頻度 */
    bluff: number;
    /** 降りにくさ（高いほど付いてくる） */
    sticky: number;
    tagline: string;
}
export declare const PERSONALITIES: Record<Personality, PersonalityProfile>;
/**
 * 人間の傾向を測る。
 * ハンド数が少ないうちは平均的な相手を仮定し、データが溜まるにつれて寄せていく。
 * いきなり実測値を信じると、最初の数ハンドの偶然に引きずられます。
 */
export declare class OpponentModel {
    private hands;
    private vpip;
    private raises;
    private actions;
    private foldsToBet;
    private facedBets;
    noteHandStart(): void;
    noteVoluntary(): void;
    noteAction(action: ActionType, facingBet: boolean): void;
    /** 事前分布に寄せた推定値。分母に定数を足すのがベイズ的な平滑化 */
    get vpipRate(): number;
    get aggressionRate(): number;
    get foldToBetRate(): number;
    get sampleSize(): number;
}
/**
 * モンテカルロで勝率を出す。
 *
 * 相手のレンジを厳密に扱うのが理想ですが、計算量が跳ね上がるうえに
 * 「相手がどういうレンジで来ているか」の推定誤差のほうが大きくなります。
 * ここでは「ランダムな手」を基準にし、そこから相手のタイトさで補正する方式にしています。
 * 実装が単純で、体感の強さは十分に出ます。
 */
export declare function equity(hole: Card[], board: Card[], opponents: number, trials: number, rng: Rng): number;
/** プリフロップの手の強さ（0〜1）。チェンの式に近い評価を正規化したもの */
export declare function preflopStrength(hole: Card[]): number;
/** ボードの危険度（0〜1）。高いほど相手に強い手が入っている可能性がある */
export declare function boardDanger(board: Card[]): number;
export interface AiDecision {
    action: ActionType;
    toAmount?: number;
    /** 思考の要約（デバッグ表示用） */
    reason: string;
}
export interface AiContext {
    hand: Hand;
    seat: number;
    profile: PersonalityProfile;
    model: OpponentModel;
    rng: Rng;
    /** 難易度。1.0 が標準、上げるほど精度と読みが上がる */
    skill: number;
}
export declare function decideAi(ctx: AiContext): AiDecision;
