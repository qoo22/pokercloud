/**
 * クライアント ↔ サーバー のプロトコル定義
 *
 * 設計方針：
 *   1. サーバーは常に権威。クライアントは「意図」を送るだけで、結果は必ずサーバーが決める。
 *      クライアントが送るのは「フォールドしたい」であって「私はフォールドした」ではない。
 *   2. 状態はスナップショット送信を基本にする。差分同期は速いが、1 個のイベントを取りこぼすと
 *      永久にズレたままになり、しかもそれに気づけない。ポーカーの通信量なら全量送って問題ない。
 *   3. 送るのは「その席から見える状態」だけ。他人のホールカードはサーバーから出さない。
 *   4. すべてのメッセージに v（プロトコル版）を持たせる。クライアント更新は必ず遅れるので、
 *      版が違うことを検出できないと原因不明の不具合になる。
 */
import type { ActionType, LegalAction, Street } from '../table.js';
import type { HandEvent } from '../table.js';
export declare const PROTOCOL_VERSION = 1;
export type ClientMessage = 
/** 接続直後の認証。resumeToken があれば以前のセッションを引き継ぐ */
{
    t: 'hello';
    v: number;
    userId?: string;
    name?: string;
    resumeToken?: string;
}
/** ロビーのテーブル一覧を要求 */
 | {
    t: 'lobby.list';
} | {
    t: 'table.create';
    bigBlind: number;
    maxSeats: number;
    name?: string;
} | {
    t: 'code.redeem';
    code: string;
} | {
    t: 'ledger.get';
}
/** テーブルに入室（観戦者として）*/
 | {
    t: 'table.watch';
    tableId: string;
}
/** 退室 */
 | {
    t: 'table.leave';
    tableId: string;
}
/** 着席。seat 省略なら空席へ自動割当 */
 | {
    t: 'table.sit';
    tableId: string;
    seat?: number;
    buyIn: number;
}
/** 離席（チップを持って卓を降りる） */
 | {
    t: 'table.stand';
    tableId: string;
}
/** 次のハンドを待機（Sit Out の解除／設定） */
 | {
    t: 'table.sitOut';
    tableId: string;
    sitOut: boolean;
}
/** チップの追加購入（トップオフ） */
 | {
    t: 'table.rebuy';
    tableId: string;
    amount: number;
}
/** アクション。handId を必ず添えて、古いハンドへの遅延アクションを弾く */
 | {
    t: 'hand.act';
    tableId: string;
    handId: string;
    action: ActionType;
    toAmount?: number;
}
/** クライアントシードの提出。コミットメント公開後・配牌前の窓でのみ受け付ける */
 | {
    t: 'fair.seed';
    tableId: string;
    seed: string;
}
/** 死活確認 */
 | {
    t: 'ping';
    ts: number;
} | {
    t: 'tour.list';
} | {
    t: 'tour.watch';
    tournamentId: string;
} | {
    t: 'tour.register';
    tournamentId: string;
} | {
    t: 'tour.unregister';
    tournamentId: string;
} | {
    t: 'tour.addon';
    tournamentId: string;
}
/** ストラドルの予約（次に UTG になったハンドで自動的に置く） */
 | {
    t: 'table.straddle';
    tableId: string;
    enabled: boolean;
} | {
    t: 'shop.list';
} | {
    t: 'shop.purchase';
    sku: string;
    receipt: string;
} | {
    t: 'daily.claim';
} | {
    t: 'mission.claim';
    missionId: string;
} | {
    t: 'pass.claim';
} | {
    t: 'profile.get';
}
/** ニックネーム変更・ブレスレット装着（コスメ） */
 | {
    t: 'user.style';
    name?: string;
    bracelet?: string | null;
};
export interface LobbyTableInfo {
    tableId: string;
    name: string;
    smallBlind: number;
    bigBlind: number;
    maxSeats: number;
    seatedCount: number;
    watchingCount: number;
    minBuyIn: number;
    maxBuyIn: number;
    avgPot: number;
    handsPerHour: number;
}
export interface PublicSeatView {
    seat: number;
    userId: string | null;
    name: string | null;
    stack: number;
    streetBet: number;
    totalBet: number;
    folded: boolean;
    allIn: boolean;
    sittingOut: boolean;
    lastAction: ActionType | null;
    /** 自分の席、またはショーダウンで公開された席のみ入る */
    holeCards: string[] | null;
    /** 手番のとき、残り思考時間（ms） */
    timeLeftMs: number | null;
    timeBankMs: number;
    /** 装着中のブレスレット（コスメ） */
    bracelet: string | null;
}
export interface TableStateView {
    tableId: string;
    name: string;
    handId: string | null;
    handNumber: number;
    street: Street | 'waiting';
    board: string[];
    pot: number;
    pots: Array<{
        amount: number;
        eligible: number[];
    }>;
    currentBet: number;
    buttonIndex: number;
    actingSeat: number | null;
    smallBlind: number;
    bigBlind: number;
    maxSeats: number;
    seats: PublicSeatView[];
    /** この接続が座っている席。観戦中は null */
    yourSeat: number | null;
    /** ストラドルが許可されている卓か */
    straddleAllowed: boolean;
    /** 自分がストラドルを予約しているか */
    straddleArmed: boolean;
    /** 自分の手番のときだけ入る */
    legalActions: LegalAction[];
    /** 配牌前に公開されるコミットメント */
    fairness: {
        commitment: string | null;
        clientSeed: string | null;
        nonce: number | null;
        /** ハンド終了後にのみ入る */
        serverSeed: string | null;
        /** シード提出を受け付けている間だけ true */
        acceptingSeeds: boolean;
    };
    /** オールインの段階公開中だけ入る、各席の勝率・アウツ・首位（勝負がついていない席のみ） */
    revealStats?: RevealStat[];
    /** 見ている本人の現在の最強役（「ストレート」等）。ハンド中だけ入る */
    yourHand?: string | null;
    /** 自分の現在の勝率(0..1)。未知の相手へのモンテカルロ推定。ハンド中のみ */
    yourEquity?: number | null;
    /** 現在の手番の基本持ち時間(ms)。これを超えるとタイムバンク消費 */
    baseActionMs?: number;
}
/** オールイン公開中に見せる、席ごとの勝率とアウツ */
export interface RevealStat {
    seat: number;
    /** 分け合いを考慮した取り分（0〜1） */
    equity: number;
    /** 次の 1 枚で単独首位になる札の枚数（首位の席は 0） */
    outs: number;
    /** いま首位か */
    leading: boolean;
}
export interface HandSummary {
    handId: string;
    handNumber: number;
    board: string[];
    pots: Array<{
        amount: number;
        rake: number;
        winners: number[];
    }>;
    netChange: Record<number, number>;
    showdown: boolean;
    hands: Array<{
        seat: number;
        cards: string[];
        description: string;
        /** 役を構成した 5 枚。勝ち札をハイライトするために使う */
        best: string[];
    }>;
    fairness: {
        commitment: string;
        serverSeed: string;
        clientSeed: string;
        nonce: number;
        deck: string[];
    };
}
export interface TournamentSummaryView {
    /** 開始予定時刻(エポックms)。SNGなど非スケジュール制は null */
    startsAt?: number | null;
    /** レイトレジ受付中か */
    lateRegOpen?: boolean;
    /** リエントリー上限(0=フリーズアウト) */
    reEntryMax?: number;
    /** アドオンありか */
    hasAddOn?: boolean;
    /** 開催に必要な最低人数(MTT)。SNGは定員=開始人数 */
    minPlayers?: number;
    tournamentId: string;
    name: string;
    type: 'sng' | 'mtt';
    /** バウンティ方式（表示用） */
    bountyMode: 'none' | 'classic' | 'progressive' | 'mystery';
    speed: 'normal' | 'turbo' | 'hyper';
    state: 'registering' | 'running' | 'finished' | 'cancelled';
    buyIn: number;
    fee: number;
    entrants: number;
    maxPlayers: number;
    remaining: number;
    prizePool: number;
    startsWhen: string;
}
export interface BountyView {
    mode: 'none' | 'classic' | 'progressive' | 'mystery';
    /** 1 エントリーあたりの賞金首 */
    perEntry: number;
    pool: number;
    /** 自分の現在の賞金首（mystery では常に 0） */
    yourBounty: number;
    /** 自分がこれまでに獲得した賞金首の合計 */
    yourEarned: number;
    yourKnockouts: number;
    /** mystery: 封筒が有効になっているか */
    active: boolean;
    /** mystery: 残っている封筒の金額（降順） */
    remainingEnvelopes: number[];
    /** mystery: 封筒の並びのコミットメント */
    commitment: string | null;
    /** mystery: 終了後に開示されるシード */
    serverSeed: string | null;
    /** 直近の撃墜（演出用） */
    recent: Array<{
        winner: string;
        victim: string;
        cash: number;
        label: string | null;
    }>;
}
export interface TournamentView extends TournamentSummaryView {
    bounty: BountyView;
    /** リエントリー可能な残り回数（0 なら不可） */
    reEntriesLeft: number;
    /** アドオンが買えるか */
    addOnAvailable: boolean;
    addOnPrice: number;
    addOnChips: number;
    lateRegOpen: boolean;
    level: number;
    smallBlind: number;
    bigBlind: number;
    ante: number;
    isBreak: boolean;
    nextLevelInMs: number | null;
    averageStack: number;
    paidPlaces: number;
    payouts: Array<{
        place: number;
        amount: number;
    }>;
    yourTableId: string | null;
    yourStack: number | null;
    yourRank: number | null;
    yourFinishPosition: number | null;
    yourPrize: number | null;
    registered: boolean;
    leaderboard: Array<{
        rank: number;
        name: string;
        stack: number;
    }>;
}
export interface ShopView {
    chipPacks: Array<{
        sku: string;
        name: string;
        priceJpy: number;
        chips: number;
        perYen: number;
    }>;
    goldPacks: Array<{
        sku: string;
        name: string;
        priceJpy: number;
        gold: number;
    }>;
    offers: Array<{
        id: string;
        sku: string;
        name: string;
        description: string;
        priceJpy: number;
        reason: string;
        multiplier: number | null;
        expiresAt: number | null;
    }>;
    passPremium: {
        sku: string;
        name: string;
        priceJpy: number;
        owned: boolean;
    };
}
export interface ProfileView {
    userId: string;
    name: string;
    chips: number;
    gold: number;
    vip: {
        points: number;
        tier: string;
        tierName: string;
        perks: string[];
        purchaseBonus: number;
        dailyMultiplier: number;
        nextTierName: string | null;
        pointsToNext: number | null;
    };
    daily: {
        available: boolean;
        streak: number;
    };
    missions: Array<{
        id: string;
        name: string;
        target: number;
        progress: number;
        rewardChips: number;
        rewardXp: number;
        claimed: boolean;
    }>;
    pass: {
        seasonId: string;
        xp: number;
        tier: number;
        premium: boolean;
        nextTierXp: number | null;
        claimable: boolean;
    };
    piggyBank: number;
}
export type ServerMessage = {
    t: 'hello.ok';
    v: number;
    userId: string;
    name: string;
    resumeToken: string;
    balance: number;
    gold: number;
    resumed: boolean;
} | {
    t: 'lobby.tables';
    tables: LobbyTableInfo[];
} | {
    t: 'table.created';
    code: string;
    table: LobbyTableInfo;
} | {
    t: 'code.table';
    table: LobbyTableInfo;
} | {
    t: 'ledger.history';
    entries: {
        at: number;
        currency: string;
        delta: number;
        reason: string;
        ref: string | null;
        balanceAfter: number;
    }[];
} | {
    t: 'table.state';
    state: TableStateView;
}
/** 演出用の増分イベント。状態の正は table.state のほうで、こちらはアニメーション指示 */
 | {
    t: 'table.events';
    tableId: string;
    handId: string;
    events: HandEvent[];
} | {
    t: 'hand.result';
    tableId: string;
    summary: HandSummary;
} | {
    t: 'balance';
    balance: number;
    gold?: number;
} | {
    t: 'error';
    code: ErrorCode;
    message: string;
    ref?: string;
} | {
    t: 'pong';
    ts: number;
} | {
    t: 'tour.tournaments';
    tournaments: TournamentSummaryView[];
} | {
    t: 'tournament.state';
    view: TournamentView;
} | {
    t: 'shop.state';
    shop: ShopView;
} | {
    t: 'profile';
    profile: ProfileView;
} | {
    t: 'reward';
    title: string;
    chips: number;
    gold: number;
    detail?: string;
};
export type ErrorCode = 'BAD_MESSAGE' | 'VERSION_MISMATCH' | 'NOT_AUTHENTICATED' | 'RATE_LIMITED' | 'NO_SUCH_TABLE' | 'SEAT_TAKEN' | 'ALREADY_SEATED' | 'NOT_SEATED' | 'INVALID_BUYIN' | 'INSUFFICIENT_FUNDS' | 'NOT_YOUR_TURN' | 'ILLEGAL_ACTION' | 'STALE_HAND' | 'SEED_WINDOW_CLOSED' | 'INTERNAL';
/**
 * 受信メッセージを検証する。
 *
 * クライアントから来る値は一切信用しない。型が合っていても範囲が異常なら弾く。
 * 特に数値は NaN / Infinity / 非整数 / 負値をすべて潰しておかないと、
 * 「バイイン -1000000」のような入力でチップが増える。
 */
export declare function parseClientMessage(raw: unknown): {
    ok: true;
    msg: ClientMessage;
} | {
    ok: false;
    reason: string;
};
