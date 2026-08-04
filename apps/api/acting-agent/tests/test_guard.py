from acting_agent.guard import ECHO_LIMIT, echo_hits, lint_question


def test_lint_catches_banned_shapes():
    cases = {
        "이거 의도하신 거예요, 아니면 그냥 그렇게 나온 거예요?": "의도했나요 문형",
        "1.2초 멈추셨는데 그때 인물은 뭘 했을까요?": "계측치 나열",
        "대략 이십 초가 넘는 그 순간은 어땠어요?": "계측치 나열 (한글 숫자)",
        "조금 더 크게 해보세요, 어떠셨어요?": "처방·지시 문형",
        "진정성이 어떻게 보이길 원하셨어요?": "판정 어휘",
        "여쭤봐도 될까요, 그 순간 인물은요?": "메타 서두·허락 구하기",
        "두려움이 스쳤던 것처럼 보였는데 인물은 뭘 원했을까요?": "내면·감정을 관찰로 서술",
        "인물에게 더 나은 선택은 무엇이었을까요?": "정답 전제 — 최선의 행동을 묻는다",
    }
    for question, label in cases.items():
        assert label in lint_question(question), question


def test_lint_requires_hedge_on_observation():
    # 몸·소리 관찰을 단정하면 배우가 부정할 문이 닫힌다
    assert "관찰 인용에 hedge 없음" in lint_question("시선이 내려갔는데 인물은 뭘 봤을까요?")
    assert "관찰 인용에 hedge 없음" not in lint_question(
        "시선이 내려간 것처럼 보였는데 인물은 뭘 봤을까요?"
    )


def test_lint_blocks_binary_but_allows_scene_contrast():
    assert "이지선다 — 배우에게 보기를 줌" in lint_question(
        "인물이 화가 난 걸까요, 아니면 그냥 지친 걸까요?"
    )
    # 은행 원형(처음과 끝 대조)은 허용된 형태다
    assert "이지선다 — 배우에게 보기를 줌" not in lint_question(
        "처음과 끝에서 인물이 원하는 건 같은 걸까요, 달라졌을까요?"
    )


def test_lint_blocks_first_person_outside_quotes():
    assert "인물을 '나'로 지칭 — 주어가 배우로 넘어감" in lint_question(
        "내가 그때 원한 건 뭐였을까요?"
    )
    # 배우가 쓴 말을 인용한 안쪽의 '나'는 정상이다
    assert lint_question('"내가 그랬잖아" 하시던 순간, 인물은 뭘 원했을까요?') == []


def test_lint_blocks_answer_echo_opener():
    # 2026-07-28 실사용: 꼬리 질문 다섯 개가 전부 이 서두로 시작했다 (화법 규칙 10)
    for question in (
        "모르겠다고 하셨는데, 인물은 누구일까요?",
        "아직 친구와의 관계가 명확하지 않다고 하셨는데, 인물은 뭘 느끼고 있었을까요?",
        "말씀하신 '나'는 이 장면에서 누구와 함께 있는 인물일까요?",
    ):
        assert "배우 답변 되풀이 서두" in lint_question(question), question
    # 조각 하나를 인용하는 건 허용된 형태다
    assert lint_question('"난 그 말에 반대야" 하시던 순간, 인물은 뭘 지키려 했을까요?') == []


def test_lint_blocks_intensity_verdicts():
    # 표현의 세기를 매기면 관찰이 아니라 연기 평가다 (2026-07-28 실사용에서 새어나간 문장)
    real = (
        "배심원실에서 빈민촌 아이들에 대한 주장을 펼치는 장면입니다. "
        "'거짓말이야', '인간이 달라요' 같은 핵심 대사에서 감정의 고조가 약하게 표현된 것처럼 "
        "보였어요. 이 장면 내내 인물을 움직이게 한 생각들은 계속 같은 모습이었을까요, "
        "아니면 달라졌을까요?"
    )
    hits = lint_question(real)
    assert "연기 세기 판정" in hits
    assert "발화가 세 문장 이상 — 한두 문장으로" in hits

    for question in (
        "감정선이 밋밋해 보였는데 인물은 뭘 원했을까요?",
        "톤이 단조로웠던 것처럼 들렸는데 인물은 뭘 기다렸을까요?",
        "몰입이 부족해 보였는데 그 순간 인물은 뭘 했을까요?",
    ):
        assert "연기 세기 판정" in lint_question(question), question


