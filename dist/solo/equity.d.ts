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
import { type Card } from '../src/cards.js';
export type EquityMode = 'AUTO' | 'EXACT' | 'MONTE_CARLO';
export type Street = 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER';
export type PlayerStatus = 'ACTIVE' | 'ALL_IN' | 'FOLDED';
export interface EquityPlayerInput {
    id: string;
    /** 既知の 2 枚。未知（レンジ計算）は将来対応。ACTIVE/ALL_IN では必須 */
    holeCards?: [Card, Card];
    status: PlayerStatus;
}
export interface EquityRequest {
    players: EquityPlayerInput[];
    board: Card[];
    /** サーバーだけが知る「山札に戻らない札」（フォールド済みの既知ホール等） */
    deadCards?: Card[];
    mode?: EquityMode;
    /** AUTO で数え上げに使う上限ケース数。超えたらモンテカルロ */
    maxExactCases?: number;
    /** モンテカルロの試行数 */
    samples?: number;
    /** モンテカルロの seed（省略時は非決定） */
    seed?: number;
}
export interface PlayerEquityResult {
    playerId: string;
    equity: number;
    winProbability: number;
    tieProbability: number;
    loseProbability: number;
    wins: number;
    ties: number;
    losses: number;
    samples: number;
}
export interface EquityResponse {
    modeUsed: 'EXACT' | 'MONTE_CARLO';
    street: Street;
    players: PlayerEquityResult[];
    totalRunouts: number;
    calculationTimeMs: number;
    exact: boolean;
    seed?: number;
}
export type EquityErrorCode = 'INVALID_CARD' | 'DUPLICATE_CARD' | 'INVALID_BOARD' | 'INVALID_PLAYER_COUNT' | 'INVALID_HOLE_CARDS' | 'NO_ACTIVE_PLAYERS' | 'CALCULATION_LIMIT_EXCEEDED';
export declare class EquityError extends Error {
    readonly code: EquityErrorCode;
    constructor(code: EquityErrorCode, message: string);
}
/**
 * AUTO のデフォルト上限。フロップ以降（≤990 通り）は必ず数え上げ、プリフロップ（HU で
 * C(48,5)=1,712,304）は既定ではモンテカルロにする。実測でプリフロップ全列挙は約 27 秒かかり
 * リアルタイム表示に耐えないため（実装指示書 §7「preflop は実測性能に応じ完全列挙または MC」）。
 * mode:'EXACT' を明示すれば、下の HARD_EXACT_CEILING までは数え上げを強制できる。
 */
export declare const DEFAULT_MAX_EXACT_CASES = 200000;
/**
 * 勝率・Equity を計算する（純関数）。
 * board 完成（RIVER）は 1 回評価、それ以外はモードに応じ数え上げ／モンテカルロ。
 */
export declare function calculateEquity(req: EquityRequest): EquityResponse;
/** 文字列カード（"As" 等）で呼びたいとき用の薄いヘルパ */
export declare function parsePlayerHole(a: string, b: string): [Card, Card];
/**
 * 勝率の公開モード。
 *   NONE                 … 表示しない
 *   HERO_VS_UNKNOWN      … 対戦中の既定。自分の手札 vs「未知の相手（一様ランダム）」の主観勝率。
 *                          相手の実手札を一切見ないので、数値から相手の強さは漏れない。
 *   SHOWDOWN_ONLY        … 全員オールイン等で手札が公開されて初めて実カードの正確な勝率を見せる。
 *   SPECTATOR_ALL_KNOWN  … 観戦専用チャンネルのみ。プレイヤー Client へは送らない（要権限）。
 *   REPLAY               … ハンド終了後の再生。
 */
export declare enum EquityVisibilityMode {
    NONE = "NONE",
    HERO_VS_UNKNOWN = "HERO_VS_UNKNOWN",
    SHOWDOWN_ONLY = "SHOWDOWN_ONLY",
    SPECTATOR_ALL_KNOWN = "SPECTATOR_ALL_KNOWN",
    REPLAY = "REPLAY"
}
/**
 * 「この視点・この局面で、実カードの勝率を出してよいか」を判定するポリシー。
 * サーバーが配信内容を組み立てる前に必ずここを通す想定（room.ts が実装で担保している挙動の明文化）。
 */
export declare function resolveVisibility(ctx: {
    isSpectator: boolean;
    handComplete: boolean;
    cardsPublic: boolean;
    isReplay?: boolean;
    spectatorAuthorized?: boolean;
}): EquityVisibilityMode;
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
export declare function heroEquityVsUnknown(hole: readonly Card[], board: readonly Card[], oppCount: number, opts?: {
    iters?: number;
    seed?: number;
}): number;
