/**
 * ロビー：テーブル・トーナメント・経済のとりまとめと、メッセージのルーティング
 *
 * トランスポート（WebSocket）から切り離してあるので、テストでは偽の送信先を差して
 * ソケットを一切張らずにプロトコル全体を検証できる。
 * 実際のバグの大半はソケットではなくこの層に出るので、ここを高速にテストできることが重要。
 */
import { MemoryStore } from './store.js';
import { Economy, CHIP_PACKS, GOLD_PACKS, PASS_PREMIUM_SKU, PASS_TIERS, SAFE_POST } from './economy.js';
import { Room, realScheduler } from './room.js';
import { Tournament } from './tournament.js';
import { PROTOCOL_VERSION, parseClientMessage, } from './protocol.js';
import { randomSeedHex } from '../fair.js';
import { hmacSha256 } from '../sha256.js';
const DEFAULTS = {
    signupBonus: 50000,
    signupGold: 100,
    maxMessagesPerSecond: 20,
    authSecret: '',
};
/** 招待コード：入力するとチップがもらえる（1ユーザー1回まで） */
const INVITE_CODES = {
    // --- 入門(マイクロ〜ハイ卓向け) ---
    STARTER10M: 10_000_000, // 1000万
    BRONZE100M: 100_000_000, // 1億
    SILVER500M: 500_000_000, // 5億
    // --- 中堅(ハイローラー〜レジェンド卓向け) ---
    LUCKY1B: 1_000_000_000, // 10億
    GOLD5B: 5_000_000_000, // 50億
    RICH10B: 10_000_000_000, // 100億
    PLATINUM50B: 50_000_000_000, // 500億
    VIP100B: 100_000_000_000, // 1000億
    DIAMOND500B: 500_000_000_000, // 5000億
    // --- 大物(ミリオネア〜神々の卓・高額トーナメント向け) ---
    WHALE1T: 1_000_000_000_000, // 1兆
    SHARK5T: 5_000_000_000_000, // 5兆
    GOD10T: 10_000_000_000_000, // 10兆
    TITAN50T: 50_000_000_000_000, // 50兆
    DRAGON100T: 100_000_000_000_000, // 100兆
    // --- 最終兵器 ---
    PHOENIX500T: 500_000_000_000_000, // 500兆
    INFINITY1000T: 1_000_000_000_000_000, // 1000兆
    // --- 神域(第81弾で追加) ---
    // 注意: store.post 1回の記帳は Number.isSafeInteger(2^53≈9007兆)まで。第147弾からは
    // 付与を SAFE_POST で分割記帳するので、コード額自体は 9000兆を超えてよい(京コインも可)
    // (2^53 ≒ 9007兆)。これを超える額のコードを足すと適用時にエラーになる。
    // 残高の合計が壁を超えるのは実測で問題なし(残高と監査が同じ計算経路のため)。
    ZEUS2000T: 2_000_000_000_000_000, // 2000兆
    COSMOS4000T: 4_000_000_000_000_000, // 4000兆
    OMEGA9000T: 9_000_000_000_000_000, // 9000兆
    // --- 第137弾で大幅増量(どれも1ユーザー1回まで) ---
    // 小口
    NIGHT1M: 1_000_000, // 100万
    CHERRY5M: 5_000_000, // 500万
    ACE20M: 20_000_000, // 2000万
    ROYAL50M: 50_000_000, // 5000万
    JACKPOT200M: 200_000_000, // 2億
    NEON300M: 300_000_000, // 3億
    // 遊び札(数字にちなむ)
    KOI123: 123_000_000, // 1.23億
    SLOT555: 555_000_000, // 5.55億
    SAKURA777: 777_000_000, // 7.77億
    BACCARA888: 888_000_000, // 8.88億
    FUJI3776: 3_776_000_000, // 37.76億
    // 中堅
    STORM2B: 2_000_000_000, // 20億
    TIGER3B: 3_000_000_000, // 30億
    PEARL20B: 20_000_000_000, // 200億
    EMERALD30B: 30_000_000_000, // 300億
    RUBY200B: 200_000_000_000, // 2000億
    SAPPHIRE300B: 300_000_000_000, // 3000億
    ONYX800B: 800_000_000_000, // 8000億
    // 大物
    KRAKEN2T: 2_000_000_000_000, // 2兆
    GRIFFIN3T: 3_000_000_000_000, // 3兆
    HYDRA20T: 20_000_000_000_000, // 20兆
    PEGASUS30T: 30_000_000_000_000, // 30兆
    VALKYRIE200T: 200_000_000_000_000, // 200兆
    MIDAS300T: 300_000_000_000_000, // 300兆
    EXCALIBUR800T: 800_000_000_000_000, // 800兆
    // 神域
    ATLAS1500T: 1_500_000_000_000_000, // 1500兆
    CHRONOS3000T: 3_000_000_000_000_000, // 3000兆
    GAIA5000T: 5_000_000_000_000_000, // 5000兆
    HELIOS6000T: 6_000_000_000_000_000, // 6000兆
    POSEIDON7000T: 7_000_000_000_000_000, // 7000兆
    HADES8000T: 8_000_000_000_000_000, // 8000兆
    RA8500T: 8_500_000_000_000_000, // 8500兆
    // --- 第138弾: 高額帯をさらに増量(すべて9000兆の上限内) ---
    // 北欧
    ODIN600T: 600_000_000_000_000, // 600兆
    THOR700T: 700_000_000_000_000, // 700兆
    LOKI900T: 900_000_000_000_000, // 900兆
    FENRIR1100T: 1_100_000_000_000_000, // 1100兆
    SLEIPNIR1200T: 1_200_000_000_000_000, // 1200兆
    // 日本神話・七福神
    AMATERASU1300T: 1_300_000_000_000_000, // 1300兆
    TSUKUYOMI1400T: 1_400_000_000_000_000, // 1400兆
    SUSANOO1600T: 1_600_000_000_000_000, // 1600兆
    IZANAGI1700T: 1_700_000_000_000_000, // 1700兆
    YAMATO1800T: 1_800_000_000_000_000, // 1800兆
    KAGUYA1900T: 1_900_000_000_000_000, // 1900兆
    RAIJIN2200T: 2_200_000_000_000_000, // 2200兆
    FUJIN2400T: 2_400_000_000_000_000, // 2400兆
    BENTEN2500T: 2_500_000_000_000_000, // 2500兆
    EBISU2600T: 2_600_000_000_000_000, // 2600兆
    DAIKOKU2800T: 2_800_000_000_000_000, // 2800兆
    HACHIMAN3200T: 3_200_000_000_000_000, // 3200兆
    // インド
    SHIVA3500T: 3_500_000_000_000_000, // 3500兆
    VISHNU3800T: 3_800_000_000_000_000, // 3800兆
    BRAHMA4200T: 4_200_000_000_000_000, // 4200兆
    // エジプト
    ANUBIS4500T: 4_500_000_000_000_000, // 4500兆
    OSIRIS4800T: 4_800_000_000_000_000, // 4800兆
    HORUS5200T: 5_200_000_000_000_000, // 5200兆
    ISIS5500T: 5_500_000_000_000_000, // 5500兆
    THOTH5800T: 5_800_000_000_000_000, // 5800兆
    // ギリシャ
    ODYSSEY6200T: 6_200_000_000_000_000, // 6200兆
    APOLLO6500T: 6_500_000_000_000_000, // 6500兆
    ARTEMIS6800T: 6_800_000_000_000_000, // 6800兆
    ATHENA7200T: 7_200_000_000_000_000, // 7200兆
    ARES7500T: 7_500_000_000_000_000, // 7500兆
    HERMES7800T: 7_800_000_000_000_000, // 7800兆
    HERA8200T: 8_200_000_000_000_000, // 8200兆
    NYX8800T: 8_800_000_000_000_000, // 8800兆
    ETERNAL9000T: 9_000_000_000_000_000, // 9000兆
    // --- 第147弾: 京帯(分割記帳で付与) ---
    ZIPANGU1KYO: 10_000_000_000_000_000, // 1京
    ATLANTIS2KYO: 20_000_000_000_000_000, // 2京
    ELDORADO3KYO: 30_000_000_000_000_000, // 3京
    AVALON4KYO: 40_000_000_000_000_000, // 4京
    OLYMPUS5KYO: 50_000_000_000_000_000, // 5京
    VALHALLA6KYO: 60_000_000_000_000_000, // 6京
    SHANGRILA7KYO: 70_000_000_000_000_000, // 7京
    YGGDRASIL8KYO: 80_000_000_000_000_000, // 8京
    RAGNAROK9KYO: 90_000_000_000_000_000, // 9京
    GODEMPEROR10KYO: 100_000_000_000_000_000, // 10京
    // --- 第148弾: さらに増量 ---
    // 動物(数十兆帯の隙間)
    FALCON40T: 40_000_000_000_000, // 40兆
    COBRA60T: 60_000_000_000_000, // 60兆
    PANTHER70T: 70_000_000_000_000, // 70兆
    RHINO80T: 80_000_000_000_000, // 80兆
    BISON90T: 90_000_000_000_000, // 90兆
    LYNX110T: 110_000_000_000_000, // 110兆
    ORCA150T: 150_000_000_000_000, // 150兆
    // 和(数百兆帯の隙間)
    SAMURAI250T: 250_000_000_000_000, // 250兆
    NINJA350T: 350_000_000_000_000, // 350兆
    SHOGUN400T: 400_000_000_000_000, // 400兆
    RONIN450T: 450_000_000_000_000, // 450兆
    KABUKI550T: 550_000_000_000_000, // 550兆
    KATANA650T: 650_000_000_000_000, // 650兆
    SUMO750T: 750_000_000_000_000, // 750兆
    BUSHIDO850T: 850_000_000_000_000, // 850兆
    TAIKO950T: 950_000_000_000_000, // 950兆
    // 妖(億帯)
    TANUKI7B: 7_000_000_000, // 70億
    KAPPA8B: 8_000_000_000, // 80億
    ONI9B: 9_000_000_000, // 90億
    YUREI66B: 66_000_000_000, // 660億
    // 楽園(京帯・第147弾の分割記帳で付与)
    TAKARABUNE1KYO: 10_000_000_000_000_000, // 1京
    RYUGU2KYO: 20_000_000_000_000_000, // 2京
    HORAI3KYO: 30_000_000_000_000_000, // 3京
    TENKAI4KYO: 40_000_000_000_000_000, // 4京
    GOKURAKU5KYO: 50_000_000_000_000_000, // 5京
    MAKAI6KYO: 60_000_000_000_000_000, // 6京
    TAKAMAGAHARA7KYO: 70_000_000_000_000_000, // 7京
    UTOPIA8KYO: 80_000_000_000_000_000, // 8京
    PARADISO9KYO: 90_000_000_000_000_000, // 9京
    INFERNO10KYO: 100_000_000_000_000_000, // 10京
    // --- 第139弾: 5000兆以上の高額帯を大量増量(すべて9000兆の上限内) ---
    // 幻獣(5000兆帯)
    LEVIATHAN5050T: 5_050_000_000_000_000, // 5050兆
    BAHAMUT5150T: 5_150_000_000_000_000, // 5150兆
    TIAMAT5250T: 5_250_000_000_000_000, // 5250兆
    FAFNIR5300T: 5_300_000_000_000_000, // 5300兆
    QUETZAL5350T: 5_350_000_000_000_000, // 5350兆
    GARUDA5400T: 5_400_000_000_000_000, // 5400兆
    CERBERUS5450T: 5_450_000_000_000_000, // 5450兆
    CHIMERA5550T: 5_550_000_000_000_000, // 5550兆
    BASILISK5600T: 5_600_000_000_000_000, // 5600兆
    WYVERN5650T: 5_650_000_000_000_000, // 5650兆
    MANTICORE5700T: 5_700_000_000_000_000, // 5700兆
    BEHEMOTH5750T: 5_750_000_000_000_000, // 5750兆
    JORMUNGAND5850T: 5_850_000_000_000_000, // 5850兆
    NIDHOGG5900T: 5_900_000_000_000_000, // 5900兆
    OROCHI5950T: 5_950_000_000_000_000, // 5950兆
    // 和の聖獣(6000兆帯)
    SEIRYU6000T: 6_000_000_000_000_000, // 6000兆
    SUZAKU6050T: 6_050_000_000_000_000, // 6050兆
    BYAKKO6100T: 6_100_000_000_000_000, // 6100兆
    GENBU6150T: 6_150_000_000_000_000, // 6150兆
    KIRIN6250T: 6_250_000_000_000_000, // 6250兆
    TENGU6300T: 6_300_000_000_000_000, // 6300兆
    KITSUNE6400T: 6_400_000_000_000_000, // 6400兆
    RAIJU6450T: 6_450_000_000_000_000, // 6450兆
    HOUOU6550T: 6_550_000_000_000_000, // 6550兆
    RYUJIN6600T: 6_600_000_000_000_000, // 6600兆
    KAMUI6650T: 6_650_000_000_000_000, // 6650兆
    ASHURA6700T: 6_700_000_000_000_000, // 6700兆
    TAIYO6850T: 6_850_000_000_000_000, // 6850兆
    GEKKO6900T: 6_900_000_000_000_000, // 6900兆
    GINGA6950T: 6_950_000_000_000_000, // 6950兆
    // 星(7000兆帯)
    NEBULA7050T: 7_050_000_000_000_000, // 7050兆
    QUASAR7100T: 7_100_000_000_000_000, // 7100兆
    PULSAR7150T: 7_150_000_000_000_000, // 7150兆
    SUPERNOVA7250T: 7_250_000_000_000_000, // 7250兆
    GALAXY7300T: 7_300_000_000_000_000, // 7300兆
    ANDROMEDA7350T: 7_350_000_000_000_000, // 7350兆
    ORION7400T: 7_400_000_000_000_000, // 7400兆
    SIRIUS7450T: 7_450_000_000_000_000, // 7450兆
    VEGA7550T: 7_550_000_000_000_000, // 7550兆
    POLARIS7600T: 7_600_000_000_000_000, // 7600兆
    CANOPUS7650T: 7_650_000_000_000_000, // 7650兆
    RIGEL7700T: 7_700_000_000_000_000, // 7700兆
    ALTAIR7750T: 7_750_000_000_000_000, // 7750兆
    DENEB7850T: 7_850_000_000_000_000, // 7850兆
    ANTARES7900T: 7_900_000_000_000_000, // 7900兆
    SPICA7950T: 7_950_000_000_000_000, // 7950兆
    // 宇宙(8000兆帯)
    AURORA8000T: 8_000_000_000_000_000, // 8000兆
    ECLIPSE8050T: 8_050_000_000_000_000, // 8050兆
    ZENITH8100T: 8_100_000_000_000_000, // 8100兆
    NOVA8150T: 8_150_000_000_000_000, // 8150兆
    COMET8250T: 8_250_000_000_000_000, // 8250兆
    METEOR8300T: 8_300_000_000_000_000, // 8300兆
    STARDUST8400T: 8_400_000_000_000_000, // 8400兆
    MILKYWAY8450T: 8_450_000_000_000_000, // 8450兆
    BLACKHOLE8550T: 8_550_000_000_000_000, // 8550兆
    BIGBANG8600T: 8_600_000_000_000_000, // 8600兆
    GRAVITY8650T: 8_650_000_000_000_000, // 8650兆
    PHOTON8700T: 8_700_000_000_000_000, // 8700兆
    NEUTRON8750T: 8_750_000_000_000_000, // 8750兆
    PLASMA8850T: 8_850_000_000_000_000, // 8850兆
    COSMIC8900T: 8_900_000_000_000_000, // 8900兆
    ASTRAL8950T: 8_950_000_000_000_000, // 8950兆
    // 究極(9000兆=上限いっぱい)
    ULTIMATE9000T: 9_000_000_000_000_000, // 9000兆
    GENESIS9000T: 9_000_000_000_000_000, // 9000兆
    APEX9000T: 9_000_000_000_000_000, // 9000兆
    ABSOLUTE9000T: 9_000_000_000_000_000, // 9000兆
};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomTableCode() {
    let s = '';
    for (let i = 0; i < 6; i++)
        s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
}
export class Lobby {
    transport;
    clock;
    store;
    economy;
    rooms = new Map();
    /** プライベート卓（ロビー一覧に出さない） */
    privateIds = new Set();
    /** 卓コード → tableId */
    tableCodes = new Map();
    /** 招待コードの使用履歴（メモリ上。再起動でリセットされる点は HANDOFF 参照） */
    redeemedCodes = new Map();
    tournaments = new Map();
    /** 定期開催トーナメントの連番と、終了後の掃除予定時刻 */
    tourSeq = 0;
    tourPruneAt = new Map();
    sessions = new Map();
    resumeTokens = new Map();
    cfg;
    constructor(cfg, transport, clock = realScheduler) {
        this.transport = transport;
        this.clock = clock;
        // 明示的に undefined が渡ることがある（Gateway が options をそのまま流すため）ので、
        // スプレッドの後に必ず既定値へ落とす。ここを ...cfg に任せると undefined で上書きされる
        this.cfg = { ...DEFAULTS, ...cfg, tournaments: cfg.tournaments ?? [] };
        this.store = cfg.store ?? new MemoryStore();
        this.economy = new Economy(this.store, () => this.clock.now());
        const io = { send: (sid, msg) => this.transport.send(sid, msg) };
        const bank = {
            withdraw: (userId, amount, ref) => this.store.post(userId, 'chips', -amount, 'table_buyin', ref) !== null,
            deposit: (userId, amount, ref) => {
                this.store.post(userId, 'chips', amount, 'table_cashout', ref);
            },
            balanceOf: (userId) => this.store.balance(userId, 'chips'),
            // 卓の上にあるチップを台帳に記録しておく。サーバーが落ちても次の起動で払い戻せる
            noteSeat: (userId, tableId, stack) => this.store.setOpenSeat(userId, tableId, stack),
            clearSeat: (userId, tableId) => this.store.clearOpenSeat(userId, tableId),
        };
        this.bank = bank;
        this.io = io;
        for (const t of cfg.tables) {
            const room = new Room(t, io, bank, clock);
            room.hooks.onHandResult = (r, summary, seats) => this.onHandResult(r, summary, seats);
            this.rooms.set(t.tableId, room);
        }
        for (const t of this.cfg.tournaments)
            this.createTournament(t);
        this.startTourScheduler();
        this.recoverOpenSeats();
        this.startSeatSweeper();
    }
    bank;
    io;
    /**
     * 前回のプロセスが精算せずに落ちた席のチップを残高へ払い戻す(起動時に一度)。
     *
     * 座席はメモリ上のオブジェクトなので、再起動すると卓上のチップは消える。
     * バイインは永続残高から引き済みなので、放置するとプレイヤーの純損失になる
     * (「立ち上げたら残高が減っている」の原因)。open_seats に記録しておいた額をここで返す。
     * このプロセスで作った席はまだ1つも無いので、残っている行は全て前回ぶんと判断してよい。
     */
    recoverOpenSeats() {
        let rows;
        try {
            rows = this.store.listOpenSeats();
        }
        catch {
            return; // 旧DB(テーブル未作成)など。復旧できなくても起動は妨げない
        }
        if (!rows.length)
            return;
        let users = 0, total = 0;
        for (const r of rows) {
            if (r.stack > 0) {
                this.store.post(r.userId, 'chips', r.stack, 'table_recover', `${r.tableId}:recover`);
                users++;
                total += r.stack;
            }
            this.store.clearOpenSeat(r.userId, r.tableId);
        }
        if (users > 0) {
            console.log(`未精算だった卓上チップを払い戻しました: ${users}人 / ${total.toLocaleString()}チップ`);
        }
    }
    /**
     * 切断猶予を過ぎた席を定期的に精算する。
     * ハンド終了時(settle)だけに任せると、以後ハンドが始まらない卓
     * (相手が全員抜けた等)でチップが永久に戻らないため。
     */
    startSeatSweeper() {
        const tick = () => {
            for (const room of this.rooms.values()) {
                try {
                    room.sweepExpiredSeats();
                }
                catch { /* 1卓の失敗で全体を止めない */ }
            }
            this.sweepTimer = this.arm(tick);
        };
        this.sweepTimer = this.arm(tick);
    }
    sweepTimer = null;
    /**
     * 掃除タイマーを1本張る。
     * unref しておかないと、この繰り返しタイマーだけでイベントループが生き続け、
     * Lobby を dispose しないコード(テスト等)でプロセスが終われなくなる
     * (Gateway のハートビートが unref しているのと同じ理由)。
     */
    arm(fn) {
        const h = this.clock.setTimeout(fn, 15_000);
        h?.unref?.();
        return h;
    }
    /** サーバー終了時に全卓を精算する(再デプロイでチップを卓に置き去りにしない) */
    cashOutAllTables() {
        for (const room of this.rooms.values()) {
            try {
                room.cashOutAll();
            }
            catch { /* noop */ }
        }
    }
    /** 再接続トークンの署名鍵（cfg 未指定ならプロセス限り） */
    get authKey() {
        if (!this.authKeyCache) {
            this.authKeyCache = this.cfg.authSecret && this.cfg.authSecret.length >= 16 ? this.cfg.authSecret : randomSeedHex(16);
        }
        return this.authKeyCache;
    }
    authKeyCache = null;
    // --- 引き継ぎコード -------------------------------------------------------
    //
    // このアプリはログイン(メール/パスワード)を作らないゲスト方式なので、
    // ブラウザに保存した鍵(resumeToken)が消えるとアカウントに二度と戻れない。
    // 実際に、同一ドメインに置いた別アプリが localStorage を上書きして
    // 1,550兆チップのアカウントに入れなくなる事故が起きた。
    // そこで「ID + PIN を控えておけば、どの端末からでも取り戻せる」経路を用意する。
    /** 紛らわしい文字(I/O/0/1)を除いた、口頭でも伝えられる文字集合 */
    static CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    /** 12文字を 4-4-4 で区切ったコードを作る。32^12 ≒ 1.2×10^18 通り */
    newTransferCode() {
        const A = Lobby.CODE_ALPHABET;
        const bytes = randomSeedHex(12); // 24桁の16進
        let out = '';
        for (let i = 0; i < 12; i++) {
            out += A[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % A.length];
        }
        return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
    }
    /** PIN は生で保存しない。コードと混ぜて署名し、その16進を持つ */
    hashPin(code, pin) {
        const enc = new TextEncoder();
        const sig = hmacSha256(enc.encode(this.authKey), enc.encode(`transfer:${code}:${pin}`));
        return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    /**
     * 引き継ぎコードを発行する。古いコードは無効化するので、常に最新の1組だけが有効。
     * 生の PIN はこの戻り値でしか手に入らない(サーバーには残らない)。
     */
    issueTransferCode(userId) {
        this.store.deleteTransferCodesOf(userId);
        const code = this.newTransferCode();
        // PIN は4桁。総当たりは attempts の上限で止める
        const pin = String(Math.floor(Number(`0x${randomSeedHex(4)}`) % 10000)).padStart(4, '0');
        this.store.setTransferCode({
            code,
            userId,
            pinHash: this.hashPin(code, pin),
            createdAt: this.clock.now(),
            attempts: 0,
        });
        return { code, pin };
    }
    /** PIN を何回まちがえたらコードを捨てるか */
    static MAX_PIN_ATTEMPTS = 5;
    /**
     * 引き継ぎコードを使ってアカウントを取り戻す。
     * 成功したらコードは使い切りにする(漏れても使い回されないように)。
     */
    redeemTransferCode(codeRaw, pin) {
        // 入力ゆれ(小文字・スペース・ハイフン無し)を吸収する
        const norm = codeRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (norm.length !== 12)
            return { ok: false, error: 'コードの形式が違います' };
        const code = `${norm.slice(0, 4)}-${norm.slice(4, 8)}-${norm.slice(8, 12)}`;
        const row = this.store.getTransferCode(code);
        if (!row)
            return { ok: false, error: 'コードが見つかりません' };
        if (row.pinHash !== this.hashPin(code, pin.trim())) {
            const n = this.store.bumpTransferAttempts(code);
            if (n >= Lobby.MAX_PIN_ATTEMPTS) {
                this.store.deleteTransferCode(code);
                return { ok: false, error: 'PIN を間違えすぎたため、このコードは無効になりました' };
            }
            return { ok: false, error: `PIN が違います（あと ${Lobby.MAX_PIN_ATTEMPTS - n} 回）` };
        }
        if (!this.store.getUser(row.userId))
            return { ok: false, error: 'アカウントが見つかりません' };
        this.store.deleteTransferCode(code); // 使い切り
        return { ok: true, userId: row.userId };
    }
    signUserId(userId) {
        const enc = new TextEncoder();
        const sig = hmacSha256(enc.encode(this.authKey), enc.encode(userId));
        return Array.from(sig.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    makeResumeToken(userId) {
        return `${userId}.${this.signUserId(userId)}`;
    }
    /** 署名付きトークンを検証して userId を返す。改ざん・形式不正なら null */
    verifyResumeToken(token) {
        const i = token.lastIndexOf('.');
        if (i <= 0)
            return null;
        const userId = token.slice(0, i);
        const sig = token.slice(i + 1);
        if (!/^[\w.-]{1,64}$/.test(userId) || sig.length !== 32)
            return null;
        return sig === this.signUserId(userId) ? userId : null;
    }
    createTournament(cfg) {
        const t = new Tournament(cfg, this.io, this.bank, {
            collectEntry: (userId, amount, ref) => this.store.post(userId, 'chips', -amount, 'tournament_buyin', ref) !== null,
            payPrize: (userId, amount, ref) => {
                this.store.post(userId, 'chips', amount, 'tournament_prize', ref);
                this.sendBalance(userId);
            },
            notify: (userId, msg) => this.sendToUser(userId, msg),
            onEntered: (userId) => this.economy.onTournamentEntered(userId),
        }, this.clock);
        this.tournaments.set(cfg.tournamentId, t);
        return t;
    }
    // -------------------------------------------------------------------------
    // タイムテーブル型の定期開催トーナメント
    //   ・常に5本前後の「これから始まる」大会が並ぶ(名前/バイイン/形式はランダム)
    //   ・定刻になったら開始(最低人数はbotの事前登録が担保する)
    //   ・終了後しばらくして一覧から消え、新しい大会が補充される(一期一会)
    // -------------------------------------------------------------------------
    startTourScheduler() {
        const NAMES = [
            'ベガス・カジノ', 'ACESポーカークラブ', 'ポーカークラブ', 'ベガス・ラグジュアリーカジノ',
            'ミッドナイト・チャレンジ', 'ゴールデンラッシュ', 'ロイヤルフラッシュ杯', 'デイリーグランプリ',
            'サンセット・ショーダウン', 'ダイヤモンドリーグ',
        ];
        // フォーマットのプリセット(現代MTTの主流構成)
        const PRESETS = [
            { label: 'フリーズアウト', reEntryMax: 0, addOn: null },
            { label: 'リエントリー1回', reEntryMax: 1, addOn: null },
            { label: 'リエントリー無制限', reEntryMax: 99, addOn: null },
            { label: 'リバイ&アドオン', reEntryMax: 3, addOn: { price: 0, chips: 30_000 } }, // priceは後でbuyInから設定
        ];
        const BUYINS = [5_000_000, 50_000_000, 500_000_000, 5_000_000_000, 50_000_000_000, 500_000_000_000];
        const tick = () => {
            const now = Date.now();
            // 1) 定刻を過ぎた大会を開始
            for (const t of this.tournaments.values())
                t.tickSchedule();
            // 2) 終了・中止した定期大会は3分後に一覧から消す
            for (const [id, t] of this.tournaments) {
                if (!id.startsWith('tt-'))
                    continue;
                if (t.state === 'finished' || t.state === 'cancelled') {
                    const at = this.tourPruneAt.get(id);
                    if (at === undefined)
                        this.tourPruneAt.set(id, now + 180_000);
                    else if (now >= at) {
                        this.tournaments.delete(id);
                        this.tourPruneAt.delete(id);
                    }
                }
            }
            // 2.5) 常設トーナメント(SNG/MTT)は終了・中止の60秒後に同じ設定で再開設する。
            //      これが無いと一度遊ばれた(またはbot同士で始まってしまった)常設大会が二度と遊べない
            for (const base of this.cfg.tournaments) {
                const cur = this.tournaments.get(base.tournamentId);
                if (cur && (cur.state === 'finished' || cur.state === 'cancelled')) {
                    const at = this.tourPruneAt.get(base.tournamentId);
                    if (at === undefined)
                        this.tourPruneAt.set(base.tournamentId, now + 60_000);
                    else if (now >= at) {
                        this.tourPruneAt.delete(base.tournamentId);
                        this.createTournament(base);
                    }
                }
            }
            // 3) 「登録受付中」の定期大会が5本になるまで補充
            const upcoming = [...this.tournaments.entries()].filter(([id, t]) => id.startsWith('tt-') && t.state === 'registering').length;
            for (let i = upcoming; i < 5; i++) {
                const name = NAMES[Math.floor(Math.random() * NAMES.length)];
                const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
                const buyIn = BUYINS[Math.floor(Math.random() * BUYINS.length)];
                const turbo = Math.random() < 0.35;
                const id = `tt-${++this.tourSeq}`;
                this.createTournament({
                    tournamentId: id,
                    name: `${name}${preset.label === 'フリーズアウト' ? '' : `（${preset.label}）`}`,
                    type: 'mtt',
                    buyIn,
                    fee: Math.round(buyIn * 0.1),
                    startingStack: 30_000,
                    seatsPerTable: 9,
                    maxPlayers: [27, 45, 90][Math.floor(Math.random() * 3)],
                    minPlayers: 4,
                    levelDurationMs: 4 * 60 * 1000,
                    speed: turbo ? 'turbo' : 'normal',
                    scheduledStart: now + (3 + Math.random() * 12) * 60_000,
                    lateRegMs: (8 + Math.random() * 6) * 60_000,
                    reEntryMax: preset.reEntryMax,
                    addOn: preset.addOn ? { price: buyIn, chips: 30_000 } : undefined,
                });
            }
        };
        tick();
        // unref しないとこのインターバルだけでイベントループが生き続け、
        // Lobby を dispose しないコード(テスト等)がプロセスを終了できなくなる
        setInterval(tick, 20_000).unref?.();
    }
    /** ハンド結果を受けて、永続化・ミッション・パス経験値を進める */
    onHandResult(room, summary, seats) {
        const rake = summary.pots.reduce((a, p) => a + p.rake, 0);
        this.store.saveHand({
            handId: summary.handId,
            tableId: room.cfg.tableId,
            handNumber: summary.handNumber,
            board: summary.board.join(' '),
            potTotal: summary.pots.reduce((a, p) => a + p.amount, 0),
            rake,
            fairness: JSON.stringify(summary.fairness),
            seats: JSON.stringify(seats.map((s) => ({ seat: s.seat, userId: s.userId, net: summary.netChange[s.seat] ?? 0 }))),
        });
        const winners = new Set();
        for (const p of summary.pots)
            for (const w of p.winners)
                winners.add(w);
        for (const s of seats) {
            const won = winners.has(s.seat);
            this.economy.onHandPlayed(s.userId, {
                won,
                showdownWin: won && summary.showdown,
                rakeContributed: Math.round(rake / Math.max(1, seats.length)),
            });
        }
    }
    getRoom(tableId) {
        const cash = this.rooms.get(tableId);
        if (cash)
            return cash;
        for (const t of this.tournaments.values()) {
            const r = t.getTable(tableId);
            if (r)
                return r;
        }
        return undefined;
    }
    listRooms() {
        // プライベート卓はロビー一覧から除外（コードを知っている人だけが入れる）
        return [...this.rooms.entries()].filter(([id]) => !this.privateIds.has(id)).map(([, r]) => r);
    }
    listTournaments() {
        return [...this.tournaments.values()];
    }
    getTournament(id) {
        return this.tournaments.get(id);
    }
    // -------------------------------------------------------------------------
    // 接続ライフサイクル
    // -------------------------------------------------------------------------
    onConnect(sessionId) {
        this.sessions.set(sessionId, {
            sessionId,
            userId: '',
            name: '',
            resumeToken: '',
            authenticated: false,
            tables: new Set(),
            windowStart: this.clock.now(),
            windowCount: 0,
            lastSeen: this.clock.now(),
        });
    }
    onDisconnect(sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s)
            return;
        for (const tableId of s.tables)
            this.getRoom(tableId)?.leave(sessionId);
        this.sessions.delete(sessionId);
    }
    onRaw(sessionId, data) {
        let parsed;
        try {
            parsed = JSON.parse(data);
        }
        catch {
            this.err(sessionId, 'BAD_MESSAGE', 'JSON として解釈できません');
            return;
        }
        const r = parseClientMessage(parsed);
        if (!r.ok) {
            this.err(sessionId, 'BAD_MESSAGE', r.reason);
            return;
        }
        this.onMessage(sessionId, r.msg);
    }
    onMessage(sessionId, msg) {
        const s = this.sessions.get(sessionId);
        if (!s)
            return;
        if (!this.rateLimitOk(s)) {
            this.err(sessionId, 'RATE_LIMITED', 'メッセージの送信が速すぎます');
            return;
        }
        s.lastSeen = this.clock.now();
        if (msg.t === 'hello')
            return this.handleHello(s, msg);
        if (msg.t === 'ping')
            return this.transport.send(sessionId, { t: 'pong', ts: msg.ts });
        if (!s.authenticated)
            return this.err(sessionId, 'NOT_AUTHENTICATED', '先に hello を送ってください');
        switch (msg.t) {
            case 'lobby.list':
                return this.transport.send(sessionId, {
                    t: 'lobby.tables',
                    tables: this.listRooms().map((r) => r.lobbyInfo()),
                });
            case 'table.watch': {
                const room = this.getRoom(msg.tableId);
                if (!room)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのテーブルはありません');
                s.tables.add(msg.tableId);
                room.join(sessionId, s.userId, s.name);
                return;
            }
            case 'table.leave': {
                const room = this.getRoom(msg.tableId);
                if (!room)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのテーブルはありません');
                s.tables.delete(msg.tableId);
                room.leave(sessionId);
                return;
            }
            case 'table.sit':
                return this.withRoom(sessionId, msg.tableId, (room) => room.sit(sessionId, msg.seat, msg.buyIn));
            case 'table.stand':
                return this.withRoom(sessionId, msg.tableId, (room) => {
                    const r = room.stand(sessionId);
                    // 精算をロビーの残高表示へ即反映
                    this.sendBalance(s.userId);
                    return r;
                });
            case 'table.straddle':
                return this.withRoom(sessionId, msg.tableId, (room) => room.setStraddle(sessionId, msg.enabled));
            case 'table.sitOut':
                return this.withRoom(sessionId, msg.tableId, (room) => room.setSitOut(sessionId, msg.sitOut));
            case 'table.rebuy':
                return this.withRoom(sessionId, msg.tableId, (room) => room.rebuy(sessionId, msg.amount));
            case 'hand.act':
                return this.withRoom(sessionId, msg.tableId, (room) => room.act(sessionId, msg.handId, msg.action, msg.toAmount));
            case 'fair.seed':
                return this.withRoom(sessionId, msg.tableId, (room) => room.submitSeed(sessionId, msg.seed));
            // --- トーナメント ---
            case 'tour.list':
                return this.transport.send(sessionId, {
                    t: 'tour.tournaments',
                    tournaments: this.listTournaments().map((t) => t.summary()),
                });
            case 'tour.watch': {
                const t = this.tournaments.get(msg.tournamentId);
                if (!t)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのトーナメントはありません');
                this.transport.send(sessionId, { t: 'tournament.state', view: t.view(s.userId) });
                // 自分の卓に自動入室させる（卓移動があっても迷子にならないように）
                const tableId = t.tableOf(s.userId);
                if (tableId) {
                    const room = t.getTable(tableId);
                    if (room) {
                        s.tables.add(tableId);
                        room.join(sessionId, s.userId, s.name);
                    }
                }
                return;
            }
            case 'tour.register': {
                const t = this.tournaments.get(msg.tournamentId);
                if (!t)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのトーナメントはありません');
                const code = t.register(s.userId, s.name);
                if (code)
                    return this.err(sessionId, code, ERROR_MESSAGES[code]);
                this.sendBalance(s.userId);
                this.transport.send(sessionId, { t: 'tournament.state', view: t.view(s.userId) });
                return;
            }
            case 'tour.addon': {
                const t = this.tournaments.get(msg.tournamentId);
                if (!t)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのトーナメントはありません');
                const code = t.addOn(s.userId);
                if (code)
                    return this.err(sessionId, code, ERROR_MESSAGES[code]);
                this.sendBalance(s.userId);
                this.transport.send(sessionId, { t: 'tournament.state', view: t.view(s.userId) });
                return;
            }
            case 'tour.unregister': {
                const t = this.tournaments.get(msg.tournamentId);
                if (!t)
                    return this.err(sessionId, 'NO_SUCH_TABLE', 'そのトーナメントはありません');
                const code = t.unregister(s.userId);
                if (code)
                    return this.err(sessionId, code, ERROR_MESSAGES[code]);
                this.sendBalance(s.userId);
                return;
            }
            // --- 経済 ---
            case 'table.create': {
                const bb = msg.bigBlind;
                const id = 'pvt-' + Math.random().toString(36).slice(2, 8);
                const code = randomTableCode();
                const cfg = {
                    tableId: id,
                    name: (msg.name && msg.name.trim()) || `プライベート卓 ${code}`,
                    smallBlind: Math.max(1, Math.floor(bb / 2)),
                    bigBlind: bb,
                    maxSeats: msg.maxSeats,
                    rakePercent: 0,
                    // アクション時間は公開卓と同じ一律60秒(ACTION_MS)。タイムバンクの名残は置かない
                };
                const room = new Room(cfg, this.io, this.bank, this.clock);
                room.hooks.onHandResult = (r, summary, seats) => this.onHandResult(r, summary, seats);
                this.rooms.set(id, room);
                this.privateIds.add(id);
                this.tableCodes.set(code, id);
                // 5分の猶予ののち、無人になったら片付ける
                const createdAt = Date.now();
                const timer = setInterval(() => {
                    const rm = this.rooms.get(id);
                    if (!rm) {
                        clearInterval(timer);
                        return;
                    }
                    if (Date.now() - createdAt < 300000)
                        return;
                    const info = rm.lobbyInfo();
                    if (info.seatedCount === 0 && info.watchingCount === 0) {
                        rm.dispose();
                        this.rooms.delete(id);
                        this.privateIds.delete(id);
                        this.tableCodes.delete(code);
                        clearInterval(timer);
                    }
                }, 120000);
                timer.unref?.(); // 掃除タイマーだけでプロセスが終われなくならないように
                this.transport.send(sessionId, { t: 'table.created', code, table: room.lobbyInfo() });
                return;
            }
            case 'code.redeem': {
                const code = msg.code.toUpperCase().replace(/[\s-]/g, '');
                const chips = INVITE_CODES[code];
                if (chips) {
                    // 使用済みチェックは購入レシート台帳で永続化(サーバー再起動しても2重取得できない)
                    const receiptKey = `code:${code}:${s.userId}`;
                    if (this.store.hasReceipt(receiptKey)) {
                        return this.err(sessionId, 'ILLEGAL_ACTION', 'このコードは使用済みです');
                    }
                    let used = this.redeemedCodes.get(s.userId);
                    if (!used) {
                        used = new Set();
                        this.redeemedCodes.set(s.userId, used);
                    }
                    if (used.has(code))
                        return this.err(sessionId, 'ILLEGAL_ACTION', 'このコードは使用済みです');
                    used.add(code);
                    this.store.savePurchase({
                        userId: s.userId,
                        sku: 'invite_code',
                        priceJpy: 0,
                        granted: JSON.stringify({ chips, code }),
                        receipt: receiptKey,
                    });
                    // 台帳1回の記帳は Number.isSafeInteger(≈9007兆) までなので、
                    // 大きな付与はバカラの大口ベットと同じく SAFE_POST で分割記帳する(第147弾)
                    for (let left = chips; left > 0;) {
                        const c = Math.min(left, SAFE_POST);
                        this.store.post(s.userId, 'chips', c, 'adjustment', `code:${code}`);
                        left -= c;
                    }
                    this.sendBalance(s.userId);
                    this.transport.send(sessionId, {
                        t: 'reward',
                        title: '招待コードを適用しました！',
                        chips,
                        gold: 0,
                    });
                    return;
                }
                const tid = this.tableCodes.get(code);
                if (tid) {
                    const room = this.rooms.get(tid);
                    if (!room)
                        return this.err(sessionId, 'NO_SUCH_TABLE', 'その卓はすでに終了しています');
                    return this.transport.send(sessionId, { t: 'code.table', table: room.lobbyInfo() });
                }
                return this.err(sessionId, 'ILLEGAL_ACTION', 'コードが正しくありません');
            }
            case 'ledger.get': {
                // チップ増減の履歴(台帳)。全増減が永続記録されており、これはその閲覧API
                const entries = this.store.history(s.userId, 80).map((r) => ({
                    at: r.at,
                    currency: r.currency,
                    delta: r.delta,
                    reason: r.reason,
                    ref: r.ref,
                    balanceAfter: r.balanceAfter,
                }));
                return this.transport.send(sessionId, { t: 'ledger.history', entries });
            }
            case 'shop.list':
                return this.transport.send(sessionId, { t: 'shop.state', shop: this.shopView(s.userId) });
            case 'shop.purchase': {
                const r = this.economy.purchase(s.userId, msg.sku, msg.receipt);
                if (!r.ok)
                    return this.err(sessionId, 'ILLEGAL_ACTION', r.error ?? '購入できませんでした');
                this.sendBalance(s.userId);
                this.transport.send(sessionId, {
                    t: 'reward',
                    title: r.granted.tierUp ? `${r.granted.tierUp.name} に昇格！` : '購入が完了しました',
                    chips: r.granted.chips,
                    gold: r.granted.gold,
                    detail: `VIP +${r.granted.vipPoints}`,
                });
                this.transport.send(sessionId, { t: 'shop.state', shop: this.shopView(s.userId) });
                this.sendProfile(sessionId, s.userId);
                return;
            }
            case 'daily.claim': {
                const r = this.economy.claimDailyBonus(s.userId);
                if (!r.ok)
                    return this.err(sessionId, 'ILLEGAL_ACTION', r.error ?? '受け取れませんでした');
                this.sendBalance(s.userId);
                this.transport.send(sessionId, {
                    t: 'reward',
                    title: `デイリーボーナス（${r.streak} 日連続）`,
                    chips: r.amount,
                    gold: 0,
                });
                this.sendProfile(sessionId, s.userId);
                return;
            }
            case 'transfer.issue': {
                const { code, pin } = this.issueTransferCode(s.userId);
                this.transport.send(sessionId, { t: 'transfer.issued', code, pin });
                this.sendProfile(sessionId, s.userId);
                return;
            }
            case 'transfer.redeem': {
                const r = this.redeemTransferCode(msg.code, msg.pin);
                if (!r.ok)
                    return this.err(sessionId, 'ILLEGAL_ACTION', r.error ?? '引き継げませんでした');
                const userId = r.userId;
                // 引き継ぎ先のアカウントへこのセッションを付け替える。
                // 卓に着いたままだと状態が食い違うので、先に全部降りてもらう
                for (const room of this.rooms.values()) {
                    try {
                        room.leave(sessionId);
                    }
                    catch { /* 座っていなければ何もしない */ }
                }
                const u = this.store.getUser(userId);
                const name = u?.name ?? `Player-${userId.slice(-4)}`;
                const token = this.makeResumeToken(userId);
                this.resumeTokens.set(token, { userId, name });
                s.userId = userId;
                s.name = name;
                s.resumeToken = token;
                s.authenticated = true;
                this.store.upsertUser(userId, name);
                this.transport.send(sessionId, {
                    t: 'transfer.done',
                    resumeToken: token,
                    name,
                    balance: this.store.balance(userId, 'chips'),
                    gold: this.store.balance(userId, 'gold'),
                });
                return;
            }
            case 'slot.state': {
                this.transport.send(sessionId, { t: 'slot.info', slot: this.economy.slotState(s.userId) });
                return;
            }
            case 'baccarat.deal': {
                const r = this.economy.dealBaccaratHand(s.userId, msg.bets, msg.declare ?? null, Math.random);
                if (!r.ok)
                    return this.err(sessionId, 'ILLEGAL_ACTION', r.error ?? '配れませんでした');
                this.sendBalance(s.userId);
                this.transport.send(sessionId, {
                    t: 'baccarat.result',
                    result: {
                        hand: r.hand, bets: r.bets, stake: r.stake, won: r.won, bonus: r.bonus,
                        declare: msg.declare ?? null, balance: r.balance,
                    },
                });
                return;
            }
            case 'slot.spin': {
                const r = this.economy.spinSlot(s.userId, msg.bet, Math.random, { ante: msg.ante, mode: msg.mode });
                if (!r.ok)
                    return this.err(sessionId, 'ILLEGAL_ACTION', r.error ?? '回せませんでした');
                this.sendBalance(s.userId);
                this.transport.send(sessionId, {
                    t: 'slot.result',
                    result: {
                        outcome: r.outcome, bet: r.bet, currency: 'chips', cost: r.cost, won: r.won, multiplier: r.multiplier,
                        kind: r.kind, goldLeft: r.goldLeft, spinsLeft: r.spinsLeft,
                    },
                });
                return;
            }
            case 'mission.claim': {
                const r = this.economy.claimMission(s.userId, msg.missionId);
                if (!r.ok)
                    return this.err(sessionId, 'ILLEGAL_ACTION', r.error ?? '受け取れませんでした');
                this.sendBalance(s.userId);
                this.transport.send(sessionId, {
                    t: 'reward',
                    title: 'ミッション達成',
                    chips: r.chips,
                    gold: 0,
                    detail: `パス経験値 +${r.xp}`,
                });
                this.sendProfile(sessionId, s.userId);
                return;
            }
            case 'pass.claim': {
                const r = this.economy.claimPassRewards(s.userId);
                if (r.tiers.length === 0 && r.boxes === 0) {
                    return this.err(sessionId, 'ILLEGAL_ACTION', '受け取れる報酬がありません');
                }
                this.sendBalance(s.userId);
                this.transport.send(sessionId, {
                    t: 'reward',
                    title: r.tiers.length ? `パス報酬（${r.tiers.length} ティア分）` : '完走ボーナス',
                    chips: r.chips,
                    gold: r.gold,
                    detail: r.boxes > 0 ? `完走ボーナス箱 ${r.boxes} 個を含みます` : undefined,
                });
                this.sendProfile(sessionId, s.userId);
                return;
            }
            case 'profile.get':
                return this.sendProfile(sessionId, s.userId);
            case 'user.style': {
                // ニックネーム変更・ブレスレット装着（コスメ）。名前は1〜16文字に制限
                const name = typeof msg.name === 'string' && msg.name.trim().length > 0
                    ? msg.name.trim().slice(0, 16)
                    : undefined;
                const bracelet = msg.bracelet === null || (typeof msg.bracelet === 'string' && /^b[1-6]$/.test(msg.bracelet))
                    ? msg.bracelet
                    : undefined;
                if (name) {
                    s.name = name;
                    this.store.upsertUser(s.userId, name);
                    if (s.resumeToken)
                        this.resumeTokens.set(s.resumeToken, { userId: s.userId, name });
                }
                for (const room of this.rooms.values())
                    room.setStyle(s.userId, name, bracelet);
                for (const t of this.tournaments.values())
                    t.setStyle(s.userId, name, bracelet);
                this.sendProfile(sessionId, s.userId);
                return;
            }
        }
    }
    // -------------------------------------------------------------------------
    shopView(userId) {
        const offers = this.economy.offersFor(userId);
        const premiumOwned = this.economy.passStatus(userId).premium;
        return {
            chipPacks: CHIP_PACKS.map((p) => ({
                sku: p.sku,
                name: p.name,
                priceJpy: p.priceJpy,
                chips: p.chips,
                perYen: Math.round(p.chips / p.priceJpy),
            })),
            // 第66弾: ゴールド廃止。枠は機能商品(広告除去など)に転用した
            goldPacks: GOLD_PACKS.map((p) => ({ sku: p.sku, name: p.name, priceJpy: p.priceJpy, gold: 0 })),
            offers: offers.map((o) => ({
                id: o.id,
                sku: o.sku.sku,
                name: o.name,
                description: o.description,
                priceJpy: o.sku.priceJpy,
                reason: o.reason,
                multiplier: o.sku.valueMultiplier ?? null,
                expiresAt: o.expiresAt,
            })),
            passPremium: {
                sku: PASS_PREMIUM_SKU.sku,
                name: PASS_PREMIUM_SKU.name,
                priceJpy: PASS_PREMIUM_SKU.priceJpy,
                owned: premiumOwned,
            },
            vipPurchaseBonus: this.economy.vipStatus(userId).purchaseBonus,
            recentPurchases: this.store.purchases(userId, 10).map((p) => ({
                sku: p.sku,
                name: this.economy.findSku(p.sku)?.name ?? p.sku,
                priceJpy: p.priceJpy,
                at: p.at,
            })),
        };
    }
    profileView(userId) {
        const u = this.store.getUser(userId);
        const pass = this.economy.passStatus(userId);
        const claimable = pass.tiers.some((t) => t.unlocked && (!t.claimedFree || (pass.premium && !t.claimedPremium))) || pass.boxesEarned > pass.boxesClaimed;
        return {
            userId,
            name: u?.name ?? userId,
            chips: this.store.balance(userId, 'chips'),
            gold: this.store.balance(userId, 'gold'),
            vip: this.economy.vipStatus(userId),
            daily: { available: this.economy.dailyBonusAvailable(userId), streak: u?.loginStreak ?? 0 },
            missions: this.economy.missionStatus(userId),
            weekly: this.economy.weeklyStatus(userId),
            seasonal: this.economy.seasonalStatus(userId),
            pass: {
                seasonId: pass.seasonId,
                xp: pass.xp,
                tier: pass.tier,
                premium: pass.premium,
                nextTierXp: pass.nextTierXp,
                claimable,
                tierCount: PASS_TIERS.length,
                completeXp: pass.completeXp,
                daysLeft: pass.daysLeft,
                endsAt: pass.endsAt,
                finalWeek: pass.finalWeek,
                boxesEarned: pass.boxesEarned,
                boxesClaimed: pass.boxesClaimed,
                boxChips: pass.boxChips,
                preview: this.economy.passPurchasePreview(userId),
            },
            piggyBank: u?.piggyBank ?? 0,
            hasTransferCode: this.store.hasTransferCode(userId),
        };
    }
    sendProfile(sessionId, userId) {
        this.transport.send(sessionId, { t: 'profile', profile: this.profileView(userId) });
    }
    sendBalance(userId) {
        this.sendToUser(userId, {
            t: 'balance',
            balance: this.store.balance(userId, 'chips'),
            gold: this.store.balance(userId, 'gold'),
        });
    }
    sendToUser(userId, msg) {
        for (const s of this.sessions.values())
            if (s.userId === userId)
                this.transport.send(s.sessionId, msg);
    }
    withRoom(sessionId, tableId, fn) {
        const room = this.getRoom(tableId);
        if (!room)
            return this.err(sessionId, 'NO_SUCH_TABLE', 'そのテーブルはありません');
        let code;
        try {
            code = fn(room);
        }
        catch (e) {
            console.error(`[room:${tableId}] 内部エラー`, e);
            return this.err(sessionId, 'INTERNAL', '内部エラーが発生しました');
        }
        if (code)
            this.err(sessionId, code, ERROR_MESSAGES[code]);
    }
    handleHello(s, msg) {
        if (msg.v !== PROTOCOL_VERSION) {
            this.err(s.sessionId, 'VERSION_MISMATCH', `プロトコル版が違います（サーバー: ${PROTOCOL_VERSION}）`);
            this.transport.close?.(s.sessionId, 'version mismatch');
            return;
        }
        let resumed = false;
        let userId;
        let name;
        const prior = msg.resumeToken ? this.resumeTokens.get(msg.resumeToken) : undefined;
        // メモリ上のマップに無くても、署名付きトークンならサーバー再起動をまたいで復帰できる
        const signedId = !prior && msg.resumeToken ? this.verifyResumeToken(msg.resumeToken) : null;
        if (prior) {
            userId = prior.userId;
            name = msg.name ?? prior.name;
            resumed = true;
        }
        else if (signedId) {
            userId = signedId;
            const u = this.store.getUser(signedId);
            name = msg.name ?? u?.name ?? `Player-${signedId.slice(-4)}`;
            resumed = u !== null;
        }
        else {
            userId = msg.userId && /^[\w.-]{1,64}$/.test(msg.userId) ? msg.userId : `u_${randomSeedHex(6)}`;
            name = msg.name ?? `Player-${userId.slice(-4)}`;
        }
        const isNew = this.store.getUser(userId) === null;
        this.store.upsertUser(userId, name);
        if (isNew) {
            this.store.post(userId, 'chips', this.cfg.signupBonus, 'signup_bonus');
            this.store.post(userId, 'gold', this.cfg.signupGold, 'signup_bonus');
        }
        const token = this.makeResumeToken(userId);
        this.resumeTokens.set(token, { userId, name });
        s.userId = userId;
        s.name = name;
        s.resumeToken = token;
        s.authenticated = true;
        this.transport.send(s.sessionId, {
            t: 'hello.ok',
            v: PROTOCOL_VERSION,
            userId,
            name,
            resumeToken: token,
            balance: this.store.balance(userId, 'chips'),
            gold: this.store.balance(userId, 'gold'),
            resumed,
        });
        this.sendProfile(s.sessionId, userId);
    }
    rateLimitOk(s) {
        const now = this.clock.now();
        if (now - s.windowStart >= 1000) {
            s.windowStart = now;
            s.windowCount = 0;
        }
        s.windowCount++;
        return s.windowCount <= this.cfg.maxMessagesPerSecond;
    }
    err(sessionId, code, message) {
        this.transport.send(sessionId, { t: 'error', code, message });
    }
    /**
     * 監視用：全ユーザーの残高 + キャッシュ卓のチップ = 発行総量 になっているはず。
     *
     * トーナメント卓のスタックは意図的に含めない。あれは順位を決めるための点数であって通貨ではなく、
     * 通貨としての出入りは「参加費の徴収」と「賞金の支払い」だけで完結している。
     * ここを混ぜると、大会が始まるたびにチップが増えたように見えてしまう。
     */
    totalChips() {
        let sum = this.store.totalBalance('chips');
        for (const r of this.rooms.values())
            sum += r.chipsOnTable();
        return sum;
    }
    dispose() {
        if (this.sweepTimer !== null)
            this.clock.clearTimeout(this.sweepTimer);
        this.sweepTimer = null;
        for (const r of this.rooms.values())
            r.dispose();
        for (const t of this.tournaments.values())
            t.dispose();
    }
    get sessionCount() {
        return this.sessions.size;
    }
}
const ERROR_MESSAGES = {
    BAD_MESSAGE: 'メッセージの形式が不正です',
    VERSION_MISMATCH: 'プロトコルの版が違います',
    NOT_AUTHENTICATED: '認証されていません',
    RATE_LIMITED: '送信が速すぎます',
    NO_SUCH_TABLE: 'そのテーブルはありません',
    SEAT_TAKEN: 'その席は空いていません',
    ALREADY_SEATED: 'すでに参加しています',
    NOT_SEATED: '参加していません',
    INVALID_BUYIN: 'バイイン額が範囲外です',
    INSUFFICIENT_FUNDS: '残高が足りません',
    NOT_YOUR_TURN: 'あなたの手番ではありません',
    ILLEGAL_ACTION: 'その操作はできません',
    STALE_HAND: '古いハンドへの操作です',
    SEED_WINDOW_CLOSED: 'シードの受付時間は終了しています',
    INTERNAL: '内部エラーが発生しました',
};
//# sourceMappingURL=lobby.js.map