"""시스템 프롬프트 렌더 + 턴별 사용자 메시지.

규칙은 `system_instruction` 으로 올리고, 장면·관찰·타깃 지시만 사용자 메시지로 넣는다.
규칙과 데이터를 한 덩어리로 보내면 모델이 규칙을 "참고 자료"로 취급해서, 모델이 약할수록
먼저 무너진다. 볼트 하네스 renderSystemPrompt / sceneBlock 을 옮겨 온 것이다.
"""

from functools import lru_cache
from typing import Optional

from acting_agent.knowledge import load
from acting_agent.targeting import Context, Target, usable


def _render_system_prompt(with_follow_up: bool) -> str:
    inj = load()
    p: list[str] = [inj["persona"], ""]

    p.append("생성 절차 — 반드시 이 순서로:")
    p.append(
        "1단계 (analysis, 내부 전용 — 배우에게 절대 노출되지 않는다): "
        + inj["generation_process"]["step1_internal_analysis"]
    )
    p.append(
        "2단계 (question): 1단계 분석에서 [타깃 지시]에 맞는 질문 하나를 꺼내라. "
        "규칙(관찰 hedge 인용 + 인물 언어)을 지켜라."
    )
    if inj["generation_process"].get("archetype_shaping"):
        p.append("- " + inj["generation_process"]["archetype_shaping"])
    p.append("")

    input_model = inj.get("input_model")
    if input_model:
        p.append("[배우에게 받는 입력 — 이 셋뿐이다]")
        p += [f"- {f}" for f in input_model["fields"]]
        p.append(f"- {input_model['not_collected']}")
        p.append(f"- {input_model['goal_filled_rule']}")
        p.append(f"- {input_model['empty_field_rule']}")
        p.append("")

    decl = inj["declarations"]
    p.append("[전제 선언]")
    p.append(f"- {decl['purpose']}")
    p.append(f"- {decl['acting_view']}")
    if decl.get("material"):
        p.append(f"- {decl['material']}")
    p.append("")

    tr = inj["translation_rule"]
    p.append("[번역 규칙]")
    p.append(f"- {tr['rule']}")
    p.append(f"- 장면 지칭: {tr['moment_reference']}")
    p.append(f"- {tr['no_phenomenon_only_turn']}")
    if tr.get("observation_first"):
        p.append(f"- {tr['observation_first']}")
    p.append("- 질문은 한 번에 하나만.")
    p.append("")

    p.append("[금지 문형 — 하나라도 쓰면 실패]")
    for b in inj["banned_patterns"]:
        p.append(f"- {b['pattern']} ({b['reason']})")
        if b.get("distinction"):
            p.append(f"  ↳ {b['distinction']}")
    p.append("")

    p.append("[화법 규칙]")
    p += [f"- {r}" for r in inj.get("style_rules", [])]
    p.append("")

    md = inj["misread_defense"]
    p.append("[오독 방어]")
    p.append(f"- {md['confidence_gate']}")
    p.append(f"- {md['accepted_definition']}")
    p.append(f"- {md['refutation_path']}")
    p.append("")

    p.append("[관찰 귀속 — 어디서 온 근거인지 문장에서 구분한다]")
    p += [f"- {v}" for v in (inj.get("attribution_rule") or {}).values()]
    p.append("")

    p.append("[개념 카드 — 분석과 질문 선택에 쓴다. 설명은 배우가 물을 때만 2~3문장]")
    p += [f"- {c['name']}: {c['gist']} (쓰임: {c['use']})" for c in inj["concept_cards"]]
    p.append("")

    p.append("[개념 사용 규칙]")
    p += [f"- {r}" for r in inj.get("concept_usage_rules", [])]
    p.append("")

    p.append("[좋은/나쁜 예시]")
    for f in inj["few_shot"]:
        p.append(f"- 관찰: {f['observation']}")
        p.append(f"  ❌ {f['bad']}")
        p.append(f"  ✅ {f['good']}")

    if with_follow_up:
        p.append("")
        p.append("[꼬리 질문 규칙]")
        p += [f"- {r}" for r in inj["follow_up_rules"]]
        p.append(
            "- 배우가 '인물이 원하는 것'을 말한 뒤에는, [제시된 관찰] 중 타깃 하나를 hedge로"
            " 인용해 인물 언어 질문으로 연결해도 된다. 단 세션 내내 타깃은 그 하나만 —"
            " 다른 관찰을 새로 꺼내지 않는다."
        )
        p.append(
            "- close 판단: 배우가 의도와 실제의 차이(또는 자기 발견)를 스스로 한 문장으로"
            " 말했으면 close=true로 하고, question에는 새 질문 없이 대화를 담백하게 인정하며"
            " 닫는 한마디를 담는다. 연기 평가·칭찬은 금지."
        )

    return "\n".join(p)


