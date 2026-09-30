# -*- coding: utf-8 -*-
"""生成 Chrome 插件图标（纯标准库，不依赖 Pillow）。"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")

# 品牌配色：蓝色 -> 青色渐变
TOP = (30, 136, 229)
BOTTOM = (0, 191, 165)
WHITE = (255, 255, 255)

SS = 3  # 超采样倍数，用于抗锯齿


def rounded_rect_alpha(x, y, size, radius):
    """返回点 (x, y) 是否落在圆角矩形内。"""
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    dx = x - cx
    dy = y - cy
    return (dx * dx + dy * dy) <= radius * radius


def wifi_alpha(x, y, size):
    """返回该点的白弧覆盖强度 0..1（弧线自底部中点向上发散）。"""
    cx = size * 0.5
    cy = size * 0.80
    dx = x - cx
    dy = y - cy
    dist = (dx * dx + dy * dy) ** 0.5
    if dy > size * 0.06:          # 只画上半部分
        return 0.0
    best = 0.0
    for frac, width in ((0.16, 0.055), (0.30, 0.055), (0.44, 0.055)):
        r = size * frac
        w = size * width
        if abs(dist - r) <= w / 2.0:
            best = 1.0
    # 底部圆点
    if dist <= size * 0.055:
        best = 1.0
    return best


def render(size):
    """渲染一张 size x size 的 RGBA 像素。"""
    rows = []
    radius = size * 0.22
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc_a = 0.0
            acc_r = acc_g = acc_b = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    fx = px + (sx + 0.5) / SS
                    fy = py + (sy + 0.5) / SS
                    if not rounded_rect_alpha(fx, fy, size, radius):
                        continue
                    t = fy / max(1.0, float(size) - 1.0)
                    if t < 0.0:
                        t = 0.0
                    elif t > 1.0:
                        t = 1.0
                    r = TOP[0] + (BOTTOM[0] - TOP[0]) * t
                    g = TOP[1] + (BOTTOM[1] - TOP[1]) * t
                    b = TOP[2] + (BOTTOM[2] - TOP[2]) * t
                    wa = wifi_alpha(fx, fy, size)
                    if wa > 0:
                        r = r + (WHITE[0] - r) * wa
                        g = g + (WHITE[1] - g) * wa
                        b = b + (WHITE[2] - b) * wa
                    acc_a += 1.0
                    acc_r += r
                    acc_g += g
                    acc_b += b
            total = float(SS * SS)
            if acc_a <= 0:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((
                    int(round(acc_r / acc_a)),
                    int(round(acc_g / acc_a)),
                    int(round(acc_b / acc_a)),
                    int(round(255.0 * acc_a / total)),
                ))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        body = tag + data
        return (struct.pack(">I", len(data)) + body +
                struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(os.path.join(OUT, "icon%d.png" % size), size, render(size))
        print("wrote icon%d.png" % size)


if __name__ == "__main__":
    main()
