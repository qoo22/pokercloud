# -*- coding: utf-8 -*-
# 第185弾: ためは高額だけ / フリーの配当はゆっくりカウントアップ / 転がる音
import sys, base64
p, wav = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf8').read()
B64 = base64.b64encode(open(wav, 'rb').read()).decode()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① ためは高額のときだけ。ガセをやめる
rep("""   * 止まってから当選額が出るまでの「ため」(第184弾)。
   *
   * 高額のときだけ溜めると、**溜まった瞬間に高額が確定**してしまい、
   * 「もしかして」と思う時間が消える。だから**外れのときもたまに溜める**。
   * 溜まったら期待は上がるが、確定ではない——これが察する楽しみになる。
   *
   * 長さは額で変える(大きいほど長い)。ただし短いほうの差は小さくして、
   * 長さだけで結果が読めないようにしてある。
   *
   * @param payX 賭け金の何倍か
   * @param done ためが終わったら呼ぶ
   */
  var TN_HOLD_GASE = 0.12;      // 高額でないときに溜める割合
  function tnHold(payX, done) {
    var big = payX >= TN_BIG_X;
    if (!big && Math.random() >= TN_HOLD_GASE) { done(); return; }
    var ms = big ? (payX >= 100 ? 1100 : 800) : 700;""",
"""   * 止まってから当選額が出るまでの「ため」(第184→185弾)。
   *
   * これは焦らしではなく、**高額の配当を計算しているように見せる間**。
   * だから外れのときには入れない(第185弾・オーナー指定)。
   * 当たっていないのに計算しているように見えるのは、ただの待ち時間になる。
   *
   * 長さは額で変える。大きいほど長く計算しているように見せる。
   *
   * @param payX 賭け金の何倍か
   * @param done ためが終わったら呼ぶ
   */
  function tnHold(payX, done) {
    if (payX < TN_BIG_X) { done(); return; }
    var ms = payX >= 100 ? 1100 : 800;""", 'ためは高額だけ')

# ② カウントアップの転がる音
rep("""  /** 手持ちのクレジット。slot.info の残高をそのまま出す */""",
"""  /**
   * カウントアップ中に流れる音(第185弾)。
   *
   * 実機の録音から、転がっている部分の芯だけを 175ms 切り出したもの。
   * 端をゼロ交差で合わせてクロスさせてあるので、**繰り返しても継ぎ目が出ない**。
   * これを速くループさせて「ドゥるるるるる」を作る。
   * 単発を並べる方式だと、間隔が揺れて途切れて聞こえる
   */
  var TN_COUNT_B64 = "data:audio/wav;base64,@@B64@@";
  var tnCountBuf = null, tnCountTried = false, tnCountSrc = null, tnCountGain = null;
  function tnCountLoad() {
    if (tnCountBuf || tnCountTried) return;
    try {
      bacAudioInit();
      if (!bacAC) return;
      tnCountTried = true;
      var bin = atob(TN_COUNT_B64.split(",")[1]), n = bin.length, u8 = new Uint8Array(n);
      for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
      bacAC.decodeAudioData(u8.buffer, function (b) { tnCountBuf = b; }, function () {});
    } catch (e) {}
  }
  /** @param rate 再生速度。上げるほど細かく速い「るるる」になる */
  function tnCountStart(rate) {
    tnCountLoad();
    if (!tnCountBuf || !bacAC || tnCountSrc) return;
    try {
      tnCountGain = bacAC.createGain();
      tnCountGain.gain.value = 0.55;
      var src = bacAC.createBufferSource();
      src.buffer = tnCountBuf;
      src.loop = true;
      src.playbackRate.value = rate || 1.8;
      src.connect(tnCountGain); tnCountGain.connect(bacAC.destination);
      src.start();
      tnCountSrc = src;
    } catch (e) {}
  }
  function tnCountStop() {
    var src = tnCountSrc, g = tnCountGain;
    tnCountSrc = null; tnCountGain = null;
    if (!src) return;
    try {
      if (g && bacAC) g.gain.setTargetAtTime(0, bacAC.currentTime, 0.03);
      setTimeout(function () { try { src.stop(); } catch (e) {} }, 140);
    } catch (e) {}
  }

  /**
   * 配当をゆっくり数え上げる(第185弾)。GOLD RUSH のフリー中と同じ見せ方。
   *
   * 一瞬で額を出さず、0から目的の額まで回す。回している間は転がる音を流し、
   * **数え終わってから**次の回転に進む。額が大きいほど長く数える
   *
   * @param to   数え上げる先(チップ)
   * @param done 数え終わったら呼ぶ
   */
  function tnCountUp(to, done) {
    if (!(to > 0)) { done(); return; }
    var ms = Math.min(2600, 700 + Math.round(Math.log10(Math.max(10, to)) * 320));
    tnCountStart(1.8);
    var t0 = null;
    var tick = function (now) {
      if (t0 === null) t0 = now;
      var u = Math.min(1, (now - t0) / ms);
      // 最後だけ少し減速させると「数え終わった」感じが出る
      var e = 1 - Math.pow(1 - u, 2);
      if (tnLast) { tnLast.win = Math.round(to * e); renderTunnel(); }
      if (u < 1) { requestAnimationFrame(tick); return; }
      tnCountStop();
      if (tnLast) { tnLast.win = to; renderTunnel(); }
      setTimeout(done, 220);
    };
    requestAnimationFrame(tick);
  }

  /** 手持ちのクレジット。slot.info の残高をそのまま出す */""".replace('@@B64@@', B64), 'カウントアップ')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
