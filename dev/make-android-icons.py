# -*- coding: utf-8 -*-
"""
生成安卓图标与启动图（品牌：清笺课程表 / 青绿山水渐变 石青→石绿→嫩绿 + 白色日历勾选图标）
用法：python dev/make-android-icons.py
"""
import os, math
from PIL import Image, ImageDraw, ImageFont

RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'android-app', 'android',
                   'app', 'src', 'main', 'res')
RES = os.path.abspath(RES)

C1 = (11, 143, 134)    # #0b8f86 石青（青绿山水）
C2 = (39, 185, 139)    # #27b98b 石绿
C3 = (142, 208, 106)   # #8ed06a 嫩绿
FONT_BOLD = r'C:\Windows\Fonts\msyhbd.ttc'
FONT_REG = r'C:\Windows\Fonts\msyh.ttc'
SS = 4                 # 超采样倍数


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def grad_color(t):
    """三段渐变：0→C1, 0.5→C2, 1→C3"""
    t = max(0.0, min(1.0, t))
    return lerp(C1, C2, t / 0.5) if t <= 0.5 else lerp(C2, C3, (t - 0.5) / 0.5)


def make_gradient(size, diag=True, base_size=256):
    """生成对角线性渐变图（先小后放大，快且平滑）"""
    n = base_size
    small = Image.new('RGB', (n, n))
    px = small.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1)) if diag else y / (n - 1)
            px[x, y] = grad_color(t)
    return small.resize((size, size), Image.BICUBIC)


def draw_glyph(d, box, s):
    """在 box=(x0,y0,x1,y1) 内画白色日历+勾，s=线宽系数（基准 1.0 约等于 box 宽度的 8.5%）"""
    x0, y0, x1, y1 = box
    w = x1 - x0
    h = y1 - y0
    lw = max(1, int(round(w * 0.085 * s)))

    def P(u, v):
        return (x0 + u * w, y0 + v * h)

    # ① 顶部实心横条（日历头）
    d.rounded_rectangle([P(0.05, 0.13), P(0.95, 0.375)], radius=w * 0.10, fill=(255, 255, 255))
    # ② 外框描边
    d.rounded_rectangle([P(0.05, 0.13), P(0.95, 0.99)], radius=w * 0.18,
                        outline=(255, 255, 255), width=lw)
    # ③ 里面的勾
    pts = [P(0.28, 0.685), P(0.445, 0.845), P(0.755, 0.50)]
    d.line(pts, fill=(255, 255, 255), width=lw, joint='curve')
    # 端点补圆，避免尖角
    r = lw / 2.0
    for (cx, cy) in (pts[0], pts[-1]):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255))


def icon_square(size, radius_ratio=0.235):
    """完整方形图标（带圆角渐变底 + 白图标）"""
    S = size * SS
    img = make_gradient(S)
    img = img.convert('RGBA')

    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=S * radius_ratio, fill=255)
    img.putalpha(mask)

    d = ImageDraw.Draw(img)
    inset = 0.255
    draw_glyph(d, (S * inset, S * inset, S * (1 - inset), S * (1 - inset)), 1.0)
    return img.resize((size, size), Image.LANCZOS)


def icon_round(size):
    """圆形图标"""
    S = size * SS
    img = make_gradient(S).convert('RGBA')
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, S - 1, S - 1], fill=255)
    img.putalpha(mask)
    d = ImageDraw.Draw(img)
    inset = 0.27
    draw_glyph(d, (S * inset, S * inset, S * (1 - inset), S * (1 - inset)), 1.0)
    return img.resize((size, size), Image.LANCZOS)


def icon_foreground(size):
    """自适应图标前景：透明底 + 白图标（内容收在安全区 72/108 内）"""
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inset = (1 - 72.0 / 108 * 0.86) / 2      # 留出安全边距
    draw_glyph(d, (S * inset, S * inset, S * (1 - inset), S * (1 - inset)), 1.06)
    return img.resize((size, size), Image.LANCZOS)


