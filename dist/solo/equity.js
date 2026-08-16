/**
 * リアルタイム勝率・Equity 計算エンジン（仕様準拠のまとめ役）
 *
 * このモジュールは新しい評価ロジックを再発明しない。既に検証済みの
 * `solo/showdown.ts`（数え上げ＋モンテカルロ・フォールバック、タイ分割、マルチウェイ、
 * アウツ）を土台に、実装指示書が求める形へ整えるだけの薄い層である:
 *
 *   - 明示的な mode: AUTO / EXACT / MONTE_CARLO と AUTO 判定
 *   - win / tie / **lose** / equity を分離した PlayerEquityResult（+ 生カウントと samples）
 *   - 入力バリデーション（重複カード・不正ボード枚数・人数・ホール枚数）と型付きエラー
 *   - デッドカード（フォールドした既知札＝マック）をデッキから除外
 *   - seed 指定による決定的モンテカルロ（既存 createSeededRng を使用）
 *
 * 情報秘匿・配信・UI は既存のゲームサーバー（room.ts / protocol.ts / client）が担う。
 * ここは純粋計算だけを行い、副作用も I/O も持たない。
 *
 * ベンチマーク実測（solo/equity.bench.mjs, Node 24 / Apple Silicon、strays 無し）:
 *   river HU（1 runout）      0.03 ms
 *   turn  HU（44）            0.46 ms
 *   flop  HU（990）           11.4 ms
 *   flop  4-way              21.0 ms
 *   preflop HU MC 10k        177 ms
 *   preflop HU MC 40k        711 ms
 * これを根拠に AUTO はフロップ以降を必ず数え上げ（≤990、体感 0）とし、プリフロップ
 * （HU で 1,712,304 通り＝全列挙で約 27 秒）は既定でモンテカルロにしている。
 * 律速は 7 枚評価 scoreBest（21 通りの rank5）。実ゲームの利用箇所はオールイン段階公開で、
 * 数秒の演出中に 1 回だけ計算する（タイトループではない）ため上記で十分。
 * 将来もし範囲 vs 範囲をベット中にライブ更新する等でタイトループ化する場合は、
 * perfect-hash な 7 枚評価器（spec §16）へ差し替えるのが次の最適化ポイント。
 */
import { createSeededRng, parseCard } from '../src/cards.js';
import { scoreBest } from '../src/evaluator.js';
import { showdownEquity } from './showdown.js';
export class EquityError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'EquityError';
    }
}
/**
 * AUTO のデフォルト上限。フロップ以降（≤990 通り）は必ず数え上げ、プリフロップ（HU で
 * C(48,5)=1,712,304）は既定ではモンテカルロにする。実測でプリフロップ全列挙は約 27 秒かかり
 * リアルタイム表示に耐えないため（実装指示書 §7「preflop は実測性能に応じ完全列挙または MC」）。
 * mode:'EXACT' を明示すれば、下の HARD_EXACT_CEILING までは数え上げを強制できる。
 */
export const DEFAULT_MAX_EXACT_CASES = 200_000;
/** 安全弁：これを超える数え上げは EXACT 指定でも拒否する */
const HARD_EXACT_CEILING = 3_000_000;
const DEFAULT_SAMPLES = 40_000;
function isValidCard(c) {
    return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 51;
}
function streetOf(boardLen) {
    switch (boardLen) {
        case 0:
            return 'PREFLOP';
        case 3:
            return 'FLOP';
        case 4:
            return 'TURN';
        default:
            return 'RIVER';
    }
}
function choose(n, k) {
    if (k < 0 || k > n)
        return 0;
    let r = 1;
    for (let i = 0; i < k; i++)
        r = (r * (n - i)) / (i + 1);
    return Math.round(r);
}
/**
 * 入力を検証して正規化する。ショーダウン対象（active + all_in で手札既知）の席と、
 * デッキから除くべき全既知カード（board + 対象手札 + deadCards + フォールド既知手札）を返す。
 */
