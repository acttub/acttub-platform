#!/usr/bin/env python3
"""Play Store 등록용 이미지 생성: 앱 아이콘(512), 피처 그래픽(1024x500).
기존 앱 에셋(icon.png, logo-wordmark.png, android-icon-background/foreground)을 재활용."""
import os
from PIL import Image

BASE = os.path.join(os.path.dirname(__file__), "..", "assets", "images")
OUT = os.path.join(os.path.dirname(__file__), "..", "store")
os.makedirs(OUT, exist_ok=True)

BRAND_BG = (1, 130, 249)  # #0182F9 (어댑티브 아이콘 배경색과 동일)


def info():
    for f in ["icon.png", "logo-wordmark.png",
              "android-icon-background.png", "android-icon-foreground.png"]:
        p = os.path.join(BASE, f)
        if os.path.exists(p):
            im = Image.open(p)
            print(f"  {f}: {im.size} {im.mode}")


def make_icon_512():
    """스토어 앱 아이콘: 512x512 PNG, 알파 없음(구글 요구)."""
    src = Image.open(os.path.join(BASE, "icon.png")).convert("RGBA")
    icon = src.resize((512, 512), Image.LANCZOS)
    # 알파를 브랜드 배경 위에 합성 (스토어 아이콘은 투명 허용 안 함)
    bg = Image.new("RGB", (512, 512), BRAND_BG)
    bg.paste(icon, (0, 0), icon)
    out = os.path.join(OUT, "play-icon-512.png")
    bg.save(out)
    print("  -> play-icon-512.png")


def make_feature_1024x500():
    """피처 그래픽: 1024x500. 브랜드 배경 + 중앙 워드마크."""
    canvas = Image.new("RGB", (1024, 500), BRAND_BG)
    wm = Image.open(os.path.join(BASE, "logo-wordmark.png")).convert("RGBA")
    # 워드마크를 캔버스 폭 55%로 맞춤
    target_w = int(1024 * 0.55)
    ratio = target_w / wm.width
    target_h = int(wm.height * ratio)
    wm = wm.resize((target_w, target_h), Image.LANCZOS)
    x = (1024 - target_w) // 2
    y = (500 - target_h) // 2
    canvas.paste(wm, (x, y), wm)
    out = os.path.join(OUT, "play-feature-1024x500.png")
    canvas.save(out)
    print("  -> play-feature-1024x500.png")


if __name__ == "__main__":
    print("[input assets]")
    info()
    print("[generating]")
    make_icon_512()
    make_feature_1024x500()
    print("done. output in:", os.path.abspath(OUT))
