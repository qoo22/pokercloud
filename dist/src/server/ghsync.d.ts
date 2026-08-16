/**
 * GitHub リポジトリを「無料の永続ストレージ」として使う残高DBの自動バックアップ。
 *
 * 動作:
 *   起動時   … ローカルにDBが無ければ GitHub の backup/poker.db から復元
 *   5分ごと … DBのスナップショット(VACUUM INTO)を取り、変化があればプッシュ
 *   終了時   … SIGTERM/SIGINT で最後のプッシュを試みてから終了(再デプロイ時の取りこぼし防止)
 *
 * 設定(環境変数):
 *   POKER_GH_TOKEN  … GitHub のアクセストークン(対象リポジトリの Contents: Read and write)
 *   POKER_GH_REPO   … "ユーザー名/リポジトリ名"(プライベートリポジトリ推奨)
 *   POKER_GH_BRANCH … 省略時 main
 *
 * 未設定なら全機能が黙って無効になる(ローカル開発に影響なし)。
 */
import type { Store } from './store.js';
/** 起動時の復元。ローカルDBが既にあれば触らない(上書き事故防止) */
export declare function restoreFromGitHub(dbPath: string): Promise<void>;
/** スナップショットを取って GitHub へプッシュ。結果を文字列で返す(ログ/管理エンドポイント用) */
export declare function pushToGitHub(store: Store, dbPath: string): Promise<string>;
/** 定期バックアップ + botデータ掃除 + 終了時の駆け込みプッシュ */
export declare function startAutoBackup(store: Store, dbPath: string): void;
