/**
 * オールイン後の勝率とアウツ
 *
 * ここが普段のエクイティ推定（solo/ai.ts）と決定的に違うのは、
 * **全員の手札が分かっている**ことです。伏せられた札が無いので、
 * 残りの山札から出る並びを全部数え上げれば、推定ではなく正確な勝率が出せます。
 *
 * 数え上げの規模：
 *   ターン以降（残り 1 枚）… 40 通り前後
 *   フロップ以降（残り 2 枚）… 600〜1,000 通り
 *   プリフロップ（残り 5 枚）… 60 万〜170 万通り
 *
 * 最後だけは重いので、閾値を超えたらモンテカルロに切り替えます。
 * ただし表示は「約 62%」のように丸めるので、どちらでも見た目は変わりません。
 *
 * アウツは「次の 1 枚がそれなら、その瞬間に自分が単独首位になる札」と定義しています。
 * 世間で言うアウツと同じ意味で、しかも数え上げれば厳密に出せます。
 */
import { type Card, type Rng } from '../src/cards.js';
export interface ShowdownPlayer {
    seat: number;
    hole: Card[];
}
export interface SeatEquity {
    seat: number;
    /** 単独勝ちの確率 */
    win: number;
    /** 引き分けの確率 */
    tie: number;
    /** 分け合いを考慮した取り分の期待値。全員ぶん足すと 1 になる */
    equity: number;
}
/**
 * まだ場に出ていない札。
 *
 * deadCards には「サーバーは知っているが、もう山札には戻らない札」を渡す。
 * 典型例はフォールドした席の既知ホールカード（マックに行った＝以後のランアウトに出得ない）。
 * これを山札に残すと勝率・アウツがわずかに歪むため、必ず除外する。
 */
export declare function remainingDeck(players: ShowdownPlayer[], board: Card[], deadCards?: readonly Card[]): Card[];
/**
 * 現時点で首位に立っている席。
 * 同点なら複数返る。ボードが 3 枚未満のときは役が決まらないので空を返す。
 */
export declare function currentLeaders(players: ShowdownPlayer[], board: Card[]): number[];
export interface EquityResult {
    seats: SeatEquity[];
    /** 数え上げた（または試行した）回数 */
    samples: number;
    /** 全通りを数え上げたか。false ならモンテカルロ */
    exact: boolean;
}
/**
 * 全員の手札が見えている状態での勝率。
 * board が 5 枚なら結果は確定しているので、勝者が 1（または同点で等分）になる。
 */
export declare function showdownEquity(players: ShowdownPlayer[], board: Card[], rng?: Rng, maxTrials?: number, deadCards?: readonly Card[], exactLimit?: number): EquityResult;
export interface OutsResult {
    seat: number;
    /** これが来れば単独首位に立てる札 */
    cards: Card[];
    /** 今すでに首位なら true（このときアウツは「守る側」の話になるので空になる） */
    leading: boolean;
}
/**
 * 各席のアウツ。
 *
 * 「次の 1 枚がそれなら単独首位になる札」を数えます。
 * すでに首位の席は追いかける必要がないので空を返し、`leading` で区別できるようにしています。
 * ボードが 5 枚（もう引く札が無い）なら、当然すべて空です。
 */
export declare function outsFor(players: ShowdownPlayer[], board: Card[], deadCards?: readonly Card[]): OutsResult[];
/**
 * 演出の台本。
 * 1 枚めくるたびに、その時点の勝率・アウツ・首位が変わったかを持っておく。
 * 描画側はこれを順番に流すだけでよくなり、
 * 「めくった後の状態」と「表示している状態」がずれる事故を防げる。
 */
export interface RevealStep {
    /** このステップでめくる札（最初のステップは null＝公開直後の状態） */
    card: Card | null;
    /** めくった後の場札 */
    board: Card[];
    /** めくった後の勝率 */
    equity: SeatEquity[];
    /** めくった後のアウツ */
    outs: OutsResult[];
    /** めくった後の首位 */
    leaders: number[];
    /** 首位が入れ替わったか。演出で「逆転」を出すのに使う */
    leadChanged: boolean;
    /** 最後の 1 枚か */
    final: boolean;
}
/**
 * ショーダウンの台本を組み立てる。
 * runout は最終的に場に出る 5 枚のうち、まだ出ていないぶん。
 */
export declare function buildRevealScript(players: ShowdownPlayer[], board: Card[], runout: Card[], rng?: Rng): RevealStep[];
