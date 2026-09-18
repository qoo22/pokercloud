# -*- coding: utf-8 -*-
# 第177弾: ジョーカーを紋章入りに作り直し、止まった瞬間に動くスプライトを足す
import sys, base64, re
p, still, sheet = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf8').read()
STILL = base64.b64encode(open(still, 'rb').read()).decode()
SHEET = base64.b64encode(open(sheet, 'rb').read()).decode()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 静止画を紋章入りに差し替え
m = re.search(r'var TN_IMG = \{joker: "(data:image/[a-z]+;base64,[A-Za-z0-9+/=]+)"', s)
assert m
print(f'  静止画 {len(m.group(1)):,} → {len(STILL)+24:,} 文字')
s = s.replace(m.group(1), 'data:image/webp;base64,' + STILL, 1)
print('OK 静止画')

# ② 動くスプライト
rep("""  /** 手持ちのクレジット。slot.info の残高をそのまま出す */""",
"""  /**
   * 止まった瞬間に動くジョーカー(第177弾)。
   *
   * 元は静止画1枚なので、**金の輪郭に沿って光が走る・宝石と目が明滅する・
   * 一度だけ大きくなって戻る**の3つを焼き込んだ8コマにしてある。
   * CSSの重ね合わせでは金だけを光らせられないので、画像として持つ。
   *
   * 中央に止まる=フリー確定なので、ここだけは派手でよい。
   * 横に8コマ並べた帯を background-position で送る(steps で送ると
   * 中間の補間が入らず、実機のコマ送りらしくなる)
   */
  var TN_JOKER_SHEET = "data:image/webp;base64,@@SHEET@@";
  var TN_JOKER_FRAMES = 8;

  /** 手持ちのクレジット。slot.info の残高をそのまま出す */""".replace('@@SHEET@@', SHEET), 'スプライト')

# ③ 見た目
rep("""  .tn-cell.s-joker img,
  .tn-strip div.s-joker img,
  .tn-revstrip div.s-joker img{width:100%;height:100%;object-fit:cover;transform:none}""",
"""  .tn-cell.s-joker img,
  .tn-strip div.s-joker img,
  .tn-revstrip div.s-joker img{width:100%;height:100%;object-fit:cover;transform:none}
  /* 止まった瞬間だけ動く(第177弾)。静止画の上に重ね、終わったら消す。
     8コマを steps で送るので、中間が補間されずコマ送りに見える */
  .tn-jokeranim{position:absolute;inset:0;z-index:3;pointer-events:none;
    background-repeat:no-repeat;background-size:800% 100%;background-position:0 0;
    animation:tnJokerRun .72s steps(8) 2}
  @keyframes tnJokerRun{from{background-position:0 0}to{background-position:-800% 0}}
  /* 動いているあいだは枠も金色に光らせる */
  .tn-cell.jokerlit{box-shadow:inset 0 0 0 2px #ffd76a,0 0 22px rgba(255,200,90,.9);z-index:4}""", 'CSS')

# ④ 止まったときに走らせる
rep("""          st.stopped = true;
          st.el.style.transform = "translateY(0px)";   // 先頭の絵柄が枠に収まる
          var c = cells[i];
          c.classList.remove("landing"); void c.offsetWidth; c.classList.add("landing");
          tnSfxStop();
          continue;""",
"""          st.stopped = true;
          st.el.style.transform = "translateY(0px)";   // 先頭の絵柄が枠に収まる
          var c = cells[i];
          c.classList.remove("landing"); void c.offsetWidth; c.classList.add("landing");
          tnSfxStop();
          if (finalGrid[i] === "joker") tnJokerLand(c);   // 止まった瞬間に動かす
          continue;""", '停止時に走らせる')

rep("""  function tnFmt(n) { return typeof fmt === "function" ? fmt(n) : String(n); }""",
"""  /**
   * ジョーカーが止まったマスを一度だけ動かす。
   * 重ねた帯は再生が終わったら外す(置きっぱなしにすると次のスピンまで残る)
   */
  function tnJokerLand(cell) {
    if (!cell) return;
    var old = cell.querySelector(".tn-jokeranim");
    if (old) old.remove();
    var el = document.createElement("span");
    el.className = "tn-jokeranim";
    el.style.backgroundImage = "url(" + TN_JOKER_SHEET + ")";
    cell.appendChild(el);
    cell.classList.add("jokerlit");
    setTimeout(function () {
      el.remove();
      cell.classList.remove("jokerlit");
    }, 1500);
  }

  function tnFmt(n) { return typeof fmt === "function" ? fmt(n) : String(n); }""", '再生の本体')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
