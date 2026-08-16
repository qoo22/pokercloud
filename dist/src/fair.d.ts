/**
 * Provably Fair（証明可能な公正性）
 *
 * 目的：
 *   「配牌を操作していない」ことを、運営の言葉ではなくプレイヤー自身の計算で確認できるようにする。
 *   仕様書に書いたとおり、このジャンルで最大の炎上要因は配牌操作への不信であり、
 *   第三者認証（iTech Labs など）を取っても疑いは消えない。認証は「監査時点でのコードが正しい」
 *   ことしか示さないからだ。Provably Fair は「今あなたが遊んだこのハンド」の正しさを示す。
 *
 * 仕組み：
 *   1. ハンド開始前、サーバーは serverSeed（32バイトの乱数）を生成し、
 *      その SHA-256（＝コミットメント）だけを公開する。シードそのものは伏せる。
 *   2. 各プレイヤーは clientSeed を提出する。全員分を連結したものが実際のクライアントシードになる。
 *   3. デッキの並びは HMAC-SHA256(serverSeed, "clientSeed:nonce") から導出する。
 *   4. ハンド終了後、サーバーは serverSeed を開示する。
 *   5. プレイヤーは SHA-256(serverSeed) がコミットメントと一致することを確認し、
 *      同じ手順でデッキを再現して、実際に配られたカードと一致するか検証する。
 *
 * なぜこれで操作できないのか：
 *   サーバーは手札を見てから serverSeed を選び直せない。コミットメントを先に公開しており、
 *   SHA-256 の原像計算は現実的に不可能だからだ。
 *   逆にプレイヤーも自分に有利な配牌は作れない。serverSeed を知らないうちに clientSeed を出すため。
 *   さらに clientSeed は全席分を連結しているので、特定の 1 人が結果を狙うこともできない。
 *
 * 前提となる運用ルール（これを守らないと仕組みが無意味になる）：
 *   - コミットメントは必ずカードを配る前にクライアントへ送ること
 *   - serverSeed はハンドごとに新規生成し、開示後は二度と使わないこと
 *   - clientSeed の受付はコミットメント公開後・配牌前の窓に限ること
 */
import { type Card, type Rng } from './cards.js';
import { sha256, sha256Hex, hmacSha256, bytesToHex, hexToBytes } from './sha256.js';
export interface FairnessInput {
    /** サーバーの秘密シード（16進、32バイト推奨） */
    serverSeed: string;
    /** 全席分を合成したクライアントシード */
    clientSeed: string;
    /** ハンド連番。同じシード組でもハンドごとに違う並びになる */
    nonce: number;
}
export interface FairnessCommitment {
    /** 配牌前に公開する SHA-256(serverSeed) */
    commitment: string;
    clientSeed: string;
    nonce: number;
    /** 各席が提出した生のシード（合成の内訳） */
    clientSeedParts: string[];
}
export interface FairnessReveal extends FairnessCommitment {
    /** ハンド終了後に開示する */
    serverSeed: string;
    /** 導出されたデッキ（配布順、"As" 形式） */
    deck: string[];
}
/** CSPRNG で 16 進のランダムシードを作る */
export declare function randomSeedHex(bytes?: number): string;
/** serverSeed からコミットメント（公開するハッシュ）を作る */
export declare function commitmentOf(serverSeed: string): string;
/**
 * 全席のクライアントシードを 1 本に合成する。
 *
 * 単純連結ではなく席順を固定した上で "|" 区切りにしているのは、
 * ("ab", "c") と ("a", "bc") が同じ文字列にならないようにするため（連結の曖昧性の除去）。
 * 席順は座席インデックス順に固定し、提出順に依存させない。
 */
export declare function combineClientSeeds(seedsBySeat: string[]): string;
/** 席ごとのシードが未提出なら自動生成して埋める */
export declare function fillMissingClientSeeds(seedsBySeat: Array<string | null | undefined>, bytes?: number): string[];
/**
 * HMAC-SHA256 をカウンタモードで回してバイト列を生成し、そこから一様な整数を切り出す乱数源。
 *
 * 剰余バイアスは棄却サンプリングで除去する（cards.ts の CSPRNG と同じ方針）。
 * ここで手を抜いて `% n` にすると、低いインデックスがわずかに出やすくなり、
 * 「検証可能だが公正ではない」という最悪の状態になる。
 */
export declare function createFairRng(input: FairnessInput): Rng;
/** シードからデッキの並びを決定論的に導出する */
export declare function deriveDeck(input: FairnessInput): Card[];
export interface VerifyInput {
    serverSeed: string;
    /** 配牌前に公開されていたコミットメント */
    commitment: string;
    clientSeed: string;
    nonce: number;
    /** 実際に配られたデッキ（"As" 形式、配布順） */
    deck: string[];
}
export interface VerifyCheck {
    label: string;
    passed: boolean;
    detail: string;
}
export interface VerifyResult {
    passed: boolean;
    checks: VerifyCheck[];
    /** 検証側で再現したデッキ */
    derivedDeck: string[];
    /** 一致しなかった位置（0 始まり） */
    mismatchIndexes: number[];
}
/**
 * ハンドの公正性を検証する。
 *
 * この関数はサーバーの状態に一切アクセスしない。入力だけから結論が出る。
 * だからこそプレイヤーの手元で（あるいは第三者が）実行する意味がある。
 */
export declare function verifyHand(input: VerifyInput): VerifyResult;
/**
 * 1 テーブル分のシード管理。
 *
 * ハンドごとに serverSeed を作り直し、nonce を進める。
 * サーバー実装では、beginHand() の戻り値（コミットメント）を配牌前に必ずクライアントへ送り、
 * ハンド終了時に reveal() の結果を送る、という順序を守ること。
 */
export declare class FairnessSession {
    private serverSeed;
    private revealed;
    private locked;
    private rawSeeds;
    private frozenParts;
    readonly commitment: string;
    readonly nonce: number;
    constructor(opts?: {
        /** 席ごとのクライアントシード。null / 未指定の席は締切時に自動生成される */
        clientSeeds?: Array<string | null | undefined>;
        nonce?: number;
        /** テスト用に serverSeed を固定したい場合 */
        serverSeed?: string;
        seatCount?: number;
    });
    /**
     * 席のクライアントシードを提出する。
     * 締切（lock）後は受け付けない。配牌後に差し替えられたら仕組みが崩れるため。
     */
    submitClientSeed(seat: number, seed: string): boolean;
    /** シードの受付を締め切って確定させる。未提出の席はここで自動生成される */
    lock(): void;
    get isLocked(): boolean;
    get clientSeedParts(): string[];
    get clientSeed(): string;
    /** 配牌前にクライアントへ送る情報。serverSeed は含まれない */
    getCommitment(): FairnessCommitment;
    /** デッキを導出する。サーバー内部でのみ呼ぶ。呼んだ時点でシードは締め切られる */
    deriveDeck(): Card[];
    /** ハンド終了後にシードを開示する */
    reveal(): FairnessReveal;
    get isRevealed(): boolean;
}
export { sha256, sha256Hex, hmacSha256, bytesToHex, hexToBytes };
