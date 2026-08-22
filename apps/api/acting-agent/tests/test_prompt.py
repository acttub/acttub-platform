import hashlib

from acting_agent.prompt import COACH_V2_PROMPT, COACH_V3_PROMPT, build_chat_prompt
from acting_agent.schema import CoachSession, CoachTurn
from acting_agent.summary_schema import ObservationPack
from agent_test_support import (
    ACTOR,
    PRACTICE_SESSION_ID,
    SESSION_ID,
    SUMMARY,
    SUMMARY_ID,
)


def _session(**updates):
    values = {
        "session_id": SESSION_ID,
        "practice_session_id": PRACTICE_SESSION_ID,
        "summary_id": SUMMARY_ID,
        "observation_pack": SUMMARY,
        "actor": ACTOR,
        "blockage_kind": "분석",
        "sub_branch": "대사 분석",
        "blockage_detail": ACTOR.blockage_detail,
    }
    values.update(updates)
    return CoachSession(**values)


def test_canonical_coach_prompt_hashes_are_unchanged():
    assert hashlib.sha256(COACH_V2_PROMPT.encode()).hexdigest() == (
        "8994a7c6adb613cb99153e04039e1412d3baf3a9f93f56ad97770b4c29440756"
    )
    assert hashlib.sha256(COACH_V3_PROMPT.encode()).hexdigest() == (
        "9cefd8c3f18881a00353cccc91e75228668bbe21d4feadbeb5828dbe12db34dd"
    )


def test_chat_prompt_uses_goal_and_compact_observation_lines():
    prompt = build_chat_prompt(_session(), "최신 말")

    assert "- 이번 테이크의 목적: 상대가 멈추게 한다" in prompt
    assert "서브텍스트" not in prompt
    assert (
        "- 120~130ms: 대사 직전에 숨을 들이쉰다 (확인 가능성 0.9)" in prompt
    )
    assert "확인되지 않은 것: 얼굴은 확인되지 않음" in prompt


def test_chat_prompt_keeps_actor_blockage_detail_as_material():
    prompt = build_chat_prompt(_session(), "첫 배우 메시지")

    assert f"- 배우가 쓴 상세: {ACTOR.blockage_detail}" in prompt
    assert "## 배우의 최신 말\n첫 배우 메시지" in prompt


def test_actor_material_ends_with_video_duration():
    prompt = build_chat_prompt(_session(), "최신 말")

    actor_block = prompt.split("## 영상에서 확인된 것", 1)[0]
    assert actor_block.rstrip().endswith(f"- 영상 길이: {ACTOR.duration_ms}ms")


def test_video_facts_instruction_uses_canonical_pack_wording():
    prompt = build_chat_prompt(_session(), "최신 말")

    assert (
        "## 영상에서 확인된 것\n"
        "이 팩만 영상 근거로 쓴다. 이 호출에는 영상이 첨부되지 않았고 "
        "새 영상 사실을 만들면 안 된다."
    ) in prompt


def test_chat_prompt_without_observation_pack_forbids_video_invention():
    prompt = build_chat_prompt(_session(summary_id=None, observation_pack=None), "최신 말")

    assert "아직 영상에서 확인된 것이 없다. 영상 이야기를 만들지 마라." in prompt


def test_zero_observations_has_canonical_normal_result_text():
    prompt = build_chat_prompt(
        _session(
            observation_pack=ObservationPack(
                observations=[], uncertainties=["사람이 보이지 않음"]
            )
        ),
        "최신 말",
    )

    assert "관찰 0개. 이것은 정상이며 영상 이야기를 새로 만들면 안 된다." in prompt
    assert "불확실: 사람이 보이지 않음" in prompt


def test_transcript_block_stays_between_actor_material_and_video_facts():
    prompt = build_chat_prompt(
        _session(transcripts=["지금 가지 마.", "내 말 좀 들어줘."]),
        "왜 지금 말하지?",
    )
    block = "## 영상에서 받아쓴 대사\n- 지금 가지 마.\n- 내 말 좀 들어줘."

    assert block in prompt
    assert prompt.index("## 배우가 쓴 것") < prompt.index(block)
    assert prompt.index(block) < prompt.index("## 영상에서 확인된 것")


def test_only_last_eight_turns_are_recent():
    prompt = build_chat_prompt(
        _session(turns=[CoachTurn(role="actor", text=f"말 {i}") for i in range(10)]),
        "최신 말",
    )
    recent = prompt.split("## 최근 대화", 1)[1].split("## 배우의 최신 말", 1)[0]
    assert "말 0" not in recent
    assert "말 2" in recent
    assert "## 지금까지\n아직 없음" in prompt
    assert "말 0" not in prompt
    assert "말 1" not in prompt


def test_conversation_summary_is_used_without_copying_old_turns():
    prompt = build_chat_prompt(
        _session(
            conversation_summary="배우는 상대를 붙잡으려 한다.",
            turns=[CoachTurn(role="actor", text=f"옛 말 {i}") for i in range(10)],
        ),
        "최신 말",
    )

    summary = prompt.split("## 지금까지", 1)[1].split("## 최근 대화", 1)[0]
    assert summary.strip() == "배우는 상대를 붙잡으려 한다."
    assert "옛 말 0" not in prompt
    assert "옛 말 1" not in prompt


