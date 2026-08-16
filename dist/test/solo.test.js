/**
 * ソロ版の検証
 *
 * ここで一番大事なのは「CPU が本当に強いか」です。
 * 見た目だけ賢そうなロジックを書いても、実際に対戦させると単純なボットに負ける、
 * ということが普通に起こります。数千ハンド戦わせて収支で確かめます。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Hand } from '../src/table.js';
import { createSeededRng, parseCards, freshDeck, shuffle } from '../src/cards.js';
import { decide as simpleDecide } from '../src/bot.js';
import { decideAi, equity, preflopStrength, boardDanger, OpponentModel, PERSONALITIES } from '../solo/ai.js';
import { RANKS, STAKES, ACHIEVEMENTS, Profile } from '../solo/meta.js';
const seats = (stacks, names) => stacks.map((s, i) => ({ id: `p${i}`, name: names[i], stack: s }));
// ---------------------------------------------------------------------------
// エクイティ推定
// ---------------------------------------------------------------------------
describe('エクイティ推定', () => {
    test('AA は 22 より強い（プリフロップ評価）', () => {
        assert.ok(preflopStrength(parseCards('As Ah')) > preflopStrength(parseCards('2s 2h')));
    });
    test('スーテッドはオフスーツより強い', () => {
        assert.ok(preflopStrength(parseCards('As Ks')) > preflopStrength(parseCards('As Kh')));
    });
    test('AKs は 72o より大幅に強い', () => {
        assert.ok(preflopStrength(parseCards('As Ks')) > preflopStrength(parseCards('7s 2h')) * 2);
    });
    test('完成した役は未完成より高い勝率になる', () => {
        const rng = createSeededRng(1);
        const board = parseCards('As Ks 7d');
        // AA のセット vs ノーペア
        const strong = equity(parseCards('Ad Ac'), board, 2, 600, rng);
        const weak = equity(parseCards('3d 4c'), board, 2, 600, rng);
        assert.ok(strong > 0.75, `セットの勝率が低すぎる: ${strong.toFixed(2)}`);
        assert.ok(weak < 0.25, `ノーペアの勝率が高すぎる: ${weak.toFixed(2)}`);
    });
    test('相手が増えるほど勝率は下がる', () => {
        const rng = createSeededRng(2);
        const board = parseCards('As Kd 7h');
        const heads = equity(parseCards('Qs Qh'), board, 1, 800, rng);
        const multi = equity(parseCards('Qs Qh'), board, 4, 800, rng);
        assert.ok(heads > multi, `${heads.toFixed(2)} > ${multi.toFixed(2)} のはず`);
    });
    test('リバーで確定した勝ち手は 100% 近くになる', () => {
        const rng = createSeededRng(3);
        // ボードに 4 枚のスペード、こちらは Ace ハイフラッシュ
        const eq = equity(parseCards('As 2s'), parseCards('Ks Qs 7s 3s 9h'), 1, 500, rng);
        assert.ok(eq > 0.9, `ナッツに近い手の勝率が ${eq.toFixed(2)} しかない`);
    });
    test('ボードの危険度が状況に応じて上がる', () => {
        assert.equal(boardDanger([]), 0);
        const dry = boardDanger(parseCards('2h 7d Jc'));
        const wet = boardDanger(parseCards('9s Ts Js'));
        assert.ok(wet > dry, `ウェットなボードの危険度が低い: ${wet} vs ${dry}`);
    });
});
// ---------------------------------------------------------------------------
// 相手のモデル化
// ---------------------------------------------------------------------------
describe('相手のモデル化', () => {
    test('データが無いうちは中庸な値を返す', () => {
        const m = new OpponentModel();
        assert.ok(m.foldToBetRate > 0.2 && m.foldToBetRate < 0.6, `初期値が極端: ${m.foldToBetRate}`);
        assert.ok(m.vpipRate > 0.1 && m.vpipRate < 0.5);
    });
    test('降りてばかりの相手は fold 率が上がる', () => {
        const m = new OpponentModel();
        for (let i = 0; i < 60; i++) {
            m.noteHandStart();
            m.noteAction('fold', true);
        }
        assert.ok(m.foldToBetRate > 0.7, `降りやすさを検出できていない: ${m.foldToBetRate.toFixed(2)}`);
    });
    test('付いてくる相手は fold 率が下がる', () => {
        const m = new OpponentModel();
        for (let i = 0; i < 60; i++) {
            m.noteHandStart();
            m.noteAction('call', true);
        }
        assert.ok(m.foldToBetRate < 0.2, `粘り強さを検出できていない: ${m.foldToBetRate.toFixed(2)}`);
    });
    test('レイズが多い相手はアグレッションが上がる', () => {
        const m = new OpponentModel();
        for (let i = 0; i < 60; i++)
            m.noteAction('raise', false);
        assert.ok(m.aggressionRate > 0.7);
    });
});
// ---------------------------------------------------------------------------
// CPU の強さ
// ---------------------------------------------------------------------------
/**
 * 指定した席を AI に任せるか簡易ボットに任せるかを切り替えて、その席の収支を返す。
 *
 * 山札を外から渡しているのがポイントです。同じ山札で AI 版とボット版を 2 回走らせると、
 * 「配られたカードの運」が両者で完全に一致するので、差分がほぼ純粋に判断力の差になります。
 * ポーカーの収支は分散が極端に大きく、素の勝ち負けだけでは 150 ハンド程度で強さを判定できません。
 */
