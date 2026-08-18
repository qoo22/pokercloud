import { evaluateBest, scoreBest, HandCategory } from '../evaluator.js';
// ---------------------------------------------------------------- 自己学習チューニング
/**
 * 意思決定の主要ノブ。既定値=これまで理論から較正した値。
 * self_improve.mjs が自己対戦で最適化し、tuned_params.json 経由で本番botに反映される。
 * 各値の意味と探索範囲は TUNING_BOUNDS を参照。
 */
export const TUNE = {
    preLoose: 0, // プリフロップ全体の緩さ(±。圏外拾い/境界絞り)
    threeBetScale: 1, // 3ベットブラフ頻度の倍率
    bbCallBonus: 0.05, // BBのコール防御ボーナス
    cbetAggr: 0.6, // アグレッサーのベット基本頻度
    cbetNon: 0.3, // 非アグレッサーのスタブ/プローブ基本頻度
    oopPenalty: 0.1, // OOPの防御閾値ペナルティ
    smallBetDef: 0.04, // 小さいベットへの防御拡大
    valueThr: 0.56, // フロップ/ターンのバリューベット閾値
    valueThrRiver: 0.6, // リバーのバリューベット閾値
    semibluffF: 0.6, // FD/OESDセミブラフ基本頻度
    bluffBase: 0.12, // 純ブラフ基本頻度
    xrFreq: 0.28, // セミブラフチェックレイズ頻度
    onePairTurnCheck: 0.6, // IP1ペアのターンチェック率
    probeBoost: 0.2, // ドロー完成ターンのプローブ増分
    solverGate: 1, // CFRソルバー使用率の倍率
    valueRaiseSize: 0.8, // バリューレイズの基本サイズ(ポット比)
};
export const TUNING_BOUNDS = {
    preLoose: [-0.08, 0.12], threeBetScale: [0.3, 2.2], bbCallBonus: [0, 0.15],
    cbetAggr: [0.35, 0.85], cbetNon: [0.1, 0.55], oopPenalty: [0.02, 0.2],
    smallBetDef: [0, 0.1], valueThr: [0.46, 0.66], valueThrRiver: [0.5, 0.72],
    semibluffF: [0.3, 0.9], bluffBase: [0.02, 0.3], xrFreq: [0.05, 0.55],
    onePairTurnCheck: [0.2, 0.9], probeBoost: [0, 0.4], solverGate: [0.4, 1.0],
    valueRaiseSize: [0.55, 1.2],
};
/** 部分更新(境界へクランプ)。トレーナーが席ごとに切り替えるのにも使う */
export function setTuning(partial) {
    for (const k of Object.keys(partial)) {
        const v = partial[k];
        if (typeof v !== 'number' || !Number.isFinite(v))
            continue;
        const [lo, hi] = TUNING_BOUNDS[k];
        TUNE[k] = Math.max(lo, Math.min(hi, v));
    }
}
export function getTuning() {
    return { ...TUNE };
}
/**
 * 自己学習の成果(tuned_params.json)があれば読み込む。
 * dist/src/server/ から見て3つ上 = poker-engine/ (または poker-cloud/) 直下を探す。
 * 無ければ既定値のまま(エラーにしない)。
 */
export async function loadTunedParams() {
    try {
        const { readFileSync } = await import('node:fs');
        const url = new URL('../../../tuned_params.json', import.meta.url);
        const data = JSON.parse(readFileSync(url, 'utf8'));
        if (data && typeof data === 'object' && data.params) {
            setTuning(data.params);
            return decodeURIComponent(url.pathname);
        }
    }
    catch { /* ファイルが無い/壊れている → 既定値 */ }
    return null;
}
// ---------------------------------------------------------------- フロップ・ブループリント(第4部フェーズ3)
//
// 頻出フロップの均衡戦略を「事前に」CFRで解き、コンパクトな表(flop_blueprint.json)に蒸留しておく。
// 実行時はその場でソルバーを回さず、表を引いて頻度どおりにアクションをサンプルするだけ——
//   ・毎手のCFRを省けるので高速(ソルバー適用率を実質100%へ引き上げられる)
//   ・同じ局面は常に同じ戦略分布 → ブレない
//   ・「どのハンドをどう打つか」という戦略の構造そのものを持てる(学習成果の可搬な資産)
// 表は起動時に一度だけローカルから読むだけ(tuned_params.json と同じ)。外部送信はゼロ。
//
// キー = `${flopClass}|${role}|${potType}|${sprBand}` の下に、ハンドバケットごとの分布を持つ:
//   firstIn(先手)     : {check, betS(小), betB(大)}
//   faceS/faceB/faceJam: 小ベット/大ベット/ジャムに直面 {fold, call, raise}
// flopClass / role / potType / sprBand / handBucket は、オフラインでも実行時でも
// 同一に再現できる決定的な関数で作る(ここがズレると表を引けなくなる)。
//
// ベットサイズごとに応答を分けているのは、MDF(最低防御頻度)がサイズで大きく変わるため。
// 以前は最小サイズの応答だけを持ち、75%にもジャムにも同じ分布を使っていて、
// 大きいベットに対して降り過ぎ／small betに対して守り過ぎになっていた。
// DCFR(Discounted CFR)の割引パラメータ。原論文の推奨値。
// 正のリグレットは緩やかに、負のリグレットは強く減衰させ、平均戦略は後半を重く見る。
const DCFR_ALPHA = 1.5;
const DCFR_BETA = 0;
const DCFR_GAMMA = 2;
/**
 * ブループリント表の形式バージョン。
 * v1 = `flopClass|role` + face 1種類 / v2 = potType・sprBand を加え、face をサイズ別に持つ。
 * 形式を変えたら必ず上げること(古い表を読み込んで挙動が混ざるのを防ぐ)。
 */
export const BLUEPRINT_VERSION = 2;
/**
 * ポットの種類。3ベットポットはレンジ構成もSPRもSRPと別物なので分けて持つ。
 * 判定はプリフロップのレンジ記述(heroSpec/villainSpec)が3ベット系かどうかで行う——
 * bots 側が実際の行動から割り当てたレンジなので、これがそのまま局面の種類になる。
 */
export function flopPotType(heroSpec, villSpec) {
    const threeBet = new Set([
        VILLAIN_PRE.threeBettor, VILLAIN_PRE.threeBetCaller,
        VILLAIN_PRE.fourBettor, VILLAIN_PRE.fourBetCaller,
    ]);
    return threeBet.has(heroSpec ?? '') || threeBet.has(villSpec ?? '') ? '3bet' : 'srp';
}
/**
 * SPR(スタック/ポット比)の帯。低SPRではコミット判断が別物になるので分けて解く。
 * 境界は 3 と 8。3ベットポットは概ね low、SRPは mid〜high に落ちる。
 */
export function flopSprBand(spr) {
    return spr <= 3 ? 'low' : spr <= 8 ? 'mid' : 'high';
}
/** 表のキーを組み立てる(オフライン生成と実行時参照で必ず同じ関数を使う) */
export function blueprintKey(flopCls, role, potType, sprBand) {
    return `${flopCls}|${role}|${potType}|${sprBand}`;
}
let BLUEPRINT = null;
export function setBlueprint(bp) { BLUEPRINT = bp; }
export function getBlueprint() { return BLUEPRINT; }
/**
 * フロップのテクスチャを少数の戦略クラスへ写す(スート同型を吸収)。
 * ペア/モノトーン/ハイカード階層 × ウェット(2トーン or コネクト)で ~11 クラス。
 */
export function flopClass(board) {
    if (board.length !== 3)
        return 'other';
    const t = classifyTexture(board);
    const ranks = board.map((c) => (c >> 2) + 2).sort((a, b) => b - a);
    const hi = ranks[0];
    if (t.paired)
        return hi >= 10 ? 'paired-hi' : 'paired-lo';
    if (t.monotone)
        return 'mono';
    const wet = t.twoTone || t.connected ? 'wet' : 'dry';
    const level = hi === 14 ? 'A' : hi >= 11 ? 'B' : hi >= 9 ? 'M' : 'L'; // A / ブロードウェイ / ミドル / ロー
    return `${level}-${wet}`;
}
/** ポジション×プリフロップアグレッサーの役割ラベル(4種) */
export function flopRole(inPosition, wasAggressor) {
    return `${inPosition ? 'ip' : 'oop'}-${wasAggressor ? 'agg' : 'def'}`;
}
/**
 * ハンドをフロップ上で決定的な強さバケットへ写す(madeScore + ドローのアウツ)。
 * オフライン蒸留と実行時ルックアップで完全に一致する(サンプリング非依存)。
 */
export function flopHandBucket(hole, board) {
    const s = madeScore(hole, board);
    if (s >= 0.9)
        return 'monster'; // ストレート+/セット/フラッシュ
    if (s >= 0.78)
        return 'strong'; // ツーペア/弱いセット
    if (s >= 0.62)
        return 'toppair'; // オーバーペア/トップペア good
    if (s >= 0.5)
        return 'midpair'; // 弱いトップペア/上位ポケット
    const d = drawFeatures(hole, board);
    // 大きいドローはペアより先に見る(ペア+FDはブラフキャッチではなく攻めの手)
    if (d.outs >= 8)
        return 'bigdraw';
    // セカンドペア/ボトムペア/下位ポケット。ショーダウンバリューがありエアとは別物
    // (ブラフキャッチャーとして振る舞うので、エアに混ぜると降り過ぎ・打ち過ぎになる)
    if (s >= 0.34)
        return 'weakpair';
    if (d.outs >= 4)
        return 'weakdraw';
    return 'air';
}
/**
 * ブループリントを引いてアクションをサンプルする。表に無ければ null(→通常経路へ)。
 *
 * ベットに直面しているときは、相手のベットサイズ(ポット比)に一番近い応答分布を選ぶ。
 * 小さいベットには広く受け、大きいベットには絞る——という MDF の効き方を表で再現するため。
 */
export function blueprintAction(c) {
    const bp = BLUEPRINT;
    if (!bp || c.street !== 'flop' || c.board.length !== 3)
        return null;
    // ストリート開始時点のポット(＝相手のベットを除いたポット)でSPRとベット比を測る
    const potStart0 = Math.max(1, c.pot - c.toCall);
    const key = blueprintKey(flopClass(c.board), flopRole(c.inPosition, c.wasAggressor), flopPotType(c.heroSpec, c.villainSpec), flopSprBand(c.myStack / potStart0));
    const byBucket = bp.nodes[key];
    if (!byBucket)
        return null;
    const node = byBucket[flopHandBucket(c.hole, c.board)];
    if (!node)
        return null;
    let dist;
    if (c.toCall <= 0) {
        dist = node.firstIn;
    }
    else {
        // 実際のベット比に近い方を使う。スタックを脅かす額はジャム扱い
        const frac = c.toCall / potStart0;
        const jamLike = c.toCall >= c.myStack * 0.6;
        const mid = (bp.sizes.betS + bp.sizes.betB) / 2;
        dist = jamLike ? node.faceJam : frac <= mid ? node.faceS : node.faceB;
        // 空(そのサイズを解いていない)なら隣のサイズで代替する
        if (!dist || Object.keys(dist).length === 0)
            dist = node.faceB ?? node.faceS;
        if (!dist || Object.keys(dist).length === 0)
            dist = node.faceS;
    }
    if (!dist)
        return null;
    const entries = Object.entries(dist).filter(([, v]) => (v ?? 0) > 0);
    let total = 0;
    for (const [, v] of entries)
        total += v ?? 0;
    if (total <= 0)
        return null;
    let x = c.rnd() * total;
    let label = entries[entries.length - 1][0];
    for (const [k, v] of entries) {
        x -= v ?? 0;
        if (x <= 0) {
            label = k;
            break;
        }
    }
    const potStart = potStart0;
    switch (label) {
        case 'check': return c.toCall > 0 ? { action: 'call' } : { action: 'check' };
        case 'fold': return c.toCall > 0 ? { action: 'fold' } : { action: 'check' };
        case 'call': return c.toCall > 0 ? { action: 'call' } : { action: 'check' };
        case 'betS': return { action: 'raise', to: Math.round(c.currentBet + (potStart + c.toCall) * bp.sizes.betS) };
        case 'betB': return { action: 'raise', to: Math.round(c.currentBet + (potStart + c.toCall) * bp.sizes.betB) };
        case 'raise': return { action: 'raise', to: Math.round(c.currentBet + (potStart + c.toCall) * bp.sizes.betB) };
        default: return null;
    }
}
/**
 * ブループリント(flop_blueprint.json)があれば読み込む。tuned_params.json と同じ場所を探す。
 * 無ければ null(エラーにしない)。読み込めた場合はファイルパスを返す。
 */
