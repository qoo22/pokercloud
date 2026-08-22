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
} | {
    t: 'slot.state';
} | {
    t: 'slot.spin';
    bet: number;
    ante?: boolean;
    mode?: 'many' | 'few';
    currency?: 'gold' | 'chips';
} | {
    t: 'transfer.issue';
} | {
    t: 'transfer.redeem';
    code: string;
    pin: string;
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
    /** 現在の手番の基本持ち時間(ms)。全卓一律60秒(ACTION_MS) */
    baseActionMs?: number;
    /**
     * 現在の手番に実際に与えられた総時間(ms)。残り時間バーの分母はこれを使う。
     * 通常は baseActionMs と同じだが、切断中の席(3秒)やタイムバンク付与時は変わる。
     */
    actionTotalMs?: number;
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
    /** 現在の VIP ティアによる購入増量率(0.03 なら +3%)。購入確認画面での明示に使う */
    vipPurchaseBonus: number;
    /** 直近の購入履歴(新しい順)。「ちゃんと買えた」ことを見せるため */
    recentPurchases: Array<{
        sku: string;
        name: string;
        priceJpy: number;
        at: number;
    }>;
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
    /** ウィークリーミッション(週ごとにリセット) */
    weekly: ProfileView['missions'];
    /** シーズンミッション(28日通しの長期目標) */
    seasonal: ProfileView['missions'];
    pass: {
        seasonId: string;
        xp: number;
        tier: number;
        premium: boolean;
        nextTierXp: number | null;
        claimable: boolean;
        /** 段階数と完走に必要な経験値 */
        tierCount: number;
        completeXp: number;
        /** シーズンの残り日数と終了時刻 */
        daysLeft: number;
        endsAt: number;
        /** 最終週(獲得経験値が増える) */
        finalWeek: boolean;
        /** 完走後の周回報酬 */
        boxesEarned: number;
        boxesClaimed: number;
        boxChips: number;
        /** 今プレミアムを買うと即時受け取れる内容(未購入のときだけ意味がある) */
        preview: {
            chips: number;
            gold: number;
            tiers: number;
        };
    };
    piggyBank: number;
    /** 引き継ぎコードを発行済みか。未発行なら警告を出して発行を促す */
    hasTransferCode: boolean;
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
} | {
    t: 'slot.info';
    slot: SlotView;
} | {
    t: 'slot.result';
    result: SlotResultView;
}
/** 発行結果。生の PIN が返るのはこの一度きり(サーバーは保存しない) */
 | {
    t: 'transfer.issued';
    code: string;
    pin: string;
}
/** 引き継ぎ成立。クライアントは resumeToken を保存し直して再読み込みする */
 | {
    t: 'transfer.done';
    resumeToken: string;
    name: string;
    balance: number;
    gold: number;
};
/** スロット画面の表示情報 */
export interface SlotView {
    gold: number;
    bets: number[];
    /** 配当表。pay[0]=3個 pay[1]=4個 pay[2]=5個(×賭け金)。0 は「その個数では配当なし」 */
    symbols: Array<{
        key: string;
        name: string;
        pay: [number, number, number];
    }>;
    /** 現在の払い出し倍率(VIPランク×連続ログイン) */
    multiplier: number;
    vipTierName: string;
    vipPart: number;
    streak: number;
    streakPart: number;
    chipsPerGold: number;
    spinsLeft: number;
    dailySpins: number;
    /** --- チップ建て(第59弾)。倍率は掛からない代わりに残高に応じた大きな額で回せる --- */
    chips: number;
    chipBets: number[];
    chipMinBet: number;
    chipSpinsLeft: number;
    chipDailySpins: number;
    /** 盤面の形(5リール×3段=243ways) */
    reels: number;
    rows: number;
    ways: number;
    /** 通常時のタンブル倍率のはしご */
    tumbleLadder: number[];
    /** スキャッター3/4/5個の配当 */
    scatterPay: Record<number, number>;
    /** フリーゲームのモード(突入時に選ばせる) */
    freeModes: Array<{
        key: string;
        name: string;
        desc: string;
        spins: number;
        startMult: number;
        step: number;
    }>;
    /** アンティベットの賭け金倍率 */
    anteCost: number;
    /** 最大配当(×賭け金) */
    maxWinX: number;
}
/** スロット 1 回分の結果。outcome を順に再生すると演出になる */
export interface SlotResultView {
    /** 盤面・連鎖・フリーゲームの全記録(slot.ts の SlotOutcome をそのまま) */
    outcome: unknown;
    bet: number;
    /** 賭けた通貨 */
    currency: 'gold' | 'chips';
    /** 実際に支払った額(アンティなら bet の1.5倍) */
    cost: number;
    won: number;
    multiplier: number;
    kind: 'none' | 'small' | 'big' | 'mega' | 'max';
    goldLeft: number;
    spinsLeft: number;
}
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
