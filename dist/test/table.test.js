import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, freshDeck, createSeededRng, cardToString } from '../src/cards.js';
import { Hand } from '../src/table.js';
import { playOut } from '../src/bot.js';
/**
 * テスト用に「配布順どおりのデッキ」を組み立てるヘルパー。
 *
 * エンジンは SB から時計回りに 1 枚ずつ 2 周配るので、その順序でカードを並べる必要がある。
 * ここを取り違えると全テストが静かに間違った前提で通ってしまうため、
 * 実際の配布ロジックと同じループでインデックスを作っている。
 */
function buildPresetDeck(opts) {
    const { holesBySeat, board, seatCount, buttonIndex } = opts;
    const sbSeat = seatCount === 2 ? buttonIndex : (buttonIndex + 1) % seatCount;
    const holes = holesBySeat.map(parseCards);
    const deck = [];
    for (let round = 0; round < 2; round++) {
        for (let i = 0; i < seatCount; i++) {
            const seat = (sbSeat + i) % seatCount;
            deck.push(holes[seat][round]);
        }
    }
    deck.push(...parseCards(board));
    const used = new Set(deck);
    for (const c of freshDeck())
        if (!used.has(c))
            deck.push(c);
    const unique = new Set(deck.map(cardToString));
    assert.equal(unique.size, 52, 'プリセットデッキに重複があります');
    return deck;
}
const seats = (stacks) => stacks.map((s, i) => ({ id: `P${i}`, name: `Player${i}`, stack: s }));
describe('ブラインドとポジション', () => {
    test('3 人以上ではボタンの左が SB、その左が BB', () => {
        const h = new Hand({ seats: seats([1000, 1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        assert.equal(h.players[1].totalBet, 50, '席1 が SB');
        assert.equal(h.players[2].totalBet, 100, '席2 が BB');
        assert.equal(h.actingSeat, 0, 'プリフロップは BB の左（＝席0）から');
    });
    test('ヘッズアップではボタンが SB を出し、プリフロップに先に動く', () => {
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        assert.equal(h.players[0].totalBet, 50, 'ボタン（席0）が SB');
        assert.equal(h.players[1].totalBet, 100, '席1 が BB');
        assert.equal(h.actingSeat, 0, 'ヘッズアップのプリフロップは SB から');
    });
    test('ヘッズアップのフロップ以降は BB から動く', () => {
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        h.act(0, 'call');
        h.act(1, 'check');
        assert.equal(h.street, 'flop');
        assert.equal(h.actingSeat, 1, 'ポストフロップはボタンの左（＝BB）から');
    });
    test('ブラインドを払いきれない場合はオールインになる', () => {
        const h = new Hand({ seats: seats([1000, 1000, 30]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        assert.equal(h.players[2].totalBet, 30);
        assert.equal(h.players[2].allIn, true);
        assert.equal(h.currentBet, 100, '払えなくても卓のベット水準は BB のまま');
    });
});
describe('全員フォールドで決着', () => {
    test('BB がブラインドを回収し、コールされなかった分は返る', () => {
        const h = new Hand({ seats: seats([1000, 1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        h.act(0, 'fold');
        h.act(1, 'fold');
        assert.equal(h.isComplete, true);
        const r = h.result;
        assert.equal(r.showdown, false, 'ショーダウンには行かない');
        assert.deepEqual(r.uncalledReturn, { seat: 2, amount: 50 }, 'BB の 100 のうち 50 は誰にもコールされていない');
        assert.deepEqual(r.netChange, [0, -50, 50]);
        assert.equal(h.players[2].stack, 1050);
    });
    test('ポストフロップで降りた場合もチップは保存される', () => {
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        h.act(0, 'call');
        h.act(1, 'check');
        h.act(1, 'bet', 300);
        h.act(0, 'fold');
        const r = h.result;
        assert.deepEqual(r.uncalledReturn, { seat: 1, amount: 300 });
        assert.deepEqual(r.netChange, [-100, 100]);
    });
});
describe('ショーダウン', () => {
    test('チェックダウンして強い役が勝つ', () => {
        const presetDeck = buildPresetDeck({
            holesBySeat: ['As Ah', 'Ks Kh'],
            board: '2c 7d 9h 3s 4c',
            seatCount: 2,
            buttonIndex: 0,
        });
        const h = new Hand({
            seats: seats([1000, 1000]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            presetDeck,
        });
        h.act(0, 'call');
        h.act(1, 'check');
        // フロップ以降はすべてチェック
        for (let i = 0; i < 3; i++) {
            h.act(1, 'check');
            h.act(0, 'check');
        }
        assert.equal(h.isComplete, true);
        const r = h.result;
        assert.equal(r.showdown, true);
        assert.deepEqual(r.pots[0].winners, [0], 'AA が KK に勝つ');
        assert.deepEqual(r.netChange, [100, -100]);
    });
    test('同点はチョップになる', () => {
        // ボードプレイ（両者ともボードのストレートフラッシュ）
        const presetDeck = buildPresetDeck({
            holesBySeat: ['2h 3d', '2c 3c'],
            board: 'As Ks Qs Js Ts',
            seatCount: 2,
            buttonIndex: 0,
        });
        const h = new Hand({
            seats: seats([1000, 1000]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            presetDeck,
        });
        h.act(0, 'call');
        h.act(1, 'check');
        for (let i = 0; i < 3; i++) {
            h.act(1, 'check');
            h.act(0, 'check');
        }
        const r = h.result;
        assert.deepEqual(r.pots[0].winners, [0, 1]);
        assert.deepEqual(r.netChange, [0, 0], 'チョップなら収支ゼロ');
    });
});
describe('サイドポットの統合テスト', () => {
    test('ショートスタックがメインポット、残り 2 人がサイドポットを争う', () => {
        // 席0(A)=100 / 席1(B)=500 / 席2(C)=500、ボタン=0 なので SB=席1, BB=席2
        const presetDeck = buildPresetDeck({
            holesBySeat: ['As Ah', 'Ks Kh', 'Qs Qh'],
            board: '2c 7d 9h 3s 4c',
            seatCount: 3,
            buttonIndex: 0,
        });
        const h = new Hand({
            seats: seats([100, 500, 500]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            presetDeck,
        });
        // プリフロップ：A がオールインコール、B コール、C チェック
        h.act(0, 'call');
        assert.equal(h.players[0].allIn, true);
        h.act(1, 'call');
        h.act(2, 'check');
        assert.equal(h.street, 'flop');
        // フロップ：B がオールイン、C がコール
        h.act(1, 'bet', 400);
        h.act(2, 'call');
        assert.equal(h.isComplete, true);
        const r = h.result;
        assert.equal(r.pots.length, 2, 'メインポットとサイドポットの 2 層');
        assert.equal(r.pots[0].pot.amount, 300, 'メイン = 100 x 3');
        assert.deepEqual(r.pots[0].pot.eligible, [0, 1, 2]);
        assert.deepEqual(r.pots[0].winners, [0], 'AA がメインを取る');
        assert.equal(r.pots[1].pot.amount, 800, 'サイド = 400 x 2');
        assert.deepEqual(r.pots[1].pot.eligible, [1, 2]);
        assert.deepEqual(r.pots[1].winners, [1], 'KK が QQ に勝ってサイドを取る');
        assert.deepEqual(r.netChange, [200, 300, -500]);
        assert.equal(r.netChange.reduce((a, b) => a + b, 0), 0, 'チップの総量は変わらない');
    });
});
describe('ベット額のルール', () => {
    test('最小レイズ未満は拒否される', () => {
        const h = new Hand({ seats: seats([10000, 10000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        const raise = h.getLegalActions(0).find((a) => a.type === 'raise');
        assert.equal(raise.min, 200, '最小レイズは「現在のベット + 直前のレイズ幅」');
        assert.throws(() => h.act(0, 'raise', 150), /最小額/);
    });
    test('レイズ後の最小レイズ幅が更新される', () => {
        const h = new Hand({ seats: seats([10000, 10000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        h.act(0, 'raise', 300); // レイズ幅 200
        const raise = h.getLegalActions(1).find((a) => a.type === 'raise');
        assert.equal(raise.min, 500, '300 + 200');
    });
    test('スタックを超えるベットは拒否される', () => {
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        assert.throws(() => h.act(0, 'raise', 2000), /スタックを超え/);
    });
    test('アクション権のない席は打てない', () => {
        const h = new Hand({ seats: seats([1000, 1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        assert.throws(() => h.act(2, 'fold'), /アクション権がありません/);
    });
    test('チェックできる場面ではコールは合法手に出ない', () => {
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        h.act(0, 'call');
        const types = h.getLegalActions(1).map((a) => a.type);
        assert.ok(types.includes('check'));
        assert.ok(!types.includes('call'));
    });
});
describe('ショートオールインはベッティングを再開させない', () => {
    test('既にアクション済みのプレイヤーはコールかフォールドしかできなくなる', () => {
        // 席2 のスタックを絞り、BB(100) を払った後に 130 しか残らない状況を作る
        const h = new Hand({ seats: seats([1000, 1000, 230]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        h.act(0, 'raise', 200); // フルレイズ（幅 100）
        h.act(1, 'call');
        const c = h.getLegalActions(2).find((a) => a.type === 'raise');
        assert.equal(c.min, 230, 'スタック上限に丸められる');
        assert.equal(c.max, 230);
        h.act(2, 'raise', 230); // ショートオールイン（幅 30 < 直前のレイズ幅 100）
        assert.equal(h.players[2].allIn, true);
        // 席0 は再度アクションが必要だが、レイズはできない
        assert.equal(h.actingSeat, 0);
        const types = h.getLegalActions(0).map((a) => a.type);
        assert.deepEqual(types.sort(), ['call', 'fold'], 'レイズが合法手に含まれない');
    });
    test('フルレイズならレイズ権が戻る', () => {
        const h = new Hand({ seats: seats([1000, 1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        h.act(0, 'raise', 200);
        h.act(1, 'raise', 400); // フルレイズ
        const types = h.getLegalActions(2).map((a) => a.type);
        assert.ok(types.includes('raise'), '席2 はまだアクションしていないのでレイズ可能');
    });
});
describe('レーキ', () => {
    test('フロップを見ずに決着した場合はレーキが引かれない', () => {
        const h = new Hand({
            seats: seats([1000, 1000, 1000]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            rakePercent: 0.05,
            rakeCap: 400,
        });
        h.act(0, 'fold');
        h.act(1, 'fold');
        assert.equal(h.result.totalRake, 0);
    });
    test('フロップを見たらポットからレーキが引かれる', () => {
        const presetDeck = buildPresetDeck({
            holesBySeat: ['As Ah', 'Ks Kh'],
            board: '2c 7d 9h 3s 4c',
            seatCount: 2,
            buttonIndex: 0,
        });
        const h = new Hand({
            seats: seats([1000, 1000]),
            buttonIndex: 0,
            smallBlind: 50,
            bigBlind: 100,
            rakePercent: 0.05,
            rakeCap: 400,
            presetDeck,
        });
        h.act(0, 'call');
        h.act(1, 'check');
        for (let i = 0; i < 3; i++) {
            h.act(1, 'check');
            h.act(0, 'check');
        }
        const r = h.result;
        assert.equal(r.totalRake, 10, 'ポット 200 の 5%');
        assert.deepEqual(r.netChange, [90, -100], '勝者の取り分からレーキが引かれる');
        assert.equal(r.netChange.reduce((a, b) => a + b, 0) + r.totalRake, 0, '収支合計 + レーキ = 0');
    });
});
describe('ランダム自動対戦による不変条件の検証', () => {
    for (const [style, hands] of [
        ['random', 3000],
        ['tight', 3000],
        ['loose', 2000],
        ['calling-station', 2000],
    ]) {
        test(`${style} ボットで ${hands} ハンド：チップ総量が保存される`, () => {
            const rng = createSeededRng(1234 + style.length);
            let showdowns = 0;
            let sidePots = 0;
            for (let i = 0; i < hands; i++) {
                const n = 2 + rng.randomInt(8);
                const stacks = [];
                for (let k = 0; k < n; k++)
                    stacks.push(100 + rng.randomInt(20000));
                const h = new Hand({
                    seats: seats(stacks),
                    buttonIndex: rng.randomInt(n),
                    smallBlind: 50,
                    bigBlind: 100,
                    rakePercent: 0.04,
                    rakeCap: 400,
                    rng,
                });
                playOut(h, rng, style);
                const r = h.result;
                const before = stacks.reduce((a, b) => a + b, 0);
                const after = h.players.reduce((a, p) => a + p.stack, 0);
                assert.equal(after + r.totalRake, before, `ハンド ${i}: チップが増減した`);
                // 誰のスタックもマイナスにならない
                for (const p of h.players)
                    assert.ok(p.stack >= 0, `ハンド ${i}: 席 ${p.seat} のスタックが負`);
                // ポット合計と実際の配当が一致する
                const distributed = r.pots.reduce((a, pr) => a + [...pr.shares.values()].reduce((x, y) => x + y, 0) + pr.rake, 0);
                const potTotal = r.pots.reduce((a, pr) => a + pr.pot.amount, 0);
                assert.equal(distributed, potTotal, `ハンド ${i}: ポットの配当漏れ`);
                // 各ポットの勝者は必ず権利者の中から選ばれている
                for (const pr of r.pots) {
                    for (const w of pr.winners) {
                        assert.ok(pr.pot.eligible.includes(w), `ハンド ${i}: 権利のない席が勝者になっている`);
                    }
                }
                if (r.showdown)
                    showdowns++;
                if (r.pots.length > 1)
                    sidePots++;
            }
            // シナリオが偏っていないことの確認（テスト自体が意味を持っているか）
            assert.ok(showdowns > hands * 0.02, `ショーダウンが少なすぎる (${showdowns}/${hands})`);
            // calling-station は絶対にレイズしないためオールインが起きず、サイドポットも発生しない。
            // 逆に言えばここでサイドポットが出たらベット額の計算がおかしい。
            if (style === 'calling-station') {
                assert.equal(sidePots, 0, 'レイズしないボットなのにサイドポットが発生している');
            }
            else {
                assert.ok(sidePots > 0, 'サイドポットが 1 度も発生していない');
            }
        });
    }
    test('全席オールインでも正しく決着する', () => {
        const rng = createSeededRng(99);
        for (let i = 0; i < 500; i++) {
            const n = 2 + rng.randomInt(8);
            const stacks = [];
            for (let k = 0; k < n; k++)
                stacks.push(100 + rng.randomInt(3000));
            const h = new Hand({
                seats: seats(stacks),
                buttonIndex: rng.randomInt(n),
                smallBlind: 50,
                bigBlind: 100,
                rng,
            });
            let guard = 0;
            while (!h.isComplete) {
                if (guard++ > 200)
                    throw new Error('ハンドが終了しません');
                const seat = h.actingSeat;
                const legal = h.getLegalActions(seat);
                const push = legal.find((a) => a.type === 'raise' || a.type === 'bet');
                if (push)
                    h.act(seat, push.type, push.max);
                else if (legal.find((a) => a.type === 'call'))
                    h.act(seat, 'call');
                else
                    h.act(seat, 'check');
            }
            const before = stacks.reduce((a, b) => a + b, 0);
            const after = h.players.reduce((a, p) => a + p.stack, 0);
            assert.equal(after, before);
            assert.equal(h.board.length, 5, 'オールイン成立後はボードが最後まで開かれる');
        }
    });
});
describe('情報の隠蔽', () => {
    test('他人のホールカードはプレイ中に見えない', () => {
        const h = new Hand({ seats: seats([1000, 1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        const view = h.getStateFor(0);
        assert.ok(view.players[0].holeCards !== null, '自分の手札は見える');
        assert.equal(view.players[1].holeCards, null);
        assert.equal(view.players[2].holeCards, null);
    });
    test('観戦者（seat = null）には誰の手札も見えない', () => {
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        const view = h.getStateFor(null);
        assert.ok(view.players.every((p) => p.holeCards === null));
    });
    test('ショーダウン後は降りていない全員の手札が公開される', () => {
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        h.act(0, 'call');
        h.act(1, 'check');
        for (let i = 0; i < 3; i++) {
            h.act(1, 'check');
            h.act(0, 'check');
        }
        const view = h.getStateFor(null);
        assert.ok(view.players.every((p) => p.holeCards !== null));
    });
    test('フォールド決着ならショーダウンせず手札は伏せたまま', () => {
        const h = new Hand({ seats: seats([1000, 1000]), buttonIndex: 0, smallBlind: 50, bigBlind: 100 });
        h.act(0, 'fold');
        const view = h.getStateFor(null);
        assert.ok(view.players.every((p) => p.holeCards === null));
    });
});
//# sourceMappingURL=table.test.js.map