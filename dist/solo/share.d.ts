/**
 * 自慢用の画像カード
 *
 * 1200x630 は SNS のプレビュー画像で標準的な比率です。
 * ここを外すと、投稿したときに上下が切れて肝心の数字が見えなくなります。
 *
 * 中身の優先順位は「チップ額 → 称号 → 最高役 → 細かい統計」。
 * タイムラインでは一瞬しか見られないので、数字を大きく 1 つだけ主役にしています。
 * 統計を横並びに詰め込むと、どれも読まれません。
 */
import type { Profile } from './meta.js';
export interface ShareOptions {
    profile: Profile;
    /** 直近の見せ場（あれば主役として使う） */
    highlight?: {
        title: string;
        detail: string;
    } | null;
}
export declare function renderShareCard(opts: ShareOptions): Promise<HTMLCanvasElement>;
/** 共有用の文面。画像と一緒に貼れるように、数字を読みやすく整える */
export declare function shareText(profile: Profile): string;
export declare function downloadCard(canvas: HTMLCanvasElement, name?: string): Promise<void>;
/** クリップボードへ画像をコピー。対応していない環境では false を返す */
export declare function copyCard(canvas: HTMLCanvasElement): Promise<boolean>;
