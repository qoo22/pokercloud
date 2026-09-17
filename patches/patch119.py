# -*- coding: utf-8 -*-
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

# ① bacBuildFace を DOM版 → SVG版へ丸ごと差し替え
old_face = '''  /** カードの表面を作る。rank>=11 は四隅ピップ+中央枠(数字は絞り中は隠す側で制御) */
  function bacBuildFace(el, rank, suitIdx) {
    var su = BAC_SUITS[suitIdx];
    el.innerHTML = "";
    var cells = rank >= 11 ? BAC_FACE_CELLS : BAC_CELLS[rank];
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i][0], rw = cells[i][1];
      var d = document.createElement("div");
      d.className = "bac-pip " + su.k;
      d.style.left = (BAC_COLS[c] * 100) + "%";
      d.style.top = (BAC_ROWS[rw] * 100) + "%";
      d.style.transform = "translate(-50%,-50%)" + (BAC_ROWS[rw] > 0.55 ? " rotate(180deg)" : "");
      d.textContent = su.c;
      el.appendChild(d);
    }
    if (rank >= 11) {
      var fp = document.createElement("div");
      fp.className = "bac-fpanel";
      fp.style.color = su.k === "r" ? "#c0342b" : "#0a0d0c";
      fp.textContent = bacRankLabel(rank);
      el.appendChild(fp);
    }
  }'''
new_face = '''  /**
   * カードの表面(SVG)。CARD-DESIGN-PROMPT.md の仕様に沿う:
   * ・スートはフォントではなく <path>(OS差・絵文字化を防ぐ)
   * ・下半分のピップは180°回転(実カードの上下対称)
   * ・絵札(J/Q/K)は生成画像の双頭構成+二重罫の内枠
   * ・showIndex=true のときだけコーナーに**大きな**ランク+スート
   *   (絞り中は出さない=答えの数字が先に見えない。卓上では視認性優先で大きく)
   */
  var BAC_SPATH = [
    "M12 2 C12 2 4 9.2 4 13.6 C4 16.4 6.1 18.3 8.4 18.3 C9.6 18.3 10.6 17.8 11.2 17 L10.2 21.6 L13.8 21.6 L12.8 17 C13.4 17.8 14.4 18.3 15.6 18.3 C17.9 18.3 20 16.4 20 13.6 C20 9.2 12 2 12 2 Z",
    "M12 21.4 C12 21.4 3 15.3 3 9.3 C3 6.2 5.3 4 8.1 4 C9.9 4 11.2 5 12 6.3 C12.8 5 14.1 4 15.9 4 C18.7 4 21 6.2 21 9.3 C21 15.3 12 21.4 12 21.4 Z",
    "M12 2 L20 12 L12 22 L4 12 Z",
    "M12 2.6 C9.9 2.6 8.2 4.3 8.2 6.4 C8.2 7.2 8.4 7.9 8.8 8.4 C8.3 8.2 7.8 8.1 7.2 8.1 C5.1 8.1 3.4 9.8 3.4 11.9 C3.4 14 5.1 15.7 7.2 15.7 C8.6 15.7 9.8 15 10.4 13.9 L10.2 21.6 L13.8 21.6 L13.6 13.9 C14.2 15 15.4 15.7 16.8 15.7 C18.9 15.7 20.6 14 20.6 11.9 C20.6 9.8 18.9 8.1 16.8 8.1 C16.2 8.1 15.7 8.2 15.2 8.4 C15.6 7.9 15.8 7.2 15.8 6.4 C15.8 4.3 14.1 2.6 12 2.6 Z"
  ];
  var BAC_COURT = { 11: "__JACK__", 12: "__QUEEN__", 13: "__KING__" };
  var bacSvgSeq = 0;
  function bacBuildFace(el, rank, suitIdx, showIndex) {
    var red = suitIdx === 1 || suitIdx === 2;
    var ink = red ? "#c0342b" : "#131313";
    var sp = BAC_SPATH[suitIdx];
    var pip = function (cx, cy, size, flip) {
      return '<path d="' + sp + '" fill="' + ink + '" transform="translate(' + cx + " " + cy + ") rotate(" + (flip ? 180 : 0) + ") scale(" + (size / 24).toFixed(3) + ') translate(-12 -12)"/>';
    };
    var body = "";
    if (rank >= 11 && showIndex) {
      // 絵札(表向き): 二重罫の内枠 + 双頭の人物画(生成PNG)。枠色でスートの赤黒を示す
      var cid = "bacc" + (++bacSvgSeq);
      var im = BAC_COURT[rank];
      body +=
        '<defs><clipPath id="' + cid + '"><rect x="53" y="57" width="144" height="117"/></clipPath></defs>' +
        '<rect x="46" y="50" width="158" height="250" rx="4" fill="none" stroke="' + ink + '" stroke-width="2"/>' +
        '<rect x="50" y="54" width="150" height="242" rx="3" fill="none" stroke="#d9b45f" stroke-width="1"/>' +
        '<line x1="50" y1="175" x2="200" y2="175" stroke="#d9b45f" stroke-width="1"/>' +
        '<image href="' + im + '" x="53" y="55" width="144" height="130" preserveAspectRatio="xMidYMin meet" clip-path="url(#' + cid + ')"/>' +
        '<g transform="rotate(180 125 175)"><image href="' + im + '" x="53" y="55" width="144" height="130" preserveAspectRatio="xMidYMin meet" clip-path="url(#' + cid + ')"/></g>';
    } else {
      // 数札 / 絞り中の絵札。絞り中の絵札は四隅ピップだけにして、
      // 候補絞り込み(bacSig)が見ている情報と画面が完全に一致するようにする
      var cells = rank >= 11 ? BAC_FACE_CELLS : BAC_CELLS[rank];
      var size = rank === 1 ? 66 : 34;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i][0], rw = cells[i][1];
        body += pip(BAC_COLS[c] * 250, BAC_ROWS[rw] * 350, size, BAC_ROWS[rw] > 0.55);
      }
    }
    if (showIndex) {
      // 大きなコーナーインデックス(オーナー指定: 卓上の視認性優先)
      var isTen = rank === 10;
      var fs = isTen ? 40 : 60;
      var idx =
        '<g class="bac-idx">' +
        '<text x="29" y="55" text-anchor="middle" font-family="-apple-system,Inter,Helvetica,sans-serif" font-weight="800" font-size="' + fs + '"' + (isTen ? ' letter-spacing="-3"' : "") + ' fill="' + ink + '">' + bacRankLabel(rank) + "</text>" +
        pip(29, 82, 30, false) +
        "</g>";
      body += idx + '<g transform="rotate(180 125 175)">' + idx + "</g>";
    }
    el.innerHTML =
      '<svg viewBox="0 0 250 350" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="0" y="0" width="250" height="350" rx="16" fill="#f6f4ec"/>' +
      '<rect x="1.5" y="1.5" width="247" height="347" rx="14.5" fill="none" stroke="#e0dacb" stroke-width="1"/>' +
      body + "</svg>";
  }'''
