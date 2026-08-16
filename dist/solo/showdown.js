/**
 * オールイン後の勝率とアウツ
 *
 * ここが普段のエクイティ推定（solo/ai.ts）と決定的に違うのは、
 * **全員の手札が分かっている**ことです。伏せられた札が無いので、
 * 残りの山札から出る並びを全部数え上げれば、推定ではなく正確な勝率が出せます。
 *
 * 数え上げの規模：
 *   ターン以降（残り 1 枚）… 40 通り前後
 *   フロップ以降（残り 2 枚）… 600〜1,000 通り
 *   プリフロップ（残り 5 枚）… 60 万〜170 万通り
 *
 * 最後だけは重いので、閾値を超えたらモンテカルロに切り替えます。
 * ただし表示は「約 62%」のように丸めるので、どちらでも見た目は変わりません。
 *
 * アウツは「次の 1 枚がそれなら、その瞬間に自分が単独首位になる札」と定義しています。
 * 世間で言うアウツと同じ意味で、しかも数え上げれば厳密に出せます。
 */
import { freshDeck } from '../src/cards.js';
import { scoreBest } from '../src/evaluator.js';
/** 数え上げをやめてモンテカルロに切り替える組み合わせ数 */
const EXACT_LIMIT = 300_000;
/**
 * まだ場に出ていない札。
 *
 * deadCards には「サーバーは知っているが、もう山札には戻らない札」を渡す。
 * 典型例はフォールドした席の既知ホールカード（マックに行った＝以後のランアウトに出得ない）。
 * これを山札に残すと勝率・アウツがわずかに歪むため、必ず除外する。
 */
export function remainingDeck(players, board, deadCards = []) {
    const used = new Set(board);
    for (const p of players)
        for (const c of p.hole)
            used.add(c);
    for (const c of deadCards)
        used.add(c);
    return freshDeck().filter((c) => !used.has(c));
}
/**
 * 現時点で首位に立っている席。
 * 同点なら複数返る。ボードが 3 枚未満のときは役が決まらないので空を返す。
 */
export function currentLeaders(players, board) {
    if (board.length < 3)
        return [];
    let best = -1;
    let leaders = [];
    for (const p of players) {
        const s = scoreBest([...p.hole, ...board]);
        if (s > best) {
            best = s;
            leaders = [p.seat];
        }
        else if (s === best) {
            leaders.push(p.seat);
        }
    }
    return leaders;
}
/**
 * 配られた 1 手ぶんの勝ち負けを集計に足す。
 *
 * ここは数十万〜数百万回まわるホットパスなので、割り当てと評価回数を最小化する:
 *   - スクラッチバッファ scratch（ホール 2 枚 + ボード）を使い回し、毎回の配列生成を避ける
 *   - 各プレイヤーの役は 1 回だけ評価し scores に保存（従来は最高点探索で 2 回評価していた）
 */
function tally(players, full, wins, ties, share, scratch, scores) {
    let best = -1;
    let winners = 0;
    const holeLen = players[0].hole.length; // Hold'em は常に 2
    for (let i = 0; i < full.length; i++)
        scratch[holeLen + i] = full[i];
    for (let i = 0; i < players.length; i++) {
        const hole = players[i].hole;
        for (let j = 0; j < holeLen; j++)
            scratch[j] = hole[j];
        const s = scoreBest(scratch);
        scores[i] = s;
        if (s > best) {
            best = s;
            winners = 1;
        }
        else if (s === best) {
            winners++;
        }
    }
    const shareEach = 1 / winners;
    for (let i = 0; i < players.length; i++) {
        if (scores[i] !== best)
            continue;
        if (winners === 1)
            wins[i]++;
        else
            ties[i]++;
        share[i] += shareEach;
    }
}
/** n 個から k 個を選ぶ組み合わせの数 */
function choose(n, k) {
    if (k < 0 || k > n)
        return 0;
    let r = 1;
    for (let i = 0; i < k; i++)
        r = (r * (n - i)) / (i + 1);
    return Math.round(r);
}
/**
 * 全員の手札が見えている状態での勝率。
 * board が 5 枚なら結果は確定しているので、勝者が 1（または同点で等分）になる。
 */
