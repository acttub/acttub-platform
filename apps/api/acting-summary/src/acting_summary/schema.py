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


class Anomaly(BaseModel):
    start: str = Field(
        description="이상이 지속·반복되는 전체 구간의 시작 = 최초 등장 시점 (예: 00:17)"
    )
    end: str = Field(
        description="이상이 지속·반복되는 전체 구간의 끝 = 마지막 등장 시점 (예: 00:44). 구간 길이는 최소 8초(목표 8~10초), 순간적 이상도 전후 맥락을 포함해 잡는다."
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
    overlaps_key_moment: bool = Field(
        description="이 이상의 start~end가 key_moment 구간과 1초라도 겹치면 true"
    )
    on_key_dimension: bool = Field(
        description="dimension에 key_dimension의 축이 포함되면 true"
    )
    intent_impact: Literal["반전", "약화", "국소"] = Field(
        description="서브텍스트 의도에 끼치는 영향: 반전(전달 안 되거나 반대로 읽힘)/약화(약해지지만 안 뒤집힘)/국소(거의 영향 없음)"
    )
    severity: Literal["high", "mid", "low"] = Field(
        description="코칭 우선순위. 점수 합산 규칙으로 결정: overlaps_key_moment(+1) + on_key_dimension(+1) + intent_impact(반전+2/약화+1/국소+0), 3점 이상 high / 1~2점 mid / 0점 low"
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
    anomalies: list[Anomaly] = Field(
        description="이상징후 목록, 절대 생략 금지. 중요도순(high→low) 정렬, 같은 등급이면 key_moment/key_dimension 관련이 먼저."
    )
