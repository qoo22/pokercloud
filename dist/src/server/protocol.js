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
export const PROTOCOL_VERSION = 1;
// ---------------------------------------------------------------------------
// 受信メッセージの検証
// ---------------------------------------------------------------------------
/**
 * 受信メッセージを検証する。
 *
 * クライアントから来る値は一切信用しない。型が合っていても範囲が異常なら弾く。
 * 特に数値は NaN / Infinity / 非整数 / 負値をすべて潰しておかないと、
 * 「バイイン -1000000」のような入力でチップが増える。
 */
export function parseClientMessage(raw) {
    if (typeof raw !== 'object' || raw === null)
        return { ok: false, reason: 'メッセージがオブジェクトではありません' };
    const m = raw;
    const t = m.t;
    if (typeof t !== 'string')
        return { ok: false, reason: 't（メッセージ種別）がありません' };
    const str = (k, max = 64) => {
        const v = m[k];
        return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
    };
    const posInt = (k) => {
        const v = m[k];
        return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
    };
    /**
     * 金額用(第150弾)。秘密卓のバイインは 50京 まであり 2^53 を超えるので
     * isSafeInteger では弾かれてしまう。整数であること・上限(100京)だけを見る。
     * この規模では double の刻みが 1 を超えるが、表せる値は必ず整数なので
     * Number.isInteger が正しい判定になる
     */
    const MONEY_MAX = 1e18;
    const money = (k) => {
        const v = m[k];
        return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MONEY_MAX ? v : null;
    };
    switch (t) {
        case 'hello': {
            const v = m.v;
            if (typeof v !== 'number')
                return { ok: false, reason: 'v がありません' };
            return {
                ok: true,
                msg: {
                    t: 'hello',
                    v,
                    userId: str('userId') ?? undefined,
                    name: str('name', 24) ?? undefined,
                    resumeToken: str('resumeToken', 128) ?? undefined,
                },
            };
        }
        case 'lobby.list':
            return { ok: true, msg: { t: 'lobby.list' } };
        case 'table.create': {
            const bigBlind = posInt('bigBlind');
            if (bigBlind === null || bigBlind < 2)
                return { ok: false, reason: 'bigBlind が不正です' };
            if (bigBlind > 2_500_000_000_000)
                return { ok: false, reason: 'bigBlind が大きすぎます' };
            const seatsRaw = m.maxSeats;
            const maxSeats = typeof seatsRaw === 'number' && Number.isInteger(seatsRaw) && seatsRaw >= 2 && seatsRaw <= 9 ? seatsRaw : 6;
            return { ok: true, msg: { t: 'table.create', bigBlind, maxSeats, name: str('name', 20) ?? undefined } };
        }
        case 'code.redeem': {
            const code = str('code', 32);
            if (!code)
                return { ok: false, reason: 'code がありません' };
            return { ok: true, msg: { t: 'code.redeem', code } };
        }
        case 'ledger.get':
            return { ok: true, msg: { t: 'ledger.get' } };
        case 'table.watch':
        case 'table.leave':
        case 'table.stand': {
            const tableId = str('tableId');
            if (!tableId)
                return { ok: false, reason: 'tableId がありません' };
            return { ok: true, msg: { t, tableId } };
        }
        case 'table.sit': {
            const tableId = str('tableId');
            const buyIn = money('buyIn');
            if (!tableId)
                return { ok: false, reason: 'tableId がありません' };
            if (buyIn === null || buyIn === 0)
                return { ok: false, reason: 'buyIn が不正です' };
            const seatRaw = m.seat;
            const seat = typeof seatRaw === 'number' && Number.isInteger(seatRaw) && seatRaw >= 0 && seatRaw < 9 ? seatRaw : undefined;
            return { ok: true, msg: { t: 'table.sit', tableId, seat, buyIn } };
        }
        case 'table.straddle': {
            const tableId = str('tableId');
            if (!tableId)
                return { ok: false, reason: 'tableId がありません' };
            if (typeof m.enabled !== 'boolean')
                return { ok: false, reason: 'enabled が真偽値ではありません' };
            return { ok: true, msg: { t: 'table.straddle', tableId, enabled: m.enabled } };
        }
        case 'table.sitOut': {
            const tableId = str('tableId');
            if (!tableId)
                return { ok: false, reason: 'tableId がありません' };
            if (typeof m.sitOut !== 'boolean')
                return { ok: false, reason: 'sitOut が真偽値ではありません' };
            return { ok: true, msg: { t: 'table.sitOut', tableId, sitOut: m.sitOut } };
        }
        case 'table.rebuy': {
            const tableId = str('tableId');
            const amount = money('amount');
            if (!tableId)
                return { ok: false, reason: 'tableId がありません' };
            if (amount === null || amount === 0)
                return { ok: false, reason: 'amount が不正です' };
            return { ok: true, msg: { t: 'table.rebuy', tableId, amount } };
        }
        case 'hand.act': {
            const tableId = str('tableId');
            const handId = str('handId', 64);
            const action = m.action;
            if (!tableId || !handId)
                return { ok: false, reason: 'tableId / handId がありません' };
            if (action !== 'fold' &&
                action !== 'check' &&
                action !== 'call' &&
                action !== 'bet' &&
                action !== 'raise') {
                return { ok: false, reason: 'action が不正です' };
            }
            // ベット額も秘密卓では 2^53 を超えうるので money と同じ判定にする(第150弾)
            const toRaw = m.toAmount;
            const toAmount = typeof toRaw === 'number' && Number.isInteger(toRaw) && toRaw >= 0 && toRaw <= MONEY_MAX
                ? toRaw
                : undefined;
            return { ok: true, msg: { t: 'hand.act', tableId, handId, action, toAmount } };
        }
        case 'fair.seed': {
            const tableId = str('tableId');
            const seed = str('seed', 64);
            if (!tableId)
                return { ok: false, reason: 'tableId がありません' };
            if (!seed)
                return { ok: false, reason: 'seed がありません' };
            // 区切り文字はシード合成で使うので受け付けない（サーバー側でも無害化するが二重で防ぐ）
            if (!/^[\w.-]{1,64}$/.test(seed))
                return { ok: false, reason: 'seed に使える文字は英数字と . _ - だけです' };
            return { ok: true, msg: { t: 'fair.seed', tableId, seed } };
        }
        case 'tour.list':
        case 'shop.list':
        case 'daily.claim':
        case 'pass.claim':
        case 'profile.get':
        case 'slot.state':
        case 'transfer.issue':
            return { ok: true, msg: { t } };
        case 'transfer.redeem': {
            // 形式の細かい検証はサーバー側(redeemTransferCode)で行う。ここは長さの上限だけ
            const code = str('code', 32);
            const pin = str('pin', 8);
            if (!code)
                return { ok: false, reason: 'code がありません' };
            if (!pin)
                return { ok: false, reason: 'pin がありません' };
            return { ok: true, msg: { t: 'transfer.redeem', code, pin } };
        }
        case 'baccarat.deal': {
            // 賭け金は3口とも非負整数。合計や残高は経済側(dealBaccaratHand)で最終判定する
            const n = (v) => {
                const x = Math.floor(Number(v));
                return Number.isFinite(x) && x > 0 ? x : 0;
            };
            const src = (m.bets ?? {});
            const bets = { p: n(src.p), b: n(src.b), tie: n(src.tie) };
            if (bets.p + bets.b + bets.tie <= 0)
                return { ok: false, reason: 'bets がありません' };
            // 宣言は既知の2種のみ。未知の値は「宣言なし」に落とす
            const declare = m.declare === 'H' || m.declare === 'L' ? m.declare : undefined;
            return { ok: true, msg: { t: 'baccarat.deal', bets, declare } };
        }
        case 'slot.spin': {
            // 賭け金は整数のみ。使える額かどうかは経済側(SLOT_BETS)で最終判定する
            const bet = Math.floor(Number(m.bet));
            if (!Number.isFinite(bet) || bet <= 0)
                return { ok: false, reason: 'bet が不正です' };
            const ante = m.ante === true;
            // モードは既知の2種のみ。未知の値は既定に落とす(クライアント任せにしない)
            const mode = m.mode === 'few' ? 'few' : 'many';
            return { ok: true, msg: { t: 'slot.spin', bet, ante, mode } };
        }
        case 'user.style': {
            // どちらも任意。bracelet は null（外す）を許可し、それ以外は b1〜b6 のみ
            const name = str('name', 24) ?? undefined;
            const bracelet = m.bracelet === null ? null : typeof m.bracelet === 'string' && /^b[1-6]$/.test(m.bracelet) ? m.bracelet : undefined;
            return { ok: true, msg: { t: 'user.style', name, bracelet } };
        }
        case 'tour.watch':
        case 'tour.register':
        case 'tour.unregister':
        case 'tour.addon': {
            const tournamentId = str('tournamentId');
            if (!tournamentId)
                return { ok: false, reason: 'tournamentId がありません' };
            return { ok: true, msg: { t, tournamentId } };
        }
        case 'shop.purchase': {
            const sku = str('sku');
            const receipt = str('receipt', 128);
            if (!sku || !/^[\w.-]{1,64}$/.test(sku))
                return { ok: false, reason: 'sku が不正です' };
            if (!receipt || receipt.length < 8)
                return { ok: false, reason: 'receipt が不正です' };
            return { ok: true, msg: { t: 'shop.purchase', sku, receipt } };
        }
        case 'mission.claim': {
            const missionId = str('missionId');
            if (!missionId)
                return { ok: false, reason: 'missionId がありません' };
            return { ok: true, msg: { t: 'mission.claim', missionId } };
        }
        case 'ping': {
            const ts = typeof m.ts === 'number' && Number.isFinite(m.ts) ? m.ts : 0;
            return { ok: true, msg: { t: 'ping', ts } };
        }
        default:
            return { ok: false, reason: `未知のメッセージ種別: ${t}` };
    }
}
//# sourceMappingURL=protocol.js.map