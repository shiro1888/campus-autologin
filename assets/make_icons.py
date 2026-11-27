# -*- coding: utf-8 -*-
"""生成 Chrome 插件图标（基于 assets/master.jpg 原图，超采样抗锯齿圆角处理）。"""
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
MASTER_PATH = os.path.join(BASE_DIR, "master.jpg")
OUT_DIR = os.path.join(PROJECT_ROOT, "chrome-extension", "icons")


def main():
    try:
        from PIL import Image, ImageDraw, ImageOps
        from PIL import __version__ as PILLOW_VERSION
    except ImportError:
        print("错误: 生成图标需要安装 Pillow (pip install pillow)。")
        return 1

    # rounded_rectangle 从 Pillow 8.2 才提供；低于该版本会在生成阶段抛
    # AttributeError，提前给出可读的版本提示，避免误以为图片/路径有问题。
    try:
        pillow_ver = tuple(int(x) for x in str(PILLOW_VERSION).split('.')[:2])
    except (TypeError, ValueError):
        pillow_ver = (99, 99)
    if pillow_ver < (8, 2):
        print(f"错误: 生成图标需要 Pillow >= 8.2.0（当前 {PILLOW_VERSION}）。")
        return 1

    # 兼容旧版 Pillow（<9.1.0 无 Image.Resampling）。
    # 注意不能写成 getattr(Image.Resampling, 'LANCZOS', ...)：当 Image 本身没有
    # Resampling 时，求值 getattr 的第一个参数就会先抛 AttributeError，
    # 后面的 or 回退永远执行不到（等于兼容代码是死代码）。
    # 正确做法是先取到"容器"再取属性。
    LANCZOS = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', None)
    if LANCZOS is None:
        LANCZOS = getattr(Image, 'LANCZOS', None) or getattr(Image, 'ANTIALIAS', None)
    if LANCZOS is None:
        LANCZOS = Image.BICUBIC if hasattr(Image, 'BICUBIC') else 1

    if not os.path.isfile(MASTER_PATH):
        print(f"错误: 未找到源图片 {MASTER_PATH}")
        return 1

    # 输出目录可能被删除（例如手动清理过），缺失时补建，避免保存时抛异常
    os.makedirs(OUT_DIR, exist_ok=True)

    with Image.open(MASTER_PATH) as raw_img:
        transposed = ImageOps.exif_transpose(raw_img)
        img = transposed.convert("RGBA")
    side = min(img.size)
    if img.size != (side, side):
        img = ImageOps.fit(img, (side, side), method=LANCZOS)
    w, h = img.size

    # 超采样生成抗锯齿圆角蒙版 (iOS Squircle 曲线)
    scale = 4
    mask_w, mask_h = w * scale, h * scale
    mask = Image.new("L", (mask_w, mask_h), 0)
    draw = ImageDraw.Draw(mask)
    radius = int(mask_w * 0.22)
    draw.rounded_rectangle([0, 0, mask_w - 1, mask_h - 1], radius=radius, fill=255)
    mask = mask.resize((w, h), LANCZOS)

    icon_master = img.copy()
    icon_master.putalpha(mask)

    for size in (16, 32, 48, 128):
        resized = icon_master.resize((size, size), LANCZOS)
        dest = os.path.join(OUT_DIR, f"icon{size}.png")
        resized.save(dest, "PNG")
        print(f"Generated {dest} ({size}x{size})")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
