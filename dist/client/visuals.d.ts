/**
 * カードの見た目と演出
 *
 * カードの表（52枚）は SVG、裏面とフェルトは画像です。
 *
 * なぜカードの表を画像にしないのか：
 *   1. カードは 52 枚が一貫している必要がある。AI 生成や手描き素材だと
 *      ランクごとに微妙に太さや位置がずれ、並べたときに必ず気づかれる。
 *   2. 拡大縮小で崩れない。同じ卓でも自分の手札は大きく、相手の手札は小さく出したい。
 *   3. テーマ（クラシック / ネオン）を CSS 変数だけで切り替えられる。
 *      画像だと 2 セット用意することになり、追加のたびに枚数が倍々で増える。
 *   4. 外部ファイルが増えないので、単一 HTML のまま配布できる。
 *
 * 逆に裏面とフェルトは 1 枚あれば足り、模様の細かさが質感に直結するので画像にしています
 * （生成画像を縮小して data URI で埋め込み、3 枚で 44KB）。
 *
 * ピップ（スート記号）の配置は実際のトランプの配置に合わせてあります。
 * ここを適当な等間隔にすると「なんとなく安っぽい」印象になり、
 * しかも理由が言語化されにくいので直しづらいバグになります。
 */
export type CardTheme = 'classic' | 'neon';
/** スートごとの色クラス。色覚特性に配慮して 4 色に分ける（設定で 2 色にも戻せる） */
export declare const SUIT_KEY: Record<string, string>;
/**
 * カードの各要素の寸法。すべてカード幅（--cw）に対する比率です。
 *
 * ここを数値として持っているのは、CSS をこの値から組み立てたうえで、
 * **同じ値を使って「角の指数とピップが重なっていないか」をテストで検算する**ためです。
 * CSS に直接数字を書くと、少し変えただけで重なりが復活しても誰も気づけません。
 * 実際、最初の版は指数が大きすぎてピップと重なっていました。
 *
 * 角の指数は本物のトランプではカード幅の 1 割ほどしかありませんが、
 * 画面上の 50px 前後のカードでそれをやると読めないので、
 * 読める大きさまで拡大したうえで、ピップの領域を内側に寄せて衝突を避けています。
 */
export declare const CARD_METRICS: {
    /** 高さ / 幅。実物のトランプ（63×88mm）とほぼ同じ */
    readonly aspect: 1.4;
    /** 角の指数の位置 */
    readonly idxTop: 0.05;
    readonly idxLeft: 0.06;
    /** 数字の大きさ */
    readonly idxFont: 0.28;
    /** 「10」だけは 2 文字ぶん横に広がるので、その場合は縮める */
    readonly idxWideScale: 0.58;
    /** 数字とスート記号の間隔 */
    readonly idxGap: 0.02;
    /** 指数に添えるスート記号（小さすぎて見えなかったので拡大。横幅は数字側が支配的なので隙間には影響しない） */
    readonly idxSuit: 0.17;
    /**
     * ピップを並べる領域の余白（左右／上下）。
     * 角の指数を避けようとしてここを広げすぎると、今度は列の間隔が詰まって
     * ピップ同士がぶつかります。避けるのは領域ではなく指数を小さくする側で、
     * 本物のトランプもそうなっています
     */
    readonly fieldX: 0.14;
    readonly fieldY: 0.22;
    /**
     * ピップ 1 個の大きさ。
     * 中央の列（0.5）と両脇の列（0.28 / 0.72）の間隔より小さくないと、
     * 7 や 9 のように列をまたぐ配置で重なります
     */
    readonly pipW: 0.14;
    /** 指数とピップの間に最低限空けたい距離 */
    readonly minGap: 0.02;
};
/**
 * 文字の横幅の見積もり（フォントサイズに対する比率）。
 * 正確な値はフォントに依るので、太字の数字として安全側に大きめを取っている。
 */
export declare const GLYPH_WIDTH: {
    readonly single: 0.68;
    readonly double: 1.15;
};
/** 角の指数が占める矩形（カード幅を 1 とした座標） */
export declare function indexBox(rank: string): {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
};
/** ピップ 1 個が占める矩形（カード幅を 1 とした座標） */
export declare function pipBox(x: number, y: number): {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
};
/**
 * 実際のトランプのピップ配置。x は 0〜1（左右）、y は 0〜1（上下）。
 * y > 0.5 のピップは 180 度回転させる（本物のカードと同じ）。
 */
export declare const PIP_LAYOUT: Record<number, Array<[number, number]>>;
export interface CardOptions {
    /** sm: 相手の手札 / md: ボード / lg: 自分の手札 */
    size?: 'sm' | 'md' | 'lg';
    /** 役を構成した札としてハイライトする */
    highlight?: boolean;
    /** 追加クラス */
    extra?: string;
}
/**
 * 表向きのカード。code は "♠A" のような「スート記号 + ランク」。
 * サーバーから届く表記をそのまま受け取れるようにしてある。
 */
export declare function cardFace(code: string, opts?: CardOptions): string;
/**
 * 裏向きのカード。
 * 幾何学模様を SVG で組み立てているので、テーマの色をそのまま受け取れる。
 */
export declare function cardBack(opts?: CardOptions): string;
/** 空きスロット（まだ配られていないボード） */
export declare function cardSlot(size?: 'sm' | 'md' | 'lg'): string;
export declare const VISUAL_CSS: string;
/** 役名バナーを出す */
export declare function showHandBanner(container: HTMLElement, text: string): void;
/** オールインの閃光 */
export declare function flashAllIn(container: HTMLElement): void;
/**
 * チップがポットへ飛ぶ演出。
 * 実座標を測ってから飛ばすので、席数やレイアウトが変わっても追従する。
 */
export declare function flyChips(container: HTMLElement, from: HTMLElement, count?: number): void;
/** 紙吹雪。大きな勝ちのときだけに絞る（毎回出すと価値が無くなる） */
export declare function confetti(container: HTMLElement, pieces?: number): void;
/** ポット額の増加を強調する */
export declare function bumpPot(potEl: HTMLElement): void;
