# -*- coding: utf-8 -*-
# 第162弾: ジョーカー戻り(リバース)演出。戻りガセ込み
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① CSS: 中央リールの逆回転と、ジョーカーが枠に収まる動き
rep('''  .tn-cell.roll img{animation:tnRoll .18s linear infinite}''',
'''  .tn-cell.roll img{animation:tnRoll .18s linear infinite}
  /* --- ジョーカー戻り(第162弾) --- */
  /* 中央マスだけ、上下にはみ出した帯を動かして「1コマ巻き戻す」のを見せる */
  .tn-cell.rev{overflow:hidden}
  .tn-revstrip{position:absolute;left:0;right:0;top:-100%;height:300%;
    display:flex;flex-direction:column;will-change:transform}
  .tn-revstrip div{flex:1;display:flex;align-items:center;justify-content:center}
  .tn-revstrip img{width:82%;height:82%;object-fit:contain}
  /* 戻っている最中の中央マス: うっすら光らせて視線を集める */
  .tn-cell.rev{box-shadow:inset 0 0 0 2px rgba(120,200,255,.55),0 0 18px rgba(80,170,255,.45);z-index:3}
  /* 当たって収まった瞬間の小さなバウンドと発光 */
  .tn-cell.revhit{animation:tnRevHit .5s cubic-bezier(.2,1.6,.35,1)}
  .tn-cell.revhit img{filter:drop-shadow(0 0 12px rgba(255,215,106,1))}
  @keyframes tnRevHit{
    0%{transform:translateY(-6%) scale(1)}
    45%{transform:translateY(3%) scale(1.12)}
    70%{transform:translateY(-1%) scale(1.04)}
    100%{transform:translateY(0) scale(1)}}
  /* 確定後の点滅 */
  .tn-cell.revlock{box-shadow:inset 0 0 0 3px #ffd76a,0 0 26px rgba(255,215,106,.95);z-index:4;
    animation:tnLock .5s ease-in-out 3}
  @keyframes tnLock{0%,100%{filter:brightness(1)}50%{filter:brightness(1.6)}}''', 'CSS')

# ② JS: 戻り演出の本体
rep('''  /** サーバーから返ってきた1スピンを画面に流す */
  function tnShowResult(r) {''',
'''  /**
   * ジョーカー戻り(第162弾)。
   *
   * **結果はサーバーがもう決めている**(outcome.reverse)。ここは見せ方だけで、
   * 演出の途中で抽選し直すことは無い。当たりもガセも、ジョーカーが中央枠へ
   * 近づくところまで**まったく同じ動きと音**にして、最後の数フレームまで
   * 判別できないようにしている。
   *
   * 流れ: 一度外して止まる → 約0.7秒の無音 → 中央だけ逆回転 →
   *       当たりなら枠に収まって確定音 / ガセなら行き過ぎて通常停止音
   */
  function tnReverse(hit, centerSym, done) {
    var grid = document.getElementById("tn-grid");
    if (!grid) { done(); return; }
    var cell = grid.children[4];
    if (!cell) { done(); return; }

    // 逆回転中に見せる帯。下から上へ動かすと「巻き戻し」に見える。
    // 当たり: ブランク → ジョーカー(中央に収まる)
    // ガセ  : ブランク → ジョーカー(通り過ぎる) → 実際に止まる絵柄
    var top = hit ? "blank" : centerSym;
    var mid = "joker";
    var bot = hit ? "blank" : "blank";
    cell.classList.add("rev");
    cell.innerHTML =
      '<div class="tn-revstrip" id="tn-revstrip">' +
      '<div>' + (TN_IMG[top] ? '<img src="' + TN_IMG[top] + '" alt="">' : "") + "</div>" +
      '<div><img src="' + TN_IMG[mid] + '" alt=""></div>' +
      '<div>' + (TN_IMG[bot] ? '<img src="' + TN_IMG[bot] + '" alt="">' : "") + "</div>" +
      "</div>";
    var strip = document.getElementById("tn-revstrip");
    // 開始位置: ジョーカーは中央の1コマ下(=さっき通り過ぎた位置)
    var from = -33.3, toHit = 0, toGase = 26;
    strip.style.transform = "translateY(" + from + "%)";

    // 巻き戻し音。当たりもガセも同じ音で始める(始まった時点では分からせない)
    try {
      bacAudioInit();
      var steps = 9;
      for (var i = 0; i < steps; i++) {
        (function (k) {
          setTimeout(function () { bacBlip(420 + k * 52, 0.05, "square", 0.05); }, 60 + k * 62);
        })(i);
      }
    } catch (e) {}

    var t0 = null, DUR = 720;
    var ease = function (u) {
      // ゆっくり動き出し → 中盤で加速 → 中央に近づくと減速
      return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    };
    var tick = function (now) {
      if (t0 === null) t0 = now;
      var u = Math.min(1, (now - t0) / DUR);
      var target = hit ? toHit : toGase;
      // ガセは中央(0%)をいったん通ってから行き過ぎる。ここが同じに見える肝
      var pos;
      if (hit) {
        pos = from + (target - from) * ease(u);
      } else {
        var mid2 = 0;
        pos = u < 0.78
          ? from + (mid2 - from) * ease(u / 0.78)          // 中央まで同じ動き
          : mid2 + (target - mid2) * ease((u - 0.78) / 0.22); // そこから行き過ぎる
      }
      strip.style.transform = "translateY(" + pos + "%)";
      if (u < 1) { requestAnimationFrame(tick); return; }
      // 停止
      cell.classList.remove("rev");
      cell.innerHTML = TN_IMG[hit ? "joker" : centerSym]
        ? '<img src="' + TN_IMG[hit ? "joker" : centerSym] + '" alt="">' : "";
      if (hit) {
        cell.classList.add("revhit");
        try { bacBlip(1180, 0.12, "square", 0.14); setTimeout(function () { bacBlip(1570, 0.22, "square", 0.13); }, 110); } catch (e) {}
        try { bacBuzz([12, 40, 18]); } catch (e) {}
        setTimeout(function () {
          cell.classList.remove("revhit");
          cell.classList.add("revlock");
          setTimeout(function () { cell.classList.remove("revlock"); done(); }, 620);
        }, 480);
      } else {
        // ガセ: 弱く終わる。ファンファーレもトンネル点灯も出さない
        try { bacBlip(300, 0.09, "sine", 0.07); } catch (e) {}
        setTimeout(done, 380);
      }
    };
    requestAnimationFrame(tick);
  }

  /** サーバーから返ってきた1スピンを画面に流す */
  function tnShowResult(r) {''', '戻り演出')

