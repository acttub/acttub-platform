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

# 폐기된 도구를 가리키는 역사 기록. 계약 하네스는 `SOMA-403` 4단계에서 지워졌고,
# M1~M4 문서가 그 소스를 가리키는 것은 **그 시점의 기록**이라 고칠 대상이 아니다
# (M0 의 라인 참조를 유지하는 것과 같은 이유). 6단계에서 spec/ 자체가 폐기되면
# 이 면제도 함께 사라진다.
#
# ⚠ **면제는 "그 파일이 없다" 에만 걸린다.** 실재하는 파일의 심볼이 사라진 것은 그대로
# 오류다. 면제 건수를 끝에 찍는 이유도 같다 — 조용히 넘어가면 "검사했다" 로 읽힌다.
RETIRED_PREFIXES = ("tools/contract-harness/",)
RETIRED_FILES = {"manifest.py"}


def is_retired(short: str) -> bool:
    return short.startswith(RETIRED_PREFIXES) or short in RETIRED_FILES

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


#: 백틱 안의 `...py...` 토큰 (완전형·축약형 모두).
_BACKTICKED_PY = re.compile(r"`([^`]*?\.py[^`]*?)`")
#: 백틱 안에서 콜론으로 시작하는 토큰 — 파일이 빠진 축약이다.
_BACKTICKED_ABBREV = re.compile(r"`(:[^`\s]+)`")
#: 그 중 검사기가 실제로 확인하는 형태 — `파일.py:심볼`.
_FULL_FORM = re.compile(r"^[\w./-]+\.py:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$")
#: 파일만 가리키는 것은 허용한다(디렉토리 설명·명령줄 등). 심볼을 붙일 수 없는 자리다.
_FILE_ONLY = re.compile(r"^[\w./-]+\.py$")


#: `:_parse` 처럼 파일 없이 심볼만 적은 축약. 어느 파일인지 알 수 없어 검사가 불가능하다.
_ABBREVIATED = re.compile(r"^:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$")


def bare_py_mentions(line: str) -> list[str]:
    """검사기가 확인하지 못하는 소스 참조 표기를 찾는다.

    통과시키는 것:
      - `db/store.py:PostgresStore.claim_next_external_operation` (완전형 — 검사됨)
      - `analysis_worker.py` (파일만 — 심볼을 붙일 수 없는 자리가 있다)
      - 명령줄·디렉토리명·형식을 설명하는 메타 표기
    잡는 것:
      - `:_parse` 같은 축약 — **어느 파일인지 알 수 없어 영영 검사되지 않는다**
      - `engine.py 의 _parse` 같은 혼합 토큰
    """
    found = []
    for token in _BACKTICKED_PY.findall(line) + _BACKTICKED_ABBREV.findall(line):
        token = token.strip()
        if _FULL_FORM.match(token) or _FILE_ONLY.match(token):
            continue
        if _ABBREVIATED.match(token):
            found.append(token)
            continue
        # 명령줄·산문은 공백으로 가른다. 한글이 섞인 것은 형식 설명이다.
        if " " in token or re.search(r"[가-힣]", token):
            continue
        # `.pytest_cache` 처럼 `.py` 뒤에 글자가 이어지는 것은 소스 참조가 아니다.
        if not re.search(r"\.py(?::|$)", token):
            continue
        found.append(token)
    return found


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []
    checked = 0
    retired = 0

    for spec in spec_files():
        text = spec.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), 1):
            where = f"{spec.relative_to(ROOT)}:{lineno}"

            for short, symbol in SYMBOL_REF.findall(line):
                checked += 1
                target = resolve(short)
                if target is None:
                    if is_retired(short):
                        retired += 1
                        continue
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

            # 🔎 `SYMBOL_REF` 를 빠져나가는 `.py` 표기를 잡는다.
            #
            # 검사기가 완전한 `파일.py:심볼` 만 인식하므로, 축약(`:_parse`)이나 산문
            # 파일명(`engine.py 를 옮긴다`)은 **검사 대상이 아니었다.** M4 사양이 세 번
            # 틀린 근본 원인이다 — 존재하지 않는 파일 넷을 이식 대상으로 적어 두고도
            # 참조 검사는 200건 전부 통과시켰다.
            for bare in bare_py_mentions(line):
                warnings.append(
                    f"{where}  검사되지 않는 .py 표기: {bare} — "
                    f"`파일.py:심볼` 형식으로 바꾸세요 (/SPEC.md §12)")

    for w in warnings:
        print(f"⚠  {w}")
    for e in errors:
        print(f"✗  {e}")

    print(f"\n심볼 참조 {checked}건 검사 · 오류 {len(errors)} · 경고 {len(warnings)}"
          f" · 폐기된 도구 참조 {retired}건 면제")
    if errors:
        print("\nSPEC 이 가리키는 심볼이 소스에 없습니다. 소스가 바뀌었다면 SPEC 을 고치세요.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
