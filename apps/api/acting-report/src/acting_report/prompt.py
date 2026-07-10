from acting_report.schema import ReportRecord
from acting_report.session_schema import CoachSession

RULES = """너는 연기 코칭 리포트 작성자다. 방금 끝난 코치 대화와 영상 관찰 요약을 근거로,
배우가 읽을 최종 리포트(ActingReport)를 만든다. 독자는 배우 본인이다.

철칙:
- 가장 큰 문제 딱 하나만 다룬다. [타깃 이상징후]가 그 문제다. 다른 문제·다른 구간은
  리포트 어디에도 쓰지 않는다.
- 사용자 친화: 전문용어 없이 쉬운 말, 부드러운 반말. 코치가 대화를 마무리하며 건네는
  편지처럼 쓴다.
- 금지: 점수·등급·'진정성'/'몰입도'/'연기력' 표현, '좋다/나쁘다' 판정, 근거 없는 칭찬.
- evidence에는 영상에서 관찰된 사실(시간·수치)과, [대화]에서 배우가 실제로 한 말을
  따옴표로 인용해 함께 넣는다. 대화에 없는 말을 지어내지 않는다.
- self_discovery는 배우가 스스로 말한 깨달음을 그대로 정리한다. 깨달음까지 못 갔으면
  대화에서 드러난 배우의 생각을 적되, 지어내지 않는다.
- next_step은 다음 연습에서 바로 해볼 수 있는 구체적인 행동 딱 하나. 타깃 문제와
  직접 연결돼야 한다.
- comparison: [이전 리포트]가 있으면 '저번엔 ~였는데 이번엔 ~' 식으로 변화를 짚는다.
  좋아졌으면 그 사실을, 같은 문제가 반복되면 그것도 솔직하게. [이전 리포트]가 없으면
  정확히 빈 문자열("")로 둔다.
"""


def _turns_block(session: CoachSession) -> str:
    if not session.turns:
        return "(대화 없음)"
    return "\n".join(f"{t.role}: {t.text}" for t in session.turns)


def _previous_block(previous: list[ReportRecord]) -> str:
    if not previous:
        return "(이전 리포트 없음 — comparison은 빈 문자열로)"
    lines = []
    for r in previous:
        p = r.report
        lines.append(
            f"- ({r.created_at}) 문제: [{p.biggest_problem.start}-{p.biggest_problem.end}]"
            f" {p.biggest_problem.dimension} — {p.biggest_problem.description}"
            f" / 다음 연습 제안: {p.next_step}"
        )
    return "\n".join(lines)


def build_prompt(session: CoachSession, previous: list[ReportRecord]) -> str:
    s = session.summary
    anomalies = s.anomalies
    target = (
        f"[{anomalies[0].start}-{anomalies[0].end}] ({anomalies[0].dimension}) "
        f"{anomalies[0].what} / 의도상 문제: {anomalies[0].impact_on_intent}"
        if anomalies
        else "(anomaly 없음 — summary/intent_alignment에서 가장 두드러진 지점 하나만)"
    )
    return f"""{RULES}

[요약]
{s.summary}

[의도 대비 실제]
{s.intent_alignment}

[핵심 순간]
{s.key_moment}

[타깃 이상징후 — 리포트가 다룰 유일한 문제]
{target}

[대화]
{_turns_block(session)}

[대화 종료 사유]
{session.close_reason or "(기록 없음)"}

[이전 리포트]
{_previous_block(previous)}

위 맥락으로 ActingReport(headline, biggest_problem, evidence, self_discovery,
encouragement, next_step, comparison)를 JSON으로만 출력한다."""
