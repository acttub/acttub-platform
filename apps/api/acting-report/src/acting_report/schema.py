from pydantic import BaseModel, Field

from acting_report.session_schema import CoachTurn


class BiggestProblem(BaseModel):
    start: str = Field(description="문제 구간 시작 시점 (예: 00:12)")
    end: str = Field(description="문제 구간 끝 시점. 순간이면 start와 같게.")
    dimension: str = Field(description="어느 축의 문제인지 (템포/움직임/표정 등)")
    description: str = Field(
        description="뭐가 문제였는지 전문용어 없이 쉬운 말로. 판정·점수 표현 금지."
    )


class ActingReport(BaseModel):
    headline: str = Field(
        description="오늘 연기 한 줄 총평. 따뜻한 톤, 점수·등급 없음."
    )
    biggest_problem: BiggestProblem = Field(
        description="이번 영상에서 가장 큰 문제 딱 하나. 나머지 문제는 언급하지 않는다."
    )
    evidence: str = Field(
        description="영상에서 관찰된 사실(시간·수치) + 대화에서 배우가 직접 한 말 인용"
    )
    self_discovery: str = Field(
        description="대화에서 배우가 스스로 깨닫고 말한 것 정리. 없으면 대화에서 드러난 배우의 생각."
    )
    encouragement: str = Field(description="잘한 점 한 줄. 빈말 금지, 관찰 근거 기반.")
    next_step: str = Field(
        description="다음 연습에서 시도해볼 구체적인 것 딱 하나. 배우가 바로 실행 가능한 수준으로."
    )
    comparison: str = Field(
        default="",
        description="이전 리포트가 있으면 '저번엔 ~였는데 이번엔 ~' 식의 변화 비교. 이전 리포트가 없으면 빈 문자열.",
    )


class ReportRecord(BaseModel):
    """같은 사용자의 리포트 히스토리 한 건.

    DB에서는 대화를 coach_turns에만 저장하고, 조회할 때 turns를 함께 구성한다.
    """

    created_at: str = Field(description="ISO8601 생성 시각")
    session_id: str
    report: ActingReport
    turns: list[CoachTurn] = Field(default_factory=list)
