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
        from PIL import Image, ImageDraw
    except ImportError:
        print("提示: 重新生成图标需安装 Pillow (pip install pillow)。")
        print("当前 chrome-extension/icons/ 下的图标已预先生成完毕，日常使用插件无需安装任何依赖。")
        return 0

    # 兼容旧版 Pillow（<9.1.0 无 Image.Resampling）
    LANCZOS = getattr(Image.Resampling, 'LANCZOS', None) or getattr(Image, 'LANCZOS', getattr(Image, 'ANTIALIAS', None))

    if not os.path.isfile(MASTER_PATH):
        print(f"错误: 未找到源图片 {MASTER_PATH}")
        return 1

    img = Image.open(MASTER_PATH).convert("RGBA")
    w, h = img.size

    # 超采样生成抗锯齿圆角蒙版 (iOS Squircle 曲线)
    scale = 4
    mask_w, mask_h = w * scale, h * scale
    mask = Image.new("L", (mask_w, mask_h), 0)
    draw = ImageDraw.Draw(mask)
    radius = int(mask_w * 0.22)
    draw.rounded_rectangle([0, 0, mask_w, mask_h], radius=radius, fill=255)
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
