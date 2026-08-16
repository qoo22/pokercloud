/**
 * カードとデッキ
 *
 * カードは 0〜51 の整数で表現する。
 *   card = (rank - 2) * 4 + suitIndex
 *   rank: 2〜14（14 = A）
 *   suit: 0=s(スペード) 1=h(ハート) 2=d(ダイヤ) 3=c(クラブ)
 *
 * 整数表現にしているのは、比較・ソート・集合演算がすべて O(1) の整数演算で済み、
 * 大量のハンドをシミュレーションするときに GC 負荷が出ないため。
 */
export const SUIT_CHARS = ['s', 'h', 'd', 'c'];
export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
export function rankOf(card) {
    return (card >> 2) + 2;
}
export function suitOf(card) {
    return card & 3;
}
export function makeCard(rank, suit) {
    return (rank - 2) * 4 + suit;
}
/** "As" "Th" "2c" のような文字列に変換 */
export function cardToString(card) {
    return RANK_CHARS[rankOf(card) - 2] + SUIT_CHARS[suitOf(card)];
}
/** "♠A" のような表示用文字列 */
export function cardToDisplay(card) {
    return SUIT_SYMBOLS[suitOf(card)] + RANK_CHARS[rankOf(card) - 2];
}
/** "As" 形式の文字列をパース。テストとデバッグ用 */
export function parseCard(s) {
    const r = RANK_CHARS.indexOf(s[0].toUpperCase());
    const u = SUIT_CHARS.indexOf(s[1].toLowerCase());
    if (r < 0 || u < 0)
        throw new Error(`不正なカード表記: ${s}`);
    return makeCard(r + 2, u);
}
/** "As Kd Qh" のようなスペース区切り文字列をパース */
export function parseCards(s) {
    return s.trim().split(/\s+/).map(parseCard);
}
export function freshDeck() {
    const deck = new Array(52);
    for (let i = 0; i < 52; i++)
        deck[i] = i;
    return deck;
}
/**
 * 本番用。OS の CSPRNG を使い、剰余バイアスを棄却サンプリングで除去する。
 *
 * getRandomValues() は 1 回あたり十数マイクロ秒かかる。1 シャッフルで 51 回呼ぶと
 * 実測で 1 ハンドあたり 0.6ms 前後を消費し、数千卓を捌くサーバーでは無視できない。
 * そこでまとまったバイト列を一度に取得してプールから消費する。
 * プールの中身は CSPRNG の出力そのままで、使い回しもしないので安全性は落ちない。
 */
export function createSecureRng(poolBytes = 4096) {
    if (typeof globalThis.crypto?.getRandomValues !== 'function') {
        throw new Error('CSPRNG が利用できません。Node.js 19 以上、または Web Crypto 対応ブラウザで実行してください。');
    }
    const pool = new Uint8Array(poolBytes - (poolBytes % 4));
    let offset = pool.length; // 初回は必ず補充させる
    const next32 = () => {
        if (offset >= pool.length) {
            globalThis.crypto.getRandomValues(pool);
            offset = 0;
        }
        const v = ((pool[offset] << 24) >>> 0) + (pool[offset + 1] << 16) + (pool[offset + 2] << 8) + pool[offset + 3];
        offset += 4;
        return v;
    };
    return {
        randomInt(n) {
            if (n <= 0)
                throw new Error('n は 1 以上である必要があります');
            if (n === 1)
                return 0;
            // 2^32 を n で割った余りの部分を棄却して一様性を保つ
            const limit = Math.floor(0x100000000 / n) * n;
            for (;;) {
                const v = next32();
                if (v < limit)
                    return v % n;
            }
        },
    };
}
/**
 * 決定論的な乱数源（xoshiro128**）。
 * テストの再現性と、Provably Fair（シード公開による検証）に使う。
 * 本番のシャッフルには単独では使わず、必ず CSPRNG 由来のシードを与えること。
 */
export function createSeededRng(seed) {
    let s;
    if (typeof seed === 'number') {
        // SplitMix32 で 1 個の seed を 4 ワードに展開する
        let z = seed >>> 0;
        const next = () => {
            z = (z + 0x9e3779b9) >>> 0;
            let x = z;
            x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
            x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
            return (x ^ (x >>> 15)) >>> 0;
        };
        s = [next(), next(), next(), next()];
    }
    else {
        s = [seed[0] >>> 0, seed[1] >>> 0, seed[2] >>> 0, seed[3] >>> 0];
    }
    if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0)
        s[0] = 1;
    const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
    const next32 = () => {
        const result = (Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7) >>> 0, 9) >>> 0) >>> 0;
        const t = (s[1] << 9) >>> 0;
        s[2] = (s[2] ^ s[0]) >>> 0;
        s[3] = (s[3] ^ s[1]) >>> 0;
        s[1] = (s[1] ^ s[2]) >>> 0;
        s[0] = (s[0] ^ s[3]) >>> 0;
        s[2] = (s[2] ^ t) >>> 0;
        s[3] = rotl(s[3], 11);
        return result;
    };
    return {
        randomInt(n) {
            if (n <= 0)
                throw new Error('n は 1 以上である必要があります');
            if (n === 1)
                return 0;
            const limit = Math.floor(0x100000000 / n) * n;
            for (;;) {
                const v = next32();
                if (v < limit)
                    return v % n;
            }
        },
    };
}
/**
 * Fisher-Yates シャッフル（配列を破壊的に並べ替える）。
 * 後ろから前へ回すのが正しい実装。前から回す変種は分布が偏るので使わないこと。
 */
export function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = rng.randomInt(i + 1);
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
    }
    return arr;
}
/** シャッフル済みデッキから順に配るだけのシンプルなディーラー */
export class Deck {
    cards;
    index = 0;
    constructor(rng, preset) {
        // preset はテスト用。指定した順序でそのまま配る
        this.cards = preset ? preset.slice() : shuffle(freshDeck(), rng);
    }
    draw() {
        if (this.index >= this.cards.length)
            throw new Error('デッキが尽きました');
        return this.cards[this.index++];
    }
    drawMany(n) {
        const out = new Array(n);
        for (let i = 0; i < n; i++)
            out[i] = this.draw();
        return out;
    }
    get remaining() {
        return this.cards.length - this.index;
    }
    /** ハンド履歴に残すための、配布順の完全な記録 */
    snapshot() {
        return this.cards.slice();
    }
}
//# sourceMappingURL=cards.js.map