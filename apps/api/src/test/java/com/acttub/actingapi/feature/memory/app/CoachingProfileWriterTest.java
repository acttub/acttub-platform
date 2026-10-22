package com.acttub.actingapi.feature.memory.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

/** 일반 배우의 맞춤 코칭은 자문위원 파일과 같은 모양이고, 근거·진단·장면 규칙을 지킨다 (SOMA-795). */
class CoachingProfileWriterTest {

    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private final CoachingProfileWriter writer = new CoachingProfileWriter();
    private final List<String> calls = new ArrayList<>();

    private static ProfileMaterial.Conversation conversation(int replies, String rating, List<String> corrections) {
        List<ProfileMaterial.Turn> turns = new ArrayList<>();
        turns.add(new ProfileMaterial.Turn("ai", "확인하며 말해 볼까요? 상대에게 무엇을 바라요?"));
        for (int i = 0; i < replies; i++) turns.add(new ProfileMaterial.Turn("actor", "(방법 요청) 그래서 어떻게 해요?"));
        return new ProfileMaterial.Conversation("2026-10-21", "user_ended", replies, turns, rating, null, corrections);
    }

    private static ProfileMaterial material(List<ProfileMaterial.Conversation> conversations, List<String> scene) {
        return new ProfileMaterial(USER, conversations, Map.of("tone", "짧게 존댓말로 답한다"), null, scene);
    }

    private String respond(String json, ProfileMaterial material) {
        return writer.write(material, (system, user) -> {
            calls.add(user);
            return json;
        }).orElse("");
    }

    private static final String GOOD = """
            {"length": 120,
             "summary": "이 배우는 방법을 바로 들을 때 다음 테이크로 옮겼고, 질문만 이어지면 \\"그래서 어떻게 해요?\\"라고 되물었다.",
             "first_question": "첫 응답의 <설계>에서 '첫 질문 모양' 칸에는 \\"[인물]은 [상대]한테서 뭘 얻고 싶어요?\\"를 쓰고 <코치>는 그 모양으로 묻는다.",
             "closing": "마지막 정리는 맨 첫 줄의 숨은 <다음 테이크> 줄을 그대로 쓰고, 해 볼 것 하나와 이유 한 문장으로 말한다.",
             "never_say": ["확인하며", "좋은 질문이에요"],
             "reasons": "제안에는 항상 이유를 한 문장 붙인다.",
             "when_asked": "배우가 \\"어떻게 해요?\\"라고 물으면 질문으로 돌리지 않고 방법부터 답한다.",
             "other_rules": ["이 배우는 혼자 감정에 빠지는 버릇이 있으니 상대를 보게 한다.", "아버지에게서 인정받으려는 마음을 숨긴다는 것을 기억한다.", "배우가 반말을 쓰므로 코치도 반말을 사용한다."]}
            """;

    @Test
    void theProfileHasTheAdvisorFileShape() {
        String profile = respond(GOOD, material(List.of(conversation(2, null, List.of()), conversation(3, null, List.of())),
                List.of("아버지에게서 인정받으려는 마음을 숨긴다")));
        List<String> lines = profile.lines().toList();
        assertThat(lines.get(0)).isEqualTo("[길이] 120");
        assertThat(lines.get(1)).isEqualTo("[이 배우에게 맞춘 코칭]");
        assertThat(lines.get(2)).startsWith("아래는 이 배우가 지난 대화에서");
        assertThat(lines.get(3)).startsWith("이 배우는 방법을 바로 들을 때");
        assertThat(lines.subList(4, lines.size())).allSatisfy(line -> assertThat(line).startsWith("- "));
        assertThat(profile)
                .contains("- 첫 응답의 <설계>에서 '첫 질문 모양' 칸에는")
                .contains("- 이 배우에게는 다음 말을 한 번도 쓰지 않는다: \"확인하며\".")
                .endsWith("- 한 번에 하는 말은 공백 포함 120자 안쪽이다.");
        assertThat(profile.length()).isLessThanOrEqualTo(CoachingProfileWriter.MAX_CHARS);
    }

    @Test
    void diagnosesSceneContentAndPhrasesTheCoachNeverSaidAreDropped() {
        String profile = respond(GOOD, material(List.of(conversation(2, null, List.of()), conversation(3, null, List.of())),
                List.of("아버지에게서 인정받으려는 마음을 숨긴다")));
        assertThat(profile)
                .doesNotContain("버릇")
                .doesNotContain("반말")
                .doesNotContain("아버지에게서")
                .doesNotContain("좋은 질문이에요");
    }

    @Test
    void theLengthLineStaysInsideTheBounds() {
        var material = material(List.of(conversation(2, "helpful", List.of())), List.of());
        assertThat(respond(GOOD.replace("\"length\": 120", "\"length\": 400"), material)).startsWith("[길이] 160\n");
        assertThat(respond(GOOD.replace("\"length\": 120", "\"length\": 10"), material)).startsWith("[길이] 60\n");
        assertThat(respond(GOOD.replace("\"length\": 120,", ""), material)).startsWith("[길이] 90\n");
    }

