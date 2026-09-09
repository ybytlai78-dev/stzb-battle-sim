#!/usr/bin/env python3
"""生成 PWA 图标：以 rate-logo.png（144x144）为核心，暖黑底居中放大。
产物: public/icons/icon-192.png / icon-512.png / apple-touch-icon.png(180)
用法: python scripts/gen_pwa_icons.py
"""
from PIL import Image, ImageFilter
import os

SRC = os.path.join(os.path.dirname(__file__), "..", "public", "rate-logo.png")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
BG = (21, 17, 11)  # #15110b 页面暖黑底

os.makedirs(OUT_DIR, exist_ok=True)
logo = Image.open(SRC).convert("RGBA")


def make_icon(size: int, logo_ratio: float = 0.86) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG + (255,))
    target = int(size * logo_ratio)
    resized = logo.resize((target, target), Image.LANCZOS)
    # 轻微圆角裁切? PWA 图标系统自己裁，保持方形整图即可
    canvas.paste(resized, ((size - target) // 2, (size - target) // 2), resized)
    return canvas


for size in (192, 512):
    icon = make_icon(size)
    icon.save(os.path.join(OUT_DIR, f"icon-{size}.png"))
    print(f"icon-{size}.png  {icon.size}")

apple = make_icon(180)
apple.save(os.path.join(OUT_DIR, "apple-touch-icon.png"))
print("apple-touch-icon.png  180")
