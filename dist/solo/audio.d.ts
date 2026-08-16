/**
 * 効果音
 *
 * 音源ファイルを持たず、WebAudio で波形から合成しています。
 * 単一 HTML のまま配りたいからです。音声ファイルを base64 で埋めると、
 * 1 音あたり数十〜数百 KB 増えて、あっという間に数 MB になります。
 *
 * 合成の考え方は 2 つだけです。
 *
 *   打撃音（チップ・カード）… ノイズをフィルタで削り、数十ミリ秒で切る
 *   楽音（勝利・緊張）… 正弦波を重ね、エンベロープで包む
 *
 * 実際の効果音として「らしく」聞こえるかどうかは、波形よりも
 * **減衰の速さと、複数音を数ミリ秒ずらして重ねること**で決まります。
 * チップの音が 1 発だと安っぽく、3〜5 発ばらすと途端にチップらしくなります。
 *
 * ブラウザは操作前に音を鳴らすことを許さないので、
 * 最初のクリックまで AudioContext を作らず、作った後に resume します。
 */
export type SoundName = 'chip' | 'chipBig' | 'deal' | 'flip' | 'check' | 'fold' | 'call' | 'raise' | 'allIn' | 'tension' | 'reveal' | 'outHit' | 'win' | 'lose' | 'bust' | 'achieve' | 'click';
/** 画面を触った瞬間に鳴らせる状態にしておく */
export declare function unlockAudio(): void;
export declare function isMuted(): boolean;
export declare function setMuted(v: boolean): void;
export declare function play(name: SoundName): void;
export declare function stopTension(): void;
/** アクションの種類から鳴らす音を選ぶ */
export declare function playAction(action: string, allIn: boolean): void;
