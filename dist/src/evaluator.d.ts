/**
 * 役判定
 *
 * 設計方針：
 *   5枚の判定を「絶対に間違えない形」で書き、7枚は 21 通りの組み合わせの最大値を取る。
 *   ビット演算で 7枚を直接判定する高速版も書けるが、P0 では正しさを優先した。
 *   （テストでは高速化前提の性質——例えば役の出現頻度が理論値と一致すること——を検証している）
 */
import { type Card } from './cards.js';
export declare enum HandCategory {
    HighCard = 0,
    Pair = 1,
    TwoPair = 2,
    Trips = 3,
    Straight = 4,
    Flush = 5,
    FullHouse = 6,
    Quads = 7,
    StraightFlush = 8
}
export interface HandValue {
    category: HandCategory;
    /** 同カテゴリ内の強さ。先頭から辞書順で比較する */
    ranks: number[];
    /** 役を構成する 5 枚 */
    cards: Card[];
}
/** 日本語の役名（キッカーまで含む説明） */
export declare function describeHand(hv: HandValue): string;
export declare function handToString(hv: HandValue): string;
/**
 * ちょうど 5 枚の役を判定する。
 */
export declare function evaluate5(cards: Card[]): HandValue;
export declare function rank5(c0: Card, c1: Card, c2: Card, c3: Card, c4: Card): number;
/**
 * 5〜7 枚のベストハンドを整数スコアで返す。オブジェクトを作らない版。
 * 勝敗判定だけが必要な場面（シミュレーション、エクイティ計算）ではこちらを使う。
 */
export declare function scoreBest(cards: Card[]): number;
/**
 * 5〜7 枚から最強の 5 枚を選ぶ。
 * ホールカード 2 枚 + ボード 5 枚 = 7 枚が通常の入力。
 */
export declare function evaluateBest(cards: Card[]): HandValue;
/** a が強ければ正、b が強ければ負、完全同値なら 0 */
export declare function compareHands(a: HandValue, b: HandValue): number;
/**
 * 複数プレイヤーのハンドを比較し、勝者のインデックス配列を返す（同点なら複数）。
 * hands の要素が null のプレイヤー（フォールド済みなど）は無視される。
 */
export declare function findWinners(hands: Array<HandValue | null>): number[];
