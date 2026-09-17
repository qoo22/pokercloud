# -*- coding: utf-8 -*-
# 第168弾(3/3): ダブルダウンの演出エンジン。ディーラー先行・3択・多段階減速
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# 停止音に再生速度を足す(ディーラーは低く、勝ちは高く)
rep("""  /** @param vol 0〜1。未選択リールは小さく、選んだリールの停止は大きく鳴らす */
  function tnSfxStop(vol) {
    try {
      tnStopLoad();
      if (tnStopBuf && bacAC) {
        var src = bacAC.createBufferSource(), g = bacAC.createGain();
        src.buffer = tnStopBuf;
        g.gain.value = typeof vol === "number" ? vol : 0.85;""",
"""  /**
   * @param vol  0〜1。未選択リールは小さく、選んだリールの停止は大きく鳴らす
   * @param rate 再生速度。1より下げると低く重い音になる(ディーラーや敗北)
   */
  function tnSfxStop(vol, rate) {
    try {
      tnStopLoad();
      if (tnStopBuf && bacAC) {
        var src = bacAC.createBufferSource(), g = bacAC.createGain();
        src.buffer = tnStopBuf;
        if (typeof rate === "number") src.playbackRate.value = rate;
        g.gain.value = typeof vol === "number" ? vol : 0.85;""", '停止音に音程')

