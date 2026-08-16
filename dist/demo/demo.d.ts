/**
 * ブラウザ動作確認ビューア
 *
 * これは開発用のデバッグツールであり、製品の UI ではない。
 * 特に「全員の手札を表示」はサーバーが本来クライアントに送ってはいけない情報を
 * 意図的に表示している。製品では getStateFor(seat) の結果だけを送ること。
 */
import { type ActionType } from '../src/index.js';
declare global {
    interface Window {
        __newHand: () => void;
        __act: (a: ActionType) => void;
        __actRaise: () => void;
        __setRaise: (v: number) => void;
        __copyProof: () => void;
        __setBotDelay: (ms: number) => void;
    }
}