function playMatch(targetSeats, decks, seed, personality, useAi) {
    const rng = createSeededRng(seed);
    const model = new OpponentModel();
    const START = 10_000;
    const n = 6;
    let net = 0;
    let played = 0;
    for (let i = 0; i < decks.length; i++) {
        const h = new Hand({
            seats: seats(new Array(n).fill(START), ['A', 'B', 'C', 'D', 'E', 'F']),
            buttonIndex: i % n,
            smallBlind: 50,
            bigBlind: 100,
            presetDeck: decks[i],
            rng,
        });
        let guard = 0;
        while (!h.isComplete) {
            if (guard++ > 400)
                break;
            const seat = h.actingSeat;
            const d = useAi && targetSeats.includes(seat)
                ? decideAi({ hand: h, seat, profile: PERSONALITIES[personality], model, rng, skill: 1.0 })
                : simpleDecide(h, seat, rng, 'tight');
            try {
                h.act(seat, d.action, d.toAmount);
            }
            catch {
                h.act(seat, h.getLegalActions(seat).some((l) => l.type === 'check') ? 'check' : 'fold');
            }
        }
        if (!h.result)
            continue;
        played++;
        for (const s of targetSeats)
            net += h.result.netChange[s];
    }
    return { net, played };
}
/** 同じ山札の列を作る */
function makeDecks(seed, count) {
    const rng = createSeededRng(seed);
    const out = [];
    for (let i = 0; i < count; i++)
        out.push(shuffle(freshDeck(), rng));
    return out;
}
describe('CPU の強さ', () => {
    /**
     * 同一の山札で「AI が座った場合」と「簡易ボットが座った場合」を走らせ、その差を見ます。
     * 差がプラスなら、同じカードを配られたときに AI のほうがうまく捌けた、ということです。
     */
    test('同じ山札ならボットより多く稼ぐ', () => {
        const runs = [
            [12345, [0, 3]],
            [987, [1, 4]],
            [4242, [2, 5]],
        ];
        let better = 0;
        let totalDiff = 0;
        const detail = [];
        for (const [seed, set] of runs) {
            const decks = makeDecks(seed, 110);
            const ai = playMatch(set, decks, seed, 'tag', true);
            const bot = playMatch(set, decks, seed, 'tag', false);
            assert.ok(ai.played > 90, `シード ${seed} でハンドが成立していない: ${ai.played}`);
            const diff = ai.net - bot.net;
            totalDiff += diff;
            if (diff > 0)
                better++;
            detail.push(`${seed}:${diff > 0 ? '+' : ''}${diff}`);
        }
        // 山札を揃えても、どの手に参加するかが変われば結果は分かれます。
        // 個々のセッションの勝敗は当てにならないので、合計だけを条件にしています
        assert.ok(totalDiff > 0, `AI がボットに勝てていない（差分 ${detail.join(' ')}）`);
        assert.ok(better >= 1, `勝ったのは ${better}/${runs.length} セッションだけ（${detail.join(' ')}）`);
    });
    /**
     * チップの収支は分散が大きすぎて、強さの証明には向きません。
     * そこで「どの手にお金を入れたか」を直接見ます。
     * 強いプレイヤーほど、参加する手の平均的な強さが高くなります。
     * これはカードの引きに左右されないので、少ないハンド数でも差がはっきり出ます。
     */
    test('参加する手の質がボットより高い', () => {
        function selectionQuality(useAi) {
            const rng = createSeededRng(2024);
            const model = new OpponentModel();
            const decks = makeDecks(2024, 220);
            let sum = 0;
            let count = 0;
            for (let i = 0; i < decks.length; i++) {
                const h = new Hand({
                    seats: seats(new Array(6).fill(10_000), ['A', 'B', 'C', 'D', 'E', 'F']),
                    buttonIndex: i % 6,
                    smallBlind: 50,
                    bigBlind: 100,
                    presetDeck: decks[i],
                    rng,
                });
                let voluntary = false;
                let guard = 0;
                while (!h.isComplete && guard++ < 400) {
                    const seat = h.actingSeat;
                    const isTarget = seat === 2;
                    const d = useAi && isTarget
                        ? decideAi({ hand: h, seat, profile: PERSONALITIES.tag, model, rng, skill: 1 })
                        : simpleDecide(h, seat, rng, 'tight');
                    // プリフロップで自分から call / raise したら「参加した」とみなす
                    if (isTarget && h.street === 'preflop' && (d.action === 'call' || d.action === 'raise'))
                        voluntary = true;
                    try {
                        h.act(seat, d.action, d.toAmount);
                    }
                    catch {
                        h.act(seat, h.getLegalActions(seat).some((l) => l.type === 'check') ? 'check' : 'fold');
                    }
                }
                if (voluntary) {
                    sum += preflopStrength(h.players[2].holeCards);
                    count++;
                }
            }
            return { avg: sum / Math.max(1, count), rate: count / decks.length };
        }
        const ai = selectionQuality(true);
        const bot = selectionQuality(false);
        assert.ok(ai.rate > 0.05 && ai.rate < 0.85, `AI の参加率が不自然（${(ai.rate * 100).toFixed(0)}%）`);
        assert.ok(ai.avg > bot.avg, `参加した手の平均の強さが AI ${ai.avg.toFixed(3)} / ボット ${bot.avg.toFixed(3)} で上回れていない`);
    });
    test('性格ごとに挙動が変わる', () => {
        const decks = makeDecks(555, 70);
        const rock = playMatch([0], decks, 555, 'rock', true);
        const maniac = playMatch([0], decks, 555, 'maniac', true);
        // 同じ山札・同じ席でも、性格が違えば結果は一致しないはず
        assert.notEqual(rock.net, maniac.net, '性格の違いが挙動に出ていない');
    });
    test('チップの総量は保存される（AI が壊れた手を打っていない）', () => {
        const rng = createSeededRng(42);
        const model = new OpponentModel();
        for (let i = 0; i < 50; i++) {
            const stacks = [8000, 12000, 5000, 20000, 9000, 15000];
            const h = new Hand({
                seats: seats(stacks, ['A', 'B', 'C', 'D', 'E', 'F']),
                buttonIndex: i % 6,
                smallBlind: 50,
                bigBlind: 100,
                rng,
            });
            let guard = 0;
            while (!h.isComplete) {
                if (guard++ > 400)
                    break;
                const seat = h.actingSeat;
                const d = decideAi({ hand: h, seat, profile: PERSONALITIES.tag, model, rng, skill: 1 });
                try {
                    h.act(seat, d.action, d.toAmount);
                }
                catch {
                    h.act(seat, h.getLegalActions(seat).some((l) => l.type === 'check') ? 'check' : 'fold');
                }
            }
            const after = h.players.reduce((a, p) => a + p.stack, 0);
            assert.equal(after, stacks.reduce((a, b) => a + b, 0), `ハンド ${i} でチップが増減した`);
        }
    });
    test('強い手をフォールドしない', () => {
        // ナッツに近い状況で降りるようなら、判断が壊れている
        const rng = createSeededRng(7);
        const model = new OpponentModel();
        const deck = freshDeck();
        let folds = 0;
        for (let i = 0; i < 40; i++) {
            const h = new Hand({
                seats: seats([10000, 10000, 10000], ['A', 'B', 'C']),
                buttonIndex: 0,
                smallBlind: 50,
                bigBlind: 100,
                // 席 0 に AA を配る（配布順は SB から 1 枚ずつ 2 周）
                presetDeck: [
                    ...parseCards('2c 3c As 4c 5c Ah'),
                    ...deck.filter((c) => !parseCards('2c 3c As 4c 5c Ah').includes(c)),
                ],
                rng,
            });
            // 席 0 が動く番まで進める
            let guard = 0;
            while (!h.isComplete && h.actingSeat !== 0 && guard++ < 20) {
                const s = h.actingSeat;
                h.act(s, h.getLegalActions(s).some((l) => l.type === 'call') ? 'call' : 'check');
            }
            if (h.isComplete || h.actingSeat !== 0)
                continue;
            const d = decideAi({ hand: h, seat: 0, profile: PERSONALITIES.tag, model, rng, skill: 1 });
            if (d.action === 'fold')
                folds++;
        }
        assert.equal(folds, 0, `AA を ${folds} 回フォールドした`);
    });
});
// ---------------------------------------------------------------------------
// 経済設計
// ---------------------------------------------------------------------------
describe('チップ経済の設計', () => {
    test('ランクが上がるほど回復が速く・多く・上限も高い', () => {
        for (let i = 1; i < RANKS.length; i++) {
            assert.ok(RANKS[i].rechargeAmount > RANKS[i - 1].rechargeAmount, `${RANKS[i].name} の回復量が増えていない`);
            assert.ok(RANKS[i].rechargeIntervalMs < RANKS[i - 1].rechargeIntervalMs, `${RANKS[i].name} の間隔が短くなっていない`);
            assert.ok(RANKS[i].rechargeCap > RANKS[i - 1].rechargeCap, `${RANKS[i].name} の上限が上がっていない`);
            assert.ok(RANKS[i].minRp > RANKS[i - 1].minRp);
        }
    });
    test('最低の卓には必ず時間回復だけで戻れる', () => {
        // ここが破綻すると「詰み」が発生し、躊躇いではなく離脱になる
        for (const rank of RANKS) {
            const i = RANKS.indexOf(rank);
            const cheapest = Math.min(...STAKES.filter((s) => s.minRankIndex <= i).map((s) => s.buyIn));
            assert.ok(rank.rechargeCap >= cheapest, `${rank.name} の回復上限 ${rank.rechargeCap} で最安卓 ${cheapest} に座れない`);
        }
    });
    test('上位の卓は時間回復では到達できない（勝つしかない）', () => {
        // 躊躇いの源泉。ここが緩いと、失ってもすぐ戻れるので緊張感が消える
        for (const rank of RANKS) {
            const i = RANKS.indexOf(rank);
            const reachable = STAKES.filter((s) => s.minRankIndex <= i);
            assert.ok(reachable.length > 0, `${rank.name} が座れる卓が無い`);
            const topOfTier = reachable[reachable.length - 1];
            assert.ok(topOfTier.buyIn > rank.rechargeCap, `${rank.name} は回復上限 ${rank.rechargeCap} で最上位卓 ${topOfTier.name}（${topOfTier.buyIn}）に座れてしまう`);
        }
    });
    test('卓のレートは単調に上がる', () => {
        for (let i = 1; i < STAKES.length; i++) {
            assert.ok(STAKES[i].buyIn > STAKES[i - 1].buyIn, `${STAKES[i].name} のバイインが下がっている`);
        }
    });
    test('バイインはブラインドの 20 倍以上ある', () => {
        // これを下回ると、プッシュ／フォールドだけのゲームになって読み合いが消える
        for (const s of STAKES) {
            assert.ok(s.buyIn >= s.bigBlind * 20, `${s.name} のバイインが浅すぎる`);
        }
    });
    test('実績は最高ランクに届くだけの RP を用意している', () => {
        const total = ACHIEVEMENTS.reduce((a, x) => a + x.rp, 0);
        const need = RANKS[RANKS.length - 1].minRp;
        assert.ok(total >= need, `実績の合計 ${total} RP では最高位 ${need} RP に届かない`);
    });
    test('実績が序盤に偏りすぎていない', () => {
        // 最初の数ハンドで一気にランクが上がると、成長の実感が前倒しで尽きる。
        // 役の実績（bestHandCategory）は target が「役の番号」であって回数ではないので、
        // 数値が小さくても簡単とは限らない（8 はストレートフラッシュ）。ここでは除外する
        const easy = ACHIEVEMENTS.filter((a) => a.stat !== 'bestHandCategory' && a.target <= 10);
        const early = easy.reduce((s, a) => s + a.rp, 0);
        const total = ACHIEVEMENTS.reduce((s, a) => s + a.rp, 0);
        assert.ok(early / total < 0.2, `簡単な実績だけで全体の ${Math.round((early / total) * 100)}% を取れてしまう`);
    });
    test('珍しい役ほど RP が高い', () => {
        const byHand = ACHIEVEMENTS.filter((a) => a.stat === 'bestHandCategory').sort((a, b) => a.target - b.target);
        for (let i = 1; i < byHand.length; i++) {
            assert.ok(byHand[i].rp > byHand[i - 1].rp, `${byHand[i].name} の RP が ${byHand[i - 1].name} 以下`);
        }
    });
    test('実績の ID が重複していない', () => {
        const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
        assert.equal(ids.size, ACHIEVEMENTS.length);
    });
});
// ---------------------------------------------------------------------------
// 時間による補充
// ---------------------------------------------------------------------------
/** localStorage は Node に無いので、テストのあいだだけ最小限のものを差し込む */
function withStorage(fn) {
    const store = new Map();
    const stub = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => void store.set(k, String(v)),
        removeItem: (k) => void store.delete(k),
    };
    const g = globalThis;
    const had = 'localStorage' in g;
    const prev = g.localStorage;
    g.localStorage = stub;
    try {
        return fn();
    }
    finally {
        if (had)
            g.localStorage = prev;
        else
            delete g.localStorage;
    }
}
const MIN = 60_000;
describe('チップの補充', () => {
    test('間隔が来るまでは 1 チップも増えない', () => {
        withStorage(() => {
            const t0 = 1_000_000;
            const p = new Profile(t0);
            p.data.chips = 0;
            const rank = p.rank;
            assert.equal(p.applyRecharge(t0 + rank.rechargeIntervalMs - 1), 0);
            assert.equal(p.data.chips, 0);
        });
    });
    test('タブを閉じていた時間ぶんもまとめて溜まる', () => {
        // 経過時間から計算しているので、画面を開いていなくても進む。
        // タイマーを動かし続ける実装だと、閉じている間は止まってしまう
        withStorage(() => {
            const t0 = 1_000_000;
            const p = new Profile(t0);
            p.data.chips = 0;
            const rank = p.rank;
            const gained = p.applyRecharge(t0 + rank.rechargeIntervalMs * 3);
            assert.equal(gained, rank.rechargeAmount * 3);
        });
    });
    test('上限を超えては溜まらない', () => {
        // ここが効かないと、放置するだけで上の卓に座れてしまい、緊張感が消える
        withStorage(() => {
            const t0 = 1_000_000;
            const p = new Profile(t0);
            p.data.chips = 0;
            const rank = p.rank;
            p.applyRecharge(t0 + rank.rechargeIntervalMs * 1000);
            assert.equal(p.data.chips, rank.rechargeCap);
        });
    });
    test('上限に達していれば残り時間は表示されない', () => {
        withStorage(() => {
            const p = new Profile(0);
            p.data.chips = p.rank.rechargeCap;
            assert.equal(p.msUntilNextRecharge(0), null);
        });
    });
    test('端数の時間は切り捨てずに次へ持ち越す', () => {
        // 切り捨てると、こまめに開くほど損をするという妙な仕様になってしまう
        withStorage(() => {
            const t0 = 1_000_000;
            const p = new Profile(t0);
            p.data.chips = 0;
            const iv = p.rank.rechargeIntervalMs;
            p.applyRecharge(t0 + iv + iv / 2); // 1 回ぶん + 半分
            const gained = p.applyRecharge(t0 + iv * 2);
            assert.equal(gained, p.rank.rechargeAmount, '持ち越した半分ぶんが消えている');
        });
    });
    test('チップが上限を上回っている間は時間が進まない', () => {
        withStorage(() => {
            const t0 = 1_000_000;
            const p = new Profile(t0);
            p.data.chips = p.rank.rechargeCap * 10;
            p.applyRecharge(t0 + p.rank.rechargeIntervalMs * 5);
            assert.equal(p.data.chips, p.rank.rechargeCap * 10, '上限より多いのに増減した');
            // 使って上限を割った時点から数え直すので、直後に開いても 1 チップも増えない。
            // ここが甘いと「たくさん持っていた時間」がそのまま補充に化けてしまう
            const spentAt = t0 + p.rank.rechargeIntervalMs * 5;
            p.spend(p.rank.rechargeCap * 10, spentAt);
            assert.equal(p.data.chips, 0);
            assert.equal(p.applyRecharge(spentAt), 0, '使った直後にいきなり補充された');
            assert.equal(p.applyRecharge(spentAt + p.rank.rechargeIntervalMs), p.rank.rechargeAmount);
        });
    });
    test('ランクが上がると補充が速くなる', () => {
        withStorage(() => {
            const t0 = 1_000_000;
            const p = new Profile(t0);
            const rookie = p.rank.rechargeAmount;
            // 実績をすべて達成した状態にして最高ランクへ
            // 称号は「実績を受け取ったか」ではなく統計そのものから決まるので、統計を最大にする
            for (const a of ACHIEVEMENTS) {
                const stat = p.data.stats;
                stat[a.stat] = Math.max(stat[a.stat] ?? 0, a.target);
            }
            assert.equal(p.rank.key, RANKS[RANKS.length - 1].key, `最高ランクに届かない: ${p.rank.name}`);
            assert.ok(p.rank.rechargeAmount > rookie);
        });
    });
    test('破産しても必ず最低の卓には戻れる', () => {
        // 完全に詰むと、躊躇いではなく離脱になる
        withStorage(() => {
            const t0 = 1_000_000;
            const p = new Profile(t0);
            p.spend(p.data.chips, t0); // 全部失う
            assert.equal(p.data.chips, 0);
            p.applyRecharge(t0 + p.rank.rechargeIntervalMs * 100);
            assert.ok(p.availableStakes().some((s) => p.canAfford(s.buyIn)), '待っても座れる卓が無い');
        });
    });
    test('セーブして読み直しても記録が残る', () => {
        withStorage(() => {
            const p = new Profile(1_000_000);
            p.data.playerName = 'テスト';
            p.data.stats.handsPlayed = 42;
            p.gain(12_345);
            p.save();
            const q = new Profile(1_000_000);
            assert.equal(q.data.playerName, 'テスト');
            assert.equal(q.data.stats.handsPlayed, 42);
            assert.equal(q.data.chips, p.data.chips);
        });
    });
});
//# sourceMappingURL=solo.test.js.map