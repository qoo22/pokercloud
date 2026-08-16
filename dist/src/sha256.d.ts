/**
 * SHA-256 と HMAC-SHA256（同期・依存ゼロ）
 *
 * なぜ自前実装なのか：
 *   ブラウザの Web Crypto（crypto.subtle）は非同期 API しか提供していない。
 *   一方 Provably Fair の検証は「プレイヤーが自分の手元で、同じコードを走らせて確認する」ことに
 *   意味があるため、サーバーとクライアントで完全に同一の実装を使いたい。
 *   Node の crypto と Web Crypto を条件分岐で使い分けると、その分岐自体が
 *   「実は違う計算をしているのでは」という疑いの余地になる。
 *   同期・単一実装にしておけば、検証コードをそのままプレイヤーに配布できる。
 *
 * 実装は FIPS 180-4 の規定どおり。既知のテストベクタで検証している（test/fair.test.ts）。
 */
/** SHA-256。入力・出力ともバイト列 */
export declare function sha256(message: Uint8Array): Uint8Array;
/** HMAC-SHA256（RFC 2104） */
export declare function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array;
export declare function bytesToHex(bytes: Uint8Array): string;
export declare function hexToBytes(hex: string): Uint8Array;
export declare function utf8ToBytes(s: string): Uint8Array;
/** 文字列を SHA-256 して 16 進で返す（コミットメント生成の実体） */
export declare function sha256Hex(input: string | Uint8Array): string;
/**
 * タイミング攻撃に強い文字列比較。
 * コミットメントの照合は本来サーバーの秘密に依存しないので必須ではないが、
 * 同じユーティリティを他の照合にも使い回せるよう用意しておく。
 */
export declare function timingSafeEqualHex(a: string, b: string): boolean;