function validate(req) {
    const { players, board } = req;
    if (![0, 3, 4, 5].includes(board.length)) {
        throw new EquityError('INVALID_BOARD', `ボードは 0/3/4/5 枚（受領: ${board.length}）`);
    }
    for (const c of board) {
        if (!isValidCard(c))
            throw new EquityError('INVALID_CARD', `不正なカード: ${String(c)}`);
    }
    if (!Array.isArray(players) || players.length < 2 || players.length > 10) {
        throw new EquityError('INVALID_PLAYER_COUNT', `プレイヤーは 2〜10 人（受領: ${players?.length}）`);
    }
    const seen = new Map(); // card -> どこで見たか（重複メッセージ用）
    const claim = (c, where) => {
        if (!isValidCard(c))
            throw new EquityError('INVALID_CARD', `不正なカード: ${String(c)} (${where})`);
        if (seen.has(c)) {
            throw new EquityError('DUPLICATE_CARD', `カード重複: ${c} が ${seen.get(c)} と ${where} に存在`);
        }
        seen.set(c, where);
    };
    for (const c of board)
        claim(c, 'board');
    for (const c of req.deadCards ?? [])
        claim(c, 'dead');
    const contenders = [];
    const ids = [];
    const foldedKnown = [];
    const seatIds = new Set();
    players.forEach((p, i) => {
        if (seatIds.has(p.id)) {
            throw new EquityError('INVALID_PLAYER_COUNT', `playerId が重複: ${p.id}`);
        }
        seatIds.add(p.id);
        if (p.status === 'FOLDED') {
            // フォールドした既知札はデッド（マック）。ランアウトに出してはいけない
            if (p.holeCards) {
                for (const c of p.holeCards)
                    claim(c, `folded:${p.id}`);
                foldedKnown.push(...p.holeCards);
            }
            return;
        }
        // ACTIVE / ALL_IN は既知の 2 枚が必須（未知レンジは将来対応）
        if (!p.holeCards || p.holeCards.length !== 2) {
            throw new EquityError('INVALID_HOLE_CARDS', `${p.id} のホールカードは 2 枚必要`);
        }
        for (const c of p.holeCards)
            claim(c, `hole:${p.id}`);
        contenders.push({ seat: i, hole: [...p.holeCards] });
        ids.push(p.id);
    });
    if (contenders.length < 2) {
        throw new EquityError('NO_ACTIVE_PLAYERS', 'ショーダウン対象が 2 人未満');
    }
    return { contenders, ids, dead: [...(req.deadCards ?? []), ...foldedKnown] };
}
function chooseMode(req, boardLen, cases) {
    if (req.mode === 'EXACT') {
        if (cases > HARD_EXACT_CEILING) {
            throw new EquityError('CALCULATION_LIMIT_EXCEEDED', `数え上げケース ${cases} が上限を超過`);
        }
        return 'EXACT';
    }
    if (req.mode === 'MONTE_CARLO')
        return 'MONTE_CARLO';
    // AUTO: river/turn/flop は必ず数え上げ、それ以外はケース数で判断
    if (boardLen >= 3)
        return 'EXACT';
    const limit = req.maxExactCases ?? DEFAULT_MAX_EXACT_CASES;
    return cases <= limit ? 'EXACT' : 'MONTE_CARLO';
}
/**
 * 勝率・Equity を計算する（純関数）。
 * board 完成（RIVER）は 1 回評価、それ以外はモードに応じ数え上げ／モンテカルロ。
 */
export function calculateEquity(req) {
    const started = nowMs();
    const { contenders, ids, dead } = validate(req);
    const need = 5 - req.board.length;
    const knownCount = req.board.length + contenders.length * 2 + dead.length;
    const deckLeft = 52 - knownCount;
    if (deckLeft < need) {
        throw new EquityError('INVALID_CARD', 'デッキ残り枚数が不足（カード指定を確認）');
    }
    const cases = choose(deckLeft, need);
    const modeUsed = chooseMode(req, req.board.length, cases);
    const exactLimit = req.mode === 'EXACT' ? HARD_EXACT_CEILING : (req.maxExactCases ?? DEFAULT_MAX_EXACT_CASES);
    // seeded RNG は常に用意する（数え上げでは使われないが、閾値超過で MC に落ちても壊れない）。
    const seedUsed = req.seed ?? ((nowMs() * 1000) & 0x7fffffff) | 1;
    const rng = createSeededRng(seedUsed);
    const samples = req.samples ?? DEFAULT_SAMPLES;
    // 既存の検証済みコアへ委譲（デッドカードでマック札を除外、exactLimit でモードを制御）
    const core = showdownEquity(contenders, req.board, rng, samples, dead, exactLimit);
    void modeUsed;
    const total = core.samples;
    const players = core.seats.map((s, idx) => {
        const wins = Math.round(s.win * total);
        const ties = Math.round(s.tie * total);
        const losses = Math.max(0, total - wins - ties);
        return {
            playerId: ids[idx],
            equity: s.equity,
            winProbability: s.win,
            tieProbability: s.tie,
            loseProbability: Math.max(0, 1 - s.win - s.tie),
            wins,
            ties,
            losses,
            samples: total,
        };
    });
    return {
        modeUsed: core.exact ? 'EXACT' : 'MONTE_CARLO',
        street: streetOf(req.board.length),
        players,
        totalRunouts: total,
        calculationTimeMs: nowMs() - started,
        exact: core.exact,
        seed: core.exact ? undefined : (seedUsed & 0x7fffffff),
    };
}
/** 文字列カード（"As" 等）で呼びたいとき用の薄いヘルパ */
export function parsePlayerHole(a, b) {
    return [parseCard(a), parseCard(b)];
}
// ---------------------------------------------------------------------------
// 情報秘匿：勝率をいつ・誰の視点で見せるか（実装指示書 §34-36 / spec §21）
// ---------------------------------------------------------------------------
/**
 * 勝率の公開モード。
 *   NONE                 … 表示しない
 *   HERO_VS_UNKNOWN      … 対戦中の既定。自分の手札 vs「未知の相手（一様ランダム）」の主観勝率。
 *                          相手の実手札を一切見ないので、数値から相手の強さは漏れない。
 *   SHOWDOWN_ONLY        … 全員オールイン等で手札が公開されて初めて実カードの正確な勝率を見せる。
 *   SPECTATOR_ALL_KNOWN  … 観戦専用チャンネルのみ。プレイヤー Client へは送らない（要権限）。
 *   REPLAY               … ハンド終了後の再生。
 */
