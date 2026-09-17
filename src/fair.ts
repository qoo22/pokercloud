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

import { type Card, type Rng, freshDeck, shuffle, cardToString } from './cards.js';
import { sha256, sha256Hex, hmacSha256, bytesToHex, hexToBytes, utf8ToBytes, timingSafeEqualHex } from './sha256.js';

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

// ---------------------------------------------------------------------------
// シードの生成と合成
// ---------------------------------------------------------------------------

/** CSPRNG で 16 進のランダムシードを作る */
export function randomSeedHex(bytes = 32): string {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('CSPRNG が利用できません。Node.js 19 以上、または Web Crypto 対応ブラウザで実行してください。');
  }
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

/** serverSeed からコミットメント（公開するハッシュ）を作る */
export function commitmentOf(serverSeed: string): string {
  return sha256Hex(serverSeed);
}

/**
 * 全席のクライアントシードを 1 本に合成する。
 *
 * 単純連結ではなく席順を固定した上で "|" 区切りにしているのは、
 * ("ab", "c") と ("a", "bc") が同じ文字列にならないようにするため（連結の曖昧性の除去）。
 * 席順は座席インデックス順に固定し、提出順に依存させない。
 */
export function combineClientSeeds(seedsBySeat: string[]): string {
  return seedsBySeat.map((s) => (s ?? '').replace(/\|/g, '_')).join('|');
}

/** 席ごとのシードが未提出なら自動生成して埋める */
export function fillMissingClientSeeds(seedsBySeat: Array<string | null | undefined>, bytes = 8): string[] {
  return seedsBySeat.map((s) => (s && s.length > 0 ? s : randomSeedHex(bytes)));
}

// ---------------------------------------------------------------------------
// 決定論的な乱数ストリーム
// ---------------------------------------------------------------------------

/**
 * HMAC-SHA256 をカウンタモードで回してバイト列を生成し、そこから一様な整数を切り出す乱数源。
 *
 * 剰余バイアスは棄却サンプリングで除去する（cards.ts の CSPRNG と同じ方針）。
 * ここで手を抜いて `% n` にすると、低いインデックスがわずかに出やすくなり、
 * 「検証可能だが公正ではない」という最悪の状態になる。
 */
export function createFairRng(input: FairnessInput): Rng {
  const key = hexToBytes(input.serverSeed);
  const base = `${input.clientSeed}:${input.nonce}`;
  let counter = 0;
  let block: Uint8Array = new Uint8Array(0);
  let offset = 0;

  const next32 = (): number => {
    if (offset + 4 > block.length) {
      block = hmacSha256(key, utf8ToBytes(`${base}:${counter}`));
      counter++;
      offset = 0;
    }
    const v =
      ((block[offset] << 24) >>> 0) + (block[offset + 1] << 16) + (block[offset + 2] << 8) + block[offset + 3];
    offset += 4;
    return v;
  };

  return {
    randomInt(n: number): number {
      if (n <= 0) throw new Error('n は 1 以上である必要があります');
      if (n === 1) return 0;
      const limit = Math.floor(0x100000000 / n) * n;
      for (;;) {
        const v = next32();
        if (v < limit) return v % n;
      }
    },
  };
}

/** シードからデッキの並びを決定論的に導出する */
export function deriveDeck(input: FairnessInput): Card[] {
  return shuffle(freshDeck(), createFairRng(input));
}

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

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
export function verifyHand(input: VerifyInput): VerifyResult {
  const checks: VerifyCheck[] = [];

  // 1) コミットメントの照合
  let commitmentOk = false;
  let recomputed = '';
  try {
    recomputed = commitmentOf(input.serverSeed);
    commitmentOk = timingSafeEqualHex(recomputed, input.commitment.trim().toLowerCase());
  } catch (e) {
    recomputed = `計算エラー: ${(e as Error).message}`;
  }
  checks.push({
    label: 'コミットメントの一致',
    passed: commitmentOk,
    detail: commitmentOk
      ? `SHA-256(serverSeed) = ${recomputed}`
      : `公開値 ${input.commitment} に対し、開示されたシードのハッシュは ${recomputed}`,
  });

  // 2) デッキの再現
  let derivedDeck: string[] = [];
  let deckOk = false;
  const mismatchIndexes: number[] = [];
  try {
    derivedDeck = deriveDeck({
      serverSeed: input.serverSeed,
      clientSeed: input.clientSeed,
      nonce: input.nonce,
    }).map(cardToString);

    if (input.deck.length !== derivedDeck.length) {
      for (let i = 0; i < Math.max(input.deck.length, derivedDeck.length); i++) mismatchIndexes.push(i);
    } else {
      for (let i = 0; i < derivedDeck.length; i++) {
        if (derivedDeck[i] !== input.deck[i]) mismatchIndexes.push(i);
      }
    }
    deckOk = mismatchIndexes.length === 0;
  } catch (e) {
    checks.push({ label: 'デッキの再現', passed: false, detail: `計算エラー: ${(e as Error).message}` });
  }

  if (derivedDeck.length > 0) {
    checks.push({
      label: 'デッキの一致',
      passed: deckOk,
      detail: deckOk
        ? `52 枚すべてが一致しました`
        : `${mismatchIndexes.length} 枚が不一致（最初の相違は ${mismatchIndexes[0]} 枚目：実際 ${input.deck[mismatchIndexes[0]] ?? '—'} / 再現 ${derivedDeck[mismatchIndexes[0]] ?? '—'}）`,
    });
  }

  // 3) デッキ自体の健全性（52 枚・重複なし）
  const unique = new Set(derivedDeck);
  const deckSane = derivedDeck.length === 52 && unique.size === 52;
  checks.push({
    label: 'デッキの健全性',
    passed: deckSane,
    detail: deckSane ? '52 枚・重複なし' : `${derivedDeck.length} 枚 / ユニーク ${unique.size} 種`,
  });

  return {
    passed: checks.every((c) => c.passed),
    checks,
    derivedDeck,
    mismatchIndexes,
  };
}

