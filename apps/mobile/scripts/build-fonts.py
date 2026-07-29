#!/usr/bin/env python3
"""assets/fonts의 Pretendard 서브셋을 다시 만든다.

왜 서브셋인가
  기존에는 PretendardVariable.ttf(6.4MB) 하나만 실었는데 두 가지 문제가 있었다.
  1) 용량: 폰트 하나가 앱 에셋에서 제일 큰 파일이었다.
  2) 안드로이드에서 볼드가 안 먹는다: RN은 가변폰트의 weight 축을 고를 수 없어
     fontWeight가 무시되거나 가짜 볼드로 그려진다. → 굵기별 static 파일을 실어야 한다.

무엇을 남기나
  라틴/기호/문장부호 + 한글 음절 5749자
    = KS X 1001 완성형 2350자 ∪ (초성 19 × 중성 21 × 흔한 받침 14)
  11172자(현대 한글 전체)를 다 넣으면 weight당 2.1MB라 서브셋 이득이 사라진다.
  드문 받침(ㄼ·ㅄ 등)이 들어간 음절은 대부분 KS X 1001에 이미 포함돼 있다.

사용법
  python3 scripts/build-fonts.py        # node_modules/pretendard에서 읽어 assets/fonts에 쓴다
필요 패키지
  python3 -m pip install fonttools
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

WEIGHTS = {
    "Pretendard-Regular": "Regular",
    "Pretendard-SemiBold": "SemiBold",
    "Pretendard-Bold": "Bold",
}

# 라틴·기호·문장부호·화살표·체크·전각기호·호환 자모
BASE_RANGES = [
    "U+0020-007E",
    "U+00A0-00FF",
    "U+2000-206F",
    "U+2190-21FF",
    "U+25A0-25FF",
    "U+2700-27BF",
    "U+3000-303F",
    "U+3130-318F",
    "U+FF00-FFEF",
]

# 받침 인덱스(0=없음). 실제 한국어 문장에 압도적으로 많이 나오는 것만 남긴다.
COMMON_JONGSEONG = {0, 1, 2, 4, 7, 8, 9, 16, 17, 19, 20, 21, 25, 27}


def ks_x_1001_syllables() -> set[int]:
    """KS X 1001 완성형 한글 2350자(EUC-KR 리드바이트 0xB0~0xC8)."""
    result: set[int] = set()
    for code in range(0xAC00, 0xD7A4):
        try:
            encoded = chr(code).encode("euc-kr")
        except UnicodeEncodeError:
            continue
        if len(encoded) == 2 and 0xB0 <= encoded[0] <= 0xC8:
            result.add(code)
    return result


def common_syllables() -> set[int]:
    """초성 19 × 중성 21 × 흔한 받침 조합."""
    return {
        0xAC00 + (cho * 21 + jung) * 28 + jong
        for cho in range(19)
        for jung in range(21)
        for jong in COMMON_JONGSEONG
    }


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent
    source_dir = root / "node_modules" / "pretendard" / "dist" / "public" / "static" / "alternative"
    out_dir = root / "assets" / "fonts"
    if not source_dir.exists():
        print(f"원본 폰트를 찾지 못했습니다: {source_dir}\n먼저 npm install 하세요.", file=sys.stderr)
        return 1

    unicodes = ",".join(
        BASE_RANGES + [f"U+{code:04X}" for code in sorted(ks_x_1001_syllables() | common_syllables())]
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    for family, weight in WEIGHTS.items():
        source = source_dir / f"Pretendard-{weight}.ttf"
        target = out_dir / f"{family}.subset.ttf"
        subprocess.run(
            [
                sys.executable,
                "-m",
                "fontTools.subset",
                str(source),
                f"--unicodes={unicodes}",
                f"--output-file={target}",
            ],
            check=True,
        )
        print(f"{target.name}: {target.stat().st_size / 1024:.0f}KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
