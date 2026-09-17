# -*- coding: utf-8 -*-
# 第165弾: 9リールの見た目と挙動を実機に寄せる
#   ・1マスを横長(約1.9:1)にし、上下に隣の絵柄が覗く「帯の一部」にする
#   ・START でほぼ同時に始動 → 一定速で流れる → 左上から右下へ順次停止
#   ・BET音 / START音 / 回転ループ音 / 停止音(トッ) を足す
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① マスの形と内部構造
rep('''  .tn-cell{position:relative;aspect-ratio:1;border-radius:6px;background:#000;
    display:flex;align-items:center;justify-content:center;overflow:hidden}
  .tn-cell img{width:82%;height:82%;object-fit:contain;display:block}''',
'''  /* 実機は縦長の3リールではなく、**横長の小窓が9個**。停止中も上下に隣の絵柄が
     少し覗いていて、「縦に連続する帯がここで止まっている」と分かる作り(第165弾) */
  .tn-cell{position:relative;aspect-ratio:150/78;border-radius:4px;background:#04120c;
    display:flex;align-items:center;justify-content:center;overflow:hidden}
  .tn-cell img{width:78%;height:82%;object-fit:contain;display:block}
  /* 絵柄ごとに大きさを変える。ジョーカーと7は大きく、果物は余白を残して数えやすく */
  .tn-cell.s-joker img{width:88%;height:92%}
  .tn-cell.s-red7 img,.tn-cell.s-blue7 img{width:66%;height:92%}
  .tn-cell.s-bar img{width:92%;height:70%}
  .tn-cell.s-eight img{width:62%;height:88%}
  .tn-cell.s-cherry img,.tn-cell.s-orange img,.tn-cell.s-plum img,.tn-cell.s-melon img{width:70%;height:74%}
  /* 停止中に上下から覗く隣の絵柄 */
  .tn-peek{position:absolute;left:0;right:0;height:26%;display:flex;align-items:center;
    justify-content:center;pointer-events:none;opacity:.5}
  .tn-peek.t{top:0;align-items:flex-end}
  .tn-peek.b{bottom:0;align-items:flex-start}
  .tn-peek img{width:54%;height:150%;object-fit:contain}
  /* 回転中の帯。1コマぶんずつ縦に送る(なめらかなブラーは使わない) */
  .tn-strip{position:absolute;left:0;right:0;top:0;will-change:transform}
  .tn-strip div{height:var(--tnh,78px);display:flex;align-items:center;justify-content:center}
  .tn-strip img{width:72%;height:80%;object-fit:contain}''', 'マスの形と帯')

rep('''  .tn-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:6px;border-radius:10px;''',
'''  .tn-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:5px;border-radius:8px;''', '枠の詰め')

# ② セルに絵柄別クラスと覗きを足す
rep('''  function tnCell(sym, cls, tag) {
    var img = TN_IMG[sym];
    return '<div class="tn-cell ' + (cls || "") + (sym === "blank" ? " blank" : "") + '">' +
      (img ? '<img src="' + img + '" alt="">' : "") +
      (tag ? '<span class="tn-tag px ' + tag + '">' + (tag === "tunnel" ? "TUNNEL" : "WILD") + "</span>" : "") +
      "</div>";
  }''',
'''  /** 覗かせる隣の絵柄。マスごとに固定で散らす(毎回変わるとチラつく) */
  function tnPeekSym(i, off) {
    var pool = ["cherry", "orange", "plum", "melon", "bell", "eight", "bar", "blank", "blank"];
    return pool[(i * 5 + off * 3 + 1) % pool.length];
  }
  function tnCell(sym, cls, tag, idx) {
    var img = TN_IMG[sym];
    var pt = TN_IMG[tnPeekSym(idx || 0, 0)], pb = TN_IMG[tnPeekSym(idx || 0, 1)];
    return '<div class="tn-cell s-' + sym + " " + (cls || "") + (sym === "blank" ? " blank" : "") + '">' +
      (pt ? '<span class="tn-peek t"><img src="' + pt + '" alt=""></span>' : "") +
      (img ? '<img src="' + img + '" alt="">' : "") +
      (pb ? '<span class="tn-peek b"><img src="' + pb + '" alt=""></span>' : "") +
      (tag ? '<span class="tn-tag px ' + tag + '">' + (tag === "tunnel" ? "TUNNEL" : "WILD") + "</span>" : "") +
      "</div>";
  }''', 'セルに覗きと絵柄別サイズ')

