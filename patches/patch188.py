# -*- coding: utf-8 -*-
# 第188弾: WINNING TUNNEL のジョーカーを、紋章を切らずに枠へ収める
import sys, base64, re
p, still, sheet = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf8').read()
STILL = base64.b64encode(open(still, 'rb').read()).decode()
SHEET = base64.b64encode(open(sheet, 'rb').read()).decode()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 静止画と帯を「切らない版」に差し替え
m = re.search(r'var TN_IMG = \{joker: "(data:image/[a-z]+;base64,[A-Za-z0-9+/=]+)"', s)
assert m
s = s.replace(m.group(1), 'data:image/webp;base64,' + STILL, 1)
print('OK 静止画')
m2 = re.search(r'var TN_JOKER_SHEET = "(data:image/webp;base64,[A-Za-z0-9+/=]+)"', s)
assert m2
s = s.replace(m2.group(1), 'data:image/webp;base64,' + SHEET, 1)
print('OK 帯')

# ② cover(はみ出しを切る) をやめて contain(全体を収める) に
rep("""  .tn-cell.s-joker img,
  .tn-strip div.s-joker img,
  .tn-revstrip div.s-joker img{width:100%;height:100%;object-fit:cover;transform:none}""",
"""  /* ジョーカーは**紋章を切らずに全体を収める**(第188弾)。
     以前は cover で窓いっぱいに敷いていたので、金の飾り枠が両端で
     断ち切られて不自然だった。紋章は 1.82:1 で窓(1.92:1)とほぼ同じ比率なので、
     contain にすれば左右にわずかな余白が出るだけで、何も切れない */
  .tn-cell.s-joker img,
  .tn-strip div.s-joker img,
  .tn-revstrip div.s-joker img{width:100%;height:100%;object-fit:contain;transform:none}
  /* 動く帯も同じ扱い(cover だと同じところが切れる) */
  .tn-jokeranim{background-size:800% 100%;background-position:0 0}""", '切らずに収める')

# ③ 絵に WILD と書いてあるので、重ねる WILD タグは消す。中央の TUNNEL は残す
rep("""      (tag ? '<span class="tn-tag px ' + tag + '">' + (tag === "tunnel" ? "TUNNEL" : "WILD") + "</span>" : "") +""",
"""      // 絵柄そのものに WILD と描かれているので、重ねる WILD タグは出さない(第188弾)。
      // 中央の TUNNEL は「ここに止まればフリー」という別の意味なので残す
      (tag === "tunnel" ? '<span class="tn-tag px tunnel">TUNNEL</span>' : "") +""", 'WILDタグを外す')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
