/**
 * データが本当に残っているかを**実測**する(第167弾)。
 *
 * 設定の見た目だけを見ても足りない。POKER_DB を指していても、そのパスが
 * 永続ディスクの外だったり、マウントに失敗していれば毎回消える。
 * だから「起動のたびに印を1つ足し、前回の印が残っているか」を数える。
 * 何度再起動しても印が1のままなら、それが消えている動かぬ証拠になる。
 *
 * 2026-09-14 にこの検知が無かったせいで、100京を超える残高が
 * 誰にも気づかれずに消え続けていた。
 */
import type { Store } from './store.js';
export interface PersistenceStatus {
    /** 起動した回数(DBが残っていれば増える) */
    boots: number;
    /** 前回の印が残っていたか = データが実際に永続している */
    persisted: boolean;
    /** 永続化の設定がされているか(ディスク or GitHub保存) */
    configured: boolean;
    /** ホスティング上で動いているか */
    hosted: boolean;
    dbPath: string;
    /** 人の目で読む一行 */
    summary: string;
}
export declare function checkPersistence(store: Store, dbPath: string, env?: NodeJS.ProcessEnv): PersistenceStatus;
/** 消える設定のまま動いていたら、見逃しようのない大きさで警告する */
export declare function reportPersistence(st: PersistenceStatus): void;
