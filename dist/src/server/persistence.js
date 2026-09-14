/** 印を置く先。実在しないユーザーIDにして、人間のデータと混ぜない */
const SYS = '__system__';
const KEY_BOOTS = 'sys:boots';
export function checkPersistence(store, dbPath, env = process.env) {
    const hosted = !!(env.RENDER || env.RENDER_SERVICE_ID);
    const configured = !!env.POKER_DB || !!(env.POKER_GH_TOKEN && env.POKER_GH_REPO);
    let prev = 0;
    try {
        const row = store.getProgress(SYS, KEY_BOOTS);
        prev = row ? row.value : 0;
    }
    catch {
        prev = 0;
    }
    const boots = prev + 1;
    try {
        store.setProgress(SYS, KEY_BOOTS, boots, null);
    }
    catch {
        /* 書けないなら、そもそも保存されていない */
    }
    const persisted = prev > 0;
    const summary = persisted
        ? `データは残っています(起動 ${boots} 回目)`
        : boots === 1 && !hosted
            ? '初回起動です(ローカル)'
            : 'データが残っていません。再起動のたびに消えます';
    return { boots, persisted, configured, hosted, dbPath, summary };
}
/** 消える設定のまま動いていたら、見逃しようのない大きさで警告する */
export function reportPersistence(st) {
    if (st.persisted || (!st.hosted && st.boots === 1)) {
        console.log(`データ保存: ${st.summary} (${st.dbPath})`);
        return;
    }
    const line = '='.repeat(66);
    console.error(`\n${line}`);
    console.error('!! 危険: データが保存されていません');
    console.error(`   ${st.summary}`);
    console.error(`   DBの置き場: ${st.dbPath}`);
    console.error(`   永続化の設定: ${st.configured ? 'あり(効いていない可能性)' : 'なし'}`);
    console.error('   このまま運用すると、再起動・再デプロイのたびに残高が全部消えます。');
    console.error('   (A) Render の Persistent Disk を /var/data にマウントし');
    console.error('       POKER_DB=/var/data/poker.db を設定する');
    console.error('   (B) POKER_GH_TOKEN と POKER_GH_REPO を設定して GitHub に自動保存する');
    console.error(`${line}\n`);
}
//# sourceMappingURL=persistence.js.map