export async function loadBlueprint() {
    try {
        const { readFileSync } = await import('node:fs');
        const url = new URL('../../../flop_blueprint.json', import.meta.url);
        const data = JSON.parse(readFileSync(url, 'utf8'));
        if (data && data.nodes && data.sizes && Object.keys(data.nodes).length > 0) {
            // 古い形式(v1: キーに potType/sprBand が無く、face がサイズ別でない)は読み込まない。
            // 中途半端に読むと「先手だけ表・被弾はソルバー」という分かりにくい状態になるため、
            // 作り直しを促してソルバーにフォールバックさせる
            if (data.version !== BLUEPRINT_VERSION) {
                console.warn(`フロップ・ブループリントの形式が古いため読み込みません ` +
                    `(v${data.version} → 要 v${BLUEPRINT_VERSION})。node build_blueprint.mjs で作り直してください`);
                return null;
            }
            setBlueprint(data);
            return decodeURIComponent(url.pathname);
        }
    }
    catch { /* 無い/壊れている → ブループリント無しで動作 */ }
    return null;
}
// ---------------------------------------------------------------- レンジ記法
const RANKS = '23456789TJQKA';
const rv = (c) => RANKS.indexOf(c) + 2; // '2'→2 .. 'A'→14
const rc = (v) => RANKS[v - 2];
/** "66+, A3s+, KTo+, A2s-A5s, JJ:0.5, AK" → Map<ハンドタイプ, 頻度0..1> */
function parseRange(spec) {
    const out = new Map();
    const put = (t, w) => out.set(t, Math.max(out.get(t) ?? 0, w));
    for (let tok of spec.split(',')) {
        tok = tok.trim();
        if (!tok)
            continue;
        let w = 1;
        const ci = tok.indexOf(':');
        if (ci >= 0) {
            w = Number(tok.slice(ci + 1)) || 1;
            tok = tok.slice(0, ci);
        }
        const m = tok.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)(\+?)(?:-([2-9TJQKA])([2-9TJQKA])[so]?)?$/);
        if (!m)
            continue;
        const [, h1, l1, so, plus, h2, l2] = m;
        const hi = rv(h1), lo = rv(l1);
        if (hi === lo) {
            // ペア: "JJ" / "66+" / "22-JJ"
            const top = h2 ? rv(h2) : plus ? 14 : hi;
            for (let r = Math.min(hi, top); r <= Math.max(hi, top); r++)
                put(rc(r) + rc(r), w);
        }
        else {
            const H = Math.max(hi, lo), L = Math.min(hi, lo);
            const suits = so ? [so] : ['s', 'o'];
            let kickers = [L];
            if (plus) {
                kickers = [];
                for (let k = L; k < H; k++)
                    kickers.push(k);
            }
            else if (h2 && l2) {
                const L2 = Math.min(rv(h2), rv(l2));
                kickers = [];
                for (let k = Math.min(L, L2); k <= Math.max(L, L2); k++)
                    kickers.push(k);
            }
            for (const k of kickers)
                for (const s of suits)
                    put(rc(H) + rc(k) + s, w);
        }
    }
    return out;
}
const rangeCache = new Map();
function R(spec) {
    let r = rangeCache.get(spec);
    if (!r) {
        r = parseRange(spec);
        rangeCache.set(spec, r);
    }
    return r;
}
/** ハンドがレンジに入っている頻度 (0..1) */
function freq(spec, type) { return R(spec).get(type) ?? 0; }
/** 2枚のカード → "AKs"/"AKo"/"TT" */
export function handTypeOf(a, b) {
    const r1 = (a >> 2) + 2, r2 = (b >> 2) + 2;
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    if (r1 === r2)
        return rc(hi) + rc(hi);
    return rc(hi) + rc(lo) + (((a & 3) === (b & 3)) ? 's' : 'o');
}
// ------------------------------------------------ レンジ対エクイティ (V2仕様 §6/§8)
const mkCard = (rank, suit) => (((rank - 2) << 2) | suit);
const comboCache = new Map();
function combosOf(spec) {
    let t = comboCache.get(spec);
    if (t)
        return t;
    const combos = [];
    for (const [type, w] of R(spec)) {
        if (w <= 0)
            continue;
        const hi = rv(type[0]), lo = rv(type[1]);
        if (hi === lo) {
            for (let s1 = 0; s1 < 4; s1++)
                for (let s2 = s1 + 1; s2 < 4; s2++)
                    combos.push([mkCard(hi, s1), mkCard(hi, s2), w]);
        }
        else if (type[2] === 's') {
            for (let s1 = 0; s1 < 4; s1++)
                combos.push([mkCard(hi, s1), mkCard(lo, s1), w]);
        }
        else {
            for (let s1 = 0; s1 < 4; s1++)
                for (let s2 = 0; s2 < 4; s2++)
                    if (s1 !== s2)
                        combos.push([mkCard(hi, s1), mkCard(lo, s2), w]);
        }
    }
    const cum = [];
    let total = 0;
    for (const c of combos) {
        total += c[2];
        cum.push(total);
    }
    t = { combos, cum, total };
    comboCache.set(spec, t);
    return t;
}
/**
 * モンテカルロで「自分のハンド vs 相手レンジ」の実エクイティを求める。
 * Raw Equity > Pot Odds 判定の基礎(V2 §8/§10)。ドローの完成もランアウトに含まれる。
 * tighten: 相手がポストフロップで攻めた回数。トーナメント選択(候補をtighten+1個
 * 引いて現時点で最強のものを採用)でレンジ上位へ寄せる — ベイズ更新(§6.3)の軽量近似。
 */
