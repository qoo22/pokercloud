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
import { Lobby } from '../src/server/lobby.js';
import { MemoryStore } from '../src/server/store.js';
import { setTuning, setBlueprint } from '../src/server/botgto.js';
import { startBots } from '../src/server/bots.js';
const SAVE_KEY = 'poker.offline.save.v1';
const SAVE_DEBOUNCE_MS = 1500;
/**
 * オフライン版の localStorage を丸ごと別名前空間へ隔離する。
 *
 * 【事故の再発防止】
 * オフライン版を本番と同じドメインに置いたことがあり、localStorage を共有した結果、
 * オフラインのブラウザ内サーバーが発行した resumeToken が `poker.resume` を上書きして、
 * オンラインの残高に戻れなくなった(鍵だけ失われ、アカウント自体はサーバーに残っていた)。
 *
 * 同一オリジンに置かないのが第一の対策だが、それだけに頼ると同じ事故を繰り返す。
 * ここでキーに接頭辞を付けておけば、仮に同じドメインに置かれても、
 * オンライン側の保存内容には一切触れない。
 */
function isolateStorage() {
    const PREFIX = 'offline:';
    let raw;
    try {
        raw = localStorage;
        raw.getItem('probe'); // アクセスできるかの確認(プライベートモード対策)
    }
    catch {
        return; // 使えない環境ではそのまま(保存は諦める)
    }
    const shim = {
        get length() { return raw.length; },
        key: (i) => raw.key(i),
        getItem: (k) => raw.getItem(PREFIX + k),
        setItem: (k, v) => raw.setItem(PREFIX + k, v),
        removeItem: (k) => raw.removeItem(PREFIX + k),
        clear: () => {
            // 自分の名前空間だけ消す。オンライン側の保存は残す
            const doomed = [];
            for (let i = 0; i < raw.length; i++) {
                const k = raw.key(i);
                if (k && k.startsWith(PREFIX))
                    doomed.push(k);
            }
            for (const k of doomed)
                raw.removeItem(k);
        },
    };
    try {
        Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true });
        Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
    }
    catch {
        // 差し替えできない環境では隔離できない。せめて分かるように残す
        console.warn('[offline] localStorage を隔離できませんでした。同一ドメインに本番を置かないこと');
    }
}
// ---------------------------------------------------------------------------
// 保存(localStorage)
// ---------------------------------------------------------------------------
/** 保存は書き込みのたびではなく、少し待ってまとめて行う(1ハンドで何度も動くため) */
function makeSaver(store) {
    let timer = null;
    return () => {
        if (timer)
            return;
        timer = setTimeout(() => {
            timer = null;
            try {
                localStorage.setItem(SAVE_KEY, store.serialize());
            }
            catch {
                // 容量超過などは致命的ではない。次の機会に再挑戦する
            }
        }, SAVE_DEBOUNCE_MS);
    };
}
/**
 * WebSocket の代わりに、同じプロセス内の Lobby へ直接メッセージを渡すハブ。
 * 送受信は必ず非同期(setTimeout 0)にする。同期で呼び返すと、
 * 送信元がまだ状態を更新し終える前に応答が届いて壊れることがあるため。
 */
