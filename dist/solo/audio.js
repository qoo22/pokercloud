/**
 * 効果音
 *
 * 音源ファイルを持たず、WebAudio で波形から合成しています。
 * 単一 HTML のまま配りたいからです。音声ファイルを base64 で埋めると、
 * 1 音あたり数十〜数百 KB 増えて、あっという間に数 MB になります。
 *
 * 合成の考え方は 2 つだけです。
 *
 *   打撃音（チップ・カード）… ノイズをフィルタで削り、数十ミリ秒で切る
 *   楽音（勝利・緊張）… 正弦波を重ね、エンベロープで包む
 *
 * 実際の効果音として「らしく」聞こえるかどうかは、波形よりも
 * **減衰の速さと、複数音を数ミリ秒ずらして重ねること**で決まります。
 * チップの音が 1 発だと安っぽく、3〜5 発ばらすと途端にチップらしくなります。
 *
 * ブラウザは操作前に音を鳴らすことを許さないので、
 * 最初のクリックまで AudioContext を作らず、作った後に resume します。
 */
const MUTE_KEY = 'poker.solo.mute';
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
}
catch {
    /* localStorage が使えない環境でも音は鳴らせる */
}
/** 一度だけ作る。ホワイトノイズも使い回す */
function ensure() {
    if (typeof AudioContext === 'undefined')
        return null;
    if (!ctx) {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 0.5);
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++)
            d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended')
        void ctx.resume();
    return ctx;
}
/** 画面を触った瞬間に鳴らせる状態にしておく */
export function unlockAudio() {
    ensure();
}
export function isMuted() {
    return muted;
}
export function setMuted(v) {
    muted = v;
    try {
        localStorage.setItem(MUTE_KEY, v ? '1' : '0');
    }
    catch {
        /* 保存できなくても今のセッションでは効く */
    }
    if (master && ctx)
        master.gain.setTargetAtTime(v ? 0 : 0.5, ctx.currentTime, 0.02);
}
/** ノイズを 1 発。打撃音の素 */
function burst(at, dur, freq, q, gain, type = 'bandpass') {
    if (!ctx || !master || !noiseBuf)
        return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filt).connect(g).connect(master);
    src.start(at);
    src.stop(at + dur + 0.02);
}
/** 正弦波を 1 音。楽音の素 */
function tone(at, dur, from, to, gain, type = 'sine') {
    if (!ctx || !master)
        return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    if (to !== from)
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
}
/** 音階（A4 = 440Hz からの半音） */
const note = (semitonesFromA4) => 440 * Math.pow(2, semitonesFromA4 / 12);
let tensionStop = null;
export function play(name) {
    if (muted)
        return;
    const c = ensure();
    if (!c)
        return;
    const t = c.currentTime;
    switch (name) {
        // チップが数枚ぶつかる。ばらつかせないとチップに聞こえない
        case 'chip':
            for (let i = 0; i < 4; i++)
                burst(t + i * 0.014 + Math.random() * 0.008, 0.05, 2600 + Math.random() * 1400, 6, 0.16);
            break;
        // 大量のチップが動く。数を増やし、低い成分を足して重くする
        case 'chipBig':
            for (let i = 0; i < 11; i++)
                burst(t + i * 0.022 + Math.random() * 0.014, 0.07, 2200 + Math.random() * 1800, 5, 0.15);
            tone(t, 0.28, 150, 80, 0.1);
            break;
        // カードが滑る音。高い帯域のノイズを短く
        case 'deal':
            burst(t, 0.09, 5200, 1.2, 0.13, 'highpass');
            break;
        case 'flip':
            burst(t, 0.05, 3400, 3, 0.16);
            burst(t + 0.02, 0.04, 1500, 4, 0.09);
            break;
        // チェックは卓を叩く音。低くて短い
        case 'check':
            tone(t, 0.09, 190, 90, 0.24);
            burst(t, 0.05, 420, 2, 0.1, 'lowpass');
            break;
        case 'fold':
            burst(t, 0.13, 2400, 1, 0.09, 'highpass');
            tone(t + 0.02, 0.14, 300, 170, 0.07);
            break;
        case 'call':
            for (let i = 0; i < 3; i++)
                burst(t + i * 0.016, 0.05, 2800 + Math.random() * 1000, 6, 0.14);
            tone(t, 0.1, 420, 420, 0.07);
            break;
        // レイズは上がる 2 音。上向きの動きが「攻めた」感じを作る
        case 'raise':
            for (let i = 0; i < 6; i++)
                burst(t + i * 0.018, 0.05, 2800 + Math.random() * 1200, 6, 0.14);
            tone(t, 0.1, note(0), note(0), 0.12, 'triangle');
            tone(t + 0.09, 0.16, note(7), note(7), 0.12, 'triangle');
            break;
        // オールインは重い一撃 + 上昇。ここだけ明確に音量と長さを変える
        case 'allIn':
            tone(t, 0.6, 120, 44, 0.32);
            tone(t + 0.02, 0.5, 240, 90, 0.14, 'triangle');
            for (let i = 0; i < 16; i++)
                burst(t + 0.05 + i * 0.02 + Math.random() * 0.01, 0.08, 2000 + Math.random() * 2200, 5, 0.14);
            tone(t + 0.18, 0.5, note(-12), note(4), 0.12, 'sawtooth');
            break;
        // 焦らしのあいだ鳴らし続ける低い揺れ。stopTension で止める
        case 'tension': {
            if (!ctx || !master)
                break;
            const osc = ctx.createOscillator();
            const lfo = ctx.createOscillator();
            const lfoGain = ctx.createGain();
            const g = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = 55;
            lfo.frequency.value = 5.5;
            lfoGain.gain.value = 0.05;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.09, t + 0.5);
            lfo.connect(lfoGain).connect(g.gain);
            osc.connect(g).connect(master);
            osc.start(t);
            lfo.start(t);
            tensionStop = () => {
                if (!ctx)
                    return;
                const now = ctx.currentTime;
                g.gain.cancelScheduledValues(now);
                g.gain.setValueAtTime(g.gain.value, now);
                g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
                osc.stop(now + 0.3);
                lfo.stop(now + 0.3);
            };
            break;
        }
        // 1 枚めくる瞬間。息を呑む感じの短い上昇
        case 'reveal':
            burst(t, 0.07, 4200, 2, 0.12, 'highpass');
            tone(t + 0.03, 0.18, note(-5), note(2), 0.1, 'triangle');
            break;
        // アウツを引いた瞬間。明るく高い和音
        case 'outHit':
            tone(t, 0.5, note(12), note(12), 0.15, 'triangle');
            tone(t + 0.05, 0.5, note(16), note(16), 0.12, 'triangle');
            tone(t + 0.1, 0.6, note(19), note(19), 0.12, 'sine');
            break;
        // 勝利：上がる分散和音
        case 'win':
            [0, 4, 7, 12].forEach((s, i) => tone(t + i * 0.09, 0.5, note(s), note(s), 0.15, 'triangle'));
            for (let i = 0; i < 8; i++)
                burst(t + 0.3 + i * 0.03, 0.08, 2400 + Math.random() * 1600, 5, 0.12);
            break;
        // 敗北：下がる 2 音。長く引かない（負けを責められている感じになる）
        case 'lose':
            tone(t, 0.28, note(-3), note(-3), 0.12, 'triangle');
            tone(t + 0.16, 0.42, note(-8), note(-10), 0.12, 'triangle');
            break;
        case 'bust':
            tone(t, 0.9, 180, 40, 0.26, 'sawtooth');
            tone(t + 0.1, 0.8, 90, 30, 0.16);
            break;
        case 'achieve':
            [0, 7, 12, 16, 19].forEach((s, i) => tone(t + i * 0.07, 0.4, note(s), note(s), 0.13, 'triangle'));
            break;
        case 'click':
            burst(t, 0.03, 3000, 8, 0.1);
            break;
    }
}
export function stopTension() {
    tensionStop?.();
    tensionStop = null;
}
/** アクションの種類から鳴らす音を選ぶ */
export function playAction(action, allIn) {
    if (allIn) {
        play('allIn');
        return;
    }
    switch (action) {
        case 'fold':
            play('fold');
            break;
        case 'check':
            play('check');
            break;
        case 'call':
            play('call');
            break;
        case 'bet':
        case 'raise':
            play('raise');
            break;
        default:
            play('click');
    }
}
//# sourceMappingURL=audio.js.map