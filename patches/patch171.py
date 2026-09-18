# -*- coding: utf-8 -*-
# 第171弾: ジョーカーをオーナー提供の本物の絵柄に差し替える
import sys, base64, re
p, webp = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf8').read()
B64 = base64.b64encode(open(webp, 'rb').read()).decode()

def rep(old, new, name, n=1):
    global s
    assert s.count(old) == n, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 画像そのものの差し替え
m = re.search(r'var TN_IMG = \{joker: "(data:image/[a-z]+;base64,[A-Za-z0-9+/=]+)"', s)
assert m, 'ジョーカーの画像が見つからない'
old_uri = m.group(1)
print(f'  旧 {len(old_uri):,} 文字 → 新 {len(B64) + 24:,} 文字')
s = s.replace(old_uri, 'data:image/webp;base64,' + B64, 1)
print('OK 画像')

# ② 回転中の帯にも絵柄のクラスを付ける。
#    付けないと、回っている間だけジョーカーに正方形用の引き伸ばしが当たって顔が歪む
rep('''return "<div>" + (TN_IMG[sy] ? '<img src="' + TN_IMG[sy] + '" alt="">' : "") + "</div>";''',
    '''return '<div class="s-' + sy + '">' + (TN_IMG[sy] ? '<img src="' + TN_IMG[sy] + '" alt="">' : "") + "</div>";''',
    '帯のクラス', n=2)

# ③ 戻り演出の帯にも同じく
rep('''      '<div class="tn-revstrip" id="tn-revstrip">' +
      '<div>' + (TN_IMG[top] ? '<img src="' + TN_IMG[top] + '" alt="">' : "") + "</div>" +
      '<div><img src="' + TN_IMG[mid] + '" alt=""></div>' +
      '<div>' + (TN_IMG[bot] ? '<img src="' + TN_IMG[bot] + '" alt="">' : "") + "</div>" +''',
    '''      '<div class="tn-revstrip" id="tn-revstrip">' +
      '<div class="s-' + top + '">' + (TN_IMG[top] ? '<img src="' + TN_IMG[top] + '" alt="">' : "") + "</div>" +
      '<div class="s-' + mid + '"><img src="' + TN_IMG[mid] + '" alt=""></div>' +
      '<div class="s-' + bot + '">' + (TN_IMG[bot] ? '<img src="' + TN_IMG[bot] + '" alt="">' : "") + "</div>" +''',
    '戻り演出のクラス')

# ④ ジョーカーだけは窓いっぱいに敷く
rep("  .tn-cell.s-joker img{width:98%;height:99%}",
"""  /* ジョーカーだけは**窓と同じ 150:78 で描かれた本物の絵**(第171弾)。
     正方形素材のための横伸ばしは当てず、窓いっぱいに敷く。
     中央に止まればフリー確定の特別な絵柄なので、他と格が違って見えてよい */
  .tn-cell.s-joker img,
  .tn-strip div.s-joker img,
  .tn-revstrip div.s-joker img{width:100%;height:100%;object-fit:cover;transform:none}""",
    'ジョーカーの敷き方')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
