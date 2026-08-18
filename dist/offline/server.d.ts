/**
 * オフライン版：サーバーをブラウザの中で動かす
 *
 * 位置づけは「Render がスリープ中／落ちているときの受け皿」。
 * ネットワークを使わずに、あり版とまったく同じサーバーロジック
 * (Lobby / Room / Economy / Tournament / bots) をブラウザ内で走らせる。
 *
 * 仕掛けはひとつだけ:
 *   グローバルの WebSocket を「ループバック版」に差し替える。
 * クライアント(poker-client.html)も bots.ts も `new WebSocket(url)` で繋ぐので、
 * その口だけ挿げ替えれば、どちらのコードも 1 行も変えずにそのまま動く。
 * この方式なら、今後サーバー版を改良するとオフライン版にも自動で反映される
 * (機能ごとに移植して二重管理する必要がない)。
 *
 * 割り切っている点:
 *   - 対人対戦はできない(相手は bot)。
 *   - サーバーが権威ではないので、その気になればブラウザから残高を書き換えられる。
 *     オフライン専用なので実害は無いが、ランキング等はここでは作らない。
 *   - 保存先は端末の localStorage。JSON 1 塊なので、将来サーバーへ引き継ぐのも容易。
 */
/** セーブデータの書き出し/取り込み(将来サーバーへ引き継ぐための出口) */
export interface OfflineSave {
    export(): string;
    import(json: string): boolean;
    reset(): void;
}
export declare function startOfflineServer(): OfflineSave;
