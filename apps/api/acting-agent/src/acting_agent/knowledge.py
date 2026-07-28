"""질문 지식 주입본 — 연기 자문(7/24)과 전문 서적에서 추린 것.

정본은 볼트의 `planning/AI품질/질문지식-주입본-2026-07-26.json` 이고, 이 패키지의
`data/question_knowledge.json` 은 그 사본이다. 정본이 바뀌면 사본을 갱신한다.
"""

import json
from functools import lru_cache
from importlib.resources import files
from typing import Any

_DATA = "question_knowledge.json"


@lru_cache(maxsize=1)
def load() -> dict[str, Any]:
    # data 를 패키지로 만들지 않아도 되게 acting_agent 기준으로 찾는다
    raw = files("acting_agent").joinpath("data", _DATA).read_text(encoding="utf-8")
    return json.loads(raw)


def bank_find(question: str) -> dict[str, Any]:
    """은행 원형을 문구로 찾는다. 없으면 즉시 터뜨린다 — 조용히 다른 질문이 나가면
    어떤 원형이 실제로 쓰였는지 추적할 수 없다."""
    for row in load()["question_bank"]:
        if row["question"] == question:
            return row
    raise KeyError(f"은행에 없는 원형: {question}")
