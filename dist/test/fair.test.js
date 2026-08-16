import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { sha256, sha256Hex, hmacSha256, bytesToHex, hexToBytes, utf8ToBytes, timingSafeEqualHex, } from '../src/sha256.js';
import { randomSeedHex, commitmentOf, combineClientSeeds, fillMissingClientSeeds, createFairRng, deriveDeck, verifyHand, FairnessSession, } from '../src/fair.js';
import { cardToString } from '../src/cards.js';
import { Hand } from '../src/table.js';
import { playOut } from '../src/bot.js';
import { createSeededRng } from '../src/cards.js';
describe('SHA-256 の既知テストベクタ', () => {
    // FIPS 180-2 / RFC 6234 の標準ベクタ
    const vectors = [
        ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
        ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
        [
            'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
            '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
        ],
        [
            'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
            'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
        ],
    ];
    for (const [input, expected] of vectors) {
        test(`"${input.slice(0, 24)}${input.length > 24 ? '…' : ''}" (${input.length} 文字)`, () => {
            assert.equal(sha256Hex(input), expected);
        });
    }
    test('1,000,000 文字の "a"（ブロック境界とパディングの総合確認）', () => {
        assert.equal(sha256Hex('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    });
    test('55 / 56 / 63 / 64 バイト境界で Node の crypto と一致する', () => {
        // パディング長の計算を 1 バイト間違えるとここだけが落ちる
        for (const len of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129]) {
            const s = 'x'.repeat(len);
            const expected = createHash('sha256').update(s).digest('hex');
            assert.equal(sha256Hex(s), expected, `${len} バイトで不一致`);
        }
    });
    test('ランダムなバイト列 500 本で Node の crypto と一致する', () => {
        const rng = createSeededRng(31337);
        for (let i = 0; i < 500; i++) {
            const len = rng.randomInt(300);
            const buf = new Uint8Array(len);
            for (let k = 0; k < len; k++)
                buf[k] = rng.randomInt(256);
            const expected = createHash('sha256').update(Buffer.from(buf)).digest('hex');
            assert.equal(bytesToHex(sha256(buf)), expected, `${len} バイトのランダム入力で不一致`);
        }
    });
});
describe('HMAC-SHA256 の既知テストベクタ', () => {
    test('RFC 4231 Test Case 1', () => {
        const key = hexToBytes('0b'.repeat(20));
        const msg = utf8ToBytes('Hi There');
        assert.equal(bytesToHex(hmacSha256(key, msg)), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    });
    test('RFC 4231 Test Case 2（鍵が短い）', () => {
        assert.equal(bytesToHex(hmacSha256(utf8ToBytes('Jefe'), utf8ToBytes('what do ya want for nothing?'))), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    });
    test('RFC 4231 Test Case 6（鍵がブロック長を超える）', () => {
        const key = hexToBytes('aa'.repeat(131));
        const msg = utf8ToBytes('Test Using Larger Than Block-Size Key - Hash Key First');
        assert.equal(bytesToHex(hmacSha256(key, msg)), '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
    });
    test('ランダム入力 300 本で Node の crypto と一致する', () => {
        const rng = createSeededRng(4242);
        for (let i = 0; i < 300; i++) {
            const kl = 1 + rng.randomInt(200);
            const ml = rng.randomInt(300);
            const key = new Uint8Array(kl);
            const msg = new Uint8Array(ml);
            for (let k = 0; k < kl; k++)
                key[k] = rng.randomInt(256);
            for (let k = 0; k < ml; k++)
                msg[k] = rng.randomInt(256);
            const expected = createHmac('sha256', Buffer.from(key)).update(Buffer.from(msg)).digest('hex');
            assert.equal(bytesToHex(hmacSha256(key, msg)), expected);
        }
    });
});
describe('16進変換', () => {
    test('往復変換で元に戻る', () => {
        const hex = 'deadbeef0123456789abcdef';
        assert.equal(bytesToHex(hexToBytes(hex)), hex);
    });
    test('不正な入力を拒否する', () => {
        assert.throws(() => hexToBytes('abc'), /奇数/);
        assert.throws(() => hexToBytes('zz'), /不正な文字/);
    });
    test('timingSafeEqualHex は長さ違いを false にする', () => {
        assert.equal(timingSafeEqualHex('abcd', 'abcd'), true);
        assert.equal(timingSafeEqualHex('abcd', 'abce'), false);
        assert.equal(timingSafeEqualHex('abcd', 'abcde'), false);
    });
});
describe('シードの生成と合成', () => {
    test('randomSeedHex は指定バイト数の 16 進を返す', () => {
        const s = randomSeedHex(32);
        assert.equal(s.length, 64);
        assert.match(s, /^[0-9a-f]{64}$/);
    });
    test('毎回異なる値が出る', () => {
        const set = new Set();
        for (let i = 0; i < 200; i++)
            set.add(randomSeedHex(32));
        assert.equal(set.size, 200);
    });
    test('コミットメントは serverSeed の SHA-256', () => {
        const seed = 'a'.repeat(64);
        assert.equal(commitmentOf(seed), createHash('sha256').update(seed).digest('hex'));
    });
    test('クライアントシードの合成は区切り文字で曖昧さを排除する', () => {
        // 単純連結だと ["ab","c"] と ["a","bc"] が同じになってしまう
        assert.notEqual(combineClientSeeds(['ab', 'c']), combineClientSeeds(['a', 'bc']));
        assert.equal(combineClientSeeds(['ab', 'c']), 'ab|c');
    });
    test('区切り文字を含むシードは無害化される', () => {
        assert.equal(combineClientSeeds(['a|b', 'c']), 'a_b|c');
    });
    test('未提出の席は自動生成で埋まる', () => {
        const filled = fillMissingClientSeeds(['mine', null, undefined, '']);
        assert.equal(filled[0], 'mine');
        assert.ok(filled[1].length > 0);
        assert.ok(filled[2].length > 0);
        assert.ok(filled[3].length > 0);
        assert.notEqual(filled[1], filled[2]);
    });
});
describe('デッキ導出の決定論性', () => {
    const input = { serverSeed: 'ab'.repeat(32), clientSeed: 'alice|bob|carol', nonce: 7 };
    test('同じ入力からは常に同じデッキが出る', () => {
        const a = deriveDeck(input).map(cardToString);
        const b = deriveDeck(input).map(cardToString);
        assert.deepEqual(a, b);
    });
    test('52 枚・重複なし', () => {
        const deck = deriveDeck(input).map(cardToString);
        assert.equal(deck.length, 52);
        assert.equal(new Set(deck).size, 52);
    });
    test('nonce が 1 違うだけで並びが変わる', () => {
        const a = deriveDeck(input).map(cardToString);
        const b = deriveDeck({ ...input, nonce: 8 }).map(cardToString);
        assert.notDeepEqual(a, b);
    });
    test('serverSeed が 1 ビット違うだけで並びが変わる', () => {
        const a = deriveDeck(input).map(cardToString);
        const b = deriveDeck({ ...input, serverSeed: 'aa' + 'ab'.repeat(31) }).map(cardToString);
        assert.notDeepEqual(a, b);
    });
    test('clientSeed が違えば並びが変わる（1 人でも結果を動かせる）', () => {
        const a = deriveDeck(input).map(cardToString);
        const b = deriveDeck({ ...input, clientSeed: 'alice|bob|dave' }).map(cardToString);
        assert.notDeepEqual(a, b);
    });
});
describe('導出乱数の一様性', () => {
    test('剰余バイアスが無い（randomInt の分布検定）', () => {
        const rng = createFairRng({ serverSeed: 'cd'.repeat(32), clientSeed: 'x', nonce: 0 });
        const m = 52;
        const n = 208000; // 1 セルあたり期待値 4000
        const counts = new Array(m).fill(0);
        for (let i = 0; i < n; i++)
            counts[rng.randomInt(m)]++;
        const expected = n / m;
        const chi2 = counts.reduce((a, o) => a + (o - expected) ** 2 / expected, 0);
        assert.ok(chi2 < 92, `カイ二乗値 ${chi2.toFixed(2)}（自由度51、0.1%水準の臨界値は約92）`);
    });
    test('導出デッキでも特定のカードが 52 箇所に均等に散る', () => {
        const n = 20800; // 1 位置あたり期待値 400
        const positions = new Array(52).fill(0);
        for (let i = 0; i < n; i++) {
            const deck = deriveDeck({ serverSeed: 'ef'.repeat(32), clientSeed: 'table-1', nonce: i });
            positions[deck.indexOf(0)]++;
        }
        const expected = n / 52;
        const chi2 = positions.reduce((a, o) => a + (o - expected) ** 2 / expected, 0);
        assert.ok(chi2 < 92, `カイ二乗値 ${chi2.toFixed(2)}`);
    });
});
describe('検証関数', () => {
    const session = new FairnessSession({
        clientSeeds: ['alice', 'bob', 'carol'],
        nonce: 3,
        serverSeed: '11'.repeat(32),
    });
    test('正しい開示は検証を通る', () => {
        const reveal = session.reveal();
        const r = verifyHand({
            serverSeed: reveal.serverSeed,
            commitment: reveal.commitment,
            clientSeed: reveal.clientSeed,
            nonce: reveal.nonce,
            deck: reveal.deck,
        });
        assert.equal(r.passed, true, JSON.stringify(r.checks, null, 2));
        assert.equal(r.mismatchIndexes.length, 0);
        assert.equal(r.checks.every((c) => c.passed), true);
    });
    test('serverSeed をすり替えるとコミットメント照合で落ちる', () => {
        const reveal = session.reveal();
        const r = verifyHand({
            serverSeed: '22'.repeat(32),
            commitment: reveal.commitment,
            clientSeed: reveal.clientSeed,
            nonce: reveal.nonce,
            deck: reveal.deck,
        });
        assert.equal(r.passed, false);
        assert.equal(r.checks[0].passed, false, 'コミットメント照合が落ちるはず');
    });
    test('デッキを 1 枚だけ入れ替えると不一致が検出される', () => {
        const reveal = session.reveal();
        const tampered = reveal.deck.slice();
        const t = tampered[0];
        tampered[0] = tampered[1];
        tampered[1] = t;
        const r = verifyHand({
            serverSeed: reveal.serverSeed,
            commitment: reveal.commitment,
            clientSeed: reveal.clientSeed,
            nonce: reveal.nonce,
            deck: tampered,
        });
        assert.equal(r.passed, false);
        assert.deepEqual(r.mismatchIndexes, [0, 1]);
    });
    test('nonce を偽ると不一致になる', () => {
        const reveal = session.reveal();
        const r = verifyHand({
            serverSeed: reveal.serverSeed,
            commitment: reveal.commitment,
            clientSeed: reveal.clientSeed,
            nonce: reveal.nonce + 1,
            deck: reveal.deck,
        });
        assert.equal(r.passed, false);
    });
    test('clientSeed を偽ると不一致になる', () => {
        const reveal = session.reveal();
        const r = verifyHand({
            serverSeed: reveal.serverSeed,
            commitment: reveal.commitment,
            clientSeed: 'alice|bob|mallory',
            nonce: reveal.nonce,
            deck: reveal.deck,
        });
        assert.equal(r.passed, false);
    });
    test('壊れた入力でも例外を投げず結果を返す', () => {
        const r = verifyHand({
            serverSeed: 'これは16進ではない',
            commitment: 'xyz',
            clientSeed: 'a',
            nonce: 0,
            deck: [],
        });
        assert.equal(r.passed, false);
        assert.ok(r.checks.length > 0);
    });
});
describe('Hand への組み込み', () => {
    const seats = (stacks) => stacks.map((s, i) => ({ id: `P${i}`, name: `P${i}`, stack: s }));
    test('コミットメントは配牌前に取得でき、シードは含まれない', () => {
        const fairness = new FairnessSession({ clientSeeds: ['a', 'b', 'c'], nonce: 0 });
        const h = new Hand({ seats: seats([1000, 1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100, fairness });
        const c = h.getFairnessCommitment();
        assert.match(c.commitment, /^[0-9a-f]{64}$/);
        assert.equal(JSON.stringify(c).includes('serverSeed'), false, 'コミットメントに秘密が漏れている');
    });
    test('進行中にシードを開示しようとすると拒否される', () => {
        const fairness = new FairnessSession({ clientSeeds: ['a', 'b'], nonce: 0 });
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100, fairness });
        assert.throws(() => h.revealFairness(), /終了する前に/);
    });
    test('実際に配られたカードが導出デッキと一致し、検証を通る', () => {
        const rng = createSeededRng(2024);
        for (let i = 0; i < 200; i++) {
            const fairness = new FairnessSession({ clientSeeds: ['alice', 'bob', 'carol', 'dave'], nonce: i });
            const commitment = fairness.getCommitment();
            const h = new Hand({
                seats: seats([5000, 5000, 5000, 5000]),
                buttonIndex: i % 4,
                smallBlind: 50,
                bigBlind: 100,
                fairness,
            });
            playOut(h, rng, 'tight');
            const reveal = h.revealFairness();
            const history = h.getHandHistory();
            // 事前に公開したコミットメントと、開示時のコミットメントが同一であること
            assert.equal(reveal.commitment, commitment.commitment);
            const r = verifyHand({
                serverSeed: reveal.serverSeed,
                commitment: commitment.commitment,
                clientSeed: commitment.clientSeed,
                nonce: commitment.nonce,
                deck: history.deckOrder, // エンジンが実際に使った配布順
            });
            assert.equal(r.passed, true, `ハンド ${i}: ${JSON.stringify(r.checks, null, 2)}`);
        }
    });
    test('履歴は進行中は commitment のみ、終了後は serverSeed を含む', () => {
        const fairness = new FairnessSession({ clientSeeds: ['a', 'b'], nonce: 0 });
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100, fairness });
        const during = h.getHandHistory();
        assert.equal('serverSeed' in during.fairness, false);
        h.act(0, 'fold');
        const after = h.getHandHistory();
        assert.equal('serverSeed' in after.fairness, true);
    });
    test('Provably Fair を使わない場合 fairness は null のまま', () => {
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        assert.equal(h.getFairnessCommitment(), null);
        assert.throws(() => h.revealFairness(), /有効にしていません/);
    });
    test('同じシードなら同じハンドが再現される', () => {
        const opts = { clientSeeds: ['x', 'y', 'z'], nonce: 99, serverSeed: '33'.repeat(32) };
        const play = () => {
            const h = new Hand({
                seats: seats([3000, 3000, 3000]),
                buttonIndex: 1,
                smallBlind: 50,
                bigBlind: 100,
                fairness: new FairnessSession(opts),
            });
            playOut(h, createSeededRng(777), 'tight');
            return h.getHandHistory();
        };
        const a = play();
        const b = play();
        assert.deepEqual(a.deckOrder, b.deckOrder);
        assert.deepEqual(a.seats, b.seats);
        assert.deepEqual(a.board, b.board);
        assert.deepEqual(a.result.netChange, b.result.netChange);
    });
});
//# sourceMappingURL=fair.test.js.map