export function showdownEquity(players, board, rng, maxTrials = 20_000, deadCards = [], exactLimit = EXACT_LIMIT) {
    const n = players.length;
    const wins = new Array(n).fill(0);
    const ties = new Array(n).fill(0);
    const share = new Array(n).fill(0);
    const deck = remainingDeck(players, board, deadCards);
    const need = 5 - board.length;
    const total = choose(deck.length, need);
    const exact = need === 0 || total <= exactLimit;
    let samples = 0;
    // ホットパスで使い回すバッファ（毎手の配列生成・GC を避ける）
    const holeLen = players[0].hole.length;
    const scratch = new Array(holeLen + 5);
    const scores = new Array(n);
    if (exact) {
        const full = [...board, ...new Array(need).fill(0)];
        const idx = new Array(need).fill(0);
        // need 枚の組み合わせを辞書順に回す
        const walk = (start, depth) => {
            if (depth === need) {
                for (let i = 0; i < need; i++)
                    full[board.length + i] = deck[idx[i]];
                tally(players, full, wins, ties, share, scratch, scores);
                samples++;
                return;
            }
            for (let i = start; i <= deck.length - (need - depth); i++) {
                idx[depth] = i;
                walk(i + 1, depth + 1);
            }
        };
        walk(0, 0);
    }
    else {
        if (!rng)
            throw new Error('数え上げが重い局面では rng が必要です');
        const pool = deck.slice();
        const full = [...board, ...new Array(need).fill(0)];
        for (let t = 0; t < maxTrials; t++) {
            // 必要な枚数だけ部分シャッフルする。全体を混ぜる必要はない
            for (let i = 0; i < need; i++) {
                const j = i + rng.randomInt(pool.length - i);
                const tmp = pool[i];
                pool[i] = pool[j];
                pool[j] = tmp;
                full[board.length + i] = pool[i];
            }
            tally(players, full, wins, ties, share, scratch, scores);
            samples++;
        }
    }
    return {
        exact,
        samples,
        seats: players.map((p, i) => ({
            seat: p.seat,
            win: wins[i] / samples,
            tie: ties[i] / samples,
            equity: share[i] / samples,
        })),
    };
}
/**
 * 各席のアウツ。
 *
 * 「次の 1 枚がそれなら単独首位になる札」を数えます。
 * すでに首位の席は追いかける必要がないので空を返し、`leading` で区別できるようにしています。
 * ボードが 5 枚（もう引く札が無い）なら、当然すべて空です。
 */
export function outsFor(players, board, deadCards = []) {
    const leaders = new Set(currentLeaders(players, board));
    const deck = remainingDeck(players, board, deadCards);
    if (board.length >= 5) {
        return players.map((p) => ({ seat: p.seat, cards: [], leading: leaders.has(p.seat) }));
    }
    return players.map((p) => {
        if (leaders.has(p.seat))
            return { seat: p.seat, cards: [], leading: true };
        const cards = [];
        for (const c of deck) {
            const next = [...board, c];
            const after = currentLeaders(players, next);
            if (after.length === 1 && after[0] === p.seat)
                cards.push(c);
        }
        return { seat: p.seat, cards, leading: false };
    });
}
/**
 * ショーダウンの台本を組み立てる。
 * runout は最終的に場に出る 5 枚のうち、まだ出ていないぶん。
 */
export function buildRevealScript(players, board, runout, rng) {
    const steps = [];
    let cur = [...board];
    let prevLeaders = currentLeaders(players, cur);
    steps.push({
        card: null,
        board: [...cur],
        equity: showdownEquity(players, cur, rng).seats,
        outs: outsFor(players, cur),
        leaders: prevLeaders,
        leadChanged: false,
        final: runout.length === 0,
    });
    for (let i = 0; i < runout.length; i++) {
        cur = [...cur, runout[i]];
        const leaders = currentLeaders(players, cur);
        // 首位の顔ぶれが変わったかどうか。人数が同じでも中身が違えば逆転
        const changed = prevLeaders.length > 0 &&
            (leaders.length !== prevLeaders.length || leaders.some((s) => !prevLeaders.includes(s)));
        steps.push({
            card: runout[i],
            board: [...cur],
            equity: showdownEquity(players, cur, rng).seats,
            outs: outsFor(players, cur),
            leaders,
            leadChanged: changed,
            final: i === runout.length - 1,
        });
        prevLeaders = leaders;
    }
    return steps;
}
//# sourceMappingURL=showdown.js.map