@lru_cache(maxsize=2)
def system_prompt(with_follow_up: bool) -> str:
    return _render_system_prompt(with_follow_up)


def scene_block(ctx: Context) -> str:
    # 규칙을 프롬프트 멀리 두면 모델이 목표 문장을 통째로 옮긴다 → 제약을 데이터 옆에 붙인다.
    return "\n".join(
        [
            "[이 장면의 입력]",
            f"- 상황: {usable(ctx.input.situation) or '(입력 없음)'}",
            f"- 인물: {usable(ctx.input.character) or '(입력 없음)'}",
            f"- 목표: {usable(ctx.input.goal) or '(입력 없음)'}",
            "  ↳ 위 세 줄의 표현을 그대로 옮겨 쓰지 않는다. 가리켜야 하면 '적어 두신 목표'·"
            "'처음에 쓰신 상황'처럼 지칭한다.",
        ]
    )


def first_user_message(ctx: Context, target: Target) -> str:
    lines = [scene_block(ctx), ""]
    if target.use_observation and target.signal is not None:
        lines += [
            "[이 질문의 근거 관찰 — hedge를 붙여 한 줄만 인용한다. 다른 관찰은 꺼내지 않는다]",
            f"- {target.signal.name}: {target.signal.evidence}",
            "",
        ]
    lines.append(f"[타깃 지시 — 코드가 선정함: {target.why}]")
    lines.append(f'- 은행 원형({target.row["category"]}): "{target.row["question"]}"')
    lines.append("- 첫 발화다: 장면 이해 재진술 1줄(입력 근거로만) 뒤에 이 질문을 자연스럽게 잇는다.")
    if target.use_observation:
        lines.append("- 관찰 한 줄을 hedge로 인용해 근거로 삼되, 질문은 인물 쪽을 향한다.")
    else:
        # 입력 기반 타깃은 인용할 관찰이 없다 → 오프너가 쓸 재료가 입력뿐이라 요약으로
        # 흐른다. 그래서 요약 시작을 아예 막는다.
        lines.append(
            "- 아직 관찰은 인용하지 않는다 — 관찰은 배우가 답한 뒤에 쓴다.\n"
            "- 입력을 요약하는 문장으로 시작하지 않는다. 입력끼리 부딪히는 지점이 보이면"
            " 그것만 한 줄로 짚고, 보이지 않으면 첫 줄을 생략하고 질문 한 문장만 낸다."
        )
    return "\n".join(lines)


def followup_user_message(
    ctx: Context,
    history: list[tuple[str, str]],
    actor_text: str,
    candidate_signal: Optional[object],
    candidate_row: Optional[dict],
    stuck: bool,
    converging: bool,
) -> str:
    lines = [scene_block(ctx), ""]
    lines.append("[지금까지 대화]")
    for role, text in history:
        lines.append(f"{'코치' if role == 'ai' else '배우'}: {text}")
    lines.append("")
    lines.append("[방금 배우 답변]")
    lines.append(actor_text)
    lines.append("")
    if candidate_signal is not None:
        lines += [
            "[제시된 관찰 — 아직 쓰지 않은 것. 쓸 만하면 hedge로 한 줄만 인용한다]",
            f"- {candidate_signal.name}: {candidate_signal.evidence}",  # type: ignore[attr-defined]
            "",
        ]
    lines.append("[타깃 지시]")
    if candidate_row is not None:
        lines.append(f'- 은행 원형({candidate_row["category"]}): "{candidate_row["question"]}"')
    lines.append("- 꼬리 질문이다: 방금 답변에서 출발한다. 새 현상 지적으로 시작하지 않는다.")
    if stuck:
        lines.append(
            "- 배우가 스스로 막혔다고 말했다: 관점 두 개를 고르게 하지 말고 다시 볼 지점"
            " 하나를 가리키는 scaffold를 준다."
        )
    if converging:
        lines.append(
            "- 수렴 구간이다: 새 갈래를 열지 말고 배우가 자기 문장으로 정리하도록 이끈다."
        )
    return "\n".join(lines)
