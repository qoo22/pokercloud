/**
 * サーバーテスト用のハーネス
 *
 * ソケットを一切張らずに Lobby の全機能を叩けるようにする。
 * 実時間も使わない（仮想時計）。おかげでタイムアウト絡みのテストが 15 秒待たずに書ける。
 */
import { Lobby, type LobbyConfig } from '../../src/server/lobby.js';
import type { Scheduler } from '../../src/server/room.js';
import type { ClientMessage, ServerMessage, TableStateView, HandSummary } from '../../src/server/protocol.js';
/** 仮想時計。advance() で好きなだけ時間を進められる */
export declare class VirtualClock implements Scheduler {
    private t;
    private seq;
    private items;
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    /** ms 分だけ進め、その間に期限が来たタイマーを順に発火させる */
    advance(ms: number): void;
    get pendingCount(): number;
}
export type BotStyle = 'passive' | 'aggressive' | 'allin';
export interface TestClient {
    sessionId: string;
    received: ServerMessage[];
    userId: string;
    resumeToken: string;
    balance: number;
    send(msg: ClientMessage): void;
    /** 最後に受け取ったテーブル状態 */
    state(): TableStateView | null;
    /** 最後に受け取ったエラー */
    lastError(): Extract<ServerMessage, {
        t: 'error';
    }> | null;
    errors(): Array<Extract<ServerMessage, {
        t: 'error';
    }>>;
    results(): HandSummary[];
    clear(): void;
}
export declare class Harness {
    readonly lobby: Lobby;
    readonly clock: VirtualClock;
    private clients;
    private nextId;
    /** 自動応答（ボット）が積んだアクション。再入を避けるためキューに溜めて後で流す */
    private pending;
    private autoPlay;
    constructor(cfg: LobbyConfig);
    connect(name?: string): TestClient;
    /** hello まで済ませた接続を作る */
    login(name: string, userId?: string): TestClient;
    disconnect(c: TestClient): void;
    /** この接続を自動プレイにする（常に一番安い合法手を選ぶ） */
    enableBot(c: TestClient, style?: BotStyle): void;
    private botStyle;
    private reactAsBot;
    /**
     * 溜まったボットのアクションを流しつつ時間を進める。
     * 送信の中から同期的にアクションを返すと再入で状態が壊れるので、必ずここで一段ずらす。
     */
    pump(ms?: number): void;
    /** 指定ハンド数が終わるまで回す。戻り値は実際に完了したハンド数 */
    runHands(count: number, stepMs?: number, maxSteps?: number): number;
    /**
     * 完了したハンドの ID 集合。
     * hand.result は着席者全員に届くので、単純に受信数を数えると
     * 「2 人卓で 1 ハンド = 2 件」となって数え違える。ID で重複を排除する。
     */
    private completedHandIds;
    private newHandCount;
    dispose(): void;
}