// ---------------------------------------------------------------------------
// セッション管理
// ---------------------------------------------------------------------------

/**
 * 1 テーブル分のシード管理。
 *
 * ハンドごとに serverSeed を作り直し、nonce を進める。
 * サーバー実装では、beginHand() の戻り値（コミットメント）を配牌前に必ずクライアントへ送り、
 * ハンド終了時に reveal() の結果を送る、という順序を守ること。
 */
export class FairnessSession {
  private serverSeed: string;
  private revealed = false;
  private locked = false;
  private rawSeeds: Array<string | null>;
  private frozenParts: string[] | null = null;
  readonly commitment: string;
  readonly nonce: number;

  constructor(opts: {
    /** 席ごとのクライアントシード。null / 未指定の席は締切時に自動生成される */
    clientSeeds?: Array<string | null | undefined>;
    nonce?: number;
    /** テスト用に serverSeed を固定したい場合 */
    serverSeed?: string;
    seatCount?: number;
  } = {}) {
    const seatCount = opts.seatCount ?? opts.clientSeeds?.length ?? 1;
    const raw = (opts.clientSeeds ?? new Array(seatCount).fill(null)).slice(0, seatCount);
    while (raw.length < seatCount) raw.push(null);

    this.rawSeeds = raw.map((s) => s ?? null);
    this.nonce = opts.nonce ?? 0;
    // serverSeed はクライアントシードに一切依存しない。
    // だからコミットメントを先に公開し、そのあとでシードを募ることができる。
    this.serverSeed = opts.serverSeed ?? randomSeedHex(32);
    this.commitment = commitmentOf(this.serverSeed);
  }

  /**
   * 席のクライアントシードを提出する。
   * 締切（lock）後は受け付けない。配牌後に差し替えられたら仕組みが崩れるため。
   */
  submitClientSeed(seat: number, seed: string): boolean {
    if (this.locked) return false;
    if (seat < 0 || seat >= this.rawSeeds.length) return false;
    if (!seed || seed.length === 0 || seed.length > 64) return false;
    this.rawSeeds[seat] = seed;
    return true;
  }

  /** シードの受付を締め切って確定させる。未提出の席はここで自動生成される */
  lock(): void {
    if (this.locked) return;
    this.frozenParts = fillMissingClientSeeds(this.rawSeeds);
    this.locked = true;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get clientSeedParts(): string[] {
    return this.frozenParts ? this.frozenParts.slice() : this.rawSeeds.map((s) => s ?? '(未提出)');
  }

  get clientSeed(): string {
    if (!this.frozenParts) {
      // 締切前は暫定値。実際の配牌にはこの値は使われない
      return combineClientSeeds(this.rawSeeds.map((s) => s ?? ''));
    }
    return combineClientSeeds(this.frozenParts);
  }

  /** 配牌前にクライアントへ送る情報。serverSeed は含まれない */
  getCommitment(): FairnessCommitment {
    return {
      commitment: this.commitment,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
      clientSeedParts: this.clientSeedParts,
    };
  }

  /** デッキを導出する。サーバー内部でのみ呼ぶ。呼んだ時点でシードは締め切られる */
  deriveDeck(): Card[] {
    this.lock();
    return deriveDeck({ serverSeed: this.serverSeed, clientSeed: this.clientSeed, nonce: this.nonce });
  }

  /** ハンド終了後にシードを開示する */
  reveal(): FairnessReveal {
    this.revealed = true;
    return {
      ...this.getCommitment(),
      serverSeed: this.serverSeed,
      deck: this.deriveDeck().map(cardToString),
    };
  }

  get isRevealed(): boolean {
    return this.revealed;
  }
}

// 検証ツールをそのまま配布できるよう、必要なものをまとめて再エクスポートする
export { sha256, sha256Hex, hmacSha256, bytesToHex, hexToBytes };
