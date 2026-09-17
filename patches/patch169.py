# -*- coding: utf-8 -*-
# 第169弾: 回転音・開始音・ベット操作を GOLD RUSH と同じにする
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 回転音。GOLD RUSH は録音をループさせている。合成音ではなく同じ音源を使う
rep("""  /**
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
  }""",
"""  /**
   * 回転音(第169弾)。GOLD RUSH が鳴らしているのと**同じ録音**をループさせる。
   *
   * 第168弾では合成のカチカチ音を等間隔で鳴らしていたが、GOLD RUSH の
   * 回転音は録音(`sfxBuf.reel`)のループだった。台ごとに音が違うと、
   * 同じ筐体に入っている別ゲームに聞こえない。音源ごと揃える。
   *
   * 引数は互換のために残してあるが、録音のループなので間隔は関係ない。
   * 減速の表現は音程ではなく、停止音の間の取り方で作る。
   */
  function tnLoopOn() {
    if (tnLoop) return;
    try { reelSoundStart(); } catch (e) { return; }
    tnLoop = true;
  }
  function tnLoopOff() {
    if (!tnLoop) return;
    tnLoop = false;
    try { reelSoundStop(); } catch (e) {}
  }""", '回転音')

# ② BET音・START音も GOLD RUSH と同じボタン音に
rep("""  /** BET音。短い矩形波。連打すると規則的に鳴る */
  function tnSfxBet() { try { bacAudioInit(); bacBlip(880, 0.05, "square", 0.07); } catch (e) {} }
  /** START音。BETより少し低く、始まりを知らせる */
  function tnSfxStart() { try { bacAudioInit(); bacBlip(420, 0.09, "triangle", 0.10); } catch (e) {} }""",
"""  /** BET音。GOLD RUSH のベット操作と同じボタン音(第169弾) */
  function tnSfxBet() { try { sfx("btn"); } catch (e) {} }
  /** START音。GOLD RUSH のスピンと同じボタン音(第169弾) */
  function tnSfxStart() { try { sfx("btn"); } catch (e) {} }""", 'BET/START音')

# ③ 減速に合わせて間隔を変えていた呼び出しを、録音ループに合わせて素直にする
rep("""      reel.stop({ extra: extra }, function (stage) {
        // 減速が耳でも分かるように、回転音の間隔を広げていく
        tnLoopOn([320, 320, 460, 700, 980][stage] || 980);
      }, function () {""",
"""      reel.stop({ extra: extra }, null, function () {""", '減速中の音')

rep("""      reel.setLanding(r.player[idx], teaser);
      tnLoopOn(320);""",
"""      reel.setLanding(r.player[idx], teaser);
      tnLoopOn();""", '選択リールの回転音')
rep("""    reel.spin();
    tnLoopOn(320);""",
"""    reel.spin();
    tnLoopOn();""", 'ディーラーの回転音')
rep("""      return r;
    });
    tnLoopOn(320);""",
"""      return r;
    });
    tnLoopOn();""", 'プレイヤーの回転音')

# ④ ベット操作を GOLD RUSH と同じ「段を選ぶ」方式にする
rep("""      '<div class="tn-ctrl">' +
        '<button class="tn-btn" id="tn-minus">\\u2212</button>' +
        '<div class="tn-bet"><span>\\u8CDE\\u3051\\u91D1</span><b id="tn-betv">' + tnFmt(tnBet) + "</b></div>" +
        '<button class="tn-btn" id="tn-plus">\\uFF0B</button>' +
      "</div>" +""",
"""      tnBetHtml() +""", 'ベットUIの差し替え')

