from acting_agent.prompt import build_prompt
from acting_agent.schema import CoachSession, CoachTurn
from agent_test_support import SESSION_ID, SUMMARY, SUMMARY_ID


def test_prompt_includes_anomaly_and_rules():
    s = CoachSession(session_id=SESSION_ID, summary_id=SUMMARY_ID, summary=SUMMARY)
    p = build_prompt(s, None)
    assert "00:12" in p and "1.2초 멈춤" in p  # anomaly material 실림
    assert "왜" in p  # 캐묻기 지시
    assert "점수" in p  # 금지 규칙 명시
    assert "물음표" in p  # 의문문 강제 규칙 명시
    assert "00:10-00:15" in p and "템포" in p  # key_moment/key_dimension 실림


def test_prompt_includes_speech_style_rules():
    s = CoachSession(session_id=SESSION_ID, summary_id=SUMMARY_ID, summary=SUMMARY)
    p = build_prompt(s, None)
    assert "말투 규칙" in p
    assert "타임스탬프" in p  # 발화에 시간 표기 금지 지시
    assert "연기 현장 용어" in p and "감정선" in p  # 현장 공용어 지시
    assert "한 번만 살짝 풀어준다" in p  # 전문어 1회 풀기
    assert "존댓말" in p and "반말 금지" in p  # 정중한 톤 — 배우가 위


def test_prompt_includes_anti_loop_rules():
    s = CoachSession(session_id=SESSION_ID, summary_id=SUMMARY_ID, summary=SUMMARY)
    p = build_prompt(s, None)
    assert "빈 답" in p and "두 번 연속이면 무조건 닫는다" in p  # 빈 답 탈출
    assert "되돌아가지 않는다" in p  # 사다리 후퇴 금지
    assert "질문 틀 재사용 금지" in p  # 단어만 바꾼 반복 금지


def test_prompt_shows_only_top_severity_anomaly():
    # 픽스처는 low가 먼저 들어 있다 — 프롬프트엔 high(00:12) 하나만 실려야 한다
    s = CoachSession(session_id=SESSION_ID, summary_id=SUMMARY_ID, summary=SUMMARY)
    p = build_prompt(s, None)
    assert "1.2초 멈춤" in p and "severity=high" in p
    assert "시선 이탈" not in p  # low anomaly는 아예 노출하지 않는다


def test_prompt_includes_history_and_actor_text():
    s = CoachSession(
        session_id=SESSION_ID,
        summary_id=SUMMARY_ID,
        summary=SUMMARY,
        turns=[CoachTurn(role="ai", text="첫 질문")],
    )
    p = build_prompt(s, "긴장해서 그랬어요")
    assert "첫 질문" in p and "긴장해서 그랬어요" in p