# ③ 結果表示に組み込む。戻り演出があるときは「無音の間」を先に置く
rep('''    tnPending = r.pending || 0;
    tnCanDouble = r.pending > 0;
    tnBusy = false;
    renderTunnel();
    // フリーがあれば1回ずつ見せる
    if (o.freeEntered && o.free && o.free.length) tnPlayFree(o, r);
  }''',
'''    tnPending = r.pending || 0;
    tnCanDouble = r.pending > 0;

    var finish = function () {
      tnBusy = false;
      renderTunnel();
      if (o.freeEntered && o.free && o.free.length) tnPlayFree(o, r);
    };

    if (o.reverse) {
      // 一度「外した」ところを見せる。ここでは当たりを匂わせる文字を出さない
      var shown = o.grid0.slice();
      if (o.reverse.hit) shown[4] = "blank";   // 当たりでも、まずは外して見せる
      tnLast.grid = shown;
      tnLast.hitCells = [];
      tnLast.freeText = "";
      tnLast.msg = "";
      tnBusy = true;
      renderTunnel();
      // 約0.7秒の無音。この「何も起きない時間」が焦らしの本体
      setTimeout(function () {
        tnReverse(o.reverse.hit, o.grid0[4], function () {
          tnLast.grid = o.grid0;
          tnLast.hitCells = hitCells;
          tnLast.freeText = o.freeEntered ? "TUNNEL \\u62BD\\u9078\\u4E2D\\u2026" : "";
          renderTunnel();
          if (o.freeEntered) {
            // 確定してから初めてトンネルへ視線を移す
            setTimeout(function () {
              tnLast.freeText = "TUNNEL \\u00D7" + o.tunnel + "\\u3000FREE GAME 5\\u56DE";
              try { bacBlip(880, 0.1, "triangle", 0.12); } catch (e) {}
              renderTunnel();
              setTimeout(finish, 520);
            }, 620);
          } else {
            finish();
          }
        });
      }, 700);
      return;
    }
    tnBusy = false;
    renderTunnel();
    if (o.freeEntered && o.free && o.free.length) tnPlayFree(o, r);
  }''', '間と組み込み')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
