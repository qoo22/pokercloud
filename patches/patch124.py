# -*- coding: utf-8 -*-
import sys, base64, os, re
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

# ① CSS: 直書きの内観URL → var(--bac-room)。既定は新しいスロットフロア。
#    旧ホール画像は JS(BAC_ROOMS.hall) へ移す
m = re.search(r'(#bac-root\{[^}]*?)url\((data:image/webp;base64,[^)]+)\) center 30%/cover no-repeat #10151c;', s)
assert m, 'room url not found'
hall = m.group(2)
s = s[:m.start()] + m.group(1) + 'var(--bac-room) center 30%/cover no-repeat #10151c;' + s[m.end():]
print('OK CSS→変数')

# ② JS: 背景プール(5種)とデザイン適用
rep('''  var BAC_BKS = { classic: "''',
'''  /** 裏側の背景(カジノ内観)。Z-Image生成の5種から選べる */
  var BAC_ROOMS = { floor: "__RFLOOR__", vip: "__RVIP__", neon: "__RNEON__", grand: "__RGRAND__", hall: "__RHALL__" };
  var BAC_BKS = { classic: "''', '背景プール')

rep('''    var tk = "green", bk = "classic";
    try { tk = localStorage.getItem("bacTbl") || tk; bk = localStorage.getItem("bacBack") || bk; } catch (e) {}
    if (!BAC_TBLS[tk]) tk = "green";
    if (!BAC_BKS[bk]) bk = "classic";
    host.style.setProperty("--bac-tbl", 'url("' + BAC_TBLS[tk] + '")');
    host.style.setProperty("--bac-back", 'url("' + BAC_BKS[bk] + '")');
    document.querySelectorAll(".bac-sw[data-tbl]").forEach((b) => b.classList.toggle("on", b.dataset.tbl === tk));
    document.querySelectorAll(".bac-sw[data-bk]").forEach((b) => b.classList.toggle("on", b.dataset.bk === bk));''',
'''    var tk = "green", bk = "classic", rm = "floor";
    try {
      tk = localStorage.getItem("bacTbl") || tk;
      bk = localStorage.getItem("bacBack") || bk;
      rm = localStorage.getItem("bacRoom") || rm;
    } catch (e) {}
    if (!BAC_TBLS[tk]) tk = "green";
    if (!BAC_BKS[bk]) bk = "classic";
    if (!BAC_ROOMS[rm]) rm = "floor";
    host.style.setProperty("--bac-tbl", 'url("' + BAC_TBLS[tk] + '")');
    host.style.setProperty("--bac-back", 'url("' + BAC_BKS[bk] + '")');
    host.style.setProperty("--bac-room", 'url("' + BAC_ROOMS[rm] + '")');
    document.querySelectorAll(".bac-sw[data-tbl]").forEach((b) => b.classList.toggle("on", b.dataset.tbl === tk));
    document.querySelectorAll(".bac-sw[data-bk]").forEach((b) => b.classList.toggle("on", b.dataset.bk === bk));
    document.querySelectorAll(".bac-sw[data-room]").forEach((b) => b.classList.toggle("on", b.dataset.room === rm));''', 'デザイン適用に背景')

# ③ テンプレート: 背景スワッチ行
rep('''    <span>カード</span>
    <button class="bac-sw bk" data-bk="classic"></button><button class="bac-sw bk" data-bk="red"></button>
    <button class="bac-sw bk" data-bk="blue"></button><button class="bac-sw bk" data-bk="noir"></button>
  </div>''',
'''    <span>カード</span>
    <button class="bac-sw bk" data-bk="classic"></button><button class="bac-sw bk" data-bk="red"></button>
    <button class="bac-sw bk" data-bk="blue"></button><button class="bac-sw bk" data-bk="noir"></button>
    <span>背景</span>
    <button class="bac-sw" data-room="floor"></button><button class="bac-sw" data-room="vip"></button>
    <button class="bac-sw" data-room="neon"></button><button class="bac-sw" data-room="grand"></button>
    <button class="bac-sw" data-room="hall"></button>
  </div>''', '背景スワッチ')

# ④ 配線: クリック保存とサムネイル
rep('''      try {
        if (b.dataset.tbl) localStorage.setItem("bacTbl", b.dataset.tbl);
        if (b.dataset.bk) localStorage.setItem("bacBack", b.dataset.bk);
      } catch (e2) {}''',
'''      try {
        if (b.dataset.tbl) localStorage.setItem("bacTbl", b.dataset.tbl);
        if (b.dataset.bk) localStorage.setItem("bacBack", b.dataset.bk);
        if (b.dataset.room) localStorage.setItem("bacRoom", b.dataset.room);
      } catch (e2) {}''', '保存')

rep('''    document.querySelectorAll(".bac-sw[data-bk]").forEach((b) => {
      b.style.backgroundImage = 'url("' + BAC_BKS[b.dataset.bk] + '")';
    });''',
'''    document.querySelectorAll(".bac-sw[data-bk]").forEach((b) => {
      b.style.backgroundImage = 'url("' + BAC_BKS[b.dataset.bk] + '")';
    });
    document.querySelectorAll(".bac-sw[data-room]").forEach((b) => {
      b.style.backgroundImage = 'url("' + BAC_ROOMS[b.dataset.room] + '")';
    });''', 'サムネイル')

# ⑤ 画像データ
rep('"__RFLOOR__"', '"' + uri('room_floor.webp') + '"', 'floor')
rep('"__RVIP__"', '"' + uri('room_vip.webp') + '"', 'vip')
rep('"__RNEON__"', '"' + uri('room_neon.webp') + '"', 'neon')
rep('"__RGRAND__"', '"' + uri('room_grand.webp') + '"', 'grand')
rep('"__RHALL__"', '"' + hall + '"', 'hall(旧)')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
