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

# ① 卓プールを白背景生成の6卓に総入れ替え(第140弾)
#    旧pt_*は透過失敗(背景の黒塊残り・縁の食われ)があった。白背景+影なし指定で
#    生成し直したので切り抜きが安定。キーは旧pgreen/pred/pnoirを残し4色追加
i0 = s.index('var BAC_TBLS = {')
i1 = s.index('};', i0) + 2
s = s[:i0] + ('var BAC_TBLS = { pgreen: "__PT2G__", pred: "__PT2R__", pnoir: "__PT2N__", '
              'pblue: "__PT2B__", ppurple: "__PT2P__", pteal: "__PT2T__" };') + s[i1:]
print('OK 卓プール6色へ差し替え')

# ② スワッチ6色に
rep('''      <button class="bac-sw" data-tbl="pgreen"></button><button class="bac-sw" data-tbl="pred"></button>''',
'''      <button class="bac-sw" data-tbl="pgreen"></button><button class="bac-sw" data-tbl="pred"></button>
      <button class="bac-sw" data-tbl="pnoir"></button><button class="bac-sw" data-tbl="pblue"></button>
      <button class="bac-sw" data-tbl="ppurple"></button><button class="bac-sw" data-tbl="pteal"></button>''', 'スワッチ6色')

# ③ 画像データ
for key, fname in [('__PT2G__','pt2_green.webp'),('__PT2R__','pt2_red.webp'),('__PT2N__','pt2_noir.webp'),
                   ('__PT2B__','pt2_blue.webp'),('__PT2P__','pt2_purple.webp'),('__PT2T__','pt2_teal.webp')]:
    rep('"' + key + '"', '"' + uri(fname) + '"', key)

open(p, 'w', encoding='utf8').write(s)
print('DONE')