rep(old_face, new_face, 'bacBuildFace SVG化')

# ② 卓上のカードはインデックス付きで開く(配札時のフリップ)
rep('''      bacBuildFace(f2, arr2[o2.i].r, arr2[o2.i].s);
      el2.appendChild(f2);''',
'''      bacBuildFace(f2, arr2[o2.i].r, arr2[o2.i].s, true);
      el2.appendChild(f2);''', 'フリップにインデックス')

# ③ 絞り後の卓上リビールもインデックス付き
rep('''    bacBuildFace(f3, card.r, card.s); el3.appendChild(f3);''',
'''    bacBuildFace(f3, card.r, card.s, true); el3.appendChild(f3);''', 'リビールにインデックス')

# ④ 絞り切った瞬間: 大カードにインデックスをフェードインで出してから卓へ戻す
#    (squeeze-prototype.html の indexMask 仕様: 開き切るまで数字を出さない)
rep('''    bacBlip(1046, 0.14, "triangle", 0.2);
    setTimeout(() => bacBlip(1568, 0.2, "triangle", 0.16), 70);
    setTimeout(() => {
      document.getElementById("bac-stage").classList.remove("on");
      var done = bacSqDone; bacSqDone = null;
      if (done) done();
    }, 240);''',
'''    bacBlip(1046, 0.14, "triangle", 0.2);
    setTimeout(() => bacBlip(1568, 0.2, "triangle", 0.16), 70);
    // 開き切った瞬間にだけコーナーの数字を出す(絞り中は最後まで見せない)
    var card2 = (bacSqSlot.s === "p" ? bacSqHand.p : bacSqHand.b)[bacSqSlot.i];
    var bf = document.getElementById("bac-bigface");
    bacBuildFace(bf, card2.r, card2.s, true);
    bf.querySelectorAll(".bac-idx").forEach((g) => {
      g.style.opacity = "0"; g.style.transition = "opacity .3s";
    });
    setTimeout(() => bf.querySelectorAll(".bac-idx").forEach((g) => { g.style.opacity = "1"; }), 40);
    setTimeout(() => {
      document.getElementById("bac-stage").classList.remove("on");
      var done = bacSqDone; bacSqDone = null;
      if (done) done();
    }, 1000);''', '開いた瞬間のインデックス')

# ⑤ カード裏をオーナー提供の card-back.png(透過・角丸済み)へ差し替え
start = s.index('.bac-back{position:absolute;inset:0;border-radius:6px;')
head = 'background:url('
i0 = s.index(head, start) + len(head)
i1 = s.index(') center/cover no-repeat #0d3628;', i0)
s = s[:i0] + uri('back2.webp') + s[i1:]
print('OK 裏面差し替え')

# ⑥ 絵札の実画像を流し込む
rep('"__JACK__"', '"' + uri('jack.webp') + '"', 'jack画像')
rep('"__QUEEN__"', '"' + uri('queen.webp') + '"', 'queen画像')
rep('"__KING__"', '"' + uri('king.webp') + '"', 'king画像')

# ⑦ 面はSVGが描くので下地は透過に。旧DOMピップのCSSは撤去
rep('''  .bac-face{position:absolute;inset:0;background:#f7f4ec;border-radius:6px}
  .bac-pip{position:absolute;font-size:15px;line-height:1;font-weight:700}
  .bac-pip.r{color:#c0342b}.bac-pip.b{color:#0a0d0c}
  .bac-fpanel{position:absolute;left:22%;right:22%;top:26%;bottom:26%;border-radius:4px;
    border:1.6px solid currentColor;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px}''',
'''  .bac-face{position:absolute;inset:0;border-radius:6px}
  .bac-face svg{display:block}''', '面CSS整理')
rep('''  .bac-bigcard .bac-pip{font-size:min(7.6vw,30px)}
  .bac-bigcard .bac-fpanel{font-size:min(11vw,44px)}
''', '', '大カードの旧CSS撤去')

open(p, 'w', encoding='utf8').write(s)
