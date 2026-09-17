# -*- coding: utf-8 -*-
# 第168弾(1/2): 実機の停止音・GOLD RUSHと同じ回転音・リールの向き・覗き絵柄の除去
import sys
p, b64path = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf8').read()
B64 = open(b64path).read().strip()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 覗き絵柄をやめる。小さい絵が並ぶと本体のリールが読みにくい
rep("""  /* 停止中に上下から覗く隣の絵柄 */
  .tn-peek{position:absolute;left:0;right:0;height:26%;display:flex;align-items:center;
    justify-content:center;pointer-events:none;opacity:.5}
  .tn-peek.t{top:0;align-items:flex-end}
  .tn-peek.b{bottom:0;align-items:flex-start}
  .tn-peek img{width:54%;height:150%;object-fit:contain}
""", "", 'peek CSS 削除')

rep("""  function tnPeekSym(i, off) {
    var pool = ["cherry", "orange", "plum", "melon", "bell", "eight", "bar", "blank", "blank"];
    return pool[(i * 5 + off * 3 + 1) % pool.length];
  }
  function tnCell(sym, cls, tag, idx) {
    var img = TN_IMG[sym];
    var pt = TN_IMG[tnPeekSym(idx || 0, 0)], pb = TN_IMG[tnPeekSym(idx || 0, 1)];
    return '<div class="tn-cell s-' + sym + " " + (cls || "") + (sym === "blank" ? " blank" : "") + '">' +
      (pt ? '<span class="tn-peek t"><img src="' + pt + '" alt=""></span>' : "") +
      (img ? '<img src="' + img + '" alt="">' : "") +
      (pb ? '<span class="tn-peek b"><img src="' + pb + '" alt=""></span>' : "") +""",
"""  function tnCell(sym, cls, tag, idx) {
    var img = TN_IMG[sym];
    // 上下から隣の絵柄を覗かせるのはやめた(第168弾)。小さい絵が散らかって
    // 肝心の停止図柄が読みにくく、実機よりもごちゃついて見えるため
    return '<div class="tn-cell s-' + sym + " " + (cls || "") + (sym === "blank" ? " blank" : "") + '">' +
      (img ? '<img src="' + img + '" alt="">' : "") +""", 'peek 生成 削除')

# ② 停止音を実機の録音に差し替える
rep("""  /** 停止音。短い「トッ」。残響を残さない */
  function tnSfxStop() { try { bacBlip(240 + Math.random() * 50, 0.045, "square", 0.085); } catch (e) {} }""",
"""  /**
   * 停止音(第168弾)。実機の録音から、打撃の 88ms だけを切り出したもの。
   *
   * 合成音では「コッ」の乾いた質感が出せなかった。150Hz前後の低い胴鳴りに
   * 730Hz あたりの金属質が重なっていて、これが実機の手触りそのものになる。
   * 読み込みが間に合わないうちは、これまでどおりの合成音で代用する。
   */
  var TN_STOP_B64 = "@@B64@@";
  var tnStopBuf = null, tnStopTried = false;
  function tnStopLoad() {
    if (tnStopBuf || tnStopTried) return;
    try {
      bacAudioInit();
      if (!bacAC) return;
      tnStopTried = true;
      var bin = atob(TN_STOP_B64), n = bin.length, u8 = new Uint8Array(n);
      for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
      bacAC.decodeAudioData(u8.buffer, function (buf) { tnStopBuf = buf; }, function () {});
    } catch (e) {}
  }
  /** @param vol 0〜1。未選択リールは小さく、選んだリールの停止は大きく鳴らす */
  function tnSfxStop(vol) {
    try {
      tnStopLoad();
      if (tnStopBuf && bacAC) {
        var src = bacAC.createBufferSource(), g = bacAC.createGain();
        src.buffer = tnStopBuf;
        g.gain.value = typeof vol === "number" ? vol : 0.85;
        src.connect(g); g.connect(bacAC.destination);
        src.start();
        return;
      }
      bacBlip(240 + Math.random() * 50, 0.045, "square", 0.085);
    } catch (e) {}
  }""".replace("@@B64@@", B64), '停止音')

