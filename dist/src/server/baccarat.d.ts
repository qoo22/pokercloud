/**
 * バカラ(第117弾)。
 *
 * ここは**純粋関数だけ**: 8デックのシューから1ハンド配り、標準の三枚目規則で
 * 勝敗を出し、払い戻しを計算する。支払い・上限・台帳は economy.ts が持つ
 * (スロットと同じ分担。抽選と金銭を分けるとテストで出目を固定できる)。
 *
 * 絞り(スクイーズ)はクライアントの演出であって、結果には一切影響しない。
 * サーバーは配った瞬間に全カードと払い戻しを確定して返す。
 */
/** r: 1(A)〜13(K)、s: 0♠ 1♥ 2♦ 3♣ */
export type BacCard = {
    r: number;
    s: number;
};
export type BacHand = {
    p: BacCard[];
    b: BacCard[];
    /** 配る順(演出用)。s はどちらの手か、i は手札の何枚目か */
    order: {
        s: 'p' | 'b';
        i: number;
    }[];
    pt: number;
    bt: number;
    res: 'P' | 'B' | 'T';
};
export type BacBets = {
    p: number;
    b: number;
    tie: number;
};
/** バカラの数え方: 10・絵札は0、Aは1 */
export declare const bacValue: (r: number) => number;
/**
 * バンカーが三枚目を引くか(標準規則)。
 * p3 はプレイヤー三枚目の**値**(引いていなければ null → バンカーは 0-5 で引く)
 */
export declare const bankerDraws: (bt: number, p3: number | null) => boolean;
/**
 * 先頭から順にカードを供給する next で1ハンド進める。
 * テストはここに固定の並びを渡して三枚目規則を検証する
 */
export declare function dealFromCards(next: () => BacCard): BacHand;
/** 本番の入り口: 8デックを混ぜて配る。rnd 差し替えはテスト用 */
export declare function dealBaccarat(rnd?: () => number): BacHand;
/**
 * 払い戻し(賭け金込みの戻り)。
 * PLAYER 1:1 / BANKER 0.95:1(5%コミッション・端数切り捨て) / TIE 8:1。
 * TIE のときの PLAYER・BANKER 賭けはプッシュ(返金)
 */
export declare function baccaratReturn(bets: BacBets, res: BacHand['res']): number;
/**
 * 読み宣言(絞る最後の1枚が HIGH 5-9 か LOW 0-4 か)のボーナス率。
 * 値0は 10/J/Q/K の4ランクを含むため LOW(8/13≈62%) と HIGH(5/13≈38%) の
 * 的中率が大きく違う。率を変えて期待値を揃える:
 *   HIGH +25% × 5/13 ≈ +9.6% / LOW +15% × 8/13 ≈ +9.2%
 * (どちらを選んでも同じくらい。プロトタイプの一律20%は LOW 一択になるので不採用)
 */
export declare const BAC_DECLARE_RATE: Record<'H' | 'L', number>;
/** 宣言が的中したか。card は配り順で最後の1枚(=絞る札) */
export declare function declareHit(declare: 'H' | 'L' | null, card: BacCard): boolean;