export var EquityVisibilityMode;
(function (EquityVisibilityMode) {
    EquityVisibilityMode["NONE"] = "NONE";
    EquityVisibilityMode["HERO_VS_UNKNOWN"] = "HERO_VS_UNKNOWN";
    EquityVisibilityMode["SHOWDOWN_ONLY"] = "SHOWDOWN_ONLY";
    EquityVisibilityMode["SPECTATOR_ALL_KNOWN"] = "SPECTATOR_ALL_KNOWN";
    EquityVisibilityMode["REPLAY"] = "REPLAY";
})(EquityVisibilityMode || (EquityVisibilityMode = {}));
/**
 * 「この視点・この局面で、実カードの勝率を出してよいか」を判定するポリシー。
 * サーバーが配信内容を組み立てる前に必ずここを通す想定（room.ts が実装で担保している挙動の明文化）。
 */
export function resolveVisibility(ctx) {
    if (ctx.isReplay)
        return EquityVisibilityMode.REPLAY;
    if (ctx.isSpectator) {
        return ctx.spectatorAuthorized ? EquityVisibilityMode.SPECTATOR_ALL_KNOWN : EquityVisibilityMode.NONE;
    }
    // プレイヤー本人視点：手札公開後のみ実カード勝率、それ以外は主観（vs 未知）
    if (ctx.handComplete && ctx.cardsPublic)
        return EquityVisibilityMode.SHOWDOWN_ONLY;
    return EquityVisibilityMode.HERO_VS_UNKNOWN;
}
/**
 * 主観勝率：自分の手札を、未知の相手（残りデッキからの一様ランダム 2 枚 × oppCount 人）に対して評価する。
 *
 * ★情報漏洩しないことの根拠★
 *   引数は hole / board / oppCount（＝人数）だけで、**相手の実手札を受け取らない**。
 *   よって出力は自分の手札・公開ボード・相手人数の純関数であり、相手の強さに依存し得ない。
 *   ボードが進んで数値が下がっても、それは公開情報から誰でも導ける変化であり、
 *   「自分が実際に負けている」ことは漏れない（＝完全情報の Showdown Equity を出してはいけない場面用）。
 *
 * seed を渡せば決定的（表示のちらつき防止・テスト再現）。tie は取り分（1/winners）で数える。
 */
export function heroEquityVsUnknown(hole, board, oppCount, opts) {
    if (hole.length !== 2 || oppCount < 1)
        return 0;
    const iters = opts?.iters ?? 600;
    const rng = createSeededRng(opts?.seed ?? 0x9e3779b9);
    const known = new Set([...hole, ...board]);
    const deck = [];
    for (let c = 0; c < 52; c++)
        if (!known.has(c))
            deck.push(c);
    const boardNeed = 5 - board.length;
    const drawCount = oppCount * 2 + boardNeed; // 相手の手札 + 残りボード
    if (drawCount > deck.length)
        return 0;
    const scratch = new Array(7);
    const fullBoard = new Array(5);
    for (let i = 0; i < board.length; i++)
        fullBoard[i] = board[i];
    let sum = 0;
    for (let it = 0; it < iters; it++) {
        // 部分 Fisher–Yates：必要な drawCount 枚だけ前方へ確定させる
        for (let i = 0; i < drawCount; i++) {
            const j = i + rng.randomInt(deck.length - i);
            const t = deck[i];
            deck[i] = deck[j];
            deck[j] = t;
        }
        // 残りボードを埋める（相手手札は deck[0..oppCount*2)、ボードは deck[oppCount*2 .. drawCount)）
        for (let b = 0; b < boardNeed; b++)
            fullBoard[board.length + b] = deck[oppCount * 2 + b];
        scratch[0] = hole[0];
        scratch[1] = hole[1];
        for (let b = 0; b < 5; b++)
            scratch[2 + b] = fullBoard[b];
        const mine = scoreBest(scratch);
        let best = mine;
        let iAmBest = true;
        let winners = 1;
        for (let k = 0; k < oppCount; k++) {
            scratch[0] = deck[k * 2];
            scratch[1] = deck[k * 2 + 1];
            const os = scoreBest(scratch);
            if (os > best) {
                best = os;
                iAmBest = false;
            }
            else if (os === best && iAmBest)
                winners++;
        }
        if (iAmBest)
            sum += 1 / winners;
    }
    return sum / iters;
}
function nowMs() {
    // Date.now が使えない実行環境（ワークフロー等）でも壊れないようにフォールバック
    try {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
    }
    catch {
        /* noop */
    }
    return typeof Date !== 'undefined' ? Date.now() : 0;
}
//# sourceMappingURL=equity.js.map