rep("""  /** サーバーから返ってきた1スピンを画面に流す */
  function tnShowResult(r) {""",
"""  /**
   * 賭け金の操作(第169弾)。GOLD RUSH とまったく同じ作りにする。
   *
   * 半分/2倍で自由に動かすのではなく、**1-2-5 の段を選ぶ**。
   * 段の一覧はサーバーが所持額から作ったもの(chipBets)をそのまま使うので、
   * 2台のあいだで刻みがずれない。金額をタップすると一覧が開き、
   * MAX で一番上の段へ飛ぶ。
   */
  var tnBetOpen = false;
  function tnBetList() {
    var sv = (typeof slotView !== "undefined" && slotView) ? slotView : null;
    var list = sv && sv.chipBets && sv.chipBets.length ? sv.chipBets.slice() : null;
    if (list) return list;
    // スロット情報がまだ届いていないときの代わり。届けば上の段に差し替わる
    var out = [];
    for (var k = 3; k < 9; k++) {
      out.push(1 * Math.pow(10, k), 2 * Math.pow(10, k), 5 * Math.pow(10, k));
    }
    return out;
  }
  /** いま何段目か。一覧に無い額は、それを超えない一番近い段に寄せる */
  function tnBetIdx(list) {
    var i = list.indexOf(tnBet);
    if (i >= 0) return i;
    i = 0;
    for (var k = 0; k < list.length; k++) if (list[k] <= tnBet) i = k;
    return i;
  }
  function tnBetHtml() {
    var list = tnBetList();
    var i = tnBetIdx(list);
    var lock = tnBusy || tnCanDouble;
    return '<div class="tn-betsel">' +
      '<button class="tn-btn" data-tnbetstep="-1"' + (lock || i <= 0 ? " disabled" : "") + ">\\u2212</button>" +
      '<button class="tn-bet" id="tn-betnow"' + (lock ? " disabled" : "") + ">" +
        "<span>\\u8CDE\\u3051\\u91D1</span><b id=\\"tn-betv\\">" + tnFmt(tnBet) + "</b></button>" +
      '<button class="tn-btn" data-tnbetstep="1"' + (lock || i >= list.length - 1 ? " disabled" : "") + ">\\uFF0B</button>" +
      '<button class="tn-btn wide" data-tnbetop="max"' + (lock ? " disabled" : "") + ">MAX</button>" +
      "</div>" +
      (tnBetOpen
        ? '<div class="tn-betlist">' + list.map(function (b) {
            return '<button class="tn-betitem' + (b === tnBet ? " sel" : "") + '" data-tnbet="' + b + '">' +
              "\\uD83D\\uDCB0 " + tnFmt(b) + "</button>";
          }).join("") + "</div>"
        : "");
  }
  function tnSetBet(v) {
    var list = tnBetList();
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return;
    tnBet = n;
    try { localStorage.setItem("tnBet", String(n)); } catch (e) {}
    renderTunnel();
  }

  /** サーバーから返ってきた1スピンを画面に流す */
  function tnShowResult(r) {""", 'ベット操作')

# ⑤ 配線
rep("""    var minus = $$("tn-minus"), plus = $$("tn-plus"), spin = $$("tn-spin");
    if (minus) minus.onclick = function () { tnBet = Math.max(1000, Math.floor(tnBet / 2)); tnSfxBet(); renderTunnel(); };
    if (plus) plus.onclick = function () { tnBet = tnBet * 2; tnSfxBet(); renderTunnel(); };
    if (spin) spin.onclick = function () {
      if (tnBusy || tnCanDouble) return;
      tnBusy = true; tnLast = null; renderTunnel();
      tnSfxStart();
      send({ t: "tunnel.spin", bet: tnBet });
    };""",
"""    var spin = $$("tn-spin");
    var each = function (sel, fn) {
      Array.prototype.forEach.call(document.querySelectorAll("#tunnel " + sel), fn);
    };
    // −/+ は1段ずつ。飛び飛びの金額しか作れないのが選択式の要点(GOLD RUSH と同じ)
    each("[data-tnbetstep]", function (b) {
      b.onclick = function () {
        var list = tnBetList();
        var i = Math.max(0, Math.min(list.length - 1, tnBetIdx(list) + Number(b.dataset.tnbetstep)));
        tnSfxBet();
        if (list[i] != null) tnSetBet(list[i]);
      };
    });
    each("[data-tnbetop]", function (b) {
      b.onclick = function () {
        var list = tnBetList();
        tnSfxBet();
        if (b.dataset.tnbetop === "max" && list.length) tnSetBet(list[list.length - 1]);
      };
    });
    each("[data-tnbet]", function (b) {
      b.onclick = function () { tnBetOpen = false; tnSfxBet(); tnSetBet(b.dataset.tnbet); };
    });
    var betNow = $$("tn-betnow");
    if (betNow) betNow.onclick = function () { tnSfxBet(); tnBetOpen = !tnBetOpen; renderTunnel(); };
    if (spin) spin.onclick = function () {
      if (tnBusy || tnCanDouble) return;
      tnBetOpen = false;
      tnBusy = true; tnLast = null; renderTunnel();
      // GOLD RUSH と同じで、**ボタン音が鳴り終わってからリールが回る**。
      // 送信も同じだけ遅らせる(結果が先に届いて回転が短く見えるのを防ぐ)
      tnSfxStart();
      setTimeout(function () {
        if (!tnBusy) return;
        send({ t: "tunnel.spin", bet: tnBet });
      }, Math.round((typeof SFX_SEC !== "undefined" && SFX_SEC.btn ? SFX_SEC.btn : 0.2) * 1000));
    };""", 'ベットの配線')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
