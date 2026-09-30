# -*- coding: utf-8 -*-
"""生成 Chrome 插件图标（基于 master.jpg 原图，超采样抗锯齿圆角处理）。"""
import os
from PIL import Image, ImageDraw

ICONS_DIR = os.path.dirname(os.path.abspath(__file__))
MASTER_PATH = os.path.join(ICONS_DIR, "icons", "master.jpg")
OUT_DIR = os.path.join(ICONS_DIR, "icons")


def main():
    if not os.path.isfile(MASTER_PATH):
        print(f"Error: {MASTER_PATH} not found.")
        return

    img = Image.open(MASTER_PATH).convert("RGBA")
    w, h = img.size

    # 超采样生成抗锯齿圆角蒙版 (iOS Squircle 曲线)
    scale = 4
    mask_w, mask_h = w * scale, h * scale
    mask = Image.new("L", (mask_w, mask_h), 0)
    draw = ImageDraw.Draw(mask)
    radius = int(mask_w * 0.22)
    draw.rounded_rectangle([0, 0, mask_w, mask_h], radius=radius, fill=255)
    mask = mask.resize((w, h), Image.Resampling.LANCZOS)

    icon_master = img.copy()
    icon_master.putalpha(mask)

    for size in (16, 32, 48, 128):
        resized = icon_master.resize((size, size), Image.Resampling.LANCZOS)
        dest = os.path.join(OUT_DIR, f"icon{size}.png")
        resized.save(dest, "PNG")
        print(f"Generated {dest} ({size}x{size})")


if __name__ == "__main__":
    main()