def test_two_sentence_opener_is_allowed():
    # 오프너는 재진술 1줄 + 질문 1개 = 두 문장까지 허용된다
    assert (
        lint_question("배심원실에서 오가는 말이 팽팽했네요. 그 자리에서 인물은 뭘 지키려 했을까요?")
        == []
    )


def test_lint_blocks_strings_that_slipped_past_the_first_port():
    # Codex 교차검토(2026-07-28)가 "현재 통과한다"고 지적한 실제 문장들
    for question, label in (
        ("인물이 화가 난 건가요, 아니면 지친 건가요?", "이지선다 — 배우에게 보기를 줌"),
        ("연기가 아주 좋았어요. 인물은 뭘 원했을까요?", "좋다/나쁘다 판정"),
        ("합격할 만한 표현이었어요. 다음에는 뭘 해볼까요?", "판정 어휘"),
        ("피치가 낮아진 구간에서 인물은 뭘 원했을까요?", "1층 분석 어휘 노출"),
    ):
        assert label in lint_question(question), question


def test_first_person_check_does_not_fire_on_other_words():
    # '하나를'이 '나를'로 잡히던 오탐 (같은 리뷰 지적)
    assert lint_question("인물이 지키려던 건 하나를 고르는 일이었을까요?") == []


def test_clean_question_passes():
    assert lint_question("이 장면에서 인물이 원하는 게 뭐예요?") == []


def test_echo_hits_counts_input_words_reused():
    situation = "이별을 통보받은 직후 카페에서"
    goal = "담담한 척하며 붙잡고 싶다"
    echoed = "이별을 통보받은 직후 카페에서 담담한 척하며 붙잡고 싶으셨어요?"
    assert len(echo_hits(echoed, situation, goal)) >= ECHO_LIMIT
    # 읽어낸 형태는 입력 어절을 옮기지 않는다
    assert echo_hits("그 자리에서 인물이 지키려던 건 뭐였을까요?", situation, goal) == []


# 폴백은 가드를 우회해 그대로 배우에게 나간다. 목록 자체가 금지 문형을 밟으면
# 검사기를 통과하지 못한 문장이 사용자에게 도달한다.
def test_every_fallback_question_passes_the_lint():
    from acting_agent.guard import FALLBACK_QUESTIONS

    for question in FALLBACK_QUESTIONS:
        assert not lint_question(question), f"{question} → {lint_question(question)}"


def test_pick_fallback_skips_what_was_already_asked():
    from acting_agent.guard import FALLBACK_QUESTIONS, pick_fallback

    assert pick_fallback([]) == FALLBACK_QUESTIONS[0]
    assert pick_fallback([FALLBACK_QUESTIONS[0]]) == FALLBACK_QUESTIONS[1]
    assert pick_fallback(list(FALLBACK_QUESTIONS[:2])) == FALLBACK_QUESTIONS[2]
    # 앞뒤 공백이 붙어 들어와도 같은 질문으로 본다.
    assert pick_fallback([f"  {FALLBACK_QUESTIONS[0]}  "]) == FALLBACK_QUESTIONS[1]


# 다 써 버리면 None 을 돌려준다. 호출부(engine)가 이걸 보고 대화를 끝낸다 —
# 같은 질문을 또 던지느니 끝내는 게 낫다.
def test_pick_fallback_returns_none_when_all_used():
    from acting_agent.guard import FALLBACK_QUESTIONS, pick_fallback

    assert pick_fallback(list(FALLBACK_QUESTIONS)) is None
    assert pick_fallback(None) == FALLBACK_QUESTIONS[0]


# 물음표나 공백이 달라도 같은 질문으로 본다 — 모델이 문장부호만 바꿔 내놓는다.
def test_pick_fallback_ignores_punctuation_and_spacing():
    from acting_agent.guard import FALLBACK_QUESTIONS, pick_fallback

    first = FALLBACK_QUESTIONS[0]
    assert pick_fallback([first.replace("?", "")]) == FALLBACK_QUESTIONS[1]
    assert pick_fallback([first.replace(" ", "")]) == FALLBACK_QUESTIONS[1]
