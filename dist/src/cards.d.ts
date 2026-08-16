/**
 * カードとデッキ
 *
 * カードは 0〜51 の整数で表現する。
 *   card = (rank - 2) * 4 + suitIndex
 *   rank: 2〜14（14 = A）
 *   suit: 0=s(スペード) 1=h(ハート) 2=d(ダイヤ) 3=c(クラブ)
 *
 * 整数表現にしているのは、比較・ソート・集合演算がすべて O(1) の整数演算で済み、
 * 大量のハンドをシミュレーションするときに GC 負荷が出ないため。
 */
export type Card = number;
export declare const SUIT_CHARS: readonly ["s", "h", "d", "c"];
export declare const RANK_CHARS: readonly ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export declare const SUIT_SYMBOLS: readonly ["♠", "♥", "♦", "♣"];
export declare function rankOf(card: Card): number;
export declare function suitOf(card: Card): number;
export declare function makeCard(rank: number, suit: number): Card;
/** "As" "Th" "2c" のような文字列に変換 */
export declare function cardToString(card: Card): string;
/** "♠A" のような表示用文字列 */
export declare function cardToDisplay(card: Card): string;
/** "As" 形式の文字列をパース。テストとデバッグ用 */
export declare function parseCard(s: string): Card;
/** "As Kd Qh" のようなスペース区切り文字列をパース */
export declare function parseCards(s: string): Card[];
export declare function freshDeck(): Card[];
/**
 * 乱数源のインターフェース。
 * randomInt(n) は 0 以上 n 未満の整数を「一様に」返さなければならない。
 *
 * Math.random() を直接使わないのは意図的。
 * 1) Math.random() は暗号学的に安全ではなく、内部状態が推測されうる
 * 2) 剰余を取るだけの実装は分布に偏りが出る（modulo bias）
 * どちらもポーカーでは致命的な脆弱性になる。
 */
export interface Rng {
    randomInt(n: number): number;
}
/**
 * 本番用。OS の CSPRNG を使い、剰余バイアスを棄却サンプリングで除去する。
 *
 * getRandomValues() は 1 回あたり十数マイクロ秒かかる。1 シャッフルで 51 回呼ぶと
 * 実測で 1 ハンドあたり 0.6ms 前後を消費し、数千卓を捌くサーバーでは無視できない。
 * そこでまとまったバイト列を一度に取得してプールから消費する。
 * プールの中身は CSPRNG の出力そのままで、使い回しもしないので安全性は落ちない。
 */
export declare function createSecureRng(poolBytes?: number): Rng;
/**
 * 決定論的な乱数源（xoshiro128**）。
 * テストの再現性と、Provably Fair（シード公開による検証）に使う。
 * 本番のシャッフルには単独では使わず、必ず CSPRNG 由来のシードを与えること。
 */
export declare function createSeededRng(seed: number | number[]): Rng;
/**
 * Fisher-Yates シャッフル（配列を破壊的に並べ替える）。
 * 後ろから前へ回すのが正しい実装。前から回す変種は分布が偏るので使わないこと。
 */
export declare function shuffle<T>(arr: T[], rng: Rng): T[];
/** シャッフル済みデッキから順に配るだけのシンプルなディーラー */
export declare class Deck {
    private cards;
    private index;
    constructor(rng: Rng, preset?: Card[]);
    draw(): Card;
    drawMany(n: number): Card[];
    get remaining(): number;
    /** ハンド履歴に残すための、配布順の完全な記録 */
    snapshot(): Card[];
}