def test_expression_observations_are_json_before_latest_actor_message():
    prompt = build_chat_prompt(
        _session(blockage_kind="표현", sub_branch="화술"),
        "어떻게 말해야 할지 모르겠어",
    )

    expression_heading = prompt.index("## 표현 세션 입력 정보")
    observations = prompt.index("- video_observations:")
    latest = prompt.index("## 배우의 최신 말")
    assert expression_heading < observations < latest
    assert (
        '  - {"start_ms":120,"end_ms":130,"label":"대사 직전에 숨을 들이쉰다",'
        '"confidence":0.9}'
    ) in prompt


def test_analysis_session_omits_expression_observation_input():
    prompt = build_chat_prompt(_session(), "왜 지금 말하지?")

    assert "## 표현 세션 입력 정보" not in prompt
    assert "- video_observations:" not in prompt


def test_expression_session_includes_confirmed_analysis_handoff():
    handoff = {
        "handoff_type": "analysis",
        "blocked_point": "왜 지금 말하는지",
        "line_meaning": "상대를 붙잡는 말",
        "timing_reason": "상대가 돌아서는 순간",
        "target_effect": "상대가 멈추게 한다",
        "scene_evidence": ["상대가 돌아선다"],
        "actor_words": ["놓치면 끝이야"],
    }
    prompt = build_chat_prompt(
        _session(
            blockage_kind="표현",
            sub_branch="화술",
            analysis_handoff=handoff,
        ),
        "다시 해볼게",
    )

    block = """## 이전 분석 세션에서 전달받은 입력 정보
- blocked_point: 왜 지금 말하는지
- line_meaning: 상대를 붙잡는 말
- timing_reason: 상대가 돌아서는 순간
- target_effect: 상대가 멈추게 한다
- scene_evidence:
  - 상대가 돌아선다
- actor_words:
  - 놓치면 끝이야"""
    assert block in prompt
    assert prompt.index(block) < prompt.index("- video_observations:")
    assert prompt.index("- video_observations:") < prompt.index("## 배우의 최신 말")
    assert "## 표현 세션 입력 정보" not in prompt


def test_turn_budget_block_is_appended_at_the_end_of_every_prompt():
    def tail(ai_turns: int, blockage_kind: str = "분석") -> str:
        turns = [CoachTurn(role="ai", text="코치") for _ in range(ai_turns)]
        return build_chat_prompt(
            _session(blockage_kind=blockage_kind, turns=turns), "최신 말"
        )

    assert tail(0).endswith(
        "## 남은 응답\n"
        "전체 응답 예산: 20번\n"
        "현재 응답: 1번째\n"
        "이번 응답 뒤에 남는 횟수: 19번\n"
        "현재 구간: 남은 응답이 17회 이상일 때"
    )
    # 분석은 남은 횟수로 구간을 고른다 — 경계는 16·8·3
    assert "현재 구간: 남은 응답이 16회 이하일 때" in tail(3)
    assert "현재 구간: 남은 응답이 8회 이하일 때" in tail(11)
    assert "현재 구간: 남은 응답이 3회 이하일 때" in tail(16)
    assert tail(19).endswith(
        "현재 구간: 마지막 응답일 때\n이번이 마지막 응답이다."
    )
    # 경계 바로 앞은 아직 이전 구간이다
    assert "현재 구간: 남은 응답이 17회 이상일 때" in tail(2)
    assert "현재 구간: 남은 응답이 16회 이하일 때" in tail(10)
    assert "현재 구간: 남은 응답이 8회 이하일 때" in tail(15)
    # 예산을 넘겨도 남는 횟수는 0에서 멈추고 계속 마지막 응답으로 둔다
    assert "이번 응답 뒤에 남는 횟수: 0번" in tail(20)
    assert "이번이 마지막 응답이다." in tail(20)
    # 표현 갈래는 같은 예산을 쓰되 응답 번호로 구간을 고른다
    assert "현재 구간: 문제 확인 구간" in tail(0, "표현")
    assert "현재 구간: 방향 선택 구간" in tail(16, "표현")

def test_phase_names_match_headings_in_the_matching_prompt_body():
    """블록이 부르는 구간 이름이 본문 제목과 어긋나면 모델이 절을 못 찾는다."""
    for blockage_kind, body in (("분석", COACH_V2_PROMPT), ("표현", COACH_V3_PROMPT)):
        for ai_turns in (0, 3, 11, 16, 19, 25):
            turns = [CoachTurn(role="ai", text="코치") for _ in range(ai_turns)]
            prompt = build_chat_prompt(
                _session(blockage_kind=blockage_kind, turns=turns), "최신 말"
            )
            phase = prompt.rsplit("현재 구간: ", 1)[1].split("\n")[0]
            assert f"## {phase}" in body, (blockage_kind, ai_turns, phase)