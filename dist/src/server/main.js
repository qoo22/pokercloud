/**
 * 開発用サーバーの起動スクリプト
 *
 *   npm run server
 *   → http://localhost:8787 をブラウザで開く
 *
 * データは SQLite（poker.db）に保存されるので、サーバーを再起動しても
 * 残高・VIP・パス進捗・購入履歴・ハンド履歴が残ります。
 * まっさらから始めたいときは poker.db を削除してください。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Gateway } from './gateway.js';
import { SqliteStore, MemoryStore } from './store.js';
import { restoreFromGitHub, startAutoBackup, pushToGitHub, bandwidthToday } from './ghsync.js';
const here = dirname(fileURLToPath(import.meta.url));
// クライアント HTML の置き場。
// 既定はローカル開発向けで dist/src/server → outputs 直下。
// クラウドにデプロイするときは POKER_STATIC_ROOT に poker-client.html のあるフォルダを
// 指定する（例: カレントディレクトリからの相対で "public"）。
const staticRoot = process.env.POKER_STATIC_ROOT
    ? resolve(process.env.POKER_STATIC_ROOT)
    : resolve(here, '../../../..');
const dbPath = process.env.POKER_DB ?? resolve(here, '../../../poker.db');
// 再接続トークンの署名鍵。ファイルに永続化することで、サーバーを再起動しても
// クライアントの resumeToken が有効なまま＝残高が引き継がれる
const secretPath = process.env.POKER_SECRET_FILE ?? resolve(here, '../../../poker.secret');
// 環境変数 POKER_SECRET が最優先。ファイルを保存できないクラウド(エフェメラルFS)でも
// 環境変数は再起動・再デプロイをまたいで保持されるため、ログイン(resumeToken)が無効化されない
let authSecret = (process.env.POKER_SECRET ?? '').trim();
try {
    if (authSecret.length < 16 && existsSync(secretPath))
        authSecret = readFileSync(secretPath, 'utf8').trim();
    if (authSecret.length < 16) {
        authSecret = Array.from(crypto.getRandomValues(new Uint8Array(24)))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        writeFileSync(secretPath, authSecret, { mode: 0o600 });
    }
}
catch (e) {
    console.warn('署名鍵ファイルを扱えないため、ログイン維持は今回のプロセス限りです:', e.message);
}
// 仕様書のブラインド階段 Lv1〜6 に対応
const tables = [
    { tableId: 'micro-5', name: 'マイクロ 5人卓', smallBlind: 25, bigBlind: 50, maxSeats: 5, rakePercent: 0 },
    { tableId: 'low-6', name: 'ロー 6人卓', smallBlind: 50, bigBlind: 100, maxSeats: 6, rakePercent: 0 },
    {
        tableId: 'straddle-6',
        name: 'ストラドル卓 6人',
        smallBlind: 50,
        bigBlind: 100,
        maxSeats: 6,
        rakePercent: 0.03,
        rakeCapBB: 3,
        straddleAllowed: true,
        maxStraddles: 2,
    },
    { tableId: 'mid-9', name: 'ミドル 9人卓', smallBlind: 250, bigBlind: 500, maxSeats: 9, rakePercent: 0.03, rakeCapBB: 3 },
    { tableId: 'high-6', name: 'ハイ 6人卓', smallBlind: 1000, bigBlind: 2000, maxSeats: 6, rakePercent: 0.04, rakeCapBB: 4 },
    // ここから高額ステークス（参考アプリのステークス階段。最上位はバイイン 50T〜250T）
    { tableId: 'hr-6', name: 'ハイローラー', smallBlind: 5_000_000, bigBlind: 10_000_000, maxSeats: 6, rakePercent: 0.04, rakeCapBB: 4 },
    { tableId: 'whale-6', name: 'クジラ卓', smallBlind: 25_000_000, bigBlind: 50_000_000, maxSeats: 6, rakePercent: 0.04, rakeCapBB: 4 },
    { tableId: 'legend-6', name: 'レジェンド', smallBlind: 250_000_000, bigBlind: 500_000_000, maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5 },
    { tableId: 'mil-6', name: 'ミリオネア', smallBlind: 2_500_000_000, bigBlind: 5_000_000_000, maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5 },
    { tableId: 'bil-6', name: 'ビリオネア', smallBlind: 25_000_000_000, bigBlind: 50_000_000_000, maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5 },
    { tableId: 'titan-6', name: 'タイタン', smallBlind: 250_000_000_000, bigBlind: 500_000_000_000, maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5 },
    { tableId: 'gods-9', name: '神々の卓', smallBlind: 1_250_000_000_000, bigBlind: 2_500_000_000_000, maxSeats: 9, rakePercent: 0.05, rakeCapBB: 5 },
    // --- 秘密卓(第150弾) ---
    // secretUnlockAt のチップを持って初めて**存在が見える**。持っていない人には
    // ロビー一覧にも出ないし、卓IDを当てても着席・観戦できない(サーバーで弾く)。
    // バイインは 20BB〜100BB なので 極 は 10京〜50京
    {
        tableId: 'abyss-6', name: '深淵の卓',
        smallBlind: 25_000_000_000_000, bigBlind: 50_000_000_000_000, // 50兆
        maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5,
        secretUnlockAt: 1_000_000_000_000_000, // 1000兆
    },
    {
        tableId: 'cosmos-6', name: '天上の卓',
        smallBlind: 250_000_000_000_000, bigBlind: 500_000_000_000_000, // 500兆
        maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5,
        secretUnlockAt: 10_000_000_000_000_000, // 1京
    },
    {
        tableId: 'zenith-6', name: '極 -きわみ-',
        smallBlind: 2_500_000_000_000_000, bigBlind: 5_000_000_000_000_000, // 5000兆
        maxSeats: 6, rakePercent: 0.05, rakeCapBB: 5,
        secretUnlockAt: 100_000_000_000_000_000, // 10京(最小バイインと同じ)
    },
];
const tournaments = [
    {
        tournamentId: 'sng-3',
        name: 'ターボ SNG（3人）',
        type: 'sng',
        buyIn: 2_000,
        fee: 200,
        startingStack: 3_000,
        seatsPerTable: 3,
        maxPlayers: 3,
        levelDurationMs: 90_000,
    },
    {
        tournamentId: 'sng-6',
        name: 'SNG（6人）',
        type: 'sng',
        buyIn: 5_000,
        fee: 500,
        startingStack: 5_000,
        seatsPerTable: 6,
        maxPlayers: 6,
        levelDurationMs: 180_000,
    },
    {
        tournamentId: 'ko-6',
        name: 'ノックアウト SNG（6人）',
        type: 'sng',
        buyIn: 3_000,
        fee: 300,
        startingStack: 5_000,
        seatsPerTable: 6,
        maxPlayers: 6,
        levelDurationMs: 120_000,
        speed: 'turbo',
        bounty: { mode: 'classic', perEntry: 2_000 },
    },
    {
        tournamentId: 'pko-9',
        name: 'PKO（プログレッシブ・ノックアウト）',
        type: 'mtt',
        buyIn: 5_000,
        fee: 500,
        startingStack: 10_000,
        seatsPerTable: 6,
        maxPlayers: 45,
        minPlayers: 6,
        levelDurationMs: 180_000,
        lateRegMs: 600_000,
        reEntryMax: 1,
        addOn: { price: 5_000, chips: 10_000 },
        bounty: { mode: 'progressive', perEntry: 5_000, progressiveSplit: 0.5 },
    },
    {
        tournamentId: 'mystery-45',
        name: 'ミステリーバウンティ',
        type: 'mtt',
        buyIn: 7_000,
        fee: 700,
        startingStack: 12_000,
        seatsPerTable: 6,
        maxPlayers: 45,
        minPlayers: 6,
        levelDurationMs: 180_000,
        lateRegMs: 600_000,
        reEntryMax: 2,
        // WSOP と同じく、残り 15% になってから封筒が有効になる
        bounty: { mode: 'mystery', perEntry: 3_000, mysteryActivationRatio: 0.15 },
    },
    {
        tournamentId: 'mtt-daily',
        name: 'デイリー MTT',
        type: 'mtt',
        buyIn: 10_000,
        fee: 1_000,
        startingStack: 10_000,
        seatsPerTable: 6,
        maxPlayers: 90,
        minPlayers: 6,
        levelDurationMs: 300_000,
        lateRegMs: 600_000,
    },
    // ここから高額トーナメント（優勝ブレスレットの格もここで上がる）
    {
        tournamentId: 'hr-sng',
        name: 'ハイローラー SNG',
        type: 'sng',
        buyIn: 1_000_000_000,
        fee: 100_000_000,
        startingStack: 10_000,
        seatsPerTable: 6,
        maxPlayers: 6,
        levelDurationMs: 180_000,
    },
    {
        tournamentId: 'titan-cup',
        name: 'タイタン選手権',
        type: 'sng',
        buyIn: 10_000_000_000_000,
        fee: 1_000_000_000_000,
        startingStack: 20_000,
        seatsPerTable: 6,
        maxPlayers: 6,
        levelDurationMs: 240_000,
    },
    {
        tournamentId: 'main-event',
        name: 'メインイベント 〜神々の祭典〜',
        type: 'mtt',
        buyIn: 50_000_000_000_000,
        fee: 5_000_000_000_000,
        startingStack: 60_000,
        seatsPerTable: 9,
        maxPlayers: 45,
        minPlayers: 6,
        levelDurationMs: 300_000,
        lateRegMs: 600_000,
        reEntryMax: 1,
    },
];
// GitHub自動バックアップが設定されていれば、DBを開く前に最新バックアップを復元
await restoreFromGitHub(dbPath);
let store;
try {
    store = await SqliteStore.open(dbPath);
    console.log(`データベース: ${dbPath}`);
}
catch (e) {
    // node:sqlite が使えない環境ではメモリ実装に落とす（再起動でデータは消える）
    console.warn(`SQLite を開けませんでした（${e.message}）。メモリ上で動かします。`);
    store = new MemoryStore();
}
const port = Number(process.env.PORT ?? 8787);
const gateway = new Gateway({
    tables, tournaments, port, staticRoot, store, authSecret, dbPath,
    ghPush: () => pushToGitHub(store, dbPath),
    bandwidthToday,
});
const actual = await gateway.listen();
startAutoBackup(store, dbPath);
console.log(`ポーカーサーバーを起動しました`);
console.log(`  クライアント : http://localhost:${actual}/poker-client.html`);
console.log(`  WebSocket    : ws://localhost:${actual}`);
console.log(`  キャッシュ卓 : ${tables.map((t) => `${t.name}(${t.smallBlind}/${t.bigBlind})`).join(', ')}`);
console.log(`  トーナメント : ${tournaments.map((t) => t.name).join(', ')}`);
console.log(`\n2 人以上で遊ぶには、同じ URL を別タブでもう一枚開いてください。`);
console.log(`停止するには Ctrl+C`);
// 常駐ボット（人間っぽく出入りする）。POKER_BOTS=off で無効化
if (process.env.POKER_BOTS !== 'off') {
    try {
        const { startBots } = await import('./bots.js');
        startBots(`ws://127.0.0.1:${actual}`);
        console.log(`  ボット       : 稼働中（人数は時間でゆらぎます。POKER_BOTS=off で無効化）`);
    }
    catch (e) {
        console.warn('ボットを開始できませんでした:', e.message);
    }
}
const shutdown = async () => {
    console.log('\n終了処理中...');
    // 卓に残っているチップを先に残高へ戻す。座席はメモリ上にしか無いので、
    // ここで精算しないと再デプロイのたびにプレイヤーのチップが卓ごと消える
    try {
        gateway.lobby.cashOutAllTables();
    }
    catch (e) {
        console.warn('卓の精算に失敗しました:', e.message);
    }
    await gateway.close();
    store.close();
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
//# sourceMappingURL=main.js.map