class LoopbackHub {
    sockets = new Map();
    seq = 0;
    lobby;
    constructor(cfg) {
        const transport = {
            send: (sessionId, msg) => {
                const sock = this.sockets.get(sessionId);
                if (!sock?.onmessage)
                    return;
                const text = JSON.stringify(msg);
                setTimeout(() => sock.onmessage?.({ data: text }), 0);
            },
            close: (sessionId) => this.disconnect(sessionId),
        };
        this.lobby = new Lobby({
            tables: cfg.tables,
            tournaments: cfg.tournaments,
            store: cfg.store,
            // オフラインなので署名鍵は固定でよい(再接続トークンの整合だけ取れれば十分)
            authSecret: 'offline-local-secret-0000000000',
        }, transport);
        // 状態が動いたら保存する。Lobby からの通知は無いので、受信のたびに叩く
        this.onChange = cfg.onChange;
    }
    onChange;
    /** ソケットを登録して sessionId を返す(同期)。接続の通知は open() で別に行う */
    register(sock) {
        const sessionId = `off_${++this.seq}`;
        this.sockets.set(sessionId, sock);
        return sessionId;
    }
    /** Lobby へ接続を知らせる。呼ぶ側は先に readyState を OPEN にしておくこと */
    open(sessionId) {
        this.lobby.onConnect(sessionId);
    }
    recv(sessionId, text) {
        setTimeout(() => {
            try {
                this.lobby.onRaw(sessionId, text);
            }
            catch (e) {
                console.error('[offline] メッセージ処理で例外', e);
            }
            this.onChange();
        }, 0);
    }
    disconnect(sessionId) {
        const sock = this.sockets.get(sessionId);
        if (!sock)
            return;
        this.sockets.delete(sessionId);
        try {
            this.lobby.onDisconnect(sessionId);
        }
        catch { /* noop */ }
        setTimeout(() => sock.onclose?.(), 0);
        this.onChange();
    }
}
/** ブラウザの WebSocket と同じ形をした、ループバック用のソケット */
function makeWebSocketShim(hub) {
    class LoopbackWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        CONNECTING = 0;
        OPEN = 1;
        CLOSING = 2;
        CLOSED = 3;
        readyState = 0;
        bufferedAmount = 0;
        url;
        onopen = null;
        onmessage = null;
        onclose = null;
        onerror = null;
        sessionId;
        constructor(url) {
            this.url = String(url);
            this.sessionId = hub.register(this);
            // 接続完了は次tickで通知する。このとき順序が重要で、
            // onopen より先に readyState を OPEN にしておかないと、
            // onopen の中で送られる最初の hello が send() の判定で捨てられる。
            setTimeout(() => {
                this.readyState = 1;
                hub.open(this.sessionId);
                this.onopen?.();
            }, 0);
        }
        send(data) {
            if (this.readyState !== 1)
                return;
            hub.recv(this.sessionId, String(data));
        }
        close() {
            if (this.readyState === 3)
                return;
            this.readyState = 3;
            hub.disconnect(this.sessionId);
        }
        // クライアントは onX 形式しか使わないが、念のため最小限だけ用意する
        addEventListener(type, fn) {
            if (type === 'open')
                this.onopen = fn;
            else if (type === 'message')
                this.onmessage = fn;
            else if (type === 'close')
                this.onclose = fn;
            else if (type === 'error')
                this.onerror = fn;
        }
        removeEventListener() { }
    }
    return LoopbackWebSocket;
}
// ---------------------------------------------------------------------------
// 卓とトーナメントの構成(サーバー版 main.ts と同じ並び。金額もそのまま)
// ---------------------------------------------------------------------------
const TABLES = [
    { tableId: 'micro-5', name: 'マイクロ 5人卓', smallBlind: 25, bigBlind: 50, maxSeats: 5, rakePercent: 0 },
    { tableId: 'low-6', name: 'ロー 6人卓', smallBlind: 50, bigBlind: 100, maxSeats: 6, rakePercent: 0 },
    {
        tableId: 'straddle-6', name: 'ストラドル卓 6人', smallBlind: 50, bigBlind: 100, maxSeats: 6,
        rakePercent: 0.03, rakeCapBB: 3, straddleAllowed: true, maxStraddles: 2,
    },
    { tableId: 'mid-9', name: 'ミドル 9人卓', smallBlind: 250, bigBlind: 500, maxSeats: 9, rakePercent: 0.03, rakeCapBB: 3 },
    { tableId: 'high-6', name: 'ハイ 6人卓', smallBlind: 1000, bigBlind: 2000, maxSeats: 6, rakePercent: 0.04, rakeCapBB: 4 },
    { tableId: 'hr-6', name: 'ハイローラー', smallBlind: 5_000_000, bigBlind: 10_000_000, maxSeats: 6, rakePercent: 0.04, rakeCapBB: 4 },
    { tableId: 'whale-6', name: 'クジラ卓', smallBlind: 25_000_000, bigBlind: 50_000_000, maxSeats: 6, rakePercent: 0.04, rakeCapBB: 4 },
    { tableId: 'legend-6', name: 'レジェンド', smallBlind: 250_000_000, bigBlind: 500_000_000, maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5 },
    { tableId: 'mil-6', name: 'ミリオネア', smallBlind: 2_500_000_000, bigBlind: 5_000_000_000, maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5 },
    { tableId: 'bil-6', name: 'ビリオネア', smallBlind: 25_000_000_000, bigBlind: 50_000_000_000, maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5 },
    { tableId: 'titan-6', name: 'タイタン', smallBlind: 250_000_000_000, bigBlind: 500_000_000_000, maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5 },
    { tableId: 'gods-9', name: '神々の卓', smallBlind: 1_250_000_000_000, bigBlind: 2_500_000_000_000, maxSeats: 9, rakePercent: 0.05, rakeCapBB: 5 },
];
const TOURNAMENTS = [
    { tournamentId: 'sng-3', name: 'ターボ SNG（3人）', type: 'sng', buyIn: 2_000, fee: 200, startingStack: 3_000, seatsPerTable: 3, maxPlayers: 3, levelDurationMs: 90_000 },
    { tournamentId: 'sng-6', name: 'SNG（6人）', type: 'sng', buyIn: 5_000, fee: 500, startingStack: 5_000, seatsPerTable: 6, maxPlayers: 6, levelDurationMs: 180_000 },
    {
        tournamentId: 'ko-6', name: 'ノックアウト SNG（6人）', type: 'sng', buyIn: 3_000, fee: 300,
        startingStack: 5_000, seatsPerTable: 6, maxPlayers: 6, levelDurationMs: 120_000,
        speed: 'turbo', bounty: { mode: 'classic', perEntry: 2_000 },
    },
    {
        tournamentId: 'pko-9', name: 'PKO（プログレッシブ・ノックアウト）', type: 'mtt', buyIn: 5_000, fee: 500,
        startingStack: 10_000, seatsPerTable: 6, maxPlayers: 45, minPlayers: 6, levelDurationMs: 180_000,
        lateRegMs: 600_000, reEntryMax: 1, addOn: { price: 5_000, chips: 10_000 },
        bounty: { mode: 'progressive', perEntry: 5_000, progressiveSplit: 0.5 },
    },
    {
        tournamentId: 'mystery-45', name: 'ミステリーバウンティ', type: 'mtt', buyIn: 7_000, fee: 700,
        startingStack: 12_000, seatsPerTable: 6, maxPlayers: 45, minPlayers: 6, levelDurationMs: 180_000,
        lateRegMs: 600_000, reEntryMax: 2,
        bounty: { mode: 'mystery', perEntry: 3_000, mysteryActivationRatio: 0.15 },
    },
    {
        tournamentId: 'mtt-daily', name: 'デイリー MTT', type: 'mtt', buyIn: 10_000, fee: 1_000,
        startingStack: 10_000, seatsPerTable: 6, maxPlayers: 90, minPlayers: 6, levelDurationMs: 300_000, lateRegMs: 600_000,
    },
    { tournamentId: 'hr-sng', name: 'ハイローラー SNG', type: 'sng', buyIn: 1_000_000_000, fee: 100_000_000, startingStack: 10_000, seatsPerTable: 6, maxPlayers: 6, levelDurationMs: 180_000 },
    { tournamentId: 'titan-cup', name: 'タイタン選手権', type: 'sng', buyIn: 10_000_000_000_000, fee: 1_000_000_000_000, startingStack: 20_000, seatsPerTable: 6, maxPlayers: 6, levelDurationMs: 240_000 },
    {
        tournamentId: 'main-event', name: 'メインイベント 〜神々の祭典〜', type: 'mtt',
        buyIn: 50_000_000_000_000, fee: 5_000_000_000_000, startingStack: 60_000,
        seatsPerTable: 9, maxPlayers: 45, minPlayers: 6, levelDurationMs: 300_000, lateRegMs: 600_000, reEntryMax: 1,
    },
];
// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
export function startOfflineServer() {
    // 何よりも先に保存領域を隔離する。クライアントが動き出す前でないと意味がない
    isolateStorage();
    // 学習成果を反映(あり版は起動時にファイルから読むが、こちらは埋め込み済み)
    try {
        if (__TUNED_PARAMS__?.params)
            setTuning(__TUNED_PARAMS__.params);
    }
    catch { /* 既定値のまま */ }
    try {
        if (__FLOP_BLUEPRINT__)
            setBlueprint(__FLOP_BLUEPRINT__);
    }
    catch { /* 表なしでも動く */ }
    const store = new MemoryStore();
    const saved = (() => { try {
        return localStorage.getItem(SAVE_KEY);
    }
    catch {
        return null;
    } })();
    if (saved)
        store.restore(saved);
    const save = makeSaver(store);
    const hub = new LoopbackHub({ tables: TABLES, tournaments: TOURNAMENTS, store, onChange: save });
    // クライアントと bots の両方がこれを使う。差し替えはここ 1 箇所だけ
    globalThis.WebSocket = makeWebSocketShim(hub);
    // 常駐 bot を起動する。bots.ts はサーバーへ WS で繋ぐ普通のクライアントなので、
    // 上で差し替えた WebSocket を通じてそのまま同じ卓に座ってくれる。
    // URL は使われないが、形式だけ合わせておく。
    try {
        startBots('ws://offline/');
    }
    catch (e) {
        console.warn('[offline] bot を開始できませんでした', e);
    }
    // 離脱時に取りこぼさないよう、最後にもう一度だけ保存する
    addEventListener('pagehide', () => {
        try {
            localStorage.setItem(SAVE_KEY, store.serialize());
        }
        catch { /* noop */ }
    });
    return {
        export: () => store.serialize(),
        import: (json) => {
            const ok = store.restore(json);
            if (ok) {
                try {
                    localStorage.setItem(SAVE_KEY, store.serialize());
                }
                catch { /* noop */ }
            }
            return ok;
        },
        reset: () => {
            try {
                localStorage.removeItem(SAVE_KEY);
            }
            catch { /* noop */ }
        },
    };
}
//# sourceMappingURL=server.js.map