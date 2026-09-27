# -*- coding: utf-8 -*-
# 第186弾: 専用ファンファーレ / フリー中は鳴らさず総額で1回 / 総額でダブル
import sys, base64
p, m4a = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf8').read()
B64 = base64.b64encode(open(m4a, 'rb').read()).decode()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 専用のファンファーレを持つ
rep("""  var TN_COUNT_B64 = "data:audio/wav;base64,""",
"""  /**
   * 5倍以上の当選で流すファンファーレ(第186弾・オーナー提供)。
   *
   * GOLD RUSH の fanfarePlay とは別に、この台専用のものを持つ。
   * 5.9秒と長いので、**重ねて鳴らさない**(連続当選で何本も走ると濁る)
   */
  var TN_FANFARE_B64 = "data:audio/mp4;base64,@@B64@@";
  var tnFanBuf = null, tnFanTried = false, tnFanSrc = null;
  function tnFanLoad() {
    if (tnFanBuf || tnFanTried) return;
    try {
      bacAudioInit();
      if (!bacAC) return;
      tnFanTried = true;
      var bin = atob(TN_FANFARE_B64.split(",")[1]), n = bin.length, u8 = new Uint8Array(n);
      for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
      bacAC.decodeAudioData(u8.buffer, function (b) { tnFanBuf = b; }, function () {});
    } catch (e) {}
  }
  function tnFanfare() {
    tnFanLoad();
    if (!tnFanBuf || !bacAC) { try { fanfarePlay(); } catch (e) {} return; }
    try {
      if (tnFanSrc) { try { tnFanSrc.stop(); } catch (e) {} }   // 重ねない
      var g = bacAC.createGain(); g.gain.value = 0.9;
      var src = bacAC.createBufferSource();
      src.buffer = tnFanBuf;
      src.connect(g); g.connect(bacAC.destination);
      src.start();
      tnFanSrc = src;
      try { fsBgmDuck(true); setTimeout(function () { fsBgmDuck(false); }, 5600); } catch (e) {}
    } catch (e) {}
  }

  var TN_COUNT_B64 = "data:audio/wav;base64,""".replace('@@B64@@', B64), 'ファンファーレ音源')

# ② 5倍以上は専用ファンファーレに。フリー中は鳴らさない
rep("""      if (payX >= TN_BIG_X) {
        // 高額は**支給のファンファーレ**(第183弾で直した)。
        //
        // 第178弾では gong を鳴らしていたが、あれは GOLD RUSH で
        // **WILD の倍率が決まる瞬間に鳴るドラ**で、高額当選の音ではない。
        // 別の場面の音が流れていたので、専用の fanfarePlay に差し替えた。
        // 拍手も足さない(GOLD RUSH も高額当選では拍手を重ねていない)
        fanfarePlay();
        return;
      }""",
"""      if (payX >= TN_BIG_X) {
        // 5倍以上は専用のファンファーレ(第186弾・オーナー提供の音源)。
        //
        // 第178弾では gong を鳴らしていたが、あれは GOLD RUSH で
        // **WILD の倍率が決まる瞬間に鳴るドラ**で、高額当選の音ではなかった
        tnFanfare();
        return;
      }""", '専用ファンファーレ')

rep("""      if (free) {
        // 中央にジョーカーが止まった時点で、額に関係なくファンファーレを流す
        // (第181弾・オーナー指定)。フリー確定はこの台で一番大きい出来事
        sfx("bonusin");
        setTimeout(function () { try { fanfarePlay(); } catch (e) {} }, 900);
        return;
      }""",
"""      if (free) {
        // フリー確定。**ここではファンファーレを鳴らさない**(第186弾)。
        // GOLD RUSH と同じく、鳴らすのは5回終わって総額が確定したとき1回だけ。
        // 毎回鳴らすと総額が出たときの山が消える
        sfx("bonusin");
        return;
      }""", 'フリー突入は突入音だけ')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
