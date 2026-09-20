package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.support.FrozenValue;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 코치 프롬프트가 <b>한 글자도 바뀌지 않았는지</b> 확인한다. 기대값은 {@code frozen/} 의
 * 커밋된 fixture 이고, 왜 커밋해도 되는지는 {@link FrozenValue} 에 있다.
 */
class CoachPromptSnapshotTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Test
    void oldPackWithoutTimelineOrSpeechStillBuildsForEveryBranch() throws Exception {
        JsonNode old = observationPack();
        assertThat(old.has("timeline")).isFalse();
        assertThat(old.has("speech")).isFalse();
        for (String kind : List.of("분석", "표현", "그 외")) {
            var session = snapshot(old, kind, "그 외", "", List.of(), "", null, List.of());
            String prompt = CoachPrompt.buildChat(session, "이유를 모르겠어요");
            assertThat(prompt).contains("여자가 문 앞에서", "가지 마", "얼굴은 확인되지 않음");
        }
    }

    @Test
    void newPackIsReadInSceneTimelineSpeechObservationUncertaintyOrder() throws Exception {
        var pack = (com.fasterxml.jackson.databind.node.ObjectNode) observationPack();
        pack.put("timeline", "0:01에 멈추며 시선을 옮긴다");
        pack.set("speech", OBJECT_MAPPER.readTree("{\"transcript\":\"가지 마\",\"avg_syllables_per_sec\":7.0}"));
        var session = snapshot(pack, "분석", "그 외", "", List.of(), "", null, List.of());
        String prompt = CoachPrompt.buildChat(session, "모르겠어요");
        int previous = -1;
        for (String field : List.of("scene_summary", "timeline", "speech", "observations", "uncertainties")) {
            int index = prompt.indexOf("\"" + field + "\"");
            assertThat(index).as(field).isGreaterThan(previous);
            previous = index;
        }
        assertThat(prompt).contains("0:01에 멈추며 시선을 옮긴다", "\"avg_syllables_per_sec\":7.0");
    }

    @Test
    void measuredSpeechIsStillAvailableWhenThereAreNoVisualObservations() throws Exception {
        var pack = OBJECT_MAPPER.readTree("""
                {"timeline":"0:01에 대사가 들린다", "speech":{"transcript":"가지 마"},
                 "observations":[], "uncertainties":["사람이 화면 밖"]}
                """);
        var session = snapshot(pack, "분석", "그 외", "", List.of(), "", null, List.of());
        assertThat(CoachPrompt.buildChat(session, "모르겠어요"))
                .contains("\"speech\":{\"transcript\":\"가지 마\"}", "사람이 화면 밖");
    }

    /** 두 줄짜리 받아쓴 대사 — 칸이 여러 줄을 목록으로 적는지 보이려고 둘을 쓴다. */
    private static final List<String> TRANSCRIPTS = List.of("가지 마", "제발");

    private static final Map<String, String> SYSTEM_PROMPT_BY_KIND = Map.of(
            "분석", "coach-system-prompt-analysis.txt",
            "표현", "coach-system-prompt-expression.txt",
            "그 외", "coach-system-prompt-other.txt");

    @Test
    @DisplayName("공통 응답 정책 앞의 갈래별 본문은 동결된 값을 유지한다")
    void selectedPromptsMatchFrozenValues() {
        SYSTEM_PROMPT_BY_KIND.forEach((kind, fixture) ->
                assertThat(CoachPrompt.select(kind))
                        .as("blockage_kind=%s 시스템 프롬프트", kind)
                        .startsWith(FrozenValue.of(fixture) + "\n\n# 현재 요청에 맞춰 돕기"));
    }

    @Test
    @DisplayName("buildChat 의 직렬화 문자열이 동결된 값과 완전히 같다")
    void chatPromptMatchesFrozenValue() throws Exception {
        assertThat(CoachPrompt.buildChat(expressionSession(List.of()), "이번에는 멈춰봤어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt.txt"));
    }

    /**
     * 받아쓴 대사 칸은 SOMA-490 에서 사라졌다 — 대사는 관찰의 {@code quote} 로 이미
     * 프롬프트에 들어 있고, 같은 말을 두 번 실으면 코치가 그 목록만 붙잡고 말한다. 지난
     * 연습에 남아 있는 대사 행이 프롬프트를 <b>바꾸지 않는다</b>는 것을 여기서 고정한다.
     */
    @Test
    @DisplayName("남아 있는 받아쓴 대사는 프롬프트를 바꾸지 않는다")
    void leftoverTranscriptsDoNotChangeThePrompt() throws Exception {
        assertThat(CoachPrompt.buildChat(expressionSession(TRANSCRIPTS), "이번에는 멈춰봤어요"))
                .isEqualTo(CoachPrompt.buildChat(expressionSession(List.of()), "이번에는 멈춰봤어요"));
    }

    /**
     * 그 외 갈래는 영상부터 시작하는 기본 코치를 쓰되 표현 전용 칸 없이 간다. 갈래가 {@code 그 외} 이므로 막힘
     * 미특정 블록이 붙는다 — 코치가 막힘을 지어내지 않고 영상에서 확인된 것으로 대화를 연다.
     */
    @Test
    @DisplayName("그 외 갈래에는 막힘 미특정 블록이 붙는다")
    void otherSessionMatchesFrozenValue() throws Exception {
        assertThat(CoachPrompt.buildChat(otherSession(), "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-other.txt"));
    }

    /**
     * 장면도 막힘도 건너뛴 세션 — 웹·앱 어느 쪽이든 둘 다 건너뛰면 이렇게 온다. 두 블록이
     * 장면·막힘 순으로 나란히 붙되 장면 질문이나 고정 진행 순서를 강제하지 않는다.
     */
    @Test
    @DisplayName("장면도 막힘도 건너뛴 그 외 갈래에는 두 블록이 장면·막힘 순으로 붙는다")
    void otherSessionWithBlankSceneMatchesFrozenValue() throws Exception {
        assertThat(CoachPrompt.buildChat(withScene(otherSession(), "", "", ""), "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-other-blank-scene.txt"));
    }

    @Test
    void videoOnlyFollowUpPreservesCorrectionWithoutReopeningContextInterview() throws Exception {
        var session = withScene(otherSession(), "", "", "").withTurns(List.of(
                new CoachTurnSnapshot("actor", "그 외"),
                new CoachTurnSnapshot("ai", "마지막 대사를 살펴볼게요."),
                new CoachTurnSnapshot("actor", "학생들에게 제 경험담이라고 오해받지 않으려는 거예요."),
                new CoachTurnSnapshot("ai", "경험담으로 오해받지 않으려는 뜻으로 볼게요.")))
                .withPrior(new PriorContext(Map.of("goal", "발음을 또렷하게 말하기"),
                        null, false, List.of(), List.of()));
        String input = CoachPrompt.buildChat(session, "그래서 어떻게 해요?");
        assertThat(input).contains("학생들에게 제 경험담이라고 오해받지 않으려는 거예요.",
                        "대화에서 이미 알려준 맥락은 다시 묻지 않는다.", "현재 응답: 3번째")
                .doesNotContain("1~2번째 응답 안에서", "현재 구간:", "자연스러운 자리에서 한 번은")
                .doesNotContain("질문 하나로 시작한다")
                .contains("지난 기록을 이번 장면의 목표·의도로 확정하지 않는다.");
    }

    /**
     * 빈 칸은 <b>줄 자체를 만들지 않는다</b>(ADR-021). 셋이 모두 비면 장면 맥락 미입력
     * 블록이 붙어 코치가 첫 한두 응답에서 영상 근거로 장면을 묻는다(ADR-021 개정). {@code 그 외}
     * 하위 갈래는 "특정하지 않음" 으로 적는다 — 직접 고른 사람과 안 고른 사람을 서버가 구분할
     * 수 없는데 그 표현은 <b>양쪽 모두에게 참</b>이다. 같은 이유로 갈래가 분석이고 하위 갈래만
     * {@code 그 외} 인 이 세션에는 막힘 미특정 블록이 붙지 않는다.
     */
    @Test
    @DisplayName("세 칸 모두 빈 장면에는 미입력 블록이 붙고, 하위 갈래만 '그 외' 면 막힘 미특정 블록은 붙지 않는다")
    void blankSceneChatPromptMatchesFrozenValue() {
        assertThat(CoachPrompt.buildChat(blankSceneSession("", "", ""), "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-blank-scene.txt"));
    }

    /** 판정은 {@code isBlank()} 다 — 웹의 {@code .trim()} 에 기대지 않는다. */
    @Test
    @DisplayName("공백만 든 칸도 빈 칸과 같은 프롬프트를 낸다")
    void whitespaceOnlySceneIsTreatedAsBlank() {
        assertThat(CoachPrompt.buildChat(blankSceneSession(" ", "\t", "\n"), "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-blank-scene.txt"));
    }

    /**
     * 장면을 <b>적어 온</b> 배우의 프롬프트도 바뀐 자리다 — 지금까지는 상세가 비면
     * {@code - 배우가 쓴 상세: } 가 빈 채로 들어갔다.
     */
    @Test
    @DisplayName("장면은 다 적고 상세만 빈 경우 상세 줄만 빠진다")
    void blankDetailAloneDropsOnlyItsLine() {
        CoachSessionSnapshot blankDetail = sceneSession(
                "연습실", "지원자", "담담하게 말한다", "대사 분석", "");
        assertThat(CoachPrompt.buildChat(blankDetail, "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-blank-detail.txt"));
    }

    /** 일부만 비면 그 줄만 빠진다 — 부재를 말하지 않고 장면 맥락 미입력 블록도 붙지 않는다. */
    @Test
    @DisplayName("일부만 빈 장면은 그 줄만 빠지고 장면 맥락 미입력 블록이 붙지 않는다")
    void partiallyBlankSceneChatPromptMatchesFrozenValue() {
        CoachSessionSnapshot partial = sceneSession(
                "", "", "담담하게 말한다", "대사 분석", "이유를 모르겠다");
        assertThat(CoachPrompt.buildChat(partial, "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-partial-scene.txt"));
    }

    @Test
    @DisplayName("buildRegeneration 이 동결된 값과 완전히 같다")
    void regenerationMatchesFrozenValue() {
        assertThat(CoachPrompt.buildRegeneration(
                analysisSession(),
                "잘 모르겠어요",
                "{\"message\":\"점수\"}",
                List.of("금지어가 노출됐습니다: 점수", "응답에 시각이 들어 있습니다.")))
                .isEqualTo(FrozenValue.of("coach-regeneration-prompt.txt"));
    }

    // ---- account.profile: 코치 대화가 프로필을 읽는다 ----

    private static final ActorProfile PROFILE = new ActorProfile(
            "김배우", "여성", 25, List.of("매체(TV·영화)", "무대(연극·뮤지컬)"), "1–3년", "전문 배우");

    private static final String PROFILE_BLOCK = """
            ## 배우 프로필
            배우가 직접 저장한 현재 정보다. 영상·인물의 근거가 아니며 다시 입력하도록 묻지 않는다. 아래 기억이나 이전 대화와 다르면 현재 프로필 값을 우선한다.
            이름은 필요할 때만 호칭으로 쓴다 — 한국어로는 이름 뒤에 '님'을 붙이고, 영어로는 이름 그대로 부른다.
            - 이름: 김배우
            - 성별: 여성
            - 만 나이: 25세
            - 추구하는 방향: 매체(TV·영화), 무대(연극·뮤지컬)
            - 연기 경력: 1–3년
            - 최종 목표: 전문 배우

            """;

    /**
     * 완성된 프로필은 <b>맨 앞의 독립 블록 하나</b>로만 실린다. 그 뒤는 프로필이 없던 때의 프롬프트와
     * 글자 하나 다르지 않다 — 기존 고정값을 그대로 기준으로 쓴다(다시 뜨지 않는다).
     */
    @Test
    @DisplayName("account.profile: 프로필 블록은 맨 앞에 붙고 나머지는 동결된 값 그대로다 — 시작·후속·재생성")
    void actorProfileIsPrependedAndNothingElseChanges() throws Exception {
        assertThat(CoachPrompt.buildChat(otherSession().withActorProfile(PROFILE), "잘 모르겠어요"))
                .as("대화를 여는 첫 응답")
                .isEqualTo(PROFILE_BLOCK + FrozenValue.of("coach-chat-prompt-other.txt"));
        assertThat(CoachPrompt.buildChat(expressionSession(List.of()).withActorProfile(PROFILE), "이번에는 멈춰봤어요"))
                .as("후속 응답")
                .isEqualTo(PROFILE_BLOCK + FrozenValue.of("coach-chat-prompt.txt"));
        assertThat(CoachPrompt.buildRegeneration(
                analysisSession().withActorProfile(PROFILE),
                "잘 모르겠어요",
                "{\"message\":\"점수\"}",
                List.of("금지어가 노출됐습니다: 점수", "응답에 시각이 들어 있습니다.")))
                .as("재생성")
                .isEqualTo(PROFILE_BLOCK + FrozenValue.of("coach-regeneration-prompt.txt"));
    }

    /** 게스트와, 프로필을 아직 다 채우지 않은 회원은 포트가 {@code null} 을 준다. */
    @Test
    @DisplayName("account.profile: 프로필이 없으면 프롬프트가 바이트 단위로 전과 같다")
    void withoutAProfileThePromptIsByteForByteTheSame() throws Exception {
        assertThat(CoachPrompt.actorProfileBlock(null)).isEmpty();
        assertThat(CoachPrompt.buildChat(expressionSession(List.of()).withActorProfile(null), "이번에는 멈춰봤어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt.txt"));
        assertThat(CoachPrompt.buildChat(otherSession().withActorProfile(null), "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-other.txt"));
    }

    /**
     * 기억과 프로필이 함께 있는 프롬프트 전체를 고정한다. 기억의 성별·나이는 빠지고(프로필이 정본이다)
     * 배우가 말한 목표는 남는다 — 프로필의 최종 목표와 결이 달라 서로 보완한다.
     */
    @Test
    @DisplayName("account.profile: 프로필과 기억이 함께 있는 프롬프트가 동결된 값과 완전히 같다")
    void chatPromptWithProfileAndMemoryMatchesFrozenValue() throws Exception {
        var session = expressionSession(List.of())
                .withPrior(new PriorContext(
                        Map.of("gender", "남", "age", "31", "goal", "입시 합격"),
                        null, true, List.of("첫 대사 앞에서 한 박자 쉬어 보기"), List.of()))
                .withActorProfile(PROFILE);

        String prompt = CoachPrompt.buildChat(session, "이번에는 멈춰봤어요");

        assertThat(prompt).isEqualTo(FrozenValue.of("coach-chat-prompt-actor-profile.txt"));
        assertThat(prompt)
                .contains("- 성별: 여성", "- 만 나이: 25세", "- 배우가 말한 목표: 입시 합격")
                .doesNotContain("- 성별: 남\n", "- 나이: 31");
        assertThat(prompt.indexOf("## 배우 프로필"))
                .as("프로필 블록이 기억 블록 앞이다")
                .isLessThan(prompt.indexOf("## 배우에 대해 지금까지 알고 있는 것"));
    }

    @Test
    @DisplayName("account.profile: 성별이 '선택 안 함'이어도 옛 기억의 성별로 보충하지 않는다")
    void unspecifiedGenderIsNotFilledFromOldMemory() throws Exception {
        var unspecified = new ActorProfile("김배우", "선택 안 함", 25, List.of("무대(연극·뮤지컬)"), "입시생", "취미");
        var session = otherSession()
                .withPrior(new PriorContext(Map.of("gender", "남", "age", "31"), null, true, List.of(), List.of()))
                .withActorProfile(unspecified);

        String prompt = CoachPrompt.buildChat(session, "잘 모르겠어요");

        assertThat(prompt).contains("- 성별: 선택 안 함", "- 추구하는 방향: 무대(연극·뮤지컬)")
                .doesNotContain("- 성별: 남", "- 나이: 31")
                // 기억에 성별·나이만 있었다. 빼고 나면 남는 것이 없어 기억 블록 자체가 없다.
                .doesNotContain("## 배우에 대해 지금까지 알고 있는 것");
    }

    /** 기억 블록은 1,200자에서 잘린다. 프로필은 그 예산 밖이다 — 배우가 지금 저장해 둔 값이 잘리면 안 된다. */
    @Test
    @DisplayName("account.profile: 지난 것이 길어도 프로필 블록은 잘리지 않는다")
    void longPriorContextNeverClipsTheProfile() throws Exception {
        var session = otherSession()
                .withPrior(new PriorContext(Map.of("goal", "가".repeat(3000)), null, true, List.of(), List.of()))
                .withActorProfile(PROFILE);

        String prompt = CoachPrompt.buildChat(session, "잘 모르겠어요");

        assertThat(prompt).startsWith(PROFILE_BLOCK);
        String priorBlock = prompt.substring(PROFILE_BLOCK.length(), prompt.indexOf("## 배우가 쓴 것"));
        assertThat(priorBlock.strip().codePointCount(0, priorBlock.strip().length())).isEqualTo(1200);
    }

    /** 응답 번호는 코치 turn 수 + 1 이다 — 프롬프트의 "현재 응답: N번째" 와 같은 셈이다. */
    @Test
    @DisplayName("응답 번호는 코치 turn 수에 1을 더한 값이다")
    void turnNumberCountsAiTurnsPlusOne() throws Exception {
        assertThat(CoachPrompt.turnNumber(otherSession())).isEqualTo(1);
        assertThat(CoachPrompt.turnNumber(expressionSession(List.of()))).isEqualTo(2);
    }

    /**
     * 지시문 텍스트만 대조하면 부착 <b>조건</b>이 틀려도 초록이 된다. 실제로 그랬다 --
     * 옛 구현이 {@code contains("끝")} 이라 "이제 끝"·"끝까지 해볼게요" 같은 정상 답변에도
     * 지시문을 붙였는데, 기대값을 무조건 이어붙여 만든 탓에 통과했다. 그래서 동결된 값은
     * <b>판정을 통과시킨 결과</b>다 — 열 갈래 중 어느 것에 지시문이 붙는지가 그 안에 있다.
     */
    @Test
    @DisplayName("마무리 요청 판정과 지시문이 동결된 값과 완전히 같다")
    void closingInstructionMatchesFrozenValue() {
        List<String> cases = List.of(
                "이제 끝", "끝", "그만", "종료", "여기까지",
                "끝까지 해볼게요", "여기서 그만할게", "안 그만할래요", "그렇그만", "이제 그만");

        List<String> actual = cases.stream().map(CoachEngine::messageForGeneration).toList();

        assertThat(String.join("\n---\n", actual))
                .isEqualTo(FrozenValue.of("coach-closing-instruction.txt"));
    }

    private static CoachSessionSnapshot expressionSession(List<String> transcripts)
            throws Exception {
        JsonNode handoff = OBJECT_MAPPER.readTree("""
                {"blocked_point":"말의 이유","line_meaning":"떠나지 말라는 뜻",
                 "timing_reason":"상대가 돌아섰기 때문","target_effect":"멈춰 세우기",
                 "scene_evidence":["상대가 돌아선다"],"actor_words":["붙잡고 싶다"]}
                """);
        return snapshot(
                observationPack(), "표현", "속도", "자꾸 빨라진다", transcripts,
                "앞 대사를 급히 받는다", handoff,
                List.of(
                        new CoachTurnSnapshot("actor", "이전 질문"),
                        new CoachTurnSnapshot("ai", "이전 답변")));
    }

    /** 웹·앱이 막힘 선택을 건너뛰면 보내는 값 — 갈래·하위 갈래 모두 {@code 그 외}, 상세 없음. */
    private static CoachSessionSnapshot otherSession() throws Exception {
        return snapshot(
                observationPack(), "그 외", "그 외", "", TRANSCRIPTS,
                "", null, List.of());
    }

    private static JsonNode observationPack() throws Exception {
        return OBJECT_MAPPER.readTree("""
                {"scene_summary":"여자가 문 앞에서 돌아선 상대를 붙잡는다.",
                 "observations":[{"start_ms":0,"end_ms":93000,"what":"멈춘 뒤 말한다",
                                  "quote":"가지 마","dimension":"호흡","confidence":1.0}],
                 "uncertainties":["얼굴은 확인되지 않음"]}
                """);
    }

    private static CoachSessionSnapshot blankSceneSession(
            String situation, String characterContext, String goal) {
        return sceneSession(situation, characterContext, goal, "그 외", "");
    }

    /** 장면 세 칸과 하위 갈래·상세만 갈아끼운 분석 세션. 나머지는 {@link #snapshot} 기본값이다. */
    private static CoachSessionSnapshot sceneSession(
            String situation,
            String characterContext,
            String goal,
            String subBranch,
            String blockageDetail) {
        return withScene(
                snapshot(null, "분석", subBranch, blockageDetail, List.of("가지 마"), "", null, List.of()),
                situation, characterContext, goal);
    }

    /** 장면 세 칸만 갈아끼운 사본. */
    private static CoachSessionSnapshot withScene(
            CoachSessionSnapshot source,
            String situation,
            String characterContext,
            String goal) {
        return new CoachSessionSnapshot(
                source.sessionId(), source.practiceSessionId(), source.summaryId(),
                source.userId(), source.observationPack(), situation, characterContext, goal,
                source.durationMs(), source.blockageKind(), source.subBranch(),
                source.blockageDetail(), source.transcripts(), source.conversationSummary(),
                source.analysisHandoff(), source.status(), source.closeReason(), source.turns());
    }

    private static CoachSessionSnapshot analysisSession() {
        return snapshot(
                null, "분석", "의미", "이유를 모르겠다", List.of("가지 마"), "", null, List.of());
    }

    private static CoachSessionSnapshot snapshot(
            JsonNode observationPack,
            String blockageKind,
            String subBranch,
            String blockageDetail,
            List<String> transcripts,
            String conversationSummary,
            JsonNode analysisHandoff,
            List<CoachTurnSnapshot> turns) {
        return new CoachSessionSnapshot(
                UUID.fromString("00000000-0000-0000-0000-000000000001"),
                UUID.fromString("00000000-0000-0000-0000-000000000002"),
                null,
                UUID.fromString("00000000-0000-0000-0000-000000000003"),
                observationPack,
                "연습실",
                "지원자",
                "담담하게 말한다",
                93000,
                blockageKind,
                subBranch,
                blockageDetail,
                transcripts,
                conversationSummary,
                analysisHandoff,
                "open",
                "",
                turns);
    }
}