export function equityVsRange(hole, board, spec, opts) {
    const table = combosOf(spec);
    if (!table.combos.length || hole.length < 2)
        return null;
    const iters = opts?.iters ?? 130;
    const tighten = Math.max(0, Math.min(2, Math.round(opts?.tighten ?? 0)));
    const r = opts?.rnd ?? Math.random;
    const blocked = new Set([...hole, ...board]);
    const deck = [];
    for (let rank = 2; rank <= 14; rank++)
        for (let su = 0; su < 4; su++) {
            const c = mkCard(rank, su);
            if (!blocked.has(c))
                deck.push(c);
        }
    const need = 5 - board.length;
    const pickCombo = () => {
        for (let tries = 0; tries < 30; tries++) {
            const x = r() * table.total;
            // 二分探索で重みサンプリング
            let lo = 0, hi2 = table.cum.length - 1;
            while (lo < hi2) {
                const mid = (lo + hi2) >> 1;
                if (table.cum[mid] < x)
                    lo = mid + 1;
                else
                    hi2 = mid;
            }
            const cb = table.combos[lo];
            if (!blocked.has(cb[0]) && !blocked.has(cb[1]))
                return [cb[0], cb[1]];
        }
        return null;
    };
    let sum = 0, n = 0;
    for (let i = 0; i < iters; i++) {
        let vill = pickCombo();
        if (!vill)
            break;
        // トーナメント選択: 攻めている相手ほど現時点で強いハンドに寄せる
        for (let k = 0; k < tighten; k++) {
            const alt = pickCombo();
            if (alt && board.length >= 3 &&
                scoreBest([...alt, ...board]) > scoreBest([...vill, ...board]))
                vill = alt;
        }
        // ランアウト(部分Fisher-Yates)
        const run = [];
        if (need > 0) {
            let avail = deck.filter((c) => c !== vill[0] && c !== vill[1]);
            for (let k = 0; k < need; k++) {
                const j = k + Math.floor(r() * (avail.length - k));
                const tmp = avail[k];
                avail[k] = avail[j];
                avail[j] = tmp;
                run.push(avail[k]);
            }
        }
        const full = [...board, ...run];
        const hs = scoreBest([...hole, ...full]);
        const vs = scoreBest([...vill, ...full]);
        sum += hs > vs ? 1 : hs === vs ? 0.5 : 0;
        n++;
    }
    return n > 0 ? sum / n : null;
}
const RFI = {
    UTG: '66+, A3s+, K8s+, Q9s+, J9s+, T9s, ATo+, KJo+, QJo',
    HJ: '55+, A2s+, K6s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KTo+, QTo+',
    CO: '33+, A2s+, K3s+, Q6s+, J8s+, T7s+, 97s+, 87s, 76s, A8o+, KTo+, QTo+, JTo',
    BTN: '22+, A2s+, K2s+, Q3s+, J4s+, T6s+, 96s+, 85s+, 75s+, 64s+, 53s+, 43s, A4o+, K8o+, Q9o+, J9o+, T8o+, 98o',
    SB: '22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 96s+, 86s+, 75s+, 65s, 54s, A2o+, K7o+, Q9o+, J9o+, T8o+, 98o',
    BB: '',
};
/** 相手のプリフロップの行動から割り当てるレンジ(V2 §6.3 の初期信念。bots側が参照) */
export const VILLAIN_PRE = {
    raiserEarly: RFI.UTG,
    raiserMid: RFI.CO,
    raiserLate: RFI.BTN,
    threeBettor: 'TT+, AQs+, AJs, A5s-A2s, KQs, KJs, AKo, AQo:0.5, 76s:0.3, 65s:0.3',
    // 3ベットにコールした側(A-5/CALL_3BET相当): ポケット+スーテッドブロードウェイ+AQ系
    threeBetCaller: '22+:0.7, AQs, AJs, ATs:0.5, KQs, KJs:0.5, QJs, JTs, T9s:0.5, 98s:0.4, AQo:0.5, KQo:0.3',
    // 4ベットした側(A-5相当): QQ+/AK + A5s系ブラフ
    fourBettor: 'QQ+, AKs, AKo:0.7, JJ:0.35, A5s:0.6, A4s:0.4, KQs:0.25',
    // 4ベットにコールした側: JJ/TT/AQs中心(QQ+/AKの一部はジャムに回る)
    fourBetCaller: 'JJ, TT:0.6, QQ:0.5, AQs, KQs:0.4, AKo:0.4, AKs:0.3',
    caller: '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, 54s, ATo+, KTo+, QTo+, JTo',
    bbDefend: '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A5o+, K9o+, Q9o+, J9o+, T9o, 98o',
    wide: '22+, A2s+, K2s+, Q2s+, J2s+, T4s+, 95s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K5o+, Q7o+, J7o+, T7o+, 97o+, 86o+, 76o, 65o',
};
// ヘッズアップは質的に別(参加率60-70%)
const HU_SB_OPEN = '22+, A2s+, K2s+, Q2s+, J4s+, T5s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K2o+, Q4o+, J6o+, T6o+, 96o+, 86o+, 75o+, 65o';
const HU_BB_3BET = 'JJ+, AK, AQs, A5s-A2s, KJs+, QJs, T9s:0.5, 98s:0.5, AJo:0.5, KQo:0.5';
const HU_BB_CALL = '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 86s+, 75s+, 65s, 54s, A2o+, K7o+, Q9o+, J9o+, T9o, 98o';
// 3ベット(コールドの立場)。オープナーが前 vs 後ろで分ける
const THREEBET_VS_EARLY = 'QQ+, JJ:0.5, AKs, AKo, AQs:0.4, A5s:0.6, A4s:0.5, KJs:0.3, 76s:0.25, 65s:0.25';
const THREEBET_VS_LATE = 'TT+, AK, AQs, AJs:0.5, ATs:0.35, A5s-A2s:0.5, KJs:0.5, KTs:0.35, QTs+:0.35, JTs:0.35, 87s:0.3, 76s:0.3, 65s:0.3, AJo:0.35, KQo:0.35';
const COLDCALL_BTN = '22+, A8s+, A5s:0.4, K9s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, AJo+, KQo';
const COLDCALL_MID = '22+, ATs+, KQs, KJs:0.5, QJs, JTs, T9s, AQo:0.5';
// BB防御
const BB_3BET_VS_LATE = 'QQ+, JJ:0.5, TT:0.35, AK, AQs:0.5, A5s-A2s, ATs:0.35, A9s:0.35, KJs:0.4, KTs:0.4, 76s, 65s, 54s, KQo:0.35, AJo:0.35';
const BB_CALL_VS_LATE = '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A5o+, K9o+, Q9o+, J9o+, T9o, 98o';
const BB_3BET_VS_EARLY = 'QQ+, JJ:0.4, AK, AQs:0.4, A5s, A4s, KJs:0.3, 76s:0.5, 65s:0.5';
const BB_CALL_VS_EARLY = '22+, A2s+, K7s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, 65s, ATo+, KQo, KJo:0.5, QJo:0.5';
// 自分がオープン→3ベットされた
const FOURBET = 'QQ+, AKs, AKo:0.7, JJ:0.35, A5s:0.6, A4s:0.4, KQs:0.25';
const CALL_3BET = '22+:0.6, AQs, AJs, ATs:0.5, KQs, KJs:0.5, QJs, JTs, T9s:0.5, 98s:0.4, AQo:0.5, KQo:0.3';
// 自分が3ベット→4ベットされた
const FIVEBET_JAM = 'QQ+, AKs, AKo:0.6, JJ:0.3, A5s:0.2';
const CALL_4BET = 'JJ, TT:0.5, AQs, AKo:0.5, KQs:0.4';
// Push/Fold (MTT, アンティ近似含む)
const PUSH = {
    15: {
        UTG: '44+, A5s+, A4s:0.5, KTs+, QTs+, JTs, ATo+, KQo',
        HJ: '22+, A4s+, K9s+, QTs+, JTs, A8o+, KJo+',
        CO: '22+, A2s+, K8s+, Q9s+, J9s+, T9s, A5o+, KTo+, QJo',
        BTN: '22+, A2s+, K2s+, Q8s+, J8s+, T8s+, A2o+, K7o+, Q9o+, J9o+',
        SB: '22+, A2s+, K5s+, Q9s+, J9s+, A7o+, K9o+, QTo+',
    },
    12: {
        UTG: '44+, A2s+, KTs+, QTs+, JTs, AJo+, KQo',
        HJ: '22+, A2s+, K9s+, Q9s+, J9s+, A9o+, KJo+',
        CO: '22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 98s, A2o+, K9o+, QTo+, JTo',
        BTN: '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 97s+, A2o+, K6o+, Q9o+, J9o+, T9o',
        SB: '22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 96s+, 86s+, A2o+, K5o+, Q8o+, J8o+, T8o+',
    },
    10: {
        UTG: '44+, A2s+, KTs+, QTs+, JTs, A9o+, KQo',
        HJ: '22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, A3o+, KTo+, QJo, JTo',
        CO: '22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 98s, A2o+, KTo+, QTo+, JTo',
        BTN: '22+, A2s+, K2s+, Q5s+, J6s+, T6s+, 97s+, 87s, A2o+, K7o+, QTo+, JTo',
        SB: '22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o+, K2o+, Q2o+, J2o+, T4o+, 95o+, 86o+, 75o+, 65o',
    },
};
// さらに浅いときの追加ジャム(バンド10に上乗せ)
const PUSH_EXTRA_8 = '22+, A2s+, A2o+, K2s+, K8o+, Q8s+, J8s+, T8s+, 98s, 87s';
const PUSH_EXTRA_6 = 'K2o+, Q2s+, Q4o+, J2s+, J6o+, T2s+, T8o+, 92s+, 96o+, 82s+, 85o+, 72s+, 75o+, 62s+, 64o+, 52s+, 54o, 42s+, 32s';
// オールインへのコール (HRC Nash, スタック帯別)
const CALL_SHOVE = {
    15: '66+, A2s+, A4o+, K8s+, KQo',
    12: '44+, A2s+, A2o+, K5s+, KTo+, QTs+, QJo, JTs',
    10: '22+, A2s+, A2o+, K2s+, K8o+, Q7s+, QTo+, J8s+, JTo, T8s+, 98s',
    8: '22+, A2s+, A2o+, K2s+, K8o+, Q2s+, Q9o+, J2s+, J9o+, T3s+, T9o, 96s+, 86s+, 76s, 65s',
    6: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q4o+, J2s+, J6o+, T2s+, T8o+, 92s+, 96o+, 83s+, 86o+, 73s+, 76o, 63s+, 65o, 53s+, 43s',
};
const nearestBand = (bands, v) => bands.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
/** レンジをボード上の強さでK個の等重量バケットに分割 */
function bucketize(spec, board, tighten, K) {
    const table = combosOf(spec);
    const items = [];
    const blocked = new Set(board);
    for (const [c1, c2, w] of table.combos) {
        if (blocked.has(c1) || blocked.has(c2))
            continue;
        items.push({ score: scoreBest([c1, c2, ...board]), w });
    }
    if (items.length < K)
        return null;
    items.sort((a, b) => a.score - b.score);
    // 攻めた相手はレンジ下位の重みを減らす(ベイズ更新の近似)
    if (tighten > 0) {
        const cut = Math.floor(items.length * 0.3 * Math.min(2, tighten));
        for (let i = 0; i < cut; i++)
            items[i].w *= 0.25;
    }
    const total = items.reduce((s, x) => s + x.w, 0);
    const boundaries = [], weights = [], idxBounds = [];
    let acc = 0, bi = 0;
    for (let i = 0; i < items.length; i++) {
        acc += items[i].w;
        if (acc >= total * (bi + 1) / K || i === items.length - 1) {
            boundaries.push(items[i].score);
            idxBounds.push(i);
            weights.push(acc - (weights.reduce((s, x) => s + x, 0)));
            bi++;
        }
    }
    while (boundaries.length < K) {
        boundaries.push(boundaries[boundaries.length - 1]);
        idxBounds.push(idxBounds[idxBounds.length - 1]);
        weights.push(0);
    }
    const wsum = weights.reduce((s, x) => s + x, 0) || 1;
    const sortedScores = items.map((x) => x.score);
    const itemW = items.map((x) => x.w);
    const sortedW = [];
    let cw = 0;
    for (const x of items) {
        cw += x.w;
        sortedW.push(cw);
    }
    return { boundaries, weights: weights.map((w) => w / wsum), sortedScores, sortedW, itemW, idxBounds };
}
/** P(bucket i of A が bucket j of B に勝つ)行列(タイ0.5、実コンボ分布で厳密に計算) */
function winMatrix(A, B, K) {
    const W = Array.from({ length: K }, () => new Array(K).fill(0.5));
    const cnt = Array.from({ length: K }, () => new Array(K).fill(0));
    const cumW = (idx) => (idx < 0 ? 0 : B.sortedW[idx]);
    const lowerBound = (s, lo, hi) => {
        let l = lo, h = hi + 1;
        while (l < h) {
            const m = (l + h) >> 1;
            if (B.sortedScores[m] < s)
                l = m + 1;
            else
                h = m;
        }
        return l; // 最初に score >= s となる位置
    };
    const upperBound = (s, lo, hi) => {
        let l = lo, h = hi + 1;
        while (l < h) {
            const m = (l + h) >> 1;
            if (B.sortedScores[m] <= s)
                l = m + 1;
            else
                h = m;
        }
        return l; // 最初に score > s となる位置
    };
    let bi = 0;
    for (let idx = 0; idx < A.sortedScores.length; idx++) {
        const s = A.sortedScores[idx], w = A.itemW[idx];
        while (bi < K - 1 && idx > A.idxBounds[bi])
            bi++;
        for (let j = 0; j < K; j++) {
            const start = j === 0 ? 0 : B.idxBounds[j - 1] + 1;
            const end = B.idxBounds[j];
            const bw = cumW(end) - cumW(start - 1);
            let p = 0.5;
            if (bw > 0) {
                const lb = lowerBound(s, start, end);
                const ub = upperBound(s, start, end);
                const below = cumW(lb - 1) - cumW(start - 1); // s未満の重み
                const ties = cumW(ub - 1) - cumW(lb - 1); // s同点の重み
                p = (below + 0.5 * ties) / bw;
            }
            W[bi][j] = (W[bi][j] * cnt[bi][j] + p * w) / (cnt[bi][j] + w);
            cnt[bi][j] += w;
        }
    }
    return W;
}
function runBucketCfr(ctx) {
    const K = ctx.K;
    const r = ctx.rnd;
    const heroP = ctx.heroP;
    const W01 = ctx.W01;
    // ---- ツリー構築(ポット比)。サイズメニュー + オールイン。レイズはジャムのみ ----
    const spr = ctx.effStack / Math.max(1, ctx.pot);
    const SIZES = (ctx.sizes ?? [0.5, 1.0]).filter((s) => s < spr * 0.85);
    let nodeSeq = 0;
    const mkShow = (c0, c1) => ({ actor: 0, kind: 'showdown', c0, c1 });
    const mkFold = (folder, c0, c1) => ({ actor: 0, kind: 'fold', folder, c0, c1 });
    // ベットに対する応答(raiseはジャムのみ、ジャムに対してはfold/call)
    const respond = (resp, myC, oppC, oppIsJam) => {
        const labels = ['fold', 'call'];
        const children = [
            resp === 0 ? mkFold(0, myC, oppC) : mkFold(1, oppC, myC),
            resp === 0 ? mkShow(oppC, oppC) : mkShow(oppC, oppC),
        ];
        if (!oppIsJam && spr > oppC * 2.2) {
            labels.push('jam');
            const jamTo = spr;
            const after = {
                actor: (1 - resp), kind: 'decision', id: nodeSeq++,
                c0: resp === 0 ? jamTo : oppC, c1: resp === 0 ? oppC : jamTo,
                labels: ['fold', 'call'],
                children: resp === 0
                    ? [mkFold(1, jamTo, oppC), mkShow(jamTo, jamTo)]
                    : [mkFold(0, oppC, jamTo), mkShow(jamTo, jamTo)],
            };
            children.push(after);
        }
        return { actor: resp, kind: 'decision', id: nodeSeq++,
            c0: resp === 0 ? myC : oppC, c1: resp === 0 ? oppC : myC, labels, children };
    };
    const ipAfterCheck = { actor: 1, kind: 'decision', id: nodeSeq++, c0: 0, c1: 0,
        labels: ['check', ...SIZES.map((s) => `b${s}`), 'jam'],
        children: [mkShow(0, 0), ...SIZES.map((s) => respond(0, 0, s, false)), respond(0, 0, spr, true)] };
    const root = { actor: 0, kind: 'decision', id: nodeSeq++, c0: 0, c1: 0,
        labels: ['check', ...SIZES.map((s) => `b${s}`), 'jam'],
        children: [ipAfterCheck, ...SIZES.map((s) => respond(1, 0, s, false)), respond(1, 0, spr, true)] };
    // ---- CFR+ (ベクトル形式、K=10バケット) ----
    const regret = new Map();
    const ssum = new Map();
    const tbl = (m, id, a) => {
        let t = m.get(id);
        if (!t) {
            t = new Float64Array(K * a);
            m.set(id, t);
        }
        return t;
    };
    const showPay = (i, j, c0, c1) => {
        const P = 1 + c0 + c1;
        const w = W01[i][j];
        return [w * P - c0, (1 - w) * P - c1];
    };
    const walk = (node, r0, r1, t) => {
        const u0 = new Float64Array(K), u1 = new Float64Array(K);
        if (node.kind === 'fold') {
            const win = 1 + node.c0 + node.c1;
            const s1 = r1.reduce((a, b) => a + b, 0), s0 = r0.reduce((a, b) => a + b, 0);
            for (let i = 0; i < K; i++)
                u0[i] = s1 * (node.folder === 0 ? -node.c0 : win - node.c0);
            for (let j = 0; j < K; j++)
                u1[j] = s0 * (node.folder === 1 ? -node.c1 : win - node.c1);
            return [u0, u1];
        }
        if (node.kind === 'showdown') {
            for (let i = 0; i < K; i++)
                for (let j = 0; j < K; j++) {
                    const [p0, p1] = showPay(i, j, node.c0, node.c1);
                    u0[i] += r1[j] * p0;
                    u1[j] += r0[i] * p1;
                }
            return [u0, u1];
        }
        const A = node.children.length;
        const reg = tbl(regret, node.id, A);
        const ss = tbl(ssum, node.id, A);
        const mine = node.actor === 0 ? r0 : r1;
        // regret matching
        const sigma = new Float64Array(K * A);
        for (let i = 0; i < K; i++) {
            let sum = 0;
            for (let a = 0; a < A; a++)
                sum += Math.max(0, reg[i * A + a]);
            for (let a = 0; a < A; a++)
                sigma[i * A + a] = sum > 0 ? Math.max(0, reg[i * A + a]) / sum : 1 / A;
        }
        const childU = [];
        for (let a = 0; a < A; a++) {
            const scaled = new Float64Array(K);
            for (let i = 0; i < K; i++)
                scaled[i] = mine[i] * sigma[i * A + a];
            childU.push(node.actor === 0 ? walk(node.children[a], scaled, r1, t) : walk(node.children[a], r0, scaled, t));
        }
        const uMine = node.actor === 0 ? u0 : u1;
        const uOpp = node.actor === 0 ? u1 : u0;
        for (let a = 0; a < A; a++) {
            const cu = childU[a][node.actor];
            const co = childU[a][1 - node.actor];
            for (let i = 0; i < K; i++)
                uMine[i] += sigma[i * A + a] * cu[i];
            for (let j = 0; j < K; j++)
                uOpp[j] += co[j];
        }
        if (ctx.discount) {
            // ---- DCFR (Brown & Sandholm 2019) ----
            // 正のリグレットは t^α/(t^α+1)、負は t^β/(t^β+1) で割り引き、
            // 平均戦略は (t/(t+1))^γ で重みづける。CFR+ と違って負のリグレットを捨てない代わりに
            // 強く減衰させるので、序盤の誤った確信から抜け出しやすく、同じ反復数でも解が良くなる。
            const ta = Math.pow(t, DCFR_ALPHA);
            const dPos = ta / (ta + 1);
            const tb = Math.pow(t, DCFR_BETA);
            const dNeg = tb / (tb + 1);
            const dStrat = Math.pow(t / (t + 1), DCFR_GAMMA);
            for (let i = 0; i < K; i++)
                for (let a = 0; a < A; a++) {
                    const idx = i * A + a;
                    const r = reg[idx] + childU[a][node.actor][i] - uMine[i];
                    reg[idx] = r > 0 ? r * dPos : r * dNeg;
                    ss[idx] = ss[idx] * dStrat + mine[i] * sigma[idx];
                }
        }
        else {
            // CFR+更新 + 線形加重平均戦略(ライブ解法の既定。挙動を変えないためこちらを残す)
            for (let i = 0; i < K; i++)
                for (let a = 0; a < A; a++) {
                    reg[i * A + a] = Math.max(0, reg[i * A + a] + childU[a][node.actor][i] - uMine[i]);
                    ss[i * A + a] += t * mine[i] * sigma[i * A + a];
                }
        }
        return [u0, u1];
    };
    const iters = ctx.iters;
    const w0 = Float64Array.from(ctx.w0), w1 = Float64Array.from(ctx.w1);
    for (let t = 1; t <= iters; t++)
        walk(root, w0, w1, t);
    // ---- ブループリント蒸留: 全バケットの平均戦略を畳んで返す ----
    if (ctx.capture) {
        const small = SIZES.length ? SIZES[0] : 0.33;
        // 指定ノードのバケット別分布を、ブループリント表記へ写して返す
        const readNode = (nd, face) => {
            const out = Array.from({ length: K }, () => ({}));
            if (!nd || nd.kind !== 'decision')
                return out;
            const A2 = nd.children.length;
            const ss2 = ssum.get(nd.id);
            if (!ss2)
                return out;
            for (let i = 0; i < K; i++) {
                let tot = 0;
                for (let a = 0; a < A2; a++)
                    tot += ss2[i * A2 + a];
                if (tot <= 0)
                    continue;
                for (let a = 0; a < A2; a++) {
                    const f = ss2[i * A2 + a] / tot;
                    if (f <= 0)
                        continue;
                    const lb = nd.labels[a];
                    let key;
                    if (face)
                        key = lb === 'fold' ? 'fold' : lb === 'call' ? 'call' : 'raise';
                    else if (lb === 'check')
                        key = 'check';
                    else if (lb === 'jam')
                        key = 'betB';
                    else
                        key = Number(lb.slice(1)) <= small + 1e-9 ? 'betS' : 'betB';
                    out[i][key] = (out[i][key] ?? 0) + f;
                }
            }
            return out;
        };
        const firstNode = heroP === 0 ? root : ipAfterCheck;
        // 相手のベット枝ごとに応答を読む。サイズで MDF が変わるので分けて持つ必要がある
        // (以前は最小サイズの応答だけを表に入れていて、75%やジャムにも同じ分布を使っていた)
        const src = heroP === 0 ? ipAfterCheck : root;
        let smallNode = null, bigNode = null, jamNode = null;
        src.labels.forEach((lb, idx) => {
            if (lb === 'check')
                return;
            const child = src.children[idx];
            if (lb === 'jam')
                jamNode = child;
            else if (Number(lb.slice(1)) <= small + 1e-9)
                smallNode = child;
            else
                bigNode = child;
        });
        // そのサイズが木に無い(SPRが浅くて刈られた)ときは、隣のサイズで代替する
        ctx.capture(readNode(firstNode, false), readNode(smallNode ?? bigNode, true), readNode(bigNode ?? smallNode, true), readNode(jamNode ?? bigNode ?? smallNode, true));
    }
    // ---- 自分の実ハンドの戦略を読む ----
    const myB = Math.max(0, Math.min(K - 1, ctx.heroBucket));
    // 該当ノードを特定
    let node = null;
    if (ctx.facingBet <= 0)
        node = heroP === 0 ? root : ipAfterCheck;
    else {
        // 相手のベットに直面: 最も近いサイズのベット枝の応答ノード
        const frac = ctx.facingBet / Math.max(1, ctx.pot);
        const parent = heroP === 0 ? root : root; // OOPが直面=checkしてIPがベット、IPが直面=OOPがベット
        const src = heroP === 0 ? ipAfterCheck : root;
        const cands = [];
        src.labels.forEach((lb, idx) => {
            if (lb === 'check')
                return;
            const size = lb === 'jam' ? spr : Number(lb.slice(1));
            cands.push({ node: src.children[idx], size });
        });
        void parent;
        if (!cands.length)
            return null;
        cands.sort((a, b) => Math.abs(a.size - frac) - Math.abs(b.size - frac));
        node = cands[0].node;
    }
    if (!node || node.kind !== 'decision' || node.actor !== heroP)
        return null;
    const A = node.children.length;
    const ss = ssum.get(node.id);
    if (!ss)
        return null;
    let freqs = [];
    let total = 0;
    for (let a = 0; a < A; a++) {
        freqs.push(ss[myB * A + a]);
        total += ss[myB * A + a];
    }
    if (total <= 0)
        return null;
    freqs = freqs.map((f) => f / total);
    // 3.5%未満はソルバーノイズとして刈る(第1部 §1.14)
    freqs = freqs.map((f) => (f < 0.035 ? 0 : f));
    const total2 = freqs.reduce((a, b) => a + b, 0);
    if (total2 <= 0)
        return null;
    let x = r() * total2, pick = 0;
    for (let a = 0; a < A; a++) {
        x -= freqs[a];
        if (x <= 0) {
            pick = a;
            break;
        }
    }
    const lb = node.labels[pick];
    if (lb === 'check')
        return { action: 'check' };
    if (lb === 'fold')
        return { action: 'fold' };
    if (lb === 'call')
        return { action: 'call' };
    if (lb === 'jam')
        return { action: 'allin' };
    const size = Number(lb.slice(1));
    return { action: 'raise', to: Math.round(ctx.pot * size) };
}
function runTwoStreetCfr(ctx) {
    const K = ctx.K;
    const r = ctx.rnd;
    const heroP = ctx.heroP;
    const R = ctx.Wr.length;
    const spr = ctx.effStack / Math.max(1, ctx.pot);
    const SIZES = ctx.sizes.filter((s) => s < spr * 0.85);
    let nodeSeq = 0;
    const mkShow = (c0, c1, wIdx) => ({ kind: 'showdown', c0, c1, wIdx });
    const mkFold = (folder, c0, c1) => ({ kind: 'fold', folder, c0, c1 });
    // ---- リバー層(両者の投入 c で揃った状態から)。サイズ: 75% + ジャム(近ければ) ----
    const riverLayer = (c, wIdx) => {
        const potU = 1 + 2 * c;
        const rem = spr - c;
        if (rem <= potU * 0.05)
            return mkShow(c, c, wIdx); // 実質オールイン済み
        const menu = [];
        const b = 0.75 * potU;
        if (b < rem * 0.9)
            menu.push({ lb: 'rb', amt: b });
        if (rem <= potU * 3 || menu.length === 0)
            menu.push({ lb: 'rjam', amt: rem });
        const respond = (resp, oppAmt) => ({
            kind: 'decision', actor: resp, id: nodeSeq++, c0: c, c1: c,
            labels: ['fold', 'call'],
            children: [
                resp === 0 ? mkFold(0, c, c + oppAmt) : mkFold(1, c + oppAmt, c),
                mkShow(c + oppAmt, c + oppAmt, wIdx),
            ],
        });
        const ipNode = {
            kind: 'decision', actor: 1, id: nodeSeq++, c0: c, c1: c,
            labels: ['check', ...menu.map((m) => m.lb)],
            children: [mkShow(c, c, wIdx), ...menu.map((m) => respond(0, m.amt))],
        };
        return {
            kind: 'decision', actor: 0, id: nodeSeq++, c0: c, c1: c,
            labels: ['check', ...menu.map((m) => m.lb)],
            children: [ipNode, ...menu.map((m) => respond(1, m.amt))],
        };
    };
    // ベット-コール/チェック-チェックでストリートが終わったらリバーへ(チャンスノード)
    const toRiver = (c) => ({
        kind: 'chance', c0: c, c1: c,
        children: Array.from({ length: R }, (_, wIdx) => riverLayer(c, wIdx)),
    });
    // ---- ターン層(runBucketCfrと同じ構造だが、コール後がチェックダウンでなくリバー層) ----
    const respondTurn = (resp, oppC, oppIsJam) => {
        const labels = ['fold', 'call'];
        const children = [
            resp === 0 ? mkFold(0, 0, oppC) : mkFold(1, oppC, 0),
            oppIsJam ? mkShow(oppC, oppC, -1) : toRiver(oppC),
        ];
        if (!oppIsJam && spr > oppC * 2.2) {
            labels.push('jam');
            const after = {
                kind: 'decision', actor: (1 - resp), id: nodeSeq++,
                c0: resp === 0 ? spr : oppC, c1: resp === 0 ? oppC : spr,
                labels: ['fold', 'call'],
                children: resp === 0
                    ? [mkFold(1, spr, oppC), mkShow(spr, spr, -1)]
                    : [mkFold(0, oppC, spr), mkShow(spr, spr, -1)],
            };
            children.push(after);
        }
        return { kind: 'decision', actor: resp, id: nodeSeq++,
            c0: resp === 0 ? 0 : oppC, c1: resp === 0 ? oppC : 0, labels, children };
    };
    const ipAfterCheck = {
        kind: 'decision', actor: 1, id: nodeSeq++, c0: 0, c1: 0,
        labels: ['check', ...SIZES.map((s) => `b${s}`), 'jam'],
        children: [toRiver(0), ...SIZES.map((s) => respondTurn(0, s, false)), respondTurn(0, spr, true)],
    };
    const root = {
        kind: 'decision', actor: 0, id: nodeSeq++, c0: 0, c1: 0,
        labels: ['check', ...SIZES.map((s) => `b${s}`), 'jam'],
        children: [ipAfterCheck, ...SIZES.map((s) => respondTurn(1, s, false)), respondTurn(1, spr, true)],
    };
    // ---- CFR+(チャンスノード対応のベクトル形式) ----
    const regret = new Map();
    const ssum = new Map();
    const tbl = (m, id, a) => {
        let t = m.get(id);
        if (!t) {
            t = new Float64Array(K * a);
            m.set(id, t);
        }
        return t;
    };
    const walk = (node, r0, r1, t) => {
        const u0 = new Float64Array(K), u1 = new Float64Array(K);
        if (node.kind === 'fold') {
            const win = 1 + node.c0 + node.c1;
            const s1 = r1.reduce((a, b) => a + b, 0), s0 = r0.reduce((a, b) => a + b, 0);
            for (let i = 0; i < K; i++)
                u0[i] = s1 * (node.folder === 0 ? -node.c0 : win - node.c0);
            for (let j = 0; j < K; j++)
                u1[j] = s0 * (node.folder === 1 ? -node.c1 : win - node.c1);
            return [u0, u1];
        }
        if (node.kind === 'showdown') {
            const W = node.wIdx >= 0 ? ctx.Wr[node.wIdx] : ctx.Wavg;
            const P = 1 + node.c0 + node.c1;
            for (let i = 0; i < K; i++)
                for (let j = 0; j < K; j++) {
                    const w = W[i][j];
                    u0[i] += r1[j] * (w * P - node.c0);
                    u1[j] += r0[i] * ((1 - w) * P - node.c1);
                }
            return [u0, u1];
        }
        if (node.kind === 'chance') {
            const p = 1 / node.children.length;
            for (const ch of node.children) {
                const [a, b] = walk(ch, r0, r1, t);
                for (let i = 0; i < K; i++) {
                    u0[i] += p * a[i];
                    u1[i] += p * b[i];
                }
            }
            return [u0, u1];
        }
        const A = node.children.length;
        const reg = tbl(regret, node.id, A);
        const ss = tbl(ssum, node.id, A);
        const mine = node.actor === 0 ? r0 : r1;
        const sigma = new Float64Array(K * A);
        for (let i = 0; i < K; i++) {
            let sum = 0;
            for (let a = 0; a < A; a++)
                sum += Math.max(0, reg[i * A + a]);
            for (let a = 0; a < A; a++)
                sigma[i * A + a] = sum > 0 ? Math.max(0, reg[i * A + a]) / sum : 1 / A;
        }
        const childU = [];
        for (let a = 0; a < A; a++) {
            const scaled = new Float64Array(K);
            for (let i = 0; i < K; i++)
                scaled[i] = mine[i] * sigma[i * A + a];
            childU.push(node.actor === 0 ? walk(node.children[a], scaled, r1, t) : walk(node.children[a], r0, scaled, t));
        }
        const uMine = node.actor === 0 ? u0 : u1;
        const uOpp = node.actor === 0 ? u1 : u0;
        for (let a = 0; a < A; a++) {
            const cu = childU[a][node.actor];
            const co = childU[a][1 - node.actor];
            for (let i = 0; i < K; i++)
                uMine[i] += sigma[i * A + a] * cu[i];
            for (let j = 0; j < K; j++)
                uOpp[j] += co[j];
        }
        for (let i = 0; i < K; i++)
            for (let a = 0; a < A; a++) {
                reg[i * A + a] = Math.max(0, reg[i * A + a] + childU[a][node.actor][i] - uMine[i]);
                ss[i * A + a] += t * mine[i] * sigma[i * A + a];
            }
        return [u0, u1];
    };
    const w0 = Float64Array.from(ctx.w0), w1 = Float64Array.from(ctx.w1);
    for (let t = 1; t <= ctx.iters; t++)
        walk(root, w0, w1, t);
    // ---- 自分のターンノードの戦略を読む(抽出はrunBucketCfrと同じ) ----
    const myB = Math.max(0, Math.min(K - 1, ctx.heroBucket));
    let node = null;
    if (ctx.facingBet <= 0)
        node = heroP === 0 ? root : ipAfterCheck;
    else {
        const frac = ctx.facingBet / Math.max(1, ctx.pot);
        const src = heroP === 0 ? ipAfterCheck : root;
        const cands = [];
        src.labels.forEach((lb, idx) => {
            if (lb === 'check')
                return;
            const size = lb === 'jam' ? spr : Number(lb.slice(1));
            cands.push({ node: src.children[idx], size });
        });
        if (!cands.length)
            return null;
        cands.sort((a, b) => Math.abs(a.size - frac) - Math.abs(b.size - frac));
        node = cands[0].node;
    }
    if (!node || node.kind !== 'decision' || node.actor !== heroP)
        return null;
    const A2 = node.children.length;
    const ss = ssum.get(node.id);
    if (!ss)
        return null;
    let freqs = [];
    let total = 0;
    for (let a = 0; a < A2; a++) {
        freqs.push(ss[myB * A2 + a]);
        total += ss[myB * A2 + a];
    }
    if (total <= 0)
        return null;
    freqs = freqs.map((f) => f / total).map((f) => (f < 0.035 ? 0 : f));
    const total2 = freqs.reduce((a, b) => a + b, 0);
    if (total2 <= 0)
        return null;
    let x = r() * total2, pick = 0;
    for (let a = 0; a < A2; a++) {
        x -= freqs[a];
        if (x <= 0) {
            pick = a;
            break;
        }
    }
    const lb = node.labels[pick];
    if (lb === 'check')
        return { action: 'check' };
    if (lb === 'fold')
        return { action: 'fold' };
    if (lb === 'call')
        return { action: 'call' };
    if (lb === 'jam')
        return { action: 'allin' };
    return { action: 'raise', to: Math.round(ctx.pot * Number(lb.slice(1))) };
}
/** リバーをその場で解き、自分の実ハンドの混合戦略から1アクションを引く。失敗時null */
export function solveRiver(ctx) {
    const K = 10;
    const heroP = ctx.heroIP ? 1 : 0;
    const oopSpec = heroP === 0 ? ctx.heroSpec : ctx.villSpec;
    const ipSpec = heroP === 1 ? ctx.heroSpec : ctx.villSpec;
    const oopT = heroP === 0 ? (ctx.heroTighten ?? 0) : (ctx.villTighten ?? 0);
    const ipT = heroP === 1 ? (ctx.heroTighten ?? 0) : (ctx.villTighten ?? 0);
    const R0 = bucketize(oopSpec, ctx.board, oopT, K);
    const R1 = bucketize(ipSpec, ctx.board, ipT, K);
    if (!R0 || !R1)
        return null;
    const W01 = winMatrix(R0, R1, K); // P(OOP i beats IP j)
    // 自分の実ハンドのバケット(スコアで判定)
    const heroR = heroP === 0 ? R0 : R1;
    const myScore = scoreBest([...ctx.heroHole, ...ctx.board]);
    let myB = 0;
    while (myB < K - 1 && myScore > heroR.boundaries[myB])
        myB++;
    return runBucketCfr({
        K, W01, w0: R0.weights, w1: R1.weights, heroP, heroBucket: myB,
        pot: ctx.pot, effStack: ctx.effStack, facingBet: ctx.facingBet,
        rnd: ctx.rnd ?? Math.random, iters: ctx.iters ?? 160,
    });
}
/**
 * ターンをその場で解く(V2 Phase6 の軽量版)。
 *
 * リバーとの違いは勝率の定義だけ:
 *   リバー = 現在のスコアで確定
 *   ターン = 「リバーを配りきってショーダウンした時の勝率」
 * そこで残りのリバー候補から R_SAMPLES 枚をサンプリングし、各リバーで厳密に
 * 勝敗分布を計り、その平均でコンボの強さ(=対レンジ勝率)とバケット間勝率行列を作る。
 * ドロー(フラッシュドロー等)はリバーで完成する分だけ自然に強さへ織り込まれるので、
 * 「今は最弱だが降りないハンド」としてセミブラフ・コール継続が均衡から出てくる。
 * ツリーはリバーと同じ(check/50%/100%/jam)。葉はチェックダウン相当のショーダウン評価
 * (=深さ制限探索の単純継続)なので、リバーでのさらなるベットの価値は含まない近似。
 */
