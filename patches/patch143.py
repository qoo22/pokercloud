# -*- coding: utf-8 -*-
# 第143弾: リール盤面+4種 / WILD表記の常設(豪華フォント) / 回転中の帯もスキン追随
import sys, base64, os
p = sys.argv[1]
img = sys.argv[2]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)
def uri(name):
    with open(os.path.join(img, name), 'rb') as f:
        return 'data:image/webp;base64,' + base64.b64encode(f.read()).decode()

# ① リール盤面デザインを4種追加(gold/red/ice/noir)。classicは従来のまま
rep('''var SLOT_REELS = { classic: "", purple: "''',
'''var SLOT_REELS = { classic: "", gold: "__RLGOLD__", red: "__RLRED__", ice: "__RLICE__", noir: "__RLNOIR__", purple: "''', 'リール4種追加')

rep('''        '<button class="bac-sw" data-rl="green"></button>' +
        '<span>筐体</span>' +''',
'''        '<button class="bac-sw" data-rl="green"></button>' +
        '<button class="bac-sw" data-rl="gold"></button>' +
        '<button class="bac-sw" data-rl="red"></button>' +
        '<button class="bac-sw" data-rl="ice"></button>' +
        '<button class="bac-sw" data-rl="noir"></button>' +
        '<span>筐体</span>' +''', 'リールスワッチ追加')

# ② WILDはどのスキンでも必ずWILDと分かるように(FREEリボンと同型・豪華な書体)
rep('''  #slot .sl-cell.sc{box-shadow:inset 0 0 0 2px rgba(255,190,80,.95), 0 0 10px rgba(255,170,60,.45)}''',
'''  #slot .sl-cell.sc{box-shadow:inset 0 0 0 2px rgba(255,190,80,.95), 0 0 10px rgba(255,170,60,.45)}
  /* WILDもどの絵柄スキンでもひと目で分かるようにWILDリボンを常設(第143弾)。書体は豪華なセリフ */
  #slot .sl-cell.wd::after{content:"WILD";position:absolute;left:50%;bottom:3px;
    transform:translateX(-50%);z-index:3;font-size:9px;font-weight:900;letter-spacing:.14em;
    font-family:'Copperplate','Trajan Pro',Georgia,'Times New Roman',serif;
    color:#ffe9a8;padding:1px 7px;border-radius:6px;pointer-events:none;
    background:linear-gradient(180deg,#4a2472,#2a1046);
    box-shadow:0 1px 3px rgba(0,0,0,.65),inset 0 0 0 1px rgba(255,220,140,.75);
    text-shadow:0 1px 2px rgba(0,0,0,.6)}
  #slot .sl-cell.wd{box-shadow:inset 0 0 0 2px rgba(190,120,255,.85), 0 0 10px rgba(160,80,255,.4)}''', 'WILDリボンCSS')

rep('''  .free-mini{font-style:normal;font-size:8px;font-weight:900;letter-spacing:.06em;color:#2a1500;
    padding:0 4px;border-radius:4px;margin-left:3px;
    background:linear-gradient(180deg,#ffe9a8,#ffb84d)}''',
'''  .free-mini{font-style:normal;font-size:8px;font-weight:900;letter-spacing:.06em;color:#2a1500;
    padding:0 4px;border-radius:4px;margin-left:3px;
    background:linear-gradient(180deg,#ffe9a8,#ffb84d)}
  .wild-mini{font-style:normal;font-size:8px;font-weight:900;letter-spacing:.1em;color:#ffe9a8;
    font-family:'Copperplate','Trajan Pro',Georgia,serif;
    padding:0 4px;border-radius:4px;margin-left:3px;
    background:linear-gradient(180deg,#4a2472,#2a1046);
    box-shadow:inset 0 0 0 1px rgba(255,220,140,.7)}''', 'wild-mini CSS')

# 役名一覧バーにもWILDバッジ
rep('''${k === "scatter" ? '<i class="free-mini">FREE</i>' : ""}</span>`).join("")}</div>''',
'''${k === "scatter" ? '<i class="free-mini">FREE</i>' : k === "wild" ? '<i class="wild-mini">WILD</i>' : ""}</span>`).join("")}</div>''', '一覧のWILDバッジ')

