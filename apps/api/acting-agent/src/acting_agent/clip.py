"""코칭 프롬프트에 사용할 최우선 anomaly를 선택한다."""

from typing import Optional

from acting_agent.summary_schema import Anomaly, SceneSummary

_SEVERITY_ORDER = {"high": 0, "mid": 1, "low": 2}


def pick_target(summary: SceneSummary) -> Optional[Anomaly]:
    if not summary.anomalies:
        return None
    return min(
        summary.anomalies,
        key=lambda a: _SEVERITY_ORDER.get(a.severity, len(_SEVERITY_ORDER)),
    )
