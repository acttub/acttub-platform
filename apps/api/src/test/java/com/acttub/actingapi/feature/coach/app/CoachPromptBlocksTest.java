package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

/** 코치 프롬프트 칸: 비어 있으면 칸을 만들지 않고, 있으면 정해진 제목과 줄로 싣는다. */
class CoachPromptBlocksTest {
    static CoachSessionSnapshot session(JsonNode pack, String kind, String situation, String character, String goal,
            PriorContext prior, ActorProfile profile) {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), pack, situation, character, goal,
                8000, kind, "그 외", "", "open", "", List.of(new CoachTurnSnapshot("actor", "처음 말")), prior, "legacy", 0, null, profile);
    }

    @Test void theActorNameIsMaskedOnlyOnTheProfileLine() {
        ActorProfile profile = new ActorProfile("김배우", "선택 안 함", 25, List.of("매체(TV·영화)"), "5년 이상", "전문 배우");
        String prompt = CoachPrompt.actorProfileBlock(profile) + "## 최근 대화\n배우: 김배우라고 불러 주세요";
        assertThat(CoachPrompt.withoutActorName(prompt, profile))
                .startsWith(CoachPrompt.actorProfileBlock(profile).replace("- 이름: 김배우\n", "- 이름: [redacted]\n"))
                .endsWith("배우: 김배우라고 불러 주세요");
        assertThat(CoachPrompt.withoutActorName("## 최근 대화\n배우: 안녕", profile)).isEqualTo("## 최근 대화\n배우: 안녕");
        assertThat(CoachPrompt.withoutActorName("그대로", null)).isEqualTo("그대로");
    }

    @Test void noPriorMeansNoPriorSection() {
        assertThat(CoachPrompt.priorContextBlock(null, true)).isEmpty();
        assertThat(CoachPrompt.priorContextBlock(PriorContext.EMPTY, true)).isEmpty();
    }

    @Test void priorSectionNamesWhereTheEarlierTalkCameFromAndSkipsEmptyMemory() {
        Map<String, String> memory = new LinkedHashMap<>();
        memory.put("goal", "입시 합격");
        memory.put("tone", "");
        String same = CoachPrompt.priorContextBlock(new PriorContext(memory, "배우: 끝을 짧게 해 봤어", true, List.of(), List.of()), false);
        assertThat(same).contains("- 배우가 말한 목표: 입시 합격", "### 같은 연습에서 지난번에 나눈 이야기\n배우: 끝을 짧게 해 봤어")
                .doesNotContain("배우의 말투");
        String earlier = CoachPrompt.priorContextBlock(new PriorContext(Map.of(), "배우: 지난주 이야기", false, List.of(), List.of()), true);
        assertThat(earlier).contains("### 지난 연습에서 나눈 이야기\n배우: 지난주 이야기").doesNotContain("배우가 말한 목표");
        String history = CoachPrompt.priorContextBlock(new PriorContext(Map.of(), null, true, List.of(), List.of("1차: 말끝")), true);
        assertThat(history).contains("### 이 장면에서 지금까지\n- 1차: 말끝");
    }

    @Test void uncertaintiesAreWrittenTheWayThePythonPromptWroteThem() {
        JsonNode pack = StructuredJson.parse("{\"observations\":[],\"uncertainties\":[null,true,false,3,\"얼굴은 화면 밖\"]}");
        String prompt = CoachPrompt.buildChat(session(pack, "분석", "문 앞", "", "", PriorContext.EMPTY, null), "모르겠어요");
        assertThat(prompt).contains("관찰 0개. 영상 이야기를 새로 만들면 안 된다.\n불확실: None / True / False / 3 / 얼굴은 화면 밖");
        assertThat(prompt).contains("- 상황: 문 앞").doesNotContain("- 캐릭터:");
    }

    @Test void anEmptyOrMissingPackSaysThereIsNoVideoEvidence() {
        String none = CoachPrompt.buildChat(session(StructuredJson.parse("{\"scene_summary\":\"요약\"}"), "분석", "", "", "", PriorContext.EMPTY, null), "?");
        assertThat(none).contains("관찰 0개. 영상 이야기를 새로 만들면 안 된다.\n불확실: 없음");
        String empty = CoachPrompt.buildChat(session(StructuredJson.parse("{}"), "분석", "", "", "", PriorContext.EMPTY, null), "?");
        assertThat(empty).contains("아직 영상에서 확인된 것이 없다. 영상 이야기를 만들지 마라.");
        String missing = CoachPrompt.buildChat(session(null, "분석", "", "", "", PriorContext.EMPTY, null), "?");
        assertThat(missing).contains("아직 영상에서 확인된 것이 없다. 영상 이야기를 만들지 마라.");
    }

    @Test void extraPackFieldsFollowTheKnownOnesUnchanged() {
        JsonNode pack = StructuredJson.parse("{\"camera\":\"정면\",\"observations\":[{\"what\":\"멈춘다\"}],\"scene_summary\":\"붙잡는 장면\"}");
        String prompt = CoachPrompt.buildChat(session(pack, "분석", "", "", "", PriorContext.EMPTY, null), "?");
        assertThat(prompt).contains("{\"scene_summary\":\"붙잡는 장면\",\"observations\":[{\"what\":\"멈춘다\"}],\"camera\":\"정면\"}");
    }

    static CoachSessionSnapshot afterReplies(String kind, int coachReplies) {
        var turns = new java.util.ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < coachReplies; i++) {
            turns.add(new CoachTurnSnapshot("actor", "답 " + i));
            turns.add(new CoachTurnSnapshot("ai", "코치 " + i));
        }
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null, "", "", "",
                8000, kind, "그 외", "", "open", "", turns, PriorContext.EMPTY, "legacy", 0, null, null);
    }

    @Test void theBudgetBlockNamesThePhaseForEachReplyAndTheLastOne() {
        assertThat(CoachPrompt.buildChat(afterReplies("분석", 3), "?")).endsWith(
                "현재 응답: 4번째\n이번 응답 뒤에 남는 횟수: 4번\n현재 구간: 4~6번째 응답: 좁히는 구간");
        assertThat(CoachPrompt.buildChat(afterReplies("분석", 6), "?")).endsWith("현재 구간: 7번째 응답: 닫기 직전");
        assertThat(CoachPrompt.buildChat(afterReplies("표현", 7), "?")).endsWith(
                "이번 응답 뒤에 남는 횟수: 0번\n현재 구간: 8번째 응답: 마지막 응답\n이번이 마지막 응답이다.");
        assertThat(CoachPrompt.buildChat(afterReplies("표현", 0), "?")).endsWith("현재 구간: 1~3번째 응답: 문제 확인 구간");
    }

    @Test void expressionSessionsListTheirObservationsOnlyWhenThereAreSome() {
        JsonNode pack = StructuredJson.parse("{\"observations\":[{\"what\":\"빨라진다\"}]}");
        assertThat(CoachPrompt.buildChat(session(pack, "표현", "", "", "", PriorContext.EMPTY, null), "?"))
                .contains("## 표현 세션 입력 정보\n- video_observations:\n  - {\"what\":\"빨라진다\"}\n\n");
        JsonNode speechOnly = StructuredJson.parse("{\"observations\":[],\"speech\":{\"transcript\":\"가지 마\"}}");
        assertThat(CoachPrompt.buildChat(session(speechOnly, "표현", "", "", "", PriorContext.EMPTY, null), "?"))
                .doesNotContain("## 표현 세션 입력 정보");
    }
}
