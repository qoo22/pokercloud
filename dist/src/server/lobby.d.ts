/**
 * ロビー：テーブル・トーナメント・経済のとりまとめと、メッセージのルーティング
 *
 * トランスポート（WebSocket）から切り離してあるので、テストでは偽の送信先を差して
 * ソケットを一切張らずにプロトコル全体を検証できる。
 * 実際のバグの大半はソケットではなくこの層に出るので、ここを高速にテストできることが重要。
 */
import { type Store } from './store.js';
import { Economy } from './economy.js';
import { Room, type TableConfig, type Scheduler } from './room.js';
import { Tournament, type TournamentConfig } from './tournament.js';
import { type ClientMessage, type ServerMessage } from './protocol.js';
export interface Transport {
    /** セッションへ 1 通送る。切断済みなら黙って捨ててよい */
    send(sessionId: string, msg: ServerMessage): void;
    /** サーバー側から接続を切る */
    close?(sessionId: string, reason: string): void;
}
export interface LobbyConfig {
    tables: TableConfig[];
    tournaments?: TournamentConfig[];
    /** 新規ユーザーへの初期付与 */
    signupBonus?: number;
    signupGold?: number;
    maxMessagesPerSecond?: number;
    store?: Store;
    /**
     * 再接続トークンの署名鍵。指定すると、トークンが「userId.HMAC署名」形式になり
     * サーバーを再起動してもログイン状態（＝残高）を引き継げる。
     * 未指定ならプロセス限りのランダム鍵（テスト用途）。
     */
    authSecret?: string;
}
export declare class Lobby {
    private transport;
    private clock;
    readonly store: Store;
    readonly economy: Economy;
    private rooms;
    /** プライベート卓（ロビー一覧に出さない） */
    private privateIds;
    /** 卓コード → tableId */
    private tableCodes;
    /** 招待コードの使用履歴（メモリ上。再起動でリセットされる点は HANDOFF 参照） */
    private redeemedCodes;
    private tournaments;
    /** 定期開催トーナメントの連番と、終了後の掃除予定時刻 */
    private tourSeq;
    private tourPruneAt;
    private sessions;
    private resumeTokens;
    private cfg;
    constructor(cfg: LobbyConfig, transport: Transport, clock?: Scheduler);
    private bank;
    private io;
    /**
     * 前回のプロセスが精算せずに落ちた席のチップを残高へ払い戻す(起動時に一度)。
     *
     * 座席はメモリ上のオブジェクトなので、再起動すると卓上のチップは消える。
     * バイインは永続残高から引き済みなので、放置するとプレイヤーの純損失になる
     * (「立ち上げたら残高が減っている」の原因)。open_seats に記録しておいた額をここで返す。
     * このプロセスで作った席はまだ1つも無いので、残っている行は全て前回ぶんと判断してよい。
     */
    private recoverOpenSeats;
    /**
     * 切断猶予を過ぎた席を定期的に精算する。
     * ハンド終了時(settle)だけに任せると、以後ハンドが始まらない卓
     * (相手が全員抜けた等)でチップが永久に戻らないため。
     */
    private startSeatSweeper;
    private sweepTimer;
    /**
     * 掃除タイマーを1本張る。
     * unref しておかないと、この繰り返しタイマーだけでイベントループが生き続け、
     * Lobby を dispose しないコード(テスト等)でプロセスが終われなくなる
     * (Gateway のハートビートが unref しているのと同じ理由)。
     */
    private arm;
    /** サーバー終了時に全卓を精算する(再デプロイでチップを卓に置き去りにしない) */
    cashOutAllTables(): void;
    /** 再接続トークンの署名鍵（cfg 未指定ならプロセス限り） */
    private get authKey();
    private authKeyCache;
    private signUserId;
    private makeResumeToken;
    /** 署名付きトークンを検証して userId を返す。改ざん・形式不正なら null */
    private verifyResumeToken;
    private createTournament;
    private startTourScheduler;
    /** ハンド結果を受けて、永続化・ミッション・パス経験値を進める */
    private onHandResult;
    getRoom(tableId: string): Room | undefined;
    listRooms(): Room[];
    listTournaments(): Tournament[];
    getTournament(id: string): Tournament | undefined;
    onConnect(sessionId: string): void;
    onDisconnect(sessionId: string): void;
    onRaw(sessionId: string, data: string): void;
    onMessage(sessionId: string, msg: ClientMessage): void;
    private shopView;
    private profileView;
    private sendProfile;
    private sendBalance;
    private sendToUser;
    private withRoom;
    private handleHello;
    private rateLimitOk;
    private err;
    /**
     * 監視用：全ユーザーの残高 + キャッシュ卓のチップ = 発行総量 になっているはず。
     *
     * トーナメント卓のスタックは意図的に含めない。あれは順位を決めるための点数であって通貨ではなく、
     * 通貨としての出入りは「参加費の徴収」と「賞金の支払い」だけで完結している。
     * ここを混ぜると、大会が始まるたびにチップが増えたように見えてしまう。
     */
    totalChips(): number;
    dispose(): void;
    get sessionCount(): number;
}
