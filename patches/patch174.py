# -*- coding: utf-8 -*-
# 第174弾: WINNING TUNNEL にオートスピンを入れる
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 見た目
rep("""  .tn-spin:disabled{opacity:.45;cursor:default}""",
"""  .tn-spin:disabled{opacity:.45;cursor:default}
  /* オート中(第174弾)。GOLD RUSH と同じで、**スピンボタン自体が**
     「AUTO n / タップで停止」に変わる。赤い専用ボタンは作らない */
  .tn-spin.autorun{background:linear-gradient(180deg,#ffd0a8,#d96a3d);color:#2a0f03}
  .tn-spin small{display:block;font-size:9px;font-weight:700;letter-spacing:.08em;opacity:.85}
  .tn-autopill{display:inline-block;margin-left:8px;padding:3px 9px;border-radius:999px;
    font-size:10px;font-weight:800;cursor:pointer;
    border:1px solid rgba(217,180,95,.6);background:rgba(217,180,95,.12);color:#ffe9a8}
  .tn-autopill:disabled{opacity:.4;cursor:default}""", 'CSS')

# ② 状態と本体
rep("""  /** 中央のブランクの、どちら側にジョーカーがいるか(true=上)。""",
"""  // --- オートスピン(第174弾) ---
  //
  // フリーゲームが挟まっても止めずに回し続ける。止まる条件は3つだけ:
  //   ・決めた回数を終えた  ・チップが賭け金に足りない  ・タップで止めた
  //
  // 当たってダブルの選択待ちになると、そのままでは永久に止まる。
  // オート中は**自動で確定(コレクト)**して次のスピンへ進む。
  // ダブルは賭けるかどうかの判断なので、勝手に賭けさせない。
  var tnAuto = 0;          // 残り回数。-1 は無限。0 は停止
  var tnAutoTimer = null;

  function tnAutoRunning() { return tnAuto !== 0; }
  function tnAutoStop(why) {
    if (!tnAutoRunning()) return;
    tnAuto = 0;
    if (tnAutoTimer) { clearInterval(tnAutoTimer); tnAutoTimer = null; }
    if (why && tnLast) tnLast.msg = why;
    renderTunnel();
  }
  function tnAutoStart(n) {
    tnAuto = n;
    if (tnAutoTimer) clearInterval(tnAutoTimer);
    // 演出の途中では何もせず、手が空いた瞬間だけ次の1手を打つ。
    // 演出の終わりに合わせて呼ぶ作りにすると、途中で例外が出たとき止まってしまう
    tnAutoTimer = setInterval(tnAutoTick, 260);
    renderTunnel();
  }
  function tnAutoTick() {
    if (!tnAutoRunning()) { tnAutoStop(); return; }
    if (tnBusy || tnDD) return;                       // 演出中・ダブル中は触らない
    var el = document.getElementById("tunnel");
    if (!el || el.style.display === "none") { tnAutoStop(); return; }   // 台を離れた
    if (tnCanDouble) {                                // 当たりを確定して次へ
      tnBusy = true;
      send({ t: "tunnel.collect" });
      return;
    }
    if (tnCredits < tnBet) { tnAutoStop("\\u30C1\\u30C3\\u30D7\\u304C\\u8DB3\\u308A\\u307E\\u305B\\u3093"); return; }
    if (tnAuto > 0) tnAuto--;
    tnDoSpin();
    if (tnAuto === 0) tnAutoStop();                   // 最後の1回を回し切ってから止める
  }

  /** 中央のブランクの、どちら側にジョーカーがいるか(true=上)。""", 'オートの本体')

# ③ スピンの中身を関数に切り出す(ボタンとオートで同じ道を通す)
rep("""    if (spin) spin.onclick = function () {
      if (tnBusy || tnCanDouble) return;
      tnBetOpen = false;
      tnBusy = true;""",
"""    if (spin) spin.onclick = function () {
      if (tnAutoRunning()) { tnAutoStop(); return; }   // オート中はタップで停止
      if (tnBusy || tnCanDouble) return;
      tnDoSpin();
    };
    var auto = $$("tn-auto");
    if (auto) auto.onclick = function () { tnAskAuto(); };""", 'ボタンの配線')

rep("""      // GOLD RUSH と同じで、**ボタン音が鳴り終わってからリールが回る**。
      // 送信も同じだけ遅らせる(結果が先に届いて回転が短く見えるのを防ぐ)
      tnSfxStart();
      setTimeout(function () {
        if (!tnBusy) return;
        send({ t: "tunnel.spin", bet: tnBet });
      }, Math.round((typeof SFX_SEC !== "undefined" && SFX_SEC.btn ? SFX_SEC.btn : 0.2) * 1000));
    };""",
"""      // GOLD RUSH と同じで、**ボタン音が鳴り終わってからリールが回る**。
      // 送信も同じだけ遅らせる(結果が先に届いて回転が短く見えるのを防ぐ)
      tnSfxStart();
      setTimeout(function () {
        if (!tnBusy) return;
        send({ t: "tunnel.spin", bet: tnBet });
      }, Math.round((typeof SFX_SEC !== "undefined" && SFX_SEC.btn ? SFX_SEC.btn : 0.2) * 1000));
    }""", 'スピンの中身')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