rep('''      cells += tnCell(g[i], (hit.indexOf(i) >= 0 ? "hit " : "") + (held.indexOf(i) >= 0 ? "held" : ""), tag);''',
'''      cells += tnCell(g[i], (hit.indexOf(i) >= 0 ? "hit " : "") + (held.indexOf(i) >= 0 ? "held" : ""), tag, i);''', 'index渡し')

# ③ 音
rep('''  /** 手持ちのクレジット。slot.info の残高をそのまま出す */
  var tnCredits = 0;''',
'''  /** 手持ちのクレジット。slot.info の残高をそのまま出す */
  var tnCredits = 0;

  // --- 音(第165弾) ---
  // 実機は通常時にBGMを流さず、回転音と停止音だけでリズムを作る。
  // だから普段の音数を抑えるほど、当選時の音楽が効く
  var tnLoop = null;
  /** BET音。短い矩形波。連打すると規則的に鳴る */
  function tnSfxBet() { try { bacAudioInit(); bacBlip(880, 0.05, "square", 0.07); } catch (e) {} }
  /** START音。BETより少し低く、始まりを知らせる */
  function tnSfxStart() { try { bacAudioInit(); bacBlip(420, 0.09, "triangle", 0.10); } catch (e) {} }
  /** 停止音。短い「トッ」。残響を残さない */
  function tnSfxStop() { try { bacBlip(240 + Math.random() * 50, 0.045, "square", 0.085); } catch (e) {} }
  /** 回転ループ音。細かい周期音を小さく鳴らし続ける */
  function tnLoopOn() {
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
  }

  /**
   * 9リールの回転(第165弾)。
   *
   * 縦長の3リールではなく、**独立した9個の小窓**がそれぞれ縦に流れる。
   * START でほぼ同時に始動し(長い加速は付けない)、約1秒回してから
   * 左上→右下の順に 0.06〜0.12秒おきで止める。止まる直前だけ短く減速する。
   * 結果はもうサーバーが決めているので、ここは見せ方だけ
   */
  function tnSpinReels(finalGrid, done) {
    var grid = document.getElementById("tn-grid");
    if (!grid) { done(); return; }
    var cells = [];
    for (var i = 0; i < 9; i++) cells.push(grid.children[i]);
    if (cells.some(function (c) { return !c; })) { done(); return; }

    var H = cells[0].clientHeight || 78;
    var POOL = ["cherry", "orange", "plum", "melon", "bell", "eight", "bar", "red7", "blue7", "joker", "blank"];
    var N = 14;
    var strips = cells.map(function (c, i) {
      // 帯の最後に「最終的に止まる絵柄」を仕込んでおく
      var syms = [];
      for (var k = 0; k < N - 1; k++) syms.push(POOL[(i * 7 + k * 3 + 2) % POOL.length]);
      syms.push(finalGrid[i]);
      c.style.setProperty("--tnh", H + "px");
      c.innerHTML = '<div class="tn-strip">' + syms.map(function (sy) {
        return "<div>" + (TN_IMG[sy] ? '<img src="' + TN_IMG[sy] + '" alt="">' : "") + "</div>";
      }).join("") + "</div>";
      return { el: c.querySelector(".tn-strip"), n: syms.length, pos: 0, stopped: false };
    });

    tnLoopOn();
    var SPEED = H * 8 / 1000;             // 1秒あたり約8コマ
    var FIRST = 900, GAP = 85;            // 最初の停止まで/1つずつの間隔
    var t0 = null;
    var loop = function (now) {
      if (t0 === null) t0 = now;
      var t = now - t0;
      var all = true;
      for (var i = 0; i < 9; i++) {
        var st = strips[i];
        if (st.stopped) continue;
        var stopAt = FIRST + i * GAP;
        if (t >= stopAt) {
          // 目的の絵柄を枠へ吸着させて固定
          st.stopped = true;
          st.el.style.transform = "translateY(" + (-(st.n - 1) * H) + "px)";
          var c = cells[i];
          c.classList.remove("landing"); void c.offsetWidth; c.classList.add("landing");
          tnSfxStop();
          continue;
        }
        all = false;
        // 停止直前だけ短く減速する
        var left = stopAt - t;
        var k = left < 160 ? 0.35 + 0.65 * (left / 160) : 1;
        st.pos = (st.pos + SPEED * 16 * k) % ((st.n - 1) * H);
        st.el.style.transform = "translateY(" + (-st.pos) + "px)";
      }
      if (!all || t < FIRST + 8 * GAP) { requestAnimationFrame(loop); return; }
      tnLoopOff();
      setTimeout(done, 90);
    };
    requestAnimationFrame(loop);
  }''', '音と回転')

