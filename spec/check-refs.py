#!/usr/bin/env python3
"""SPEC 문서의 소스 참조가 실재하는지 검사한다 (/SPEC.md §12).

    python3 spec/check-refs.py

왜 필요한가: 초판 SPEC 은 `store.py:1580-1643` 처럼 라인 번호로 111 곳을 참조했다.
dev 가 전진하자 전부 어긋났고, 그중 8 곳은 **가리키던 심볼 자체가 사라졌는데도**
문서만 봐서는 알 수 없었다. 틀린 SPEC 을 근거로 이식하면 두 벌이 나란히 틀린다.

검사 대상: `파일:심볼` 형식의 참조. 파일이 실재하고 그 안에 심볼이 정의돼 있어야 한다.
라인 번호 참조(`파일:123`)는 M0 문서를 뺀 곳에서 **경고**로 보고한다.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 파이썬 참조를 풀 때 앞에 붙여 볼 경로들. 앞쪽이 우선한다.
PY_ROOTS = [
    "apps/api/acting-api/src/acting_api",
    "apps/api/acting-api",
    "apps/api/acting-summary/src",
    "apps/api/acting-agent/src",
    "apps/api/acting-report/src",
    "apps/api/acting-llm/src",
    "apps/api",
    "",
]

# 그 시점의 기록이라 라인 참조를 유지한다 (/SPEC.md §12).
SKIP_LINE_CHECK = {"M0-spike.md", "M0-findings.md"}

# `db/store.py:PostgresStore.claim_next_external_operation` / `models.py:IntentImpact`
SYMBOL_REF = re.compile(r"`([\w./-]+\.py):([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)`")
# `store.py:1580-1643`
LINE_REF = re.compile(r"`?([\w./-]+\.py):(\d+)(?:[-–]\d+)?`")


def spec_files() -> list[Path]:
    files = [ROOT / "SPEC.md"]
    files += sorted((ROOT / "spec").glob("*.md"))
    return [f for f in files if f.exists()]


def resolve(short: str) -> Path | None:
    for base in PY_ROOTS:
        candidate = ROOT / base / short if base else ROOT / short
        if candidate.is_file():
            return candidate
    # `acting-summary/summarizer.py` 처럼 패키지명을 앞에 붙인 표기를 편다.
    if "/" in short:
        pkg, rest = short.split("/", 1)
        candidate = ROOT / "apps/api" / pkg / "src" / pkg.replace("-", "_") / rest
        if candidate.is_file():
            return candidate
    return None


DEF = re.compile(r"^\s*(?:async\s+)?(?:def|class)\s+(\w+)")
ASSIGN = re.compile(r"^([A-Za-z_]\w*)\s*[:=]")


def defined_names(path: Path) -> set[str]:
    names: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        m = DEF.match(line)
        if m:
            names.add(m.group(1))
            continue
        m = ASSIGN.match(line)
        if m:
            names.add(m.group(1))
    return names


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []
    checked = 0

    for spec in spec_files():
        text = spec.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), 1):
            where = f"{spec.relative_to(ROOT)}:{lineno}"

            for short, symbol in SYMBOL_REF.findall(line):
                checked += 1
                target = resolve(short)
                if target is None:
                    errors.append(f"{where}  파일 없음: {short}")
                    continue
                names = defined_names(target)
                # `클래스.메서드` 는 두 조각 다 있으면 통과로 본다.
                missing = [p for p in symbol.split(".") if p not in names]
                if missing:
                    errors.append(
                        f"{where}  심볼 없음: {short}:{symbol} "
                        f"(찾지 못한 조각: {', '.join(missing)})")

            if spec.name in SKIP_LINE_CHECK:
                continue
            for short, _ in LINE_REF.findall(line):
                warnings.append(f"{where}  라인 번호 참조: {short} — 심볼로 바꾸세요 (/SPEC.md §12)")

    for w in warnings:
        print(f"⚠  {w}")
    for e in errors:
        print(f"✗  {e}")

    print(f"\n심볼 참조 {checked}건 검사 · 오류 {len(errors)} · 경고 {len(warnings)}")
    if errors:
        print("\nSPEC 이 가리키는 심볼이 소스에 없습니다. 소스가 바뀌었다면 SPEC 을 고치세요.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