# 配当表のWILD行にもバッジ
rep('''src="${SLOT_IMG.wild}" alt=""> ${escapeHtml(slotSymSkinName("wild") || "\\u30EF\\u30A4\\u30EB\\u30C9")}</td>''',
'''src="${SLOT_IMG.wild}" alt=""> ${escapeHtml(slotSymSkinName("wild") || "\\u30EF\\u30A4\\u30EB\\u30C9")}<i class="wild-mini">WILD</i></td>''', '配当表のWILDバッジ')

# ③ 回転中の帯(スプライト)もスキンに追随
rep('''    if (changed && typeof slotSpinning !== "undefined" && !slotSpinning) {
      try { renderSlot(); } catch (e) {}
    }
    return sk;
  }''',
'''    if (changed && typeof slotSpinning !== "undefined" && !slotSpinning) {
      try { renderSlot(); } catch (e) {}
    }
    slotStripBuild();
    return sk;
  }

  /**
   * 回転中の帯(スプライト)もスキンに追随させる(第143弾)。
   * 既定スキンは従来の焼き込み帯(SLOT_STRIP)。スキン選択時は SLOT_IMG から
   * canvas で帯を組み立てて差し替える(canvasが無い環境では従来帯のまま=安全)
   */
  var slotStripCache = {};
  var SLOT_STRIP_KEYS = ["seven", "wild", "heart", "club", "scatter", "diamond", "crown", "chip", "spade", "heart", "diamond", "club"];
  function slotStripSkin() {
    var sk = "classic";
    try { sk = localStorage.getItem("slSyms") || sk; } catch (e) {}
    return SLOT_SYM_SKINS[sk] ? sk : "classic";
  }
  function slotStripSrc() {
    var sk = slotStripSkin();
    return sk === "classic" ? SLOT_STRIP : (slotStripCache[sk] || SLOT_STRIP);
  }
  function slotStripBuild() {
    var sk = slotStripSkin();
    if (sk === "classic" || slotStripCache[sk]) return;
    try {
      var S = 96, pad = 7, cv = document.createElement("canvas");
      if (!cv.getContext) return;
      cv.width = S; cv.height = S * SLOT_STRIP_N;
      var cx = cv.getContext("2d");
      if (!cx) return;
      var done = 0;
      SLOT_STRIP_KEYS.forEach(function (k, i) {
        var im = new Image();
        im.onload = function () {
          cx.drawImage(im, pad, i * S + pad, S - pad * 2, S - pad * 2);
          if (k === "wild") {
            // 帯の中でもWILDはWILDと分かるように(豪華な金の帯字)
            cx.save();
            cx.font = "900 17px Copperplate, 'Trajan Pro', Georgia, serif";
            cx.textAlign = "center";
            cx.lineWidth = 3; cx.strokeStyle = "rgba(20,8,40,.9)";
            cx.strokeText("WILD", S / 2, i * S + S - 8);
            var gr = cx.createLinearGradient(0, i * S + S - 22, 0, i * S + S - 4);
            gr.addColorStop(0, "#fff3c4"); gr.addColorStop(1, "#e0a83c");
            cx.fillStyle = gr;
            cx.fillText("WILD", S / 2, i * S + S - 8);
            cx.restore();
          }
          done++;
          if (done === SLOT_STRIP_KEYS.length) {
            try { slotStripCache[sk] = cv.toDataURL("image/png"); } catch (e2) {}
          }
        };
        im.src = SLOT_IMG[k];
      });
    } catch (e) {}
  }''', '帯のスキン追随')

rep('''    strip.innerHTML =
      '<img class="sl-band" src="' + SLOT_STRIP + '" style="height:' + bandH + 'px" alt="">' +
      '<img class="sl-band" src="' + SLOT_STRIP + '" style="height:' + bandH + 'px" alt="">';''',
'''    const bandSrc = slotStripSrc();   // スキンに追随した帯(第143弾)
    strip.innerHTML =
      '<img class="sl-band" src="' + bandSrc + '" style="height:' + bandH + 'px" alt="">' +
      '<img class="sl-band" src="' + bandSrc + '" style="height:' + bandH + 'px" alt="">';''', '帯の差し替え')

# ④ 画像データ
for key, fname in [('__RLGOLD__','reels_gold.webp'),('__RLRED__','reels_red.webp'),
                   ('__RLICE__','reels_ice.webp'),('__RLNOIR__','reels_noir2.webp')]:
    rep('"' + key + '"', '"' + uri(fname) + '"', key)

open(p, 'w', encoding='utf8').write(s)
print('DONE')