def splash(w, h):
    """启动图：品牌渐变 + 居中圆角图标 + 应用名"""
    W, H = w * 2, h * 2
    img = make_gradient(0, diag=True).resize((W, H), Image.BICUBIC) if False else None
    # 渐变按画布尺寸生成（对角方向随长宽比走）
    n = 256
    small = Image.new('RGB', (n, n))
    px = small.load()
    for y in range(n):
        for x in range(n):
            px[x, y] = grad_color((x + y) / (2 * (n - 1)))
    img = small.resize((W, H), Image.BICUBIC).convert('RGBA')

    d = ImageDraw.Draw(img)
    # 柔光装饰圆
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    r1 = int(min(W, H) * 0.72)
    od.ellipse([W * 0.60 - r1, H * 0.06 - r1, W * 0.60 + r1, H * 0.06 + r1], fill=(255, 255, 255, 26))
    r2 = int(min(W, H) * 0.55)
    od.ellipse([W * 0.12 - r2, H * 0.95 - r2, W * 0.12 + r2, H * 0.95 + r2], fill=(255, 255, 255, 20))
    img = Image.alpha_composite(img, ov)

    side = int(min(W, H) * 0.30)
    ic = icon_square(side, 0.235)
    # 图标加投影
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [W / 2 - side / 2, H * 0.5 - side / 2 + side * 0.06, W / 2 + side / 2, H * 0.5 + side / 2 + side * 0.06],
        radius=side * 0.235, fill=(8, 46, 40, 60))
    sh = sh.filter(__import__('PIL.ImageFilter', fromlist=['ImageFilter']).GaussianBlur(side * 0.07))
    img = Image.alpha_composite(img, sh)
    img.alpha_composite(ic, (int(W / 2 - side / 2), int(H * 0.5 - side / 2)))

    d = ImageDraw.Draw(img)
    fs = int(min(W, H) * 0.088)
    try:
        f = ImageFont.truetype(FONT_BOLD, fs)
    except Exception:
        f = ImageFont.load_default()
    txt = '清笺课程表'
    tw = d.textlength(txt, font=f)
    d.text((W / 2 - tw / 2, H * 0.5 + side * 0.62), txt, font=f, fill=(255, 255, 255))

    fs2 = int(min(W, H) * 0.042)
    try:
        f2 = ImageFont.truetype(FONT_REG, fs2)
    except Exception:
        f2 = ImageFont.load_default()
    t2 = '导入 Excel，自动生成课表'
    tw2 = d.textlength(t2, font=f2)
    d.text((W / 2 - tw2 / 2, H * 0.5 + side * 0.62 + fs * 1.42), t2, font=f2, fill=(255, 255, 255, 210))

    return img.convert('RGB').resize((w, h), Image.LANCZOS)


ICON_SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FG_SIZES = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}


def main():
    for dens, s in ICON_SIZES.items():
        p = os.path.join(RES, 'mipmap-' + dens)
        icon_square(s).save(os.path.join(p, 'ic_launcher.png'))
        icon_round(s).save(os.path.join(p, 'ic_launcher_round.png'))
    for dens, s in FG_SIZES.items():
        p = os.path.join(RES, 'mipmap-' + dens)
        icon_foreground(s).save(os.path.join(p, 'ic_launcher_foreground.png'))
        print('icon', dens, s)

    # 启动图：沿用原有的尺寸清单
    for d_, w_, h_ in [('drawable', 480, 320),
                       ('drawable-land-mdpi', 480, 320), ('drawable-land-hdpi', 800, 480),
                       ('drawable-land-xhdpi', 1280, 720), ('drawable-land-xxhdpi', 1600, 960),
                       ('drawable-land-xxxhdpi', 1920, 1280),
                       ('drawable-port-mdpi', 320, 480), ('drawable-port-hdpi', 480, 800),
                       ('drawable-port-xhdpi', 720, 1280), ('drawable-port-xxhdpi', 960, 1600),
                       ('drawable-port-xxxhdpi', 1280, 1920)]:
        p = os.path.join(RES, d_)
        os.makedirs(p, exist_ok=True)
        splash(w_, h_).save(os.path.join(p, 'splash.png'))
        print('splash', d_, w_, h_)

    # 自适应图标背景色（兜底，正式背景用向量渐变）
    with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="ic_launcher_background">#0B8F86</color>\n</resources>\n')
    print('done')


if __name__ == '__main__':
    main()