    @Test
    void withoutEnoughEvidenceTheModelIsNotCalled() {
        assertThat(respond(GOOD, material(List.of(conversation(2, null, List.of()), conversation(1, null, List.of())), List.of())))
                .isEmpty();
        assertThat(calls).isEmpty();
        assertThat(CoachingProfileWriter.enoughEvidence(material(List.of(conversation(1, "not_helpful", List.of())), List.of())))
                .isTrue();
        assertThat(CoachingProfileWriter.enoughEvidence(material(
                List.of(conversation(1, null, List.of("호흡: \"그건 일부러예요\""))), List.of()))).isTrue();
    }

    @Test
    void anEmptyOrThinAnswerWritesNothing() {
        var material = material(List.of(conversation(2, "helpful", List.of())), List.of());
        assertThat(respond("{}", material)).isEmpty();
        assertThat(respond("not json", material)).isEmpty();
        assertThat(respond("{\"summary\": \"이 배우는 방법을 바로 들을 때 다음 테이크로 옮겼다.\", \"reasons\": \"제안에는 이유를 붙인다.\"}",
                material)).as("규칙이 둘보다 적으면 쓰지 않는다").isEmpty();
    }

    @Test
    void thePromptCarriesCoachAndActorTurnsRatingsAndTheCurrentProfileButNoSceneTexts() {
        var conversations = List.of(conversation(2, "not_helpful", List.of("시선: \"일부러 피한 거예요\"")),
                conversation(2, null, List.of()));
        respond(GOOD, new ProfileMaterial(USER, conversations, Map.of("wants", "방법을 바로 알려 주길 바란다"),
                "[길이] 80\n[이 배우에게 맞춘 코칭]\n지난 글", List.of("비밀 장면 내용")));
        assertThat(calls).singleElement().satisfies(prompt -> assertThat(prompt)
                .contains("코치: 확인하며 말해 볼까요?")
                .contains("배우: (방법 요청) 그래서 어떻게 해요?")
                .contains("코칭 노트 평가: 도움 안 됨")
                .contains("배우가 아니라고 한 것: 시선: \"일부러 피한 거예요\"")
                .contains("지난 글")
                .contains("- 코치에게 바라는 것: 방법을 바로 알려 주길 바란다")
                .doesNotContain("비밀 장면 내용"));
    }

    private static java.util.Optional<String> check(String line) {
        return CoachingProfileWriter.problem(line, java.util.Set.of());
    }

    @Test
    void rulesThatBreakTheCommonBansAreDroppedButRulesThatRepeatTheBansStay() {
        // 2026-10-22 표본 c24328 이 권한 줄.
        assertThat(check("첫 질문은 장면 전체에서 [인물]이 [상대]에게 하려는 일을 짧은 선택형으로 묻는다.")).isPresent();
        assertThat(check("배우가 막히면 두 가지 가능성으로 바로 좁혀 묻고, 여러 질문으로 이어 가지 않는다.")).isPresent();
        assertThat(check("막히면 \"따질래요, 달랠래요?\"처럼 묻는다.")).contains("공통 금지(양자택일 질문)");
        assertThat(check("제안은 상대의 눈을 확인하며 말하는 쪽으로 한다.")).contains("공통 금지 표현(확인하며 등)");
        assertThat(check("배우가 답하면 먼저 잘했다고 칭찬한다.")).contains("공통 금지(칭찬·감상)");
        assertThat(check("방향은 \"~하세요\"로 분명하게 말한다.")).contains("공통 금지(시키는 말)");

        assertThat(check("둘 중 고르게 하는 질문(\"~할래요, ~할래요?\")을 쓰지 않는다.")).isEmpty();
        assertThat(check("선택지를 연달아 제시하지 말고 장면 전체에 대해 한 번만 묻는다.")).isEmpty();
        assertThat(check("칭찬, 감상을 하지 않는다.")).isEmpty();
        // 문단의 근거 문장: 선택지가 안 통했다는 말은 선택형을 권하지 않는다(2026-10-22 표본 c24328).
        assertThat(check("반대로 선택지를 붙이거나 해석을 확인하는 질문이 이어지면 \"그만\"이라고 대화를 끝냈다.")).isEmpty();
        assertThat(check("두 가지 중 고르게 물을 때 잘 답했다.")).isPresent();
        assertThat(check("시키는 말(\"~하세요\", \"~마세요\")을 쓰지 않는다. 방향은 \"~해 봐도 좋아요\"로 말한다.")).isEmpty();
    }

    @Test
    void oneScenesInterpretationDoesNotBecomeAnActorRule() {
        // 2026-10-22 표본 891930 의 문단·규칙 — 한 장면의 인물 해석이다.
        assertThat(check("배우가 상대의 반응을 끌어내려는 것이 아니라고 정정했으므로, 코치가 목표를 임의로 정하지 않는다.")).isPresent();
        assertThat(check("배우가 말한 의도와 정정을 우선하고, 상대에게 특정 반응을 얻어 내고 싶다고 임의로 바꾸지 않는다.")).isPresent();
        assertThat(check("배우가 정정하면 첫 짐작을 버리고 배우 말을 기준으로 다시 제안한다.")).isEmpty();
    }

    @Test
    void aSummarySentenceThatBreaksABanIsDroppedAndTheRestStays() {
        String json = GOOD.replace("라고 되물었다.\",", "라고 되물었다. 상대의 눈·표정을 확인하며 마음을 전하는 제안이 도움됐다고 평가했다.\",");
        String profile = respond(json, material(List.of(conversation(2, "helpful", List.of())), List.of()));
        assertThat(profile).contains("라고 되물었다.\n").doesNotContain("확인하며 마음을");
    }
}