# ③ 回転音を GOLD RUSH と同じものに
rep("""  function tnLoopOn() {
    try {
      bacAudioInit();
      if (!bacAC || tnLoop) return;
      var o = bacAC.createOscillator(), g = bacAC.createGain(), lfo = bacAC.createOscillator(), lg = bacAC.createGain();
      o.type = "sawtooth"; o.frequency.value = 1380;
      lfo.type = "square"; lfo.frequency.value = 26;   // 細かい周期音
      lg.gain.value = 0.022; g.gain.value = 0.016;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(bacAC.destination);
      o.start(); lfo.start();
      tnLoop = { o: o, lfo: lfo, g: g };
    } catch (e) {}
  }
  function tnLoopOff() {
    if (!tnLoop) return;
    try {
      tnLoop.g.gain.exponentialRampToValueAtTime(0.0008, bacAC.currentTime + 0.08);
      tnLoop.o.stop(bacAC.currentTime + 0.12); tnLoop.lfo.stop(bacAC.currentTime + 0.12);
    } catch (e) {}
    tnLoop = null;
  }""",
"""  /**
   * 回転音(第168弾)。GOLD RUSH と同じ音を、同じ 320ms 間隔で鳴らす。
   *
   * これまでは専用の持続音を鳴らしていたが、台ごとに回転音が違うと
   * 同じ筐体の中の別ゲームに聞こえない。2台で同じ音にして揃えた。
   * @param ms 間隔。減速に合わせて広げると、速度が落ちたことが耳でも分かる
   */
  function tnLoopOn(ms) {
    var gap = ms || 320;
    if (tnLoop && tnLoop.gap === gap) return;
    tnLoopOff();
    try { play("reelSpin"); } catch (e) {}
    tnLoop = {
      gap: gap,
      t: setInterval(function () { try { play("reelSpin"); } catch (e) {} }, gap),
    };
  }
  function tnLoopOff() {
    if (!tnLoop) return;
    clearInterval(tnLoop.t);
    tnLoop = null;
  }""", '回転音')

# ④ リールの向きを実機と同じ「上から下へ」にする
rep("""    var strips = cells.map(function (c, i) {
      // 帯の最後に「最終的に止まる絵柄」を仕込んでおく
      var syms = [];
      for (var k = 0; k < N - 1; k++) syms.push(POOL[(i * 7 + k * 3 + 2) % POOL.length]);
      syms.push(finalGrid[i]);""",
"""    var strips = cells.map(function (c, i) {
      // 実機のリールは**上から下へ**流れる(第168弾で向きを直した)。
      // 帯は上ほど後に現れるので、止める絵柄は**先頭**に置く。
      // 送り量を増やすと transform が 0 に近づき、先頭の絵柄が枠に収まる
      var syms = [finalGrid[i]];
      for (var k = 1; k < N; k++) syms.push(POOL[(i * 7 + k * 3 + 2) % POOL.length]);""", '帯の並び')

rep("""          st.stopped = true;
          st.el.style.transform = "translateY(" + (-(st.n - 1) * H) + "px)";""",
"""          st.stopped = true;
          st.el.style.transform = "translateY(0px)";   // 先頭の絵柄が枠に収まる""", '停止位置')

rep("""        st.pos = (st.pos + SPEED * 16 * k) % ((st.n - 1) * H);
        st.el.style.transform = "translateY(" + (-st.pos) + "px)";""",
"""        st.pos = (st.pos + SPEED * 16 * k) % ((st.n - 1) * H);
        // pos が増えるほど下へ流れる(0 で先頭=停止図柄が枠に入る)
        st.el.style.transform = "translateY(" + (st.pos - (st.n - 1) * H) + "px)";""", '送り向き')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