# ④ 着地の小さな補正
rep('''  .tn-cell.hit{box-shadow:inset 0 0 0 2px #ffd76a,0 0 14px rgba(255,215,106,.7);z-index:2}''',
'''  .tn-cell.hit{box-shadow:inset 0 0 0 2px #ffd76a,0 0 14px rgba(255,215,106,.7);z-index:2}
  /* 止まった瞬間のごく短い位置合わせ。パチスロのように長く滑らせない */
  .tn-cell.landing{animation:tnLand .12s steps(2)}
  @keyframes tnLand{0%{transform:translateY(-3px)}100%{transform:translateY(0)}}''', '着地')

# ⑤ スピン操作に音と回転を繋ぐ
rep('''    if (minus) minus.onclick = function () { tnBet = Math.max(1000, Math.floor(tnBet / 2)); renderTunnel(); };
    if (plus) plus.onclick = function () { tnBet = tnBet * 2; renderTunnel(); };''',
'''    if (minus) minus.onclick = function () { tnBet = Math.max(1000, Math.floor(tnBet / 2)); tnSfxBet(); renderTunnel(); };
    if (plus) plus.onclick = function () { tnBet = tnBet * 2; tnSfxBet(); renderTunnel(); };''', 'BET音')

rep('''      tnBusy = true; tnLast = null; renderTunnel();
      send({ t: "tunnel.spin", bet: tnBet });''',
'''      tnBusy = true; tnLast = null; renderTunnel();
      tnSfxStart();
      send({ t: "tunnel.spin", bet: tnBet });''', 'START音')

# ⑥ 結果が来たら、まず回してから見せる
rep('''  function tnShowResult(r) {
    var o = r.outcome;''',
'''  function tnShowResult(r) {
    var o = r.outcome;
    // まだ回していなければ、9リールを回してから結果を見せる。
    // 戻り演出があるときは「一度外した盤面」で止めるので、そこまで回す
    if (!tnSpun) {
      tnSpun = true;
      var land = o.grid0.slice();
      if (o.reverse && o.reverse.hit) land[4] = "blank";
      tnSpinReels(land, function () { tnShowResult(r); });
      return;
    }
    tnSpun = false;''', '回してから結果')

rep('''  var tnBet = 1000, tnBusy = false, tnPending = 0, tnCanDouble = false, tnPick = 0, tnLast = null;''',
'''  var tnBet = 1000, tnBusy = false, tnPending = 0, tnCanDouble = false, tnPick = 0, tnLast = null;
  /** いま回し終えたか(結果表示を2段階に分けるための目印) */
  var tnSpun = false;''', '回転フラグ')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
