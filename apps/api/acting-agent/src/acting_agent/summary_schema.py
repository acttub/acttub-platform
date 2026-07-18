"""acting-summary의 출력 스키마 사본.

코치는 acting-summary가 만든 요약 JSON을 입력으로 받는 소비자다.
wire 포맷이 바뀌면 이 파일도 함께 맞춘다 (원본: acting-summary/src/acting_summary/schema.py).
"""

from typing import Literal

from pydantic import BaseModel, Field


class SubText(BaseModel):
    situation: str = Field(description="상황")
    character: str = Field(description="인물설정")
    subtext: str = Field(description="서브텍스트")


class ExtraDimension(BaseModel):
    name: str = Field(
        description="6축 외 추가로 관찰할 가치가 있는 축 이름 (예: 호흡, 시선처리)"
    )
    observation: str = Field(description="그 축에 대한 시간순 관찰")


class Observation(BaseModel):
    timeline: str = Field(
        description="시간순 전체 흐름. 손실 최소, 거의 생략하지 않는다. 축 간 타이밍 상관을 여기서 잡는다. 모든 축은 수치화·측정 가능한 표현(방향·각도·위치·초·횟수)으로 적는다."
    )
    dialogue: str = Field(description="대사: 내용·딕션·명료도·강조 처리")
    tempo: str = Field(description="템포: 말·행동의 속도·리듬·사이(pause)")
    pitch: str = Field(description="높낮이: 피치·억양·강세의 변화")
    movement: str = Field(description="움직임: 제스처·블로킹·자세·이동")
    expression: str = Field(description="표정·시선: 얼굴 표정, 눈의 방향·초점")
    emotion: str = Field(description="감정: 감정선의 흐름·진정성·전환")
    extra: list[ExtraDimension] = Field(
        default_factory=list,
        description="6축으로 담기지 않는 추가 축이 있으면 넣는다. 없으면 빈 리스트.",
    )


class SegmentCheck(BaseModel):
    start: str = Field(description="구간 시작. 00:00부터 5초 고정 간격 (예: 00:05)")
    end: str = Field(
        description="구간 끝. start+5초, 마지막 구간만 영상 끝 시점 (예: 00:10)"
    )
    note: str = Field(
        description="이 구간에서 6축 전부 점검한 결과. 이상이 없으면 정확히 '이상 없음'"
    )


class Anomaly(BaseModel):
    start: str = Field(description="이상 구간 시작 시점 (예: 00:12)")
    end: str = Field(
        description="이상 구간 끝 시점 (예: 00:15). 순간이라도 start와 같게 채운다."
    )
    dimension: str = Field(
        description="어느 축의 이상인지 (대사/템포/높낮이/움직임/표정/감정 또는 extra 이름, 복합 가능)"
    )
    what: str = Field(description="관찰된 이상/부자연/의도이탈")
    why_odd: str = Field(description="왜 어색하거나 눈에 띄는지")
    likely_cause: str = Field(description="왜 그렇게 됐을 것 같은지 (추정 원인)")
    impact_on_intent: str = Field(
        description="서브텍스트 의도상 왜 문제인지 (의도에 끼치는 영향)"
    )
    severity: Literal["high", "mid", "low"] = Field(
        description="서브텍스트 의도 훼손 크기 기준의 코칭 우선순위 (판정·점수 아님)"
    )
    severity_reason: str = Field(
        description="왜 이 등급인지. key_moment/key_dimension 해당 여부를 포함하고, impact_on_intent를 반복하지 않는다."
    )


class SceneSummary(BaseModel):
    observation: Observation = Field(
        description="연기 요소별로 세분화한 시간순 관찰, 손실 최소"
    )
    summary: str = Field(description="서브텍스트 대비 압축 요약")
    intent_alignment: str = Field(
        description="상황/인물설정/서브텍스트 의도 대비 실제 연기"
    )
    key_moment: str = Field(
        description="서브텍스트상 가장 중요한 시간 구간과 왜 중요한지"
    )
    key_dimension: str = Field(
        description="이 씬에서 가장 중요한 연기 축과 왜 중요한지"
    )
    # 코치는 segment_scan을 쓰지 않으므로, 이 필드가 없는 구버전 요약 JSON도 받아준다
    segment_scan: list[SegmentCheck] = Field(
        default_factory=list,
        description="00:00부터 5초 고정 간격 그리드로 나눈 전 구간의 점검 기록. 구간을 하나도 건너뛰지 않는다.",
    )
    anomalies: list[Anomaly] = Field(
        description="이상징후 목록, 절대 생략 금지. 중요도순(high→low) 정렬, 같은 등급이면 key_moment/key_dimension 관련이 먼저."
    )
