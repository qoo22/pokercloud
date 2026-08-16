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
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Lobby } from './lobby.js';
import { realScheduler } from './room.js';
import { randomSeedHex } from '../fair.js';
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};
export class Gateway {
    lobby;
    wss;
    http;
    sockets = new Map();
    alive = new Map();
    heartbeat = null;
    opts;
    constructor(options) {
        this.opts = {
            port: 8787,
            maxMessageBytes: 16 * 1024,
            heartbeatMs: 20000,
            maxBufferedBytes: 1024 * 1024,
            signupBonus: 50000,
            signupGold: 100,
            maxMessagesPerSecond: 20,
            ...options,
        };
        const transport = {
            send: (sessionId, msg) => {
                const ws = this.sockets.get(sessionId);
                if (!ws || ws.readyState !== WebSocket.OPEN)
                    return;
                // 送信が追いつかない接続は切る。放置するとサーバーのメモリを食い潰す
                if (ws.bufferedAmount > this.opts.maxBufferedBytes) {
                    ws.close(1013, 'send buffer overflow');
                    return;
                }
                ws.send(JSON.stringify(msg));
            },
            close: (sessionId, reason) => {
                this.sockets.get(sessionId)?.close(1002, reason);
            },
        };
        this.lobby = new Lobby({
            tables: options.tables,
            tournaments: options.tournaments,
            store: options.store,
            signupBonus: this.opts.signupBonus,
            signupGold: this.opts.signupGold,
            maxMessagesPerSecond: this.opts.maxMessagesPerSecond,
            authSecret: options.authSecret,
        }, transport, options.clock ?? realScheduler);
        this.http = createServer((req, res) => this.serveStatic(req, res));
        this.wss = new WebSocketServer({ server: this.http, maxPayload: this.opts.maxMessageBytes });
        this.wss.on('connection', (ws) => {
            const sessionId = `s_${randomSeedHex(8)}`;
            this.sockets.set(sessionId, ws);
            this.alive.set(sessionId, true);
            this.lobby.onConnect(sessionId);
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    ws.close(1003, 'binary not supported');
                    return;
                }
                const text = data.toString();
                if (text.length > this.opts.maxMessageBytes) {
                    ws.close(1009, 'message too large');
                    return;
                }
                try {
                    this.lobby.onRaw(sessionId, text);
                }
                catch (e) {
                    // 1 人の異常系で全員を巻き込まない
                    console.error('[gateway] メッセージ処理で例外', e);
                }
            });
            ws.on('pong', () => this.alive.set(sessionId, true));
            ws.on('close', () => {
                this.sockets.delete(sessionId);
                this.alive.delete(sessionId);
                this.lobby.onDisconnect(sessionId);
            });
            ws.on('error', () => {
                // close が続けて飛ぶので、ここでは握りつぶす
            });
        });
    }
    /**
     * 応答の無い接続を掃除する。
     * TCP は切断を教えてくれないことがあり、これが無いと「座ったまま反応しない幽霊」が卓に残る。
     */
    startHeartbeat() {
        this.heartbeat = setInterval(() => {
            for (const [sessionId, ws] of this.sockets) {
                if (this.alive.get(sessionId) === false) {
                    ws.terminate();
                    continue;
                }
                this.alive.set(sessionId, false);
                if (ws.readyState === WebSocket.OPEN)
                    ws.ping();
            }
        }, this.opts.heartbeatMs);
        this.heartbeat.unref?.();
    }
    /**
     * 残高台帳のバックアップ/復元(手動運用)。
     * エフェメラルFSのクラウドで「再デプロイ前にDLして、デプロイ後に書き戻す」ための穴。
     * 鍵は resumeToken の署名鍵(POKER_SECRET)を流用する。
     *   バックアップ: GET  /admin/backup?key=<POKER_SECRET>   → poker.db がダウンロードされる
     *   復元        : POST /admin/restore?key=<POKER_SECRET>  (bodyにpoker.dbそのまま)
     *                 → 書き戻してプロセスを終了(ホスティング側が自動再起動して読み込む)
     */
    serveAdmin(req, res, path) {
        const key = new URL(req.url ?? '/', 'http://x').searchParams.get('key') ?? '';
        const secret = this.opts.authSecret ?? '';
        const db = this.opts.dbPath;
        if (!db || secret.length < 16 || key !== secret) {
            res.writeHead(403).end('forbidden');
            return;
        }
        if (path === '/admin/backup' && req.method === 'GET') {
            try {
                const body = readFileSync(db);
                res.writeHead(200, {
                    'content-type': 'application/octet-stream',
                    'content-disposition': 'attachment; filename="poker.db"',
                });
                res.end(body);
            }
            catch {
                res.writeHead(500).end('no db');
            }
            return;
        }
        if (path === '/admin/ghpush' && req.method === 'GET') {
            const fn = this.opts.ghPush;
            if (!fn) {
                res.writeHead(500).end('ghPush 未設定');
                return;
            }
            fn().then((r) => res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(`GitHubバックアップ: ${r}`))
                .catch((e) => res.writeHead(500).end(String(e)));
            return;
        }
        // 当日の外部送信量(GitHubバックアップ)を確認する。秘密情報は含まない
        if (path === '/admin/bandwidth' && req.method === 'GET') {
            const fn = this.opts.bandwidthToday;
            if (!fn) {
                res.writeHead(500).end('bandwidth 未設定');
                return;
            }
            const b = fn();
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
                .end(`GitHub送信量 (${b.day} UTC): ${(b.bytes / 1024).toFixed(1)}KB / ${b.pushes}回`);
            return;
        }
        if (path === '/admin/restore' && req.method === 'POST') {
            const chunks = [];
            let size = 0;
            req.on('data', (c) => {
                size += c.length;
                if (size > 200 * 1024 * 1024)
                    req.destroy();
                else
                    chunks.push(c);
            });
            req.on('end', () => {
                try {
                    writeFileSync(db + '.restore', Buffer.concat(chunks));
                    renameSync(db + '.restore', db);
                    rmSync(db + '-wal', { force: true });
                    rmSync(db + '-shm', { force: true });
                    res.writeHead(200).end('restored — restarting server');
                    setTimeout(() => process.exit(0), 300);
                }
                catch {
                    res.writeHead(500).end('restore failed');
                }
            });
            return;
        }
        res.writeHead(405).end('method not allowed');
    }
    serveStatic(req, res) {
        const adminPath = (req.url ?? '/').split('?')[0];
        if (adminPath === '/admin/backup' || adminPath === '/admin/restore' || adminPath === '/admin/ghpush') {
            this.serveAdmin(req, res, adminPath);
            return;
        }
        const root = this.opts.staticRoot;
        if (!root) {
            res.writeHead(404).end('not found');
            return;
        }
        const urlPath = (req.url ?? '/').split('?')[0];
        const rel = urlPath === '/' ? '/poker-client.html' : urlPath;
        // パストラバーサル対策。normalize したあとに .. が残っていたら拒否
        const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
        if (safe.includes('..')) {
            res.writeHead(400).end('bad path');
            return;
        }
        const file = join(root, safe);
        if (!file.startsWith(normalize(root)) || !existsSync(file)) {
            res.writeHead(404).end('not found');
            return;
        }
        try {
            const body = readFileSync(file);
            res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
            res.end(body);
        }
        catch {
            res.writeHead(500).end('error');
        }
    }
    listen() {
        return new Promise((resolve) => {
            this.http.listen(this.opts.port, () => {
                this.startHeartbeat();
                const addr = this.http.address();
                const port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
                resolve(port);
            });
        });
    }
    async close() {
        if (this.heartbeat)
            clearInterval(this.heartbeat);
        for (const ws of this.sockets.values())
            ws.terminate();
        this.lobby.dispose();
        await new Promise((r) => this.wss.close(() => r()));
        await new Promise((r) => this.http.close(() => r()));
    }
}
//# sourceMappingURL=gateway.js.map