# 本体
rep("""  /** サーバーから返ってきた1スピンを画面に流す */
  function tnShowResult(r) {""",
"""  // ---------------------------------------------------------------------
  // ダブルダウン(第168弾)
  // ---------------------------------------------------------------------
  //
  // 実機の手順をそのまま追う:
  //   ディーラーが先に止まる → 倒すべき相手を理解する間を置く
  //   → プレイヤー3本が回り出す → どれか1本を選ぶ
  //   → 選ばなかった2本を先に止める(遠い方から)
  //   → 選んだ1本だけを4段階で減速させ、最後の1コマをゆっくり送る
  //
  // 面白さの本体は「選んだ瞬間」ではなく、**最後の1本に勝敗と3つ揃いの期待が
  // 同時に乗っている時間**にある。だから未選択2本は消さず、先に見せる。
  //
  // 勝敗はサーバーが配った時点で決まっている(bsz.ts の bszDealDouble)。
  // ここは見せ方だけで、演出中に抽選し直すことはない。

  /** ダブルの強弱。サーバーの BSZ_RANK と同じ並び */
  var TN_RANK = {
    blank: 0, cherry: 1, orange: 2, plum: 3, melon: 4,
    bell: 5, eight: 6, bar: 7, red7: 8, blue7: 9, joker: 10,
  };
  var TN_POOL = ["cherry","orange","plum","melon","bell","eight","bar","red7","blue7","joker","blank"];

  /** 進行中のダブル。null なら通常のリール画面 */
  var tnDD = null;

  /**
   * 1本ぶんのリール。上から下へ流れ、止めるときだけ多段階で減速する。
   *
   * 帯の**先頭**が停止図柄。1周ぶん送ると先頭が枠に収まるので、
   * 「あと何周して止まるか」だけを決めれば停止位置は自動的に合う。
   * 先頭と末尾を同じ絵柄にしてあるので、周回のつなぎ目は見えない。
   */
  function tnDDReel(cell, seed) {
    var H = cell.clientHeight || 78;
    var N = 20;
    var syms = [];
    for (var k = 0; k < N; k++) syms.push(TN_POOL[(k * 5 + seed * 3 + 1) % TN_POOL.length]);
    syms[N - 1] = syms[0];                       // つなぎ目を見せない
    cell.style.setProperty("--tnh", H + "px");
    cell.innerHTML = '<div class="tn-strip">' + syms.map(function (sy) {
      return "<div>" + (TN_IMG[sy] ? '<img src="' + TN_IMG[sy] + '" alt="">' : "") + "</div>";
    }).join("") + "</div>";
    var el = cell.querySelector(".tn-strip");
    var divs = el.children;
    var P = (N - 1) * H;                          // 1周ぶんの送り量
    var r = {
      cell: cell, el: el, H: H, N: N, P: P,
      pos: 0, base: H * 9 / 1000,                 // 1秒あたり約9コマ
      raf: 0, stopped: false,
    };
    var put = function (i, sym) {
      divs[i].innerHTML = TN_IMG[sym] ? '<img src="' + TN_IMG[sym] + '" alt="">' : "";
    };
    r.draw = function () { el.style.transform = "translateY(" + ((r.pos % P) - P) + "px)"; };
    /** 止める絵柄と、その直前に見せる絵柄を仕込む。高速回転中なら読めない */
    r.setLanding = function (final, teaser) {
      put(0, final); put(N - 1, final);
      if (teaser) put(1, teaser);
    };
    r.spin = function () {
      var last = null;
      var tick = function (now) {
        if (r.stopped) return;
        if (last !== null) r.pos += r.base * Math.min(now - last, 34);
        last = now;
        r.draw();
        r.raf = requestAnimationFrame(tick);
      };
      r.raf = requestAnimationFrame(tick);
    };
    /**
     * 止める。速度を 100% → 60% → 25% → 8% と落とし、最後は1コマぶんを
     * 1〜2pxずつ送る。滑らかなイージングは使わない(実機はもっとカクカクしている)。
     * @param extraMs 最終段を延ばす量。3つ揃いが見えているときに長くする
     */
    r.stop = function (extraMs, onStage, done) {
      cancelAnimationFrame(r.raf);
      var plan = [
        { v: 1.00, ms: 520 },
        { v: 0.60, ms: 500 },
        { v: 0.25, ms: 660 },
        { v: 0.08, ms: 480 + (extraMs || 0) },
      ];
      var rest = 0;
      for (var i = 1; i < 4; i++) rest += r.base * plan[i].v * plan[i].ms;
      // 先頭が枠に収まる位置(=1周の倍数)へちょうど着地させる。
      // 足りないぶんは**最初の高速区間の長さ**で吸収する。速すぎて誰も気づかない
      var target = Math.ceil((r.pos + rest + r.base * plan[0].ms) / r.P) * r.P;
      while (target - r.pos - rest < r.base * 200) target += r.P;
      plan[0].ms = (target - r.pos - rest) / r.base;

      var stage = 0, t0 = null, last = null, moved = 0, planEnd = 0;
      var stageEnds = [];
      var acc = 0;
      for (var j = 0; j < 4; j++) { acc += plan[j].ms; stageEnds.push(acc); }
      planEnd = acc;
      var start = r.pos;
      var tick = function (now) {
        if (t0 === null) { t0 = now; last = now; r.raf = requestAnimationFrame(tick); return; }
        var t = now - t0;
        var dt = Math.min(now - last, 34); last = now;
        while (stage < 3 && t > stageEnds[stage]) {
          stage++;
          if (onStage) onStage(stage);
        }
        r.pos += r.base * plan[stage].v * dt;
        moved = r.pos - start;
        if (t >= planEnd || r.pos >= target) {
          r.pos = target;
          r.stopped = true;
          r.draw();
          if (done) done();
          return;
        }
        // 行き過ぎないよう、残りが最終段で送れる量を超えないように抑える
        if (r.pos > target) r.pos = target;
        r.draw();
        r.raf = requestAnimationFrame(tick);
      };
      r.raf = requestAnimationFrame(tick);
    };
    r.kill = function () { r.stopped = true; cancelAnimationFrame(r.raf); };
    r.draw();
    return r;
  }

  /** ディーラーより弱い絵柄／強い絵柄を1つ選ぶ(焦らしに使う) */
  function tnTeaser(dealer, want) {
    var dr = TN_RANK[dealer] || 0;
    var cand = TN_POOL.filter(function (k) {
      var r = TN_RANK[k];
      return want === "weak" ? r < dr : r > dr;
    });
    if (!cand.length) cand = TN_POOL.filter(function (k) { return k !== dealer; });
    return cand[Math.floor(Math.random() * cand.length)];
  }

  /** ダブル開始。まずサーバーにディーラーだけ決めてもらう */
  function tnDDBegin(half) {
    if (tnDD || !tnCanDouble) return;
    var pend = tnPending || 0;
    tnDD = {
      stage: "dealing", half: half, pick: -1, reels: [], dealer: null,
      origin: pend, tryLuck: half ? Math.floor(pend / 2) : pend,
      verdict: "", verdictCls: "",
    };
    renderTunnel();
    send({ t: "tunnel.double.deal", half: half });
  }

  /** サーバーがディーラーを返してきた。ここから実機の手順どおりに進める */
  function tnDDDealt(dealer) {
    if (!tnDD) return;
    tnDD.dealer = dealer;
    var d = document.getElementById("tn-dd-d");
    if (!d) return;
    var reel = tnDDReel(d, 0);
    tnDD.dealerReel = reel;
    reel.spin();
    tnLoopOn(320);
    // ディーラーは焦らさない。約1.1秒で止める
    setTimeout(function () {
      if (!tnDD) return;
      reel.setLanding(dealer, null);
      reel.stop(-260, null, function () {
        tnLoopOff();
        tnSfxStop(0.7, 0.86);            // 少し低く「コッ」。強敵感は音程で出す
        // 倒すべき相手を理解する時間。ここを詰めると3択が作業になる
        setTimeout(tnDDSpinPlayers, 340);
      });
    }, 420);
  }

  /** プレイヤー3本を回し始め、少し遅れて選択を受け付ける */
  function tnDDSpinPlayers() {
    if (!tnDD) return;
    tnDD.reels = [0, 1, 2].map(function (i) {
      var el = document.getElementById("tn-dd-p" + i);
      if (!el) return null;
      var r = tnDDReel(el, i + 1);
      // 完全に同時だと機械的すぎる。2〜4フレームだけずらす
      setTimeout(function () { r.spin(); }, i * 35);
      return r;
    });
    tnLoopOn(320);
    setTimeout(function () {
      if (!tnDD) return;
      tnDD.stage = "picking";
      var row = document.getElementById("tn-dd-row");
      if (row) row.classList.add("live");
      try { bacBlip(1200, 0.04, "square", 0.05); } catch (e) {}
    }, 200);
  }

  /** 1本選ばれた。勝敗はサーバーが返してから見せる */
  function tnDDChoose(idx) {
    if (!tnDD || tnDD.stage !== "picking") return;
    tnDD.stage = "resolving";
    tnDD.pick = idx;
    var row = document.getElementById("tn-dd-row");
    if (row) row.classList.remove("live");
    for (var i = 0; i < 3; i++) {
      var el = document.getElementById("tn-dd-p" + i);
      if (!el) continue;
      el.classList.add(i === idx ? "dd-sel" : "dd-dim");
      if (i === idx) el.classList.add("dd-flash");
    }
    try { bacAudioInit(); bacBlip(1650, 0.05, "square", 0.09); } catch (e) {}
    send({ t: "tunnel.double.pick", pick: idx });
  }

  /** サーバーの結果が届いた。ここから停止の順番どおりに見せる */
  function tnDDReveal(view) {
    if (!tnDD) { tnDDFinish(view); return; }
    var r = view.result;
    var idx = tnDD.pick >= 0 ? tnDD.pick : (r.pick || 0);
    tnDD.result = view;
    // 選んだリールから遠い順に止める。視線が外側から中央の1本へ集まる
    var others = [0, 1, 2].filter(function (i) { return i !== idx; })
      .sort(function (a, b) { return Math.abs(b - idx) - Math.abs(a - idx); });

    var stopOther = function (k) {
      var i = others[k];
      var reel = tnDD.reels[i];
      if (!reel) return;
      reel.setLanding(r.player[i], null);
      reel.stop(-620, null, function () { tnSfxStop(0.45, 1.0); });
    };
    setTimeout(function () { stopOther(0); }, 150);
    setTimeout(function () { stopOther(1); }, 400);

    // 未選択2本が同じ絵柄なら、3つ揃いの期待があるぶん長く焦らす
    var same = r.player[others[0]] === r.player[others[1]];
    var extra = same ? 450 : 0;

    setTimeout(function () {
      if (!tnDD) return;
      var reel = tnDD.reels[idx];
      if (!reel) { tnDDShowVerdict(view); return; }
      // 直前に見せる絵柄で焦らす。
      //   勝ち … 一度負け図柄を見せてから滑り込む
      //   負け … 勝ち図柄をいったん見せてから通り過ぎる
      var teaser = r.result === "win" ? tnTeaser(r.dealer, "weak")
        : r.result === "lose" ? tnTeaser(r.dealer, "strong") : null;
      reel.setLanding(r.player[idx], teaser);
      tnLoopOn(320);
      reel.stop(extra, function (stage) {
        // 減速が耳でも分かるように、回転音の間隔を広げていく
        tnLoopOn([320, 320, 460, 700, 980][stage] || 980);
      }, function () {
        tnLoopOff();
        if (r.result === "win") {
          tnSfxStop(1, 1.12);
          try { bacBlip(1180, 0.1, "square", 0.13); setTimeout(function () { bacBlip(1570, 0.2, "square", 0.12); }, 110); } catch (e) {}
        } else if (r.result === "tie") {
          tnSfxStop(0.8, 1.0);
        } else {
          tnSfxStop(0.8, 0.82);
        }
        setTimeout(function () { tnDDShowVerdict(view); }, 180);
      });
    }, 620);
  }

  function tnDDShowVerdict(view) {
    if (!tnDD) { tnDDFinish(view); return; }
    var r = view.result;
    tnDD.verdict = r.result === "win" ? "WINNER!" : r.result === "tie" ? "TIE \\u2014 REPLAY" : "LOSE";
    tnDD.verdictCls = r.result;
    tnDDPaint();
    // ジョーカーが出ていればトンネルへ。文字より先に上を見せる
    var wait = r.tunnel ? 900 : 700;
    setTimeout(function () { tnDDFinish(view); }, wait);
  }

  /** 盤を作り直さずに、判定の文字だけ書き換える(リールを消さないため) */
  function tnDDPaint() {
    var v = document.querySelector(".tn-ddverdict");
    if (!v || !tnDD) return;
    v.className = "tn-ddverdict px " + (tnDD.verdictCls || "");
    v.textContent = tnDD.verdict || "";
  }

  /** ダブルを終えて通常画面へ戻す */
  function tnDDFinish(view) {
    if (tnDD) {
      (tnDD.reels || []).forEach(function (r) { if (r) r.kill(); });
      if (tnDD.dealerReel) tnDD.dealerReel.kill();
    }
    tnDD = null;
    tnLoopOff();
    if (view) {
      tnLast = tnLast || {};
      tnLast.dd = view.result;
      tnLast.msg = view.result.specialX > 0
        ? "SPECIAL BONUS \\u00D7" + view.result.specialX
        : (view.result.result === "win" ? "DOUBLE WIN" : view.result.result === "tie" ? "TIE" : "");
      tnPending = view.pending || 0;
      tnCanDouble = !!view.canDouble;
    }
    tnBusy = false;
    renderTunnel();
  }

  /** サーバーから返ってきた1スピンを画面に流す */
  function tnShowResult(r) {""", 'ダブル演出エンジン')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
