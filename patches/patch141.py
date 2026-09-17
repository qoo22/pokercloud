# -*- coding: utf-8 -*-
# 第141弾: 斜め(角)絞り。角から対角線状にめくれ、中央ピップの「出るか・抜けるか」を楽しめる。
# 正直さの不変条件は維持: 見えている範囲 == bacSig が候補絞りに使う範囲(対角線の式も同一)
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 方向ボタンに「斜め絞り」を追加
rep('''      <button class="bac-dir on" data-d="h">横絞り</button>
      <button class="bac-dir" data-d="v">縦絞り</button>''',
'''      <button class="bac-dir on" data-d="h">横絞り</button>
      <button class="bac-dir" data-d="v">縦絞り</button>
      <button class="bac-dir" data-d="d">斜め絞り</button>''', '斜めボタン')

rep('''  var bacDir = "h";               // 絞り方向 'h'=横 'v'=縦''',
'''  var bacDir = "h";               // 絞り方向 'h'=横 'v'=縦 'd'=斜め(角)''', 'コメント')

# ② めくれ縁(curl)の斜め版CSS。中点に置いて45°回す
rep('''  .bac-curl.v{left:0;right:0;height:20px;
    background:linear-gradient(0deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.18) 32%,rgba(255,255,255,.42) 62%,rgba(23,58,40,.9) 100%)}''',
'''  .bac-curl.v{left:0;right:0;height:20px;
    background:linear-gradient(0deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.18) 32%,rgba(255,255,255,.42) 62%,rgba(23,58,40,.9) 100%)}
  .bac-curl.d{width:20px;height:150%;transform:translate(-50%,-50%) rotate(45deg);
    background:linear-gradient(90deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.18) 32%,rgba(255,255,255,.42) 62%,rgba(23,58,40,.9) 100%)}''', '斜めcurl CSS')

# ③ 斜めのめくり描画(左下の角から対角線で開く)。clip-pathをポリゴンで切る
rep('''    if (bacDir === "h") {
      cover.style.clipPath = "inset(0 0 0 " + pct + "%)";
      curl.className = "bac-curl h";
      curl.style.left = "calc(" + pct + "% - 10px)"; curl.style.bottom = "";
    } else {
      cover.style.clipPath = "inset(0 0 " + pct + "% 0)";
      curl.className = "bac-curl v";
      curl.style.bottom = "calc(" + pct + "% - 10px)"; curl.style.left = "";
    }''',
'''    if (bacDir === "h") {
      cover.style.clipPath = "inset(0 0 0 " + pct + "%)";
      curl.className = "bac-curl h";
      curl.style.left = "calc(" + pct + "% - 10px)"; curl.style.bottom = ""; curl.style.top = "";
    } else if (bacDir === "v") {
      cover.style.clipPath = "inset(0 0 " + pct + "% 0)";
      curl.className = "bac-curl v";
      curl.style.bottom = "calc(" + pct + "% - 10px)"; curl.style.left = ""; curl.style.top = "";
    } else {
      // 斜め: 左下の角から「x + (1-y) <= 2*rev」の三角形が開いていく。
      // カバー(裏面)は残り領域をポリゴンで切る。t<=1 は角の三角、t>1 は右上の三角だけ残る
      var t = bacRev * 2;
      var poly;
      if (t <= 1) {
        poly = "polygon(0% 0%, 100% 0%, 100% 100%, " + (t * 100).toFixed(2) + "% 100%, 0% " + ((1 - t) * 100).toFixed(2) + "%)";
      } else {
        poly = "polygon(" + ((t - 1) * 100).toFixed(2) + "% 0%, 100% 0%, 100% " + ((2 - t) * 100).toFixed(2) + "%)";
      }
      cover.style.clipPath = poly;
      curl.className = "bac-curl d";
      // めくれ縁は開き線の中点(どちらの場合も (t/2, 1-t/2))
      curl.style.left = (t / 2 * 100).toFixed(2) + "%";
      curl.style.top = ((1 - t / 2) * 100).toFixed(2) + "%";
      curl.style.bottom = "";
    }''', '斜めクリップ描画')

# ④ 署名(候補絞り)も同じ対角線の式で。見た目と完全一致が絶対条件
rep('''      // 絵札は内枠の縁(横絞り: x=46/250、縦絞り: y=300/350)が見えた瞬間に
      // 「絵札だ」と分かる(画面の見た目と完全に同じ条件で候補を割る)
      var vis = dir === "h" ? rev >= 0.184 : rev >= 0.143;
      return vis ? "COURT" : "";''',
'''      // 絵札は内枠の縁が見えた瞬間に「絵札だ」と分かる(画面の見た目と完全に同じ条件)。
      // 横: x=46/250 / 縦: y=300/350 / 斜め: 内枠の左下角(0.184, 0.857) → (0.184+0.143)/2
      var vis = dir === "h" ? rev >= 0.184 : dir === "v" ? rev >= 0.143 : rev >= 0.1635;
      return vis ? "COURT" : "";''', '絵札の斜め署名')

rep('''      var vis = dir === "h" ? (BAC_COLS[c] <= rev) : (BAC_ROWS[rw] >= 1 - rev);''',
'''      var vis = dir === "h" ? (BAC_COLS[c] <= rev)
        : dir === "v" ? (BAC_ROWS[rw] >= 1 - rev)
        : ((BAC_COLS[c] + 1 - BAC_ROWS[rw]) / 2 <= rev);''', 'ピップの斜め署名')

# ⑤ 指の動きの対角射影(左下→右上へなぞる)。行程はカードの対角線長
rep('''      bacStartPt = bacDir === "h" ? e.clientX : -e.clientY;''',
'''      bacStartPt = bacDir === "h" ? e.clientX : bacDir === "v" ? -e.clientY : (e.clientX - e.clientY) * 0.7071;''', '斜めstartPt')

rep('''      var size = bacDir === "h" ? rc.width : rc.height;
      var pt = bacDir === "h" ? e.clientX : -e.clientY;''',
'''      var size = bacDir === "h" ? rc.width : bacDir === "v" ? rc.height : Math.hypot(rc.width, rc.height);
      var pt = bacDir === "h" ? e.clientX : bacDir === "v" ? -e.clientY : (e.clientX - e.clientY) * 0.7071;''', '斜めpt/size')

# ⑥ ヒント文言
rep('''        if (h) h.textContent = bacDir === "h" ? "→ 右へなぞって絞る" : "↑ 上へなぞって絞る";''',
'''        if (h) h.textContent = bacDir === "h" ? "→ 右へなぞって絞る" : bacDir === "v" ? "↑ 上へなぞって絞る" : "↗ 角から斜めになぞって絞る";''', '切替ヒント')

rep('''      h.textContent = (bacDir === "h" ? "→ ゆっくりなぞって絞る" : "↑ ゆっくりなぞって絞る") + "(真ん中で止まる。奥までスライドで全開放)";''',
'''      h.textContent = (bacDir === "h" ? "→ ゆっくりなぞって絞る" : bacDir === "v" ? "↑ ゆっくりなぞって絞る" : "↗ 角からゆっくりなぞって絞る") + "(真ん中で止まる。奥までスライドで全開放)";''', '初期ヒント')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
