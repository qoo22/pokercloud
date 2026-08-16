/**
 * ポットとサイドポット
 *
 * ここはポーカーエンジンで最もバグが出やすい箇所。
 * 「誰がいくら出したか」だけを入力に、レイヤー構造のポットを組み立てる純粋関数にしてある。
 * ハンド進行の状態を一切参照しないので、単体テストで総当たり検証できる。
 */
export interface Pot {
    /** このポットの総額 */
    amount: number;
    /** このポットを獲得しうる席インデックス（降りていない、かつこのレベルまで出資している） */
    eligible: number[];
    /** メインポットなら 0、以降 1, 2, ... */
    level: number;
}
export interface UncalledReturn {
    seat: number;
    amount: number;
}
/**
 * コールされなかったベットの返却額を計算する。
 *
 * 例：A が 1000 ベット、B が 300 でオールインし他は全員フォールド。
 * このとき A の 700 は誰にもコールされていないので A に返す。
 * これを忘れるとチップが消滅する（＝プレイヤーからは「盗まれた」ように見える）。
 *
 * 注意：フォールドしたプレイヤーの出資も「コールした額」として数える。
 *       降りる前に出したチップはポットに残るため。
 */
export declare function computeUncalledReturn(contributions: number[]): UncalledReturn | null;
/**
 * 出資額とフォールド状態からポット（メイン + サイド）を構築する。
 *
 * アルゴリズム：
 *   出資額のユニーク値を昇順に並べ、それを「水位」として層を積み上げる。
 *   各層の金額は「全員がその水位まで出した分の合計」、
 *   その層を取れるのは「降りておらず、かつその水位以上を出したプレイヤー」。
 *
 * @param contributions 席ごとの、このハンドでの総出資額（返却分は差し引き済みであること）
 * @param folded        席ごとのフォールド状態
 */
export declare function buildPots(contributions: number[], folded: boolean[]): Pot[];
export interface PotAward {
    pot: Pot;
    /** 席 → 獲得額 */
    shares: Map<number, number>;
    /** 端数を受け取った席（あれば） */
    oddChipSeat: number | null;
}
/**
 * 1 つのポットを勝者間で分配する。
 *
 * 端数の扱い：ボタンの左隣（最初にアクションする席）から時計回りに、勝者の中で最初に見つかった
 * プレイヤーに与える。これはライブポーカーの標準ルールで、実装ごとにブレやすいので明示的に固定した。
 *
 * @param winners       この ポットの勝者（席インデックス）
 * @param buttonIndex   ボタンの席インデックス
 * @param seatCount     テーブルの席数
 */
export declare function awardPot(pot: Pot, winners: number[], buttonIndex: number, seatCount: number): PotAward;
/**
 * レーキを計算する。
 *
 * ソーシャルポーカーにおけるレーキは収益ではなく、チップ経済のインフレを抑える
 * 「シンク（消滅装置）」である。仕様書では低レート帯をノーレーキにして
 * 新規プレイヤーの初期残高を保護する設計にしている。
 *
 * @param potAmount   レーキ対象のポット額
 * @param percent     レーキ率（0.03 = 3%）
 * @param cap         上限額（チップ単位）
 * @param sawFlop     フロップを見たか。false なら "no flop, no drop" でレーキ 0
 */
export declare function computeRake(potAmount: number, percent: number, cap: number, sawFlop: boolean): number;
