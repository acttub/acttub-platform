from acting_agent.prompt import first_user_message, scene_block, system_prompt
from acting_agent.targeting import (
    Context,
    SceneInput,
    Signal,
    is_vague,
    pick_first_target,
    pick_followup_signal,
)

FULL_INPUT = SceneInput(
    situation="이별을 통보받은 직후, 카페에서",
    character="담담한 척하는 20대 후반 여성",
    goal="상대를 붙잡고 싶다",
)


def _ctx(signals=None, **overrides):
    base = SceneInput(**{**FULL_INPUT.__dict__, **overrides})
    return Context(input=base, signals=list(signals or []))


def test_system_prompt_carries_injected_knowledge():
    p = system_prompt(False)
    for section in (
        "[전제 선언]",
        "[번역 규칙]",
        "[금지 문형 — 하나라도 쓰면 실패]",
        "[오독 방어]",
        "[개념 카드",
        "[좋은/나쁜 예시]",
    ):
        assert section in p, section
    # 첫 질문 프롬프트에는 꼬리 규칙이 실리지 않는다
    assert "[꼬리 질문 규칙]" not in p


def test_follow_up_prompt_adds_tail_rules():
    p = system_prompt(True)
    assert "[꼬리 질문 규칙]" in p
    assert "close 판단" in p


def test_scene_block_hides_vague_input():
    # 'ㅎㅇ'을 넘기면 모델이 거기서 뜻을 읽어내려 한다
    block = scene_block(_ctx(character="ㅎㅇ"))
    assert "ㅎㅇ" not in block
    assert "- 인물: (입력 없음)" in block
    assert "그대로 옮겨 쓰지 않는다" in block


def test_is_vague_narrow_enough_to_keep_real_input():
    assert is_vague("") and is_vague("ㅎㅇ") and is_vague("ㅋㅋㅋ") and is_vague("아")
    assert not is_vague("카페") and not is_vague("이별을 통보받은 직후")


def test_situation_gap_beats_observation():
    # 장면을 모르면 관찰을 해석할 수 없다 — 이것만 관찰보다 앞선다
    ctx = _ctx([Signal("시선", "00:12에 시선이 떨어짐")], situation="")
    assert pick_first_target(ctx).row["question"] == "지금 여기는 어디인가요? 어떤 상황에 처해 있나요?"


def test_whole_scope_signal_beats_moment_signal():
    # 장면 전체가 먼저고 순간은 나중이다
    ctx = _ctx(
        [
            Signal("시선", "00:12에 시선이 떨어짐"),
            Signal("템포", "전 구간 변화 폭이 크지 않음"),
        ]
    )
    target = pick_first_target(ctx)
    assert target.row["question"] == "처음과 끝에서 인물이 원하는 건 같은 걸까요, 달라졌을까요?"
    assert target.use_observation and target.signal is not None


def test_prior_segment_is_not_read_as_whole_scope():
    # "직전 구간"이 "전 구간"에 걸려 순간 신호가 전 구간으로 오분류되던 것
    ctx = _ctx([Signal("볼륨", "직전 구간보다 소리가 커짐")])
    assert (
        pick_first_target(ctx).row["question"]
        == "그 말이 커진 순간, 인물은 상대에게서 뭘 얻고 싶었을까요?"
    )


def test_unmapped_observation_is_not_discarded():
    # 매핑에 없는 관찰을 버리면 질문이 입력만 보고 만들어진다
    ctx = _ctx([Signal("호흡", "들숨이 얕게 반복됨")])
    target = pick_first_target(ctx)
    assert target.row["question"] == "그 순간 인물에게 가장 크게 들어온 건 무엇이었을까요?"
    assert target.signal is not None


def test_low_confidence_observation_never_becomes_target():
    # 신뢰도 게이트 — low/medium은 되묻지 않고 타깃으로 쓰지 않는다
    ctx = _ctx([Signal("시선", "00:12에 시선이 떨어짐", confidence="medium")])
    assert pick_first_target(ctx).row["question"] == (
        "원하는 걸 이루지 못하면 인물에게 무슨 일이 벌어질까요?"
    )


def test_high_observation_beats_missing_goal_and_character():
    # 질문의 재료는 영상이다 — 상황 결손만 관찰보다 앞선다 (스펙 §3)
    ctx = _ctx([Signal("템포", "말이 멈춘 지점이 있다", start="00:12")], goal="", character="")
    target = pick_first_target(ctx)
    assert target.use_observation and target.signal is not None


def test_input_gap_used_only_when_no_usable_observation():
    ctx = _ctx(goal="")
    assert pick_first_target(ctx).row["question"] == "이 장면에서 인물이 원하는 게 뭐예요?"


def test_prior_segment_variants_stay_moment_signals():
    # "그 전 구간"·"바로 전 구간"이 전 구간으로 오분류되던 것 (Codex 교차검토)
    for evidence in (
        "직전 구간보다 소리가 커짐",
        "그 전 구간보다 소리가 커짐",
        "바로 전 구간보다 소리가 커짐",
    ):
        ctx = _ctx([Signal("볼륨", evidence)])
        assert pick_first_target(ctx).row["question"] == (
            "그 말이 커진 순간, 인물은 상대에게서 뭘 얻고 싶었을까요?"
        ), evidence


def test_observation_state_is_derived_from_turns():
    # 세션에 필드로 얹으면 DB 복원에서 사라진다 — 턴에서 되살린다
    from acting_agent.schema import CoachTurn
    from acting_agent.targeting import derive_observation_state

    turns = [
        CoachTurn(role="ai", text="첫 질문", focus_timestamp="00:12"),
        CoachTurn(role="actor", text="안 멈췄는데요"),
        CoachTurn(role="ai", text="두번째", focus_timestamp="00:20"),
        CoachTurn(role="actor", text="그랬어요"),
    ]
    used, rejected, cited = derive_observation_state(turns)
    assert used == {"00:12", "00:20"}
    assert rejected == {"00:12"}  # 부정한 관찰
    assert cited == "00:20"


def test_first_message_quotes_one_observation_only():
    ctx = _ctx([Signal("시선", "00:12에 시선이 떨어짐")])
    msg = first_user_message(ctx, pick_first_target(ctx))
    assert "[타깃 지시" in msg
    assert "hedge를 붙여 한 줄만 인용한다" in msg
    assert "다른 관찰은 꺼내지 않는다" in msg


def test_first_message_without_observation_blocks_summary_opener():
    ctx = _ctx(situation="")
    msg = first_user_message(ctx, pick_first_target(ctx))
    assert "아직 관찰은 인용하지 않는다" in msg
    assert "입력을 요약하는 문장으로 시작하지 않는다" in msg


def test_followup_skips_used_and_rejected_observations():
    ctx = _ctx(
        [
            Signal("시선", "00:12에 시선이 떨어짐"),
            Signal("침묵", "00:20에 말이 끊김"),
        ]
    )
    used = {ctx.signals[0].key()}
    assert pick_followup_signal(ctx, used, set()).name == "침묵"
    # rejected 는 목록에서 아예 빼야 모델이 다시 꺼내지 않는다
    assert pick_followup_signal(ctx, used, {ctx.signals[1].key()}) is None