export function solveTurn(ctx) {
    if (ctx.board.length !== 4)
        return null;
    return solveSampledStreet(ctx, 10, [0.5, 1.0]);
}
/**
 * フロップをその場で解く。ターンと同じ仕組みで、ランアウトが「ターン+リバーの2枚」になるだけ。
 * サイズメニューは理論(第3部)に合わせて小さめ(33%/75%)を使う。
 * 葉がチェックダウン相当の近似はフロップでは2ストリート分粗くなるが、
 * レンジ対レンジの均衡からCベット頻度・ドローの継続・チェックレイズが出る。
 */
export function solveFlop(ctx) {
    if (ctx.board.length !== 3)
        return null;
    return solveSampledStreet(ctx, 12, [0.33, 0.75]);
}
/**
 * ブループリント蒸留用: 1つのフロップ・役割(ヒーローのレンジ/ポジション)についてCFRを1回解き、
 * 決定的handBucketごとの firstIn / face 戦略分布を返す。build_blueprint.mjs から呼ぶ。
 * 通常のプレイには使わない(重い代わりに全ハンドを一括で取り出す)。
 * heroHole はダミー(ソルバー内部のバケット割当を邪魔しない盤外の1枚組を渡す想定)。
 */
export function solveFlopBlueprint(ctx) {
    if (ctx.board.length !== 3)
        return null;
    const bpOut = { firstIn: [], faceS: [], faceB: [], faceJam: [], items: [] };
    solveSampledStreet({ ...ctx, bpOut }, 12, [0.33, 0.75]);
    if (!bpOut.items.length || !bpOut.firstIn.length)
        return null;
    // 決定的handBucketごとに、コンボ重みで各分布を集計
    const acc = {};
    const add = (dst, src, w) => {
        for (const k of Object.keys(src))
            dst[k] = (dst[k] ?? 0) + (src[k] ?? 0) * w;
    };
    for (const it of bpOut.items) {
        const a = (acc[it.hb] ??= { first: {}, fS: {}, fB: {}, fJ: {}, w: 0 });
        add(a.first, bpOut.firstIn[it.bucket] ?? {}, it.w);
        add(a.fS, bpOut.faceS[it.bucket] ?? {}, it.w);
        add(a.fB, bpOut.faceB[it.bucket] ?? {}, it.w);
        add(a.fJ, bpOut.faceJam[it.bucket] ?? {}, it.w);
        a.w += it.w;
    }
    const norm = (d) => {
        let t = 0;
        for (const k of Object.keys(d))
            t += d[k] ?? 0;
        if (t <= 0)
            return {};
        const o = {};
        for (const k of Object.keys(d))
            o[k] = Math.round(((d[k] ?? 0) / t) * 1000) / 1000;
        return o;
    };
    const out = {};
    for (const hb of Object.keys(acc)) {
        out[hb] = {
            firstIn: norm(acc[hb].first),
            faceS: norm(acc[hb].fS),
            faceB: norm(acc[hb].fB),
            faceJam: norm(acc[hb].fJ),
        };
    }
    return out;
}
/** ランアウトをサンプリングして解く共通実装(ターン=1枚 / フロップ=2枚) */
function solveSampledStreet(ctx, R_SAMPLES, sizes) {
    const K = 8;
    const need = 5 - ctx.board.length;
    if (need < 1 || need > 2)
        return null;
    const rnd = ctx.rnd ?? Math.random;
    const heroP = ctx.heroIP ? 1 : 0;
    const oopSpec = heroP === 0 ? ctx.heroSpec : ctx.villSpec;
    const ipSpec = heroP === 1 ? ctx.heroSpec : ctx.villSpec;
    const oopT = heroP === 0 ? (ctx.heroTighten ?? 0) : (ctx.villTighten ?? 0);
    const ipT = heroP === 1 ? (ctx.heroTighten ?? 0) : (ctx.villTighten ?? 0);
    // 盤面とヒーローの手で死んでいる札を除いた候補から、ランアウト(need枚)をサンプル
    const blocked = new Set([...ctx.board, ...ctx.heroHole]);
    const deck = [];
    for (let c = 0; c < 52; c++)
        if (!blocked.has(c))
            deck.push(c);
    if (deck.length < need)
        return null;
    const rivers = []; // 各要素が1つのランアウト(ターン=1枚 / フロップ=2枚)
    for (let s = 0; s < R_SAMPLES; s++) {
        // 部分Fisher-Yatesで先頭need枚を確定
        for (let i = 0; i < need; i++) {
            const j = i + Math.floor(rnd() * (deck.length - i));
            const t = deck[i];
            deck[i] = deck[j];
            deck[j] = t;
        }
        rivers.push(deck.slice(0, need));
    }
    if (!rivers.length)
        return null;
    const collect = (spec) => {
        const out = [];
        for (const [c1, c2, w] of combosOf(spec).combos) {
            if (blocked.has(c1) || blocked.has(c2))
                continue;
            out.push({ c1, c2, w, strength: 0, bucket: 0, orig: out.length });
        }
        return out;
    };
    const A = collect(oopSpec), B = collect(ipSpec);
    if (A.length < K * 2 || B.length < K * 2)
        return null;
    // 各ランアウトごとの スコア配列(昇順)+累積重み を両レンジぶん作る
    const board5 = [...ctx.board, ...new Array(need).fill(0)];
    const fillBoard = (runout) => {
        for (let i = 0; i < need; i++)
            board5[ctx.board.length + i] = runout[i];
    };
    const distOf = (items, runout) => {
        fillBoard(runout);
        const pairs = []; // [score, w, itemIdx]
        for (let idx = 0; idx < items.length; idx++) {
            const it = items[idx];
            // コンボがランアウトの札を持っていたら、そのランアウトでは存在できない
            let dead = false;
            for (let i = 0; i < need; i++)
                if (it.c1 === runout[i] || it.c2 === runout[i]) {
                    dead = true;
                    break;
                }
            if (dead)
                continue;
            pairs.push([scoreBest([it.c1, it.c2, ...board5]), it.w, idx]);
        }
        pairs.sort((a, b) => a[0] - b[0]);
        const scores = [], cum = [];
        let total = 0;
        const byItem = new Float64Array(items.length).fill(-1);
        for (const [s, w, idx] of pairs) {
            total += w;
            scores.push(s);
            cum.push(total);
            byItem[idx] = s;
        }
        return { scores, cum, total, byItem };
    };
    const distsA = rivers.map((rv) => distOf(A, rv));
    const distsB = rivers.map((rv) => distOf(B, rv));
    // score が dist の中で勝つ確率(タイ0.5)
    const winProb = (score, d) => {
        if (d.total <= 0)
            return 0.5;
        let lo = 0, hi = d.scores.length;
        while (lo < hi) {
            const m = (lo + hi) >> 1;
            if (d.scores[m] < score)
                lo = m + 1;
            else
                hi = m;
        }
        const below = lo > 0 ? d.cum[lo - 1] : 0;
        let hi2 = d.scores.length, lo2 = lo;
        while (lo2 < hi2) {
            const m = (lo2 + hi2) >> 1;
            if (d.scores[m] <= score)
                lo2 = m + 1;
            else
                hi2 = m;
        }
        const ties = (lo2 > 0 ? d.cum[lo2 - 1] : 0) - below;
        return (below + 0.5 * ties) / d.total;
    };
    // コンボの強さ = 対レンジ勝率のリバー平均(そのコンボが河でブロックされる回は除外)
    const strengthOf = (items, myDists, oppDists) => {
        for (let idx = 0; idx < items.length; idx++) {
            let sum = 0, n = 0;
            for (let r = 0; r < rivers.length; r++) {
                const s = myDists[r].byItem[idx];
                if (s < 0)
                    continue; // このリバーでは存在できないコンボ
                sum += winProb(s, oppDists[r]);
                n++;
            }
            items[idx].strength = n > 0 ? sum / n : 0;
        }
    };
    strengthOf(A, distsA, distsB);
    strengthOf(B, distsB, distsA);
    // 強さでソートして等重量Kバケットに分割(tightenで下位の重みを減らすのはリバーと同じ方針)
    const bucketizeByStrength = (items, tighten) => {
        items.sort((a, b) => a.strength - b.strength);
        if (tighten > 0) {
            const cut = Math.floor(items.length * 0.3 * Math.min(2, tighten));
            for (let i = 0; i < cut; i++)
                items[i].w *= 0.25;
        }
        const total = items.reduce((s, x) => s + x.w, 0);
        if (total <= 0)
            return null;
        const weights = new Array(K).fill(0);
        const bounds = new Array(K).fill(1);
        let acc = 0, bi = 0;
        for (let i = 0; i < items.length; i++) {
            acc += items[i].w;
            items[i].bucket = bi;
            weights[bi] += items[i].w;
            if (acc >= total * (bi + 1) / K && bi < K - 1) {
                bounds[bi] = items[i].strength;
                bi++;
            }
        }
        bounds[K - 1] = 1;
        return { weights: weights.map((w) => w / total), bounds };
    };
    const BA = bucketizeByStrength(A, oopT);
    const BB = bucketizeByStrength(B, ipT);
    if (!BA || !BB)
        return null;
    // バケット間勝率行列: リバーごとに Bのバケット別スコア分布を作り、Aの各コンボから平均。
    // 平均(W01)に加えて、リバーサンプル別(Wr)も保持する(ターン2ストリート解のリバー層で使う)
    const W01 = Array.from({ length: K }, () => new Array(K).fill(0.5));
    const cnt = Array.from({ length: K }, () => new Array(K).fill(0));
    const Wr = rivers.map(() => Array.from({ length: K }, () => new Array(K).fill(0.5)));
    for (let r = 0; r < rivers.length; r++) {
        // Bのバケット別分布(byItem は orig インデックスで引く)
        const bucketPairs = Array.from({ length: K }, () => []);
        for (let j = 0; j < B.length; j++) {
            const s = distsB[r].byItem[B[j].orig];
            if (s < 0)
                continue;
            bucketPairs[B[j].bucket].push([s, B[j].w]);
        }
        const bucketDists = bucketPairs.map((pairs) => {
            pairs.sort((a, b) => a[0] - b[0]);
            const scores = [], cum = [];
            let total = 0;
            for (const [s, w] of pairs) {
                total += w;
                scores.push(s);
                cum.push(total);
            }
            return { scores, cum, total, byItem: new Float64Array(0) };
        });
        const cntR = Array.from({ length: K }, () => new Array(K).fill(0));
        for (let i = 0; i < A.length; i++) {
            const s = distsA[r].byItem[A[i].orig];
            if (s < 0)
                continue;
            const bi = A[i].bucket, w = A[i].w;
            for (let j = 0; j < K; j++) {
                if (bucketDists[j].total <= 0)
                    continue;
                const p = winProb(s, bucketDists[j]);
                W01[bi][j] = (W01[bi][j] * cnt[bi][j] + p * w) / (cnt[bi][j] + w);
                cnt[bi][j] += w;
                Wr[r][bi][j] = (Wr[r][bi][j] * cntR[bi][j] + p * w) / (cntR[bi][j] + w);
                cntR[bi][j] += w;
            }
        }
    }
    // 自分の実ハンドの強さ → 自陣サイドのバケットへ
    let heroSum = 0, heroN = 0;
    const oppDists = heroP === 0 ? distsB : distsA;
    for (let r = 0; r < rivers.length; r++) {
        fillBoard(rivers[r]);
        heroSum += winProb(scoreBest([...ctx.heroHole, ...board5]), oppDists[r]);
        heroN++;
    }
    const heroStrength = heroN > 0 ? heroSum / heroN : 0.5;
    const bounds = heroP === 0 ? BA.bounds : BB.bounds;
    let myB = 0;
    while (myB < K - 1 && heroStrength > bounds[myB])
        myB++;
    // ターン(need=1)は2ストリート解: リバー層をチャンスノードで持ち、レバレッジを均衡に織り込む
    if (need === 1) {
        return runTwoStreetCfr({
            K, Wavg: W01, Wr, w0: BA.weights, w1: BB.weights, heroP, heroBucket: myB,
            pot: ctx.pot, effStack: ctx.effStack, facingBet: ctx.facingBet,
            rnd, iters: ctx.iters ?? 130, sizes,
        });
    }
    // ブループリント蒸留: 自陣コンボの (solverバケット, 決定的handBucket, 重み) を書き出し、
    // capture で全バケットの firstIn/faceS/faceB/faceJam 分布を受け取る(1回の解で全ハンドを蒸留)
    let capture;
    if (ctx.bpOut) {
        const heroItems = heroP === 0 ? A : B;
        ctx.bpOut.items = heroItems.map((it) => ({
            bucket: it.bucket, w: it.w, hb: flopHandBucket([it.c1, it.c2], ctx.board),
        }));
        capture = (firstIn, faceS, faceB, faceJam) => {
            ctx.bpOut.firstIn = firstIn;
            ctx.bpOut.faceS = faceS;
            ctx.bpOut.faceB = faceB;
            ctx.bpOut.faceJam = faceJam;
        };
    }
    return runBucketCfr({
        K, W01, w0: BA.weights, w1: BB.weights, heroP, heroBucket: myB,
        pot: ctx.pot, effStack: ctx.effStack, facingBet: ctx.facingBet,
        rnd, iters: ctx.iters ?? 140, sizes, capture, discount: ctx.discount,
    });
}
export function solveRiver3(ctx) {
    const K = 6;
    const r = ctx.rnd ?? Math.random;
    if (ctx.board.length !== 5)
        return null;
    // 各プレイヤーをスコアでバケット化
    const R = [0, 1, 2].map((p) => bucketize(ctx.specs[p], ctx.board, ctx.tightens[p], K));
    if (R.some((x) => !x))
        return null;
    const B0 = R[0], B1 = R[1], B2 = R[2];
    // バケットdist(スコア昇順+累積重み)ヘルパ
    const bucketRange = (b, j) => ({
        lo: j === 0 ? 0 : b.idxBounds[j - 1] + 1, hi: b.idxBounds[j],
    });
    const cumW = (b, idx) => (idx < 0 ? 0 : b.sortedW[idx]);
    const bucketW = (b, j) => {
        const { lo, hi } = bucketRange(b, j);
        return cumW(b, hi) - cumW(b, lo - 1);
    };
    const winIn = (s, b, j) => {
        const { lo, hi } = bucketRange(b, j);
        const bw = cumW(b, hi) - cumW(b, lo - 1);
        if (bw <= 0)
            return 0.5;
        let l = lo, h = hi + 1;
        while (l < h) {
            const m = (l + h) >> 1;
            if (b.sortedScores[m] < s)
                l = m + 1;
            else
                h = m;
        }
        const below = cumW(b, l - 1) - cumW(b, lo - 1);
        let l2 = l, h2 = hi + 1;
        while (l2 < h2) {
            const m = (l2 + h2) >> 1;
            if (b.sortedScores[m] <= s)
                l2 = m + 1;
            else
                h2 = m;
        }
        const ties = (cumW(b, l2 - 1) - cumW(b, lo - 1)) - below;
        return (below + 0.5 * ties) / bw;
    };
    // ペア勝率行列 W2[p][q][i][j] = P(pのバケットi が qのバケットj に勝つ)
    const pairW = (A, B) => {
        const W = Array.from({ length: K }, () => new Array(K).fill(0.5));
        for (let i = 0; i < K; i++) {
            const { lo, hi } = bucketRange(A, i);
            const wTot = cumW(A, hi) - cumW(A, lo - 1);
            if (wTot <= 0)
                continue;
            for (let j = 0; j < K; j++) {
                let acc = 0;
                for (let idx = lo; idx <= hi; idx++) {
                    const w = A.sortedW[idx] - cumW(A, idx - 1);
                    acc += w * winIn(A.sortedScores[idx], B, j);
                }
                W[i][j] = acc / wTot;
            }
        }
        return W;
    };
    const W01m = pairW(B0, B1), W02m = pairW(B0, B2), W12m = pairW(B1, B2);
    // 3者勝率テンソル(視点別)。残差(タイ)は勝率比で配分する正規化を適用
    const triW = (A, X, Y) => {
        const W = Array.from({ length: K }, () => Array.from({ length: K }, () => new Array(K).fill(1 / 3)));
        for (let i = 0; i < K; i++) {
            const { lo, hi } = bucketRange(A, i);
            const wTot = cumW(A, hi) - cumW(A, lo - 1);
            if (wTot <= 0)
                continue;
            for (let j = 0; j < K; j++)
                for (let k = 0; k < K; k++) {
                    let acc = 0;
                    for (let idx = lo; idx <= hi; idx++) {
                        const w = A.sortedW[idx] - cumW(A, idx - 1);
                        const s = A.sortedScores[idx];
                        acc += w * winIn(s, X, j) * winIn(s, Y, k);
                    }
                    W[i][j][k] = acc / wTot;
                }
        }
        return W;
    };
    const T0 = triW(B0, B1, B2); // P(P0が両者に勝つ | i,j,k)
    const T1 = triW(B1, B0, B2); // 添字順: [j][i][k]
    const T2 = triW(B2, B0, B1); // [k][i][j]
    // ---- ツリー(1ベット・レイズなし) ----
    const spr = 999; // リバーの1ベット66%は常に打てる前提(残スタック不足時は呼び出し側で回避)
    void spr;
    const BET = 0.66;
    let nodeSeq = 0;
    const sd = (alive, c) => {
        const n = alive.filter(Boolean).length;
        if (n === 1)
            return { kind: 'win', winner: alive.indexOf(true), c };
        return { kind: 'sd', alive, c };
    };
    // ベット後の応答列(順番に fold/call)。resp = 残り応答者列
    const respChain = (bettor, resp, alive, c) => {
        if (!resp.length)
            return sd(alive, c);
        const [p, ...rest] = resp;
        const cFold = [...c];
        const aFold = [...alive];
        aFold[p] = false;
        const cCall = [...c];
        cCall[p] = c[bettor];
        return { kind: 'd', actor: p, id: nodeSeq++, labels: ['fold', 'call'],
            children: [respChain(bettor, rest, aFold, cFold), respChain(bettor, rest, alive, cCall)] };
    };
    const betNode = (bettor, resp) => {
        const c = [0, 0, 0];
        c[bettor] = BET;
        return respChain(bettor, resp, [true, true, true], c);
    };
    const n_p2_xx = { kind: 'd', actor: 2, id: nodeSeq++, labels: ['check', 'bet'],
        children: [sd([true, true, true], [0, 0, 0]), betNode(2, [0, 1])] };
    const n_p1_x = { kind: 'd', actor: 1, id: nodeSeq++, labels: ['check', 'bet'],
        children: [n_p2_xx, betNode(1, [2, 0])] };
    const root = { kind: 'd', actor: 0, id: nodeSeq++, labels: ['check', 'bet'],
        children: [n_p1_x, betNode(0, [1, 2])] };
    // ---- 3人CFR+ ----
    const regret = new Map();
    const ssum = new Map();
    const tbl = (m, id, a) => {
        let t = m.get(id);
        if (!t) {
            t = new Float64Array(K * a);
            m.set(id, t);
        }
        return t;
    };
    const sumOf = (v) => { let s = 0; for (let i = 0; i < K; i++)
        s += v[i]; return s; };
    const walk = (node, rv, t) => {
        const u = [new Float64Array(K), new Float64Array(K), new Float64Array(K)];
        if (node.kind === 'win') {
            const P = 1 + node.c[0] + node.c[1] + node.c[2];
            const sums = rv.map(sumOf);
            for (let p = 0; p <= 2; p++) {
                const oth = sums[(p + 1) % 3] * sums[(p + 2) % 3];
                const gain = p === node.winner ? P - node.c[p] : -node.c[p];
                for (let i = 0; i < K; i++)
                    u[p][i] = oth * gain;
            }
            return u;
        }
        if (node.kind === 'sd') {
            const P = 1 + node.c[0] + node.c[1] + node.c[2];
            const [a0, a1, a2] = node.alive;
            if (a0 && a1 && a2) {
                for (let i = 0; i < K; i++)
                    for (let j = 0; j < K; j++)
                        for (let k = 0; k < K; k++) {
                            const w0 = T0[i][j][k], w1 = T1[j][i][k], w2 = T2[k][i][j];
                            const s = Math.max(1e-9, w0 + w1 + w2);
                            u[0][i] += rv[1][j] * rv[2][k] * ((w0 / s) * P - node.c[0]);
                            u[1][j] += rv[0][i] * rv[2][k] * ((w1 / s) * P - node.c[1]);
                            u[2][k] += rv[0][i] * rv[1][j] * ((w2 / s) * P - node.c[2]);
                        }
            }
            else {
                // 2人ショーダウン(1人フォールド済み)
                const pair = a0 && a1 ? [[0, 1, W01m]] : a0 && a2 ? [[0, 2, W02m]] : [[1, 2, W12m]];
                const [pa, pb, W] = pair[0];
                const pf = [0, 1, 2].find((x) => x !== pa && x !== pb);
                const sf = sumOf(rv[pf]);
                for (let i = 0; i < K; i++)
                    for (let j = 0; j < K; j++) {
                        const w = W[i][j];
                        u[pa][i] += sf * rv[pb][j] * (w * P - node.c[pa]);
                        u[pb][j] += sf * rv[pa][i] * ((1 - w) * P - node.c[pb]);
                    }
                const othFold = sumOf(rv[pa]) * sumOf(rv[pb]);
                for (let i = 0; i < K; i++)
                    u[pf][i] = othFold * (-node.c[pf]);
            }
            return u;
        }
        const A = node.children.length;
        const reg = tbl(regret, node.id, A);
        const ss = tbl(ssum, node.id, A);
        const mine = rv[node.actor];
        const sigma = new Float64Array(K * A);
        for (let i = 0; i < K; i++) {
            let sum = 0;
            for (let a = 0; a < A; a++)
                sum += Math.max(0, reg[i * A + a]);
            for (let a = 0; a < A; a++)
                sigma[i * A + a] = sum > 0 ? Math.max(0, reg[i * A + a]) / sum : 1 / A;
        }
        const childU = [];
        for (let a = 0; a < A; a++) {
            const scaled = new Float64Array(K);
            for (let i = 0; i < K; i++)
                scaled[i] = mine[i] * sigma[i * A + a];
            const next = rv.map((v, p) => (p === node.actor ? scaled : v));
            childU.push(walk(node.children[a], next, t));
        }
        for (let p = 0; p <= 2; p++) {
            if (p === node.actor) {
                for (let a = 0; a < A; a++)
                    for (let i = 0; i < K; i++)
                        u[p][i] += sigma[i * A + a] * childU[a][p][i];
            }
            else {
                for (let a = 0; a < A; a++)
                    for (let i = 0; i < K; i++)
                        u[p][i] += childU[a][p][i];
            }
        }
        for (let i = 0; i < K; i++)
            for (let a = 0; a < A; a++) {
                reg[i * A + a] = Math.max(0, reg[i * A + a] + childU[a][node.actor][i] - u[node.actor][i]);
                ss[i * A + a] += t * mine[i] * sigma[i * A + a];
            }
        return u;
    };
    const iters = ctx.iters ?? 160;
    const w = [
        Float64Array.from(B0.weights), Float64Array.from(B1.weights), Float64Array.from(B2.weights)
    ];
    for (let t = 1; t <= iters; t++)
        walk(root, w, t);
    // ---- 自分のノードを特定して戦略を読む ----
    const myScore = scoreBest([...ctx.heroHole, ...ctx.board]);
    const heroB = R[ctx.heroIdx];
    let myB = 0;
    while (myB < K - 1 && myScore > heroB.boundaries[myB])
        myB++;
    let node = null;
    if (ctx.bettorIdx === null) {
        node = ctx.heroIdx === 0 ? root : ctx.heroIdx === 1 ? n_p1_x : n_p2_xx;
    }
    else {
        // ベットに直面。中間の応答者は必ずコール済み(フォールドしていたら3人アクティブでない)
        const start = ctx.bettorIdx === 0 ? root.children[1]
            : ctx.bettorIdx === 1 ? n_p1_x.children[1] : n_p2_xx.children[1];
        let cur = start;
        while (cur.kind === 'd' && cur.actor !== ctx.heroIdx)
            cur = cur.children[1]; // call枝を辿る
        node = cur;
    }
    if (!node || node.kind !== 'd' || node.actor !== ctx.heroIdx)
        return null;
    const A2 = node.children.length;
    const ss = ssum.get(node.id);
    if (!ss)
        return null;
    let freqs = [];
    let total = 0;
    for (let a = 0; a < A2; a++) {
        freqs.push(ss[myB * A2 + a]);
        total += ss[myB * A2 + a];
    }
    if (total <= 0)
        return null;
    freqs = freqs.map((f) => f / total).map((f) => (f < 0.035 ? 0 : f));
    const t2 = freqs.reduce((a, b) => a + b, 0);
    if (t2 <= 0)
        return null;
    let x = r() * t2, pick = 0;
    for (let a = 0; a < A2; a++) {
        x -= freqs[a];
        if (x <= 0) {
            pick = a;
            break;
        }
    }
    const lb = node.labels[pick];
    if (lb === 'check')
        return { action: 'check' };
    if (lb === 'fold')
        return { action: 'fold' };
    if (lb === 'call')
        return { action: 'call' };
    return { action: 'raise', to: Math.round(ctx.pot * BET) };
}
// ---------------------------------------------------------------- ポジション
/** 参加者の席順からチャート用ポジションラベルを求める */
export function positionLabel(mySeat, buttonIndex, dealtSeats, maxSeats) {
    const n = dealtSeats.length;
    if (n <= 2)
        return mySeat === buttonIndex ? 'SB' : 'BB';
    const order = (s) => (s - (buttonIndex + 1) + maxSeats * 2) % maxSeats;
    const sorted = [...dealtSeats].sort((a, b) => order(a) - order(b)); // SBから
    const idx = sorted.indexOf(mySeat);
    if (idx === 0)
        return 'SB';
    if (idx === 1)
        return 'BB';
    if (mySeat === buttonIndex)
        return 'BTN';
    // ブラインドとBTNを除いた並び。最後がCO、その前は UTG..HJ
    const rest = sorted.slice(2).filter((s) => s !== buttonIndex);
    const ri = rest.indexOf(mySeat);
    if (ri === rest.length - 1 && rest.length >= 2)
        return 'CO';
    if (ri === rest.length - 2 && rest.length >= 3)
        return 'HJ';
    return 'UTG';
}
export function gtoPreflop(c) {
    const type = handTypeOf(c.hole[0], c.hole[1]);
    const stackBB = (c.myStack + c.myStreetBet) / c.bb;
    const r = c.rnd;
    // loose>0: 圏外ハンドを確率looseで拾う(レンジ拡大)。loose<0: 混合頻度(0<f<1)の
    // 境界ハンドだけタイト化する(純粋レンジのAA等は絶対に落とさない)
    const looseAll = c.loose + TUNE.preLoose;
    const inR = (spec, bonus = 0) => {
        const f0 = freq(spec, type);
        if (f0 <= 0)
            return r() < Math.max(0, looseAll);
        const adj = f0 < 1 ? Math.min(0, looseAll) : 0;
        return r() < Math.min(1, Math.max(0, f0 + bonus + adj));
    };
    const jam = { action: 'allin' };
    const openSize = (mult) => Math.round(c.bb * mult + c.limpers * c.bb);
    const late = c.openerPos === 'CO' || c.openerPos === 'BTN' || c.openerPos === 'SB';
    const facingShove = c.toCall > 0 && (c.opponentAllIn || c.toCall >= c.myStack * 0.85 || c.currentBet >= c.bb * 12 && c.currentBet >= (c.myStack + c.myStreetBet) * 0.6);
    // ---- 短スタック(トーナメント終盤など): Push/Fold モジュール ----
    if (stackBB <= 15 && (c.tourMode || stackBB <= 9)) {
        if (facingShove) {
            const band = nearestBand([15, 12, 10, 8, 6], stackBB);
            if (stackBB <= 3 || inR(CALL_SHOVE[band]))
                return { action: 'call' };
            return { action: 'fold' };
        }
        if (c.toCall > 0) {
            // 通常レイズに直面: コール帯より一段タイトにジャムで返すか降りる
            const band = nearestBand([15, 12, 10, 8, 6], stackBB);
            if (inR(CALL_SHOVE[band]) && (type === 'AA' || type === 'KK' || type === 'QQ' || type.startsWith('AK') || r() < 0.75))
                return jam;
            return { action: 'fold' };
        }
        // オープン: AA/KK はジャムせずミニレイズ(フォールドエクイティが最も無価値なのがレンジ最上位)
        if ((type === 'AA' || type === 'KK') && stackBB >= 5) {
            return r() < 0.65 ? { action: 'raise', to: Math.round(c.bb * 2) } : jam;
        }
        const band = nearestBand([15, 12, 10], stackBB);
        const posChart = PUSH[band][c.pos === 'BB' ? 'SB' : c.pos] ?? PUSH[band].BTN;
        let can = freq(posChart, type) > 0;
        if (!can && stackBB <= 8)
            can = freq(PUSH_EXTRA_8, type) > 0;
        if (!can && stackBB <= 6 && (c.pos === 'SB' || c.pos === 'BTN'))
            can = freq(PUSH_EXTRA_6, type) > 0;
        if (stackBB <= 2.2)
            can = true; // 2bb以下は実質任意の2枚
        if (c.pos === 'BB' && c.toCall === 0)
            return can && r() < 0.4 ? jam : { action: 'check' };
        return can ? jam : { action: 'fold' };
    }
    // ---- 誰もオープンしていない(リンプのみ含む) → RFI ----
    if (c.currentBet <= c.bb && c.toCall <= c.bb) {
        if (c.pos === 'BB' && c.toCall === 0) {
            // BBチェック。強い手はリンパーへアイソレイズ
            if (c.limpers > 0 && inR('99+, ATs+, AJo+, KQs'))
                return { action: 'raise', to: openSize(3.5) };
            return { action: 'check' };
        }
        const spec = c.headsUp && c.pos === 'SB' ? HU_SB_OPEN : RFI[c.pos];
        if (spec && inR(spec)) {
            if (c.limpers > 0) {
                // リンパーへのアイソレートはソルバー準拠で大きく(第5部§1.8: 4.3〜6.5bb。「3bb+1」は小さすぎる)
                return { action: 'raise', to: Math.round(c.bb * (4.3 + 0.5 * (c.limpers - 1) + r() * 0.4)) };
            }
            const mult = c.pos === 'SB' ? 3 : 2.3 + r() * 0.4;
            return { action: 'raise', to: openSize(mult) };
        }
        return c.toCall > 0 ? { action: 'fold' } : { action: 'check' };
    }
    if (facingShove) {
        // 深いスタックでのオールインには上位のみ
        if (inR('QQ+, AKs, AKo:0.6, JJ:0.3'))
            return { action: 'call' };
        return { action: 'fold' };
    }
    const raiseTo = (mult) => ({ action: 'raise', to: Math.round(c.currentBet * mult) });
    const iOpened = c.myStreetBet >= c.bb * 2;
    // ---- 自分がオープン → 3ベットされた ----
    if (iOpened && c.currentBet <= c.bb * 14) {
        if (inR(FOURBET))
            return c.currentBet * 2.3 >= (c.myStack + c.myStreetBet) * 0.55 ? jam : raiseTo(2.3);
        if (inR(CALL_3BET))
            return { action: 'call' };
        return { action: 'fold' };
    }
    // ---- 自分が3ベット済み → 4ベットされた ----
    if (iOpened || c.currentBet > c.bb * 14) {
        if (c.myStreetBet > c.bb * 6) {
            if (inR(FIVEBET_JAM))
                return jam;
            if (inR(CALL_4BET))
                return { action: 'call' };
            return { action: 'fold' };
        }
        // コールドで4ベットサイズに直面
        if (inR('QQ+, AKs, AKo:0.5'))
            return { action: 'call' };
        return { action: 'fold' };
    }
    // ---- オープンに直面(コールド) ----
    if (c.headsUp) {
        if (inR(HU_BB_3BET))
            return raiseTo(3.8);
        if (inR(HU_BB_CALL))
            return { action: 'call' };
        return { action: 'fold' };
    }
    if (c.pos === 'BB') {
        if (inR(late ? BB_3BET_VS_LATE : BB_3BET_VS_EARLY, c.aggr * 0.08 * TUNE.threeBetScale))
            return raiseTo(4);
        if (inR(late ? BB_CALL_VS_LATE : BB_CALL_VS_EARLY, TUNE.bbCallBonus))
            return { action: 'call' };
        return { action: 'fold' };
    }
    if (c.pos === 'SB') {
        // SBはほぼ3ベットorフォールド
        if (inR(late ? THREEBET_VS_LATE : THREEBET_VS_EARLY, c.aggr * 0.1 * TUNE.threeBetScale))
            return raiseTo(4);
        if (inR('22+:0.5, AQs:0.4, KQs:0.3, AQo:0.2'))
            return { action: 'call' };
        return { action: 'fold' };
    }
    if (inR(late ? THREEBET_VS_LATE : THREEBET_VS_EARLY, c.aggr * 0.08 * TUNE.threeBetScale))
        return raiseTo(3.5);
    if (inR(c.pos === 'BTN' ? COLDCALL_BTN : COLDCALL_MID))
        return { action: 'call' };
    return { action: 'fold' };
}
function classifyTexture(board) {
    const ranks = board.map((c) => (c >> 2) + 2).sort((a, b) => b - a);
    const suits = new Map();
    for (const c of board)
        suits.set(c & 3, (suits.get(c & 3) ?? 0) + 1);
    const maxSuit = Math.max(...suits.values());
    const paired = new Set(ranks).size < ranks.length;
    const monotone = maxSuit >= 3;
    const twoTone = !monotone && maxSuit >= 2;
    const top3 = ranks.slice(0, 3);
    const connected = !paired && top3[0] - top3[2] <= 4;
    const aceHigh = ranks[0] === 14;
    const broadway = !aceHigh && ranks[0] >= 11;
    const dynamicMid = !paired && ranks[0] >= 9 && ranks[0] <= 11;
    return { paired, monotone, twoTone, connected, aceHigh, broadway, dynamicMid, wet: monotone || twoTone || connected };
}
function drawFeatures(hole, board) {
    const all = [...hole, ...board];
    const suitCnt = new Map();
    for (const c of all)
        suitCnt.set(c & 3, (suitCnt.get(c & 3) ?? 0) + 1);
    let flushDraw = false, nutFlushDraw = false, backdoorFlush = false;
    for (const [s, n] of suitCnt) {
        const holeOfSuit = hole.filter((h) => (h & 3) === s);
        if (!holeOfSuit.length)
            continue;
        if (n === 4) {
            flushDraw = true;
            if (holeOfSuit.some((h) => (h >> 2) + 2 === 14))
                nutFlushDraw = true;
        }
        else if (n === 3 && board.length === 3)
            backdoorFlush = true;
    }
    const rankSet = new Set(all.map((c) => (c >> 2) + 2));
    if (rankSet.has(14))
        rankSet.add(1); // Aはローにも
    const holeRanks = new Set(hole.map((c) => (c >> 2) + 2));
    if (holeRanks.has(14))
        holeRanks.add(1);
    let oesd = false, gutshot = false;
    for (let lo = 1; lo <= 10; lo++) {
        const win = [lo, lo + 1, lo + 2, lo + 3, lo + 4];
        const present = win.filter((v) => rankSet.has(v));
        if (present.length === 4 && present.some((v) => holeRanks.has(v))) {
            // 4連続(端が開いている)ならOESD、飛びならガット
            const run = present[3] - present[0] === 3;
            if (run && present[0] > 1 && present[3] < 14)
                oesd = true;
            else
                gutshot = true;
        }
    }
    const topBoard = Math.max(...board.map((c) => (c >> 2) + 2));
    const overcards = hole.every((c) => (c >> 2) + 2 > topBoard) && (hole[0] >> 2) !== (hole[1] >> 2);
    let outs = 0;
    if (flushDraw)
        outs += 9;
    if (oesd)
        outs += flushDraw ? 6 : 8;
    else if (gutshot)
        outs += flushDraw ? 3 : 4;
    if (overcards && !flushDraw && !oesd)
        outs += 4;
    return { flushDraw, nutFlushDraw, oesd, gutshot, backdoorFlush, overcards, outs };
}
/** メイドハンドの相対強度(0..1)。ボード文脈(トップペア/オーバーペア等)込み */
function madeScore(hole, board) {
    const hv = evaluateBest([...hole, ...board]);
    const boardRanks = board.map((c) => (c >> 2) + 2);
    const top = Math.max(...boardRanks);
    const h1 = (hole[0] >> 2) + 2, h2 = (hole[1] >> 2) + 2;
    const pocketPair = h1 === h2;
    switch (hv.category) {
        case HandCategory.StraightFlush: return 1;
        case HandCategory.Quads: return 0.99;
        case HandCategory.FullHouse: return 0.96;
        case HandCategory.Flush: return hole.some((c) => (c >> 2) + 2 === 14 && board.filter((b) => (b & 3) === (c & 3)).length >= 3) ? 0.95 : 0.9;
        case HandCategory.Straight: return 0.88;
        case HandCategory.Trips: {
            // セット(ポケットペア由来)は最強クラス
            if (pocketPair && boardRanks.includes(h1))
                return 0.93;
            return 0.82;
        }
        case HandCategory.TwoPair: {
            // 両ホールカード使いのツーペアか、ボードペア+1枚か
            const usingBoth = boardRanks.includes(h1) && boardRanks.includes(h2) && !pocketPair;
            return usingBoth ? 0.8 : 0.62;
        }
        case HandCategory.Pair: {
            if (pocketPair && h1 > top)
                return 0.72; // オーバーペア
            if (boardRanks.includes(Math.max(h1, h2)) && Math.max(h1, h2) === top) {
                const kicker = Math.min(h1, h2);
                return kicker >= 12 ? 0.68 : kicker >= 10 ? 0.62 : 0.56; // トップペア(キッカー依存)
            }
            if (pocketPair)
                return h1 >= boardRanks.sort((a, b) => b - a)[1] ? 0.5 : 0.4;
            const pr = boardRanks.includes(h1) ? h1 : h2;
            const sorted = [...new Set(boardRanks)].sort((a, b) => b - a);
            if (pr === sorted[1])
                return 0.46; // セカンドペア
            return 0.36; // 下のペア
        }
        default: {
            // ハイカード: A/Kハイは僅かにショーダウンバリュー
            const hi = Math.max(h1, h2);
            return hi === 14 ? 0.26 : hi === 13 ? 0.22 : 0.15;
        }
    }
}
/**
 * ターンカードの分類(第5部§3.3)。フロップ3枚に対する4枚目の性質で、
 * バレル頻度が大きく変わる: オーバーカード/スケア=60〜80%、ブランク=約50%、
 * ボードペア=大半チェック、ドロー完成=ナッツ+ブロッカーのみ。
 */
