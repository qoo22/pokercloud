"""
assets-src/ の画像を圧縮して、client/assets.ts に data URI として埋め込む。

  npm run assets:build           … assets-src/ の画像を取り込む
  npm run assets -- <URL...>     … 取り込み + 変換をまとめて実行

方針：
  - 表示サイズに対して過剰な解像度は持たせない。カード裏面は実表示 30〜62px なので 220px あれば十分
  - 白フチは自動で切り落とす（生成画像はキャンバスに余白が入りがち）
  - 単一 HTML で配布したいので data URI にする。外部ファイルを増やすと配布が壊れやすい
"""
from PIL import Image
import base64, io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'assets-src')
OUT = os.path.join(HERE, '..', 'client', 'assets.ts')

# 拡張子は取り込み時の content-type で決まるので、あるものを拾う
def find(basename):
    for ext in ('webp', 'png', 'jpg', 'jpeg'):
        p = os.path.join(SRC, f'{basename}.{ext}')
        if os.path.exists(p):
            return p
    raise SystemExit(
        f'{basename} が assets-src/ にありません。\n'
        f'  npm run assets:fetch -- <URL...>  で取り込んでください。'
    )


def trim_border(im, tol=18):
    """周囲の明るい余白を切り落とす。生成画像の白フチ対策"""
    rgb = im.convert('RGB')
    w, h = rgb.size
    px = rgb.load()

    def is_bg(x, y):
        r, g, b = px[x, y]
        return r > 255 - tol and g > 255 - tol and b > 255 - tol

    left = 0
    while left < w // 2 and all(is_bg(left, y) for y in range(0, h, max(1, h // 40))):
        left += 1
    right = w - 1
    while right > w // 2 and all(is_bg(right, y) for y in range(0, h, max(1, h // 40))):
        right -= 1
    top = 0
    while top < h // 2 and all(is_bg(x, top) for x in range(0, w, max(1, w // 40))):
        top += 1
    bottom = h - 1
    while bottom > h // 2 and all(is_bg(x, bottom) for x in range(0, w, max(1, w // 40))):
        bottom -= 1
    if right - left < 32 or bottom - top < 32:
        return im
    return im.crop((left, top, right + 1, bottom + 1))


def make_seamless(im):
    """
    4 分割を入れ替えて継ぎ目を中央に寄せ、そこをぼかして繋ぐ。
    フェルトのような等方的なノイズならこれで十分に自然なタイルになる。
    継ぎ目対策をしないと、卓一面に敷いたときに格子状の線が見えてしまう。
    """
    from PIL import ImageFilter
    w, h = im.size
    hw, hh = w // 2, h // 2
    out = Image.new('RGB', (w, h))
    out.paste(im.crop((hw, hh, w, h)), (0, 0))
    out.paste(im.crop((0, hh, hw, h)), (hw, 0))
    out.paste(im.crop((hw, 0, w, hh)), (0, hh))
    out.paste(im.crop((0, 0, hw, hh)), (hw, hh))

    blurred = out.filter(ImageFilter.GaussianBlur(6))
    mask = Image.new('L', (w, h), 0)
    band = max(6, w // 40)
    for x in range(w):
        for y in range(h):
            pass
    # 十字の継ぎ目だけをぼかしでブレンドする
    from PIL import ImageDraw
    d = ImageDraw.Draw(mask)
    d.rectangle([hw - band, 0, hw + band, h], fill=255)
    d.rectangle([0, hh - band, w, hh + band], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(band / 2))
    return Image.composite(blurred, out, mask)


def encode(im, size, quality, seamless=False):
    im = im.convert('RGB')
    if seamless:
        im = make_seamless(im)
    im = im.resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format='WEBP', quality=quality, method=6)
    data = buf.getvalue()
    return f'data:image/webp;base64,{base64.b64encode(data).decode()}', len(data)


jobs = [
    # (素材名, 変数名, 出力サイズ, 品質, 余白除去, シームレス化)
    ('card-back-classic', 'CARD_BACK_CLASSIC', (220, 300), 72, True, False),
    ('card-back-neon', 'CARD_BACK_NEON', (220, 300), 72, True, False),
    ('felt', 'FELT_TEXTURE', (384, 384), 62, False, True),
]

lines = [
    '/**',
    ' * 画像アセット（自動生成 — scripts/build-assets.py で作られます。手で編集しないこと）',
    ' *',
    ' * 単一 HTML で配布したいので data URI にしてあります。',
    ' * 表示サイズに対して過剰な解像度は持たせていません（カード裏面は実表示 30〜62px）。',
    ' */',
    '',
]
total = 0
for src, name, size, q, trim, seam in jobs:
    im = Image.open(find(src))
    if trim:
        im = trim_border(im)
    uri, nbytes = encode(im, size, q, seam)
    total += nbytes
    lines.append(f'/** {size[0]}x{size[1]} / {nbytes // 1024} KB */')
    lines.append(f"export const {name} = '{uri}';")
    lines.append('')
    print(f'{name}: {nbytes // 1024} KB ({size[0]}x{size[1]})', file=sys.stderr)

open(OUT, 'w').write('\n'.join(lines))
print(f'合計 {total // 1024} KB → {OUT}', file=sys.stderr)
