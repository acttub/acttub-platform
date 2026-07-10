"""타깃 anomaly 선택과 영상 지점 재생 HTML — 프롬프트와 UI가 같은 타깃을 공유한다."""

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


def build_clip_html(video_url: str) -> str:
    return (
        f'<video src="{video_url}" controls '
        'style="width:100%;max-height:360px"></video>'
    )