export function turnCardClass(board) {
    if (board.length !== 4)
        return null;
    const t = board[3];
    const tr = (t >> 2) + 2;
    const franks = board.slice(0, 3).map((c) => (c >> 2) + 2);
    if (franks.includes(tr))
        return 'board-pair';
    // フラッシュ完成: ターンの札を含めて同スートが3枚以上
    let suitN = 0;
    for (const c of board)
        if ((c & 3) === (t & 3))
            suitN++;
    if (suitN >= 3)
        return 'draw-complete';
    // ストレート完成: ターン札を含む5幅の窓に、ボードの3ランク以上が入る
    // (例: 9-8-2 に 7 → {7,8,9}。ホール2枚でストレートが新たに成立し得る形)
    const rset = new Set(board.map((c) => (c >> 2) + 2));
    if (rset.has(14))
        rset.add(1);
    for (let lo = Math.max(1, tr - 4); lo <= Math.min(10, tr); lo++) {
        let n = 0;
        for (let v = lo; v < lo + 5; v++)
            if (rset.has(v))
                n++;
        if (n >= 3)
            return 'draw-complete';
    }
    if (tr > Math.max(...franks))
        return 'overcard';
    return 'blank';
}
/** リバーのブロッカー情報(§23-24): ナッツスートのAブロッカー / ミスしたFD */
function riverBlockerInfo(hole, board) {
    const cnt = new Map();
    for (const c of board)
        cnt.set(c & 3, (cnt.get(c & 3) ?? 0) + 1);
    let nutBlocker = false, missedFD = false;
    for (const [su, n] of cnt) {
        const mine = hole.filter((h) => (h & 3) === su);
        if (n >= 3 && mine.length === 1) {
            const rk = (mine[0] >> 2) + 2;
            // フラッシュ完成ボードでAsだけ持つ → 相手のナッツをブロックしつつ自分はフラッシュなし
            if (rk === 14 || rk === 13)
                nutBlocker = true;
        }
        // ボードに2枚だけ + 手札2枚同スート = FDが完成しなかった(悪いブラフ候補)
        if (n === 2 && mine.length === 2)
            missedFD = true;
    }
    return { nutBlocker, missedFD };
}
export function gtoPostflop(c) {
    const r = c.rnd;
    const conf = c.conf ?? 0;
    const oppFold = c.oppFold ?? 0.5;
    const oppAggr = c.oppAggr ?? 0.5;
    const spr = c.myStack / Math.max(1, c.pot);
    // 3人残りリバーは専用の3wayソルバーで解く(V2 Phase5のマルチウェイ版)。
    // レンジ情報が揃っていて自分がこのストリート未投入のときだけ(レイズ合戦は木が合わない)。
    if (c.street === 'river' && c.nActive === 3 && c.board.length === 5 &&
        c.multiwaySpecs && c.multiwaySpecs.length === 3 && typeof c.heroOrder === 'number' &&
        !(c.heroStreetBet && c.heroStreetBet > 0) && r() < (0.3 + 0.6 * c.tier) * TUNE.solverGate) {
        try {
            const g = solveRiver3({
                heroHole: c.hole, board: c.board,
                heroIdx: c.heroOrder,
                specs: c.multiwaySpecs,
                tightens: (c.multiwayTightens ?? [0, 0, 0]),
                pot: Math.max(1, c.pot - c.toCall),
                bettorIdx: c.bettorOrder ?? null,
                facingBet: c.toCall, rnd: r,
            });
            if (g) {
                if (g.action === 'fold' && c.toCall <= 0)
                    return { action: 'check' };
                return g;
            }
        }
        catch { /* ヒューリスティックへ */ }
    }
    // フロップ・ブループリント(第4部フェーズ3): 事前計算した頻出フロップの均衡表があれば、
    // その場でCFRを回さず表を引く。HU・SRP(このストリート未投入)の局面が対象。
    // ソルバーより桁違いに速いので高ティアでは適用率を高く取る(表に無ければ通常経路へ)。
    if (BLUEPRINT && c.street === 'flop' && c.nActive === 2 && c.board.length === 3 &&
        !(c.heroStreetBet && c.heroStreetBet > 0) && r() < (0.5 + 0.5 * c.tier) * TUNE.solverGate) {
        const g = blueprintAction(c);
        if (g)
            return g;
    }
    // フロップ/ターン/リバーはヘッズアップならその場でCFRで解く(V2 Phase5/6)。高レート卓ほど適用率が高い。
    // レイズ合戦(自分がこのストリートで投入済み → レイズを受けた)もサブツリー再解法で扱う:
    // 自分の投入分をポットに組み込み、両者のレンジを1段タイト化した unsafe re-solve(Libratus式の軽量版)
    const raisedWar = (c.heroStreetBet ?? 0) > 0 && c.toCall > 0;
    const solvable = c.nActive === 2 && c.heroSpec && c.villainSpec &&
        (!(c.heroStreetBet && c.heroStreetBet > 0) || raisedWar);
    const wantRiverSolve = c.street === 'river' && c.board.length === 5 && r() < (0.35 + 0.65 * c.tier) * TUNE.solverGate;
    const wantTurnSolve = c.street === 'turn' && c.board.length === 4 && r() < (0.3 + 0.6 * c.tier) * TUNE.solverGate;
    const wantFlopSolve = c.street === 'flop' && c.board.length === 3 && r() < (0.25 + 0.55 * c.tier) * TUNE.solverGate;
    if (solvable && (wantRiverSolve || wantTurnSolve || wantFlopSolve)) {
        try {
            const potStart = Math.max(1, c.pot - c.toCall);
            const solve = c.street === 'river' ? solveRiver : c.street === 'turn' ? solveTurn : solveFlop;
            const g = solve({
                heroHole: c.hole, board: c.board,
                heroSpec: c.heroSpec, villSpec: c.villainSpec,
                heroTighten: (c.heroAggStreets ?? 0) + (raisedWar ? 1 : 0),
                villTighten: (c.villainAggStreets ?? 0) + (raisedWar ? 1 : 0),
                heroIP: c.inPosition,
                pot: potStart, effStack: c.myStack, facingBet: c.toCall, rnd: r,
            });
            if (g) {
                // fold可能局面でないのにfoldが出るケースを防ぐ
                if (g.action === 'fold' && c.toCall <= 0)
                    return { action: 'check' };
                return g;
            }
        }
        catch { /* ヒューリスティックへフォールバック */ }
    }
    const t = classifyTexture(c.board);
    const d = c.street === 'river'
        ? { flushDraw: false, nutFlushDraw: false, oesd: false, gutshot: false, backdoorFlush: false, overcards: false, outs: 0 }
        : drawFeatures(c.hole, c.board);
    const s = madeScore(c.hole, c.board);
    const defenders = Math.max(1, c.nActive - 1);
    const multiPenalty = Math.max(0, c.nActive - 2);
    // ドローのエクイティ(1枚あたり約2.17%/アウト、大きな圧力に対しては2枚分)
    const perCard = c.street === 'flop' ? 0.0217 : 0.0217;
    const bigPressure = c.toCall >= c.myStack * 0.55;
    const drawEq = d.outs * perCard * (c.street === 'flop' && bigPressure ? 2 : 1)
        + (d.nutFlushDraw ? 0.03 : 0);
    if (c.toCall > 0) {
        // ======== ベットに直面 ========
        // 必要エクイティは常に リスク/(リスク+リターン)
        const required = c.toCall / (c.pot + c.toCall);
        const betFrac = c.toCall / Math.max(1, c.pot - c.toCall);
        // ポジションペナルティ: IPはMDF通り、OOPはオーバーフォールド(+8〜12pt)
        let threshold = required
            + (c.inPosition ? 0.02 : TUNE.oopPenalty)
            + multiPenalty * 0.05
            + (c.tight - 0.4) * 0.1
            + (c.tourMode && bigPressure ? 0.04 : 0) // ICM近似のリスクプレミアム
            + (bigPressure ? 0.05 : 0);
        if (betFrac <= 0.4)
            threshold -= TUNE.smallBetDef; // 小さいベットには広く防御
        // SPR(§19): 低SPRではワンペアの価値UP(コミット)、高SPRではワンペアでスタックオフしない(RIO)
        if (spr < 3 && s >= 0.62)
            threshold -= 0.05;
        if (spr > 10 && s >= 0.5 && s < 0.72)
            threshold += 0.05;
        // 相手傾向Exploit(§41-42): アグレッシブなプールにはブラフキャッチを広げ、受動的なプールには降りる
        if (c.street === 'river')
            threshold += (0.5 - oppAggr) * 0.12 * conf;
        // 実エクイティ(V2 §8/§10): 相手レンジがあればMCで「Raw Equity vs Villain Range」を計算。
        // ランアウトを回すのでドロー完成も織り込み済み。攻めてきた相手はレンジを上位へ寄せる
        let equity = Math.min(0.98, s * 0.92 + drawEq);
        if (c.villainSpec) {
            const mc = equityVsRange(c.hole, c.board, c.villainSpec, { iters: 130, tighten: c.villainAggStreets ?? 0, rnd: r });
            if (mc !== null)
                equity = Math.min(0.98, mc);
        }
        // バリューレイズ。低SPRなら強いワンペア以上で早めにコミットする
        const strongRaise = c.street === 'river' ? 0.86 : spr < 2.5 ? 0.72 : 0.8;
        if (s >= strongRaise && r() < 0.55 + c.aggr * 0.3) {
            const to = Math.round(c.currentBet + (c.pot + c.toCall) * (TUNE.valueRaiseSize + r() * 0.4));
            return to >= (c.myStack + c.currentBet) * 0.8 ? { action: 'allin' } : { action: 'raise', to };
        }
        // セミブラフのチェックレイズ(小さいベットに対して多め、マルチウェイでは激減)
        if (c.street !== 'river' && (d.flushDraw || d.oesd) && !bigPressure
            && betFrac <= 0.55 && multiPenalty === 0 && r() < TUNE.xrFreq * (0.5 + c.aggr)) {
            return { action: 'raise', to: Math.round(c.currentBet + (c.pot + c.toCall) * 0.9) };
        }
        if (equity >= threshold || (s >= 0.55 && betFrac <= 0.4))
            return { action: 'call' };
        // ブラフキャッチ: リバーでたまにMDF分だけ広げる(高ティアほど正しく)
        if (c.street === 'river' && s >= 0.5 && betFrac <= 1.0 && r() < 0.18 * c.tier)
            return { action: 'call' };
        return { action: 'fold' };
    }
    // ======== チェックまたはベット ========
    // Cベット頻度: レンジ優位ベース + テクスチャ補正(第3部 §3.7)
    let f = c.wasAggressor ? TUNE.cbetAggr : TUNE.cbetNon;
    if (t.paired)
        f += 0.15;
    if (t.aceHigh)
        f -= 0.08; // エースハイはKハイより低頻度(実測)
    if (t.broadway && !t.wet)
        f += 0.1;
    if (t.monotone)
        f *= 0.45;
    if (t.connected)
        f -= 0.12;
    f *= Math.pow(0.55, multiPenalty); // マルチウェイ: α^(1/n)の帰結でCベット半減
    // 攻めの2変数化(V2 §31): チェックレイズが多いプールにはCベット頻度を下げる(サメ対策)
    f -= ((c.oppRaisey ?? 0.5) - 0.5) * 0.2 * conf;
    // ターンカードの分類(第5部§3.3): オーバーカード=バレル増、ボードペア/ドロー完成=激減
    const tc = c.street === 'turn' ? turnCardClass(c.board) : null;
    if (c.wasAggressor) {
        if (tc === 'overcard')
            f += 0.15;
        else if (tc === 'board-pair')
            f -= 0.18;
        else if (tc === 'draw-complete')
            f -= 0.15;
    }
    else if (tc === 'draw-complete') {
        // 「Flop Checkは情報」: チェックスルー後にドローが完成すると、アグレッサーは
        // ドローをフロップで打っていたはずなので、コーラー側がナッツ優位を得る → プローブ増。
        // しかもプールはプローブにオーバーフォールドする(第3部§3.9 リークB)。
        // テクスチャ側のコネクト/ウェット減点を上回るよう強めに乗せる
        f += TUNE.probeBoost;
    }
    f = Math.max(0.05, Math.min(0.95, f + (c.aggr - 0.5) * 0.15));
    // サイズ: ドライ/ペア33%、ウェット66-75%、ミドル動的ボードの強い手はオーバーベット
    let sizeFrac = t.paired || (!t.wet && !t.dynamicMid) ? 0.33 : 0.66;
    if (t.monotone)
        sizeFrac = 0.33;
    // ターンのバレルは小さい⅓を使わない(第5部§3.6: チェックか66%以上の二択が基本)
    if (tc === 'overcard' || (c.street === 'turn' && c.wasAggressor && tc === 'blank')) {
        sizeFrac = Math.max(sizeFrac, 0.66);
    }
    // ドロー完成ターンのプローブはリニアで小さく(第3部§3.5「ペラペラのドアには軽い一押しで十分」)
    if (!c.wasAggressor && tc === 'draw-complete')
        sizeFrac = Math.min(sizeFrac, 0.5);
    if (multiPenalty > 0)
        sizeFrac = Math.min(sizeFrac, 0.5);
    const betTo = (frac) => {
        const amt = Math.max(c.bb, Math.round(c.pot * frac));
        return amt >= c.myStack * 0.9 ? { action: 'allin' } : { action: 'raise', to: amt };
    };
    // IPのアグレッサーは1ペアをターンでバレルしない(第5部§3.10-6:
    // 「サードペア、セカンドペア、大半のトップペアが厳密にチェック」。プールは保護名目で打ちすぎる)
    if (c.street === 'turn' && c.wasAggressor && c.inPosition &&
        s >= 0.46 && s < 0.7 && tc !== 'overcard' && r() < TUNE.onePairTurnCheck) {
        return { action: 'check' };
    }
    // バリューベット。コーリングステーション相手には薄いバリューを増やす(§41)
    const valueThr = (c.street === 'river' ? TUNE.valueThrRiver : TUNE.valueThr) - Math.max(0, 0.5 - oppFold) * 0.1 * conf;
    if (s >= valueThr) {
        // AAトラップ: ドライなエースハイでモンスターはたまにチェック(コールレンジをブロックしすぎる)
        if (t.aceHigh && !t.wet && s >= 0.9 && r() < 0.3)
            return { action: 'check' };
        // 強い手が脆弱(ウェット/動的) → バリュー前倒しで大きく
        if (s >= 0.75 && (t.dynamicMid || t.wet) && c.street !== 'flop' && multiPenalty === 0 && c.tier > 0.3 && r() < 0.4) {
            return betTo(1.1);
        }
        if (c.street === 'river' && s >= 0.85 && multiPenalty === 0)
            return betTo(0.75 + r() * 0.5);
        if (r() < Math.min(0.95, f + (s >= 0.72 ? 0.45 : 0.3)))
            return betTo(s >= 0.72 ? Math.max(sizeFrac, 0.5) : sizeFrac);
        return { action: 'check' };
    }
    // セミブラフ階層: FD/OESD > ガット > バックドア(フロップのみ)
    if (c.street !== 'river') {
        if ((d.flushDraw || d.oesd) && r() < (TUNE.semibluffF + c.aggr * 0.25) * Math.pow(0.6, multiPenalty))
            return betTo(t.wet ? 0.66 : 0.5);
        if (d.gutshot && r() < 0.32 * (0.5 + c.aggr) * Math.pow(0.5, multiPenalty))
            return betTo(sizeFrac);
        if (c.street === 'flop' && d.backdoorFlush && d.overcards && r() < 0.3 * c.bluff * 2 && multiPenalty === 0)
            return betTo(sizeFrac);
    }
    // 純ブラフ: リバーのブラフ率は s/(1+2s)を上限に、SDVのない手だけ
    if (s <= 0.4) {
        const bi = c.street === 'river' ? riverBlockerInfo(c.hole, c.board) : { nutBlocker: false, missedFD: false };
        const bluffCap = c.street === 'river' ? sizeFrac / (1 + 2 * sizeFrac) : 0.25;
        let p = Math.min(bluffCap, TUNE.bluffBase + c.bluff * 0.5) * (f / 0.6) * Math.pow(0.4, multiPenalty)
            * (c.wasAggressor ? 1 : 0.55)
            // Aハイ等のSDV持ちはブラフに回さない。ただしフラッシュ完成ボードのAブロッカーは
            // SDVがほぼ死んでおり最良のブラフ候補なので例外(§23-24)
            * (s >= 0.26 && !bi.nutBlocker ? 0.5 : 1);
        // 相手傾向Exploit: 降りやすいプールにはブラフ増、ステーションには絞る(§41-42)
        p *= 1 + (oppFold - 0.5) * 1.4 * conf;
        // ドロー完成ターン/ボードペアでのブラフは規律を守って半減(第5部§3.5 諦めの条件)
        if (tc === 'draw-complete' || tc === 'board-pair')
            p *= 0.5;
        let bluffSize = c.street === 'river' ? 0.66 : sizeFrac;
        if (bi.nutBlocker) {
            p *= 1.8;
            bluffSize = 0.75 + r() * 0.35;
        }
        else if (bi.missedFD)
            p *= 0.45;
        if (r() < p)
            return betTo(bluffSize);
    }
    return { action: 'check' };
}
//# sourceMappingURL=botgto.js.map