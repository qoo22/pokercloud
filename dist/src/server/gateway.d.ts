/**
 * WebSocket ゲートウェイ（ws）
 *
 * この層の責務は「バイト列とセッション ID の対応づけ」だけに絞ってある。
 * ゲームのルールも、お金も、権限判定もここには書かない。
 * そうしておくと、Lobby 側をソケット無しでテストでき、
 * トランスポートを差し替えたくなったとき（WebTransport など）にも波及しない。
 *
 * ここで面倒を見るのは、通信層でしか起きない問題だけ：
 *   - 死んだ接続の掃除（ハートビート）
 *   - 巨大メッセージによるメモリ枯渇の防止
 *   - 送信キューが詰まった接続の切断
 */
import { Lobby, type LobbyConfig } from './lobby.js';
import { type Scheduler } from './room.js';
export interface GatewayOptions extends LobbyConfig {
    /** 台帳DBのパス。指定すると /admin/backup /admin/restore が有効になる */
    dbPath?: string;
    /** GitHubへの手動バックアップ実行(/admin/ghpush)。ghsync 参照 */
    ghPush?: () => Promise<string>;
    port?: number;
    /** 静的ファイルを配る場合のルート（動作確認クライアント用） */
    staticRoot?: string;
    /** 1 メッセージの最大バイト数 */
    maxMessageBytes?: number;
    /** ハートビート間隔 */
    heartbeatMs?: number;
    /** 送信バッファがこれを超えたら切断 */
    maxBufferedBytes?: number;
    clock?: Scheduler;
}
export declare class Gateway {
    readonly lobby: Lobby;
    private wss;
    private http;
    private sockets;
    private alive;
    private heartbeat;
    private readonly opts;
    constructor(options: GatewayOptions);
    /**
     * 応答の無い接続を掃除する。
     * TCP は切断を教えてくれないことがあり、これが無いと「座ったまま反応しない幽霊」が卓に残る。
     */
    private startHeartbeat;
    /**
     * 残高台帳のバックアップ/復元(手動運用)。
     * エフェメラルFSのクラウドで「再デプロイ前にDLして、デプロイ後に書き戻す」ための穴。
     * 鍵は resumeToken の署名鍵(POKER_SECRET)を流用する。
     *   バックアップ: GET  /admin/backup?key=<POKER_SECRET>   → poker.db がダウンロードされる
     *   復元        : POST /admin/restore?key=<POKER_SECRET>  (bodyにpoker.dbそのまま)
     *                 → 書き戻してプロセスを終了(ホスティング側が自動再起動して読み込む)
     */
    private serveAdmin;
    private serveStatic;
    listen(): Promise<number>;
    close(): Promise<void>;
}
