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
const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
/** SHA-256。入力・出力ともバイト列 */
export function sha256(message) {
    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    // パディング：0x80 を足し、長さ(ビット, 64bit BE)が末尾に来るよう 0 で埋める
    const len = message.length;
    const bitLenHi = Math.floor((len / 0x20000000) | 0);
    const bitLenLo = (len << 3) >>> 0;
    // 「0x80 の 1 バイト + 長さ 8 バイト」が収まる最小の 64 バイト境界
    const totalLen = (((len + 8) >> 6) + 1) << 6;
    const buf = new Uint8Array(totalLen);
    buf.set(message);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(totalLen - 8, bitLenHi, false);
    dv.setUint32(totalLen - 4, bitLenLo, false);
    const w = new Uint32Array(64);
    for (let off = 0; off < totalLen; off += 64) {
        for (let i = 0; i < 16; i++)
            w[i] = dv.getUint32(off + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
            const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (let i = 0; i < 64; i++) {
            const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
            const ch = ((e & f) ^ (~e & g)) >>> 0;
            const temp1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
            const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
            const temp2 = (S0 + maj) >>> 0;
            hh = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }
        h[0] = (h[0] + a) >>> 0;
        h[1] = (h[1] + b) >>> 0;
        h[2] = (h[2] + c) >>> 0;
        h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0;
        h[5] = (h[5] + f) >>> 0;
        h[6] = (h[6] + g) >>> 0;
        h[7] = (h[7] + hh) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++)
        odv.setUint32(i * 4, h[i], false);
    return out;
}
const BLOCK_SIZE = 64;
/** HMAC-SHA256（RFC 2104） */
export function hmacSha256(key, message) {
    let k = key;
    if (k.length > BLOCK_SIZE)
        k = sha256(k);
    const ipad = new Uint8Array(BLOCK_SIZE);
    const opad = new Uint8Array(BLOCK_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i++) {
        const b = i < k.length ? k[i] : 0;
        ipad[i] = b ^ 0x36;
        opad[i] = b ^ 0x5c;
    }
    const inner = new Uint8Array(BLOCK_SIZE + message.length);
    inner.set(ipad);
    inner.set(message, BLOCK_SIZE);
    const innerHash = sha256(inner);
    const outer = new Uint8Array(BLOCK_SIZE + 32);
    outer.set(opad);
    outer.set(innerHash, BLOCK_SIZE);
    return sha256(outer);
}
// ---------------------------------------------------------------------------
// 変換ユーティリティ
// ---------------------------------------------------------------------------
const HEX = '0123456789abcdef';
export function bytesToHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
        s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
    }
    return s;
}
export function hexToBytes(hex) {
    const h = hex.trim().toLowerCase();
    if (h.length % 2 !== 0)
        throw new Error('16進文字列の長さが奇数です');
    if (!/^[0-9a-f]*$/.test(h))
        throw new Error('16進文字列に不正な文字が含まれています');
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++)
        out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
}
export function utf8ToBytes(s) {
    if (typeof TextEncoder !== 'undefined')
        return new TextEncoder().encode(s);
    // TextEncoder の無い環境向けの手動 UTF-8 エンコード
    const out = [];
    for (let i = 0; i < s.length; i++) {
        let c = s.codePointAt(i);
        if (c > 0xffff)
            i++;
        if (c < 0x80)
            out.push(c);
        else if (c < 0x800)
            out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000)
            out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else
            out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
}
/** 文字列を SHA-256 して 16 進で返す（コミットメント生成の実体） */
export function sha256Hex(input) {
    const bytes = typeof input === 'string' ? utf8ToBytes(input) : input;
    return bytesToHex(sha256(bytes));
}
/**
 * タイミング攻撃に強い文字列比較。
 * コミットメントの照合は本来サーバーの秘密に依存しないので必須ではないが、
 * 同じユーティリティを他の照合にも使い回せるよう用意しておく。
 */
export function timingSafeEqualHex(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
//# sourceMappingURL=sha256.js.map