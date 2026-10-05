package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 배우.md — 연습 루프 코치가 같은 배우의 지난 대화에서 받는 것은 배우가 직접 한 말이다.
 *
 * <p>근거 사례(운영, 2026-09-29~10-04): 같은 장면을 일곱 번 올린 배우가 "표정 위주로 봐달라고요"라고 했는데 새 연습마다
 * 코치가 같은 진단으로 다시 시작했고, 코치의 쉬어 보라는 제안을 따른 테이크를 버릇으로 짚었다. 배우가 "카메라 렌즈 봤어용"이라고
 * 바로잡은 뒤에도 같은 해석이 돌아왔다.
 */
class PracticeLoopMemoryTest {

    private static final Instant OCT_4 = Instant.parse("2026-10-04T11:48:00Z");
    private static final Instant OCT_1 = Instant.parse("2026-10-01T11:33:00Z");
    private static final Instant SEP_30 = Instant.parse("2026-09-30T11:36:00Z");

    @Test
    @DisplayName("배우가 바란 것이 맨 앞에 오고, 아니라고 한 것·자기 말·코치가 짚은 것이 원문으로 따라온다")
    void actorWordsComeFirst() {
        String block = PracticeLoopMemory.block(List.of(correctedThenAskedForEvaluation(), askedForFaceThenSummed(), oldExampleRequest()));

        assertThat(block).startsWith("## 배우가 지난 연습에서 직접 한 말\n");
        assertThat(block.indexOf("### 배우가 바란 것"))
                .isLessThan(block.indexOf("### 배우가 아니라고 한 것"));
        assertThat(block.indexOf("### 배우가 아니라고 한 것"))
                .isLessThan(block.indexOf("### 배우가 자기에 대해 한 말"));
        assertThat(block.indexOf("### 배우가 자기에 대해 한 말"))
                .isLessThan(block.indexOf("### 코치가 지난번에 짚은 것"));
        assertThat(block).contains(
                "- 최근 연습 3개에서: 평가 요청 1번, 보는 방식에 대한 이의 1번",
                "- 10/4 20:48: \"제 연기 전체적으로 어떤지 평가받고 싶어요. 따끔하게요\"",
                "- 10/1 20:33: \"표정 위주로 봐달라고요!!!!\"",
                "- 9/30 20:36: \"예시로 설명해 주세요.\"",
                "- 10/4 20:48 (코치가 본 것: 말하기 전에 시선이 위로 감): \"카메라 렌즈 봤어용\"",
                "- 다시 꺼내지 않을 주제: 시선, 문장 사이 쉼",
                "- 10/1 20:33: \"말의 힘을 믿어보자\"",
                "- 10/1 20:33: 문장 사이를 길게 쉼 — 제안: 한 문장이 끝나면 속으로 셋까지 세고 다음 말 하기");
        // 바란 것은 최신 대화가 앞이다.
        assertThat(block.indexOf("따끔하게요")).isLessThan(block.indexOf("표정 위주로"));
        assertThat(block.indexOf("표정 위주로")).isLessThan(block.indexOf("예시로 설명해"));
        // 짧은 답·종료는 옮기지 않는다.
        assertThat(block).doesNotContain("짜증,한심", "\"그만\"", "\"네\"");
        assertThat(block).endsWith("\n\n");
    }

    @Test
    @DisplayName("지난 대화가 없거나 남길 말이 없으면 칸 자체가 없다")
    void nothingToCarryMeansNoSection() {
        assertThat(PracticeLoopMemory.block(List.of())).isEmpty();
        assertThat(PracticeLoopMemory.block(null)).isEmpty();
        ObjectNode loop = StructuredJson.MAPPER.createObjectNode();
        loop.putArray("statuses").add("").add("배우의 말: 짧은 답\n할 일: 파고들기");
        var onlyShort = new PastPracticeLoop(OCT_4, loop,
                List.of(ai("첫 코치"), actor("네"), ai("둘째 코치")), null);
        assertThat(PracticeLoopMemory.block(List.of(onlyShort))).isEmpty();
    }

    @Test
    @DisplayName("길면 상한에서 자르고, 잘려도 배우가 바란 것은 남는다")
    void longHistoryIsClippedFromTheEnd() {
        List<PastPracticeLoop> many = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            ObjectNode loop = StructuredJson.MAPPER.createObjectNode();
            loop.put("design", "버릇: " + "길게 이어지는 버릇 설명".repeat(5) + " | 곳1: 0:01 | 곳2: 0:02");
            loop.putArray("statuses").add("")
                    .add("배우의 말: 평가 요청\n할 일: 짚어주기")
                    .add("배우의 말: 자기 한 줄\n할 일: 마무리2");
            many.add(new PastPracticeLoop(OCT_4.minusSeconds(86_400L * i), loop, List.of(
                    ai("첫 코치"), actor(i + "번째 평가해 주세요 ".repeat(20)), ai("짚어주기"),
                    actor(i + "나는 ".repeat(40) + "배우다"), ai("마무리")), "다음 제안 ".repeat(20)));
        }

        String block = PracticeLoopMemory.block(many);

        assertThat(block.strip().codePointCount(0, block.strip().length()))
                .isLessThanOrEqualTo(PracticeLoopMemory.MAX_CHARS);
        assertThat(block).doesNotContain("…\n\n").endsWith("\n\n");
        assertThat(block).contains("### 배우가 바란 것", "평가 요청 5번");
    }

    @Test
    @DisplayName("같은 말을 되풀이하면 한 번만 싣고, 피할 주제는 낱낱이 한 번씩만 싣는다")
    void repeatedWordsAndTopicsAppearOnce() {
        ObjectNode loop = StructuredJson.MAPPER.createObjectNode();
        loop.put("design", "버릇: 말이 내내 같은 속도 | 곳1: 0:01 | 곳2: 0:02");
        loop.putArray("statuses").add("")
                .add("배우의 말: 반박\n피할 것: 말 빠르기\n할 일: 짚어주기(다른 쪽)")
                .add("배우의 말: 반박\n피할 것: 말 빠르기, 문장 사이 쉼\n할 일: 짚어주기(다른 쪽)");
        var repeated = new PastPracticeLoop(OCT_1, loop, List.of(ai("첫 코치"), actor("표정 위주로 봐달라고요!!!!"),
                ai("둘째"), actor("표정 위주로 봐달라고요!!!!!!!!"), ai("셋째")), null);
        ObjectNode older = loop.deepCopy();
        older.putArray("statuses").add("").add("배우의 말: 반박\n피할 것: 말 빠르기\n할 일: 짚어주기(다른 쪽)");
        var earlier = new PastPracticeLoop(SEP_30, older, List.of(ai("첫 코치"), actor("속도 말고 다른 거 봐 줘요"), ai("둘째")), null);

        String block = PracticeLoopMemory.block(List.of(repeated, earlier));

        assertThat(block.split("표정 위주로", -1)).hasSize(2);
        assertThat(block).contains("- 다시 꺼내지 않을 주제: 말 빠르기, 문장 사이 쉼\n", "보는 방식에 대한 이의 2번");
    }

    @Test
    @DisplayName("구조화 코치의 모델 입력(prior_context)에는 지난 연습 루프가 실리지 않는다")
    void structuredInputDoesNotSerializePastLoops() {
        var prior = new PriorContext(Map.of("goal", "입시", "speech_self", "차분하다", "speech_actual", "빠르다"),
                null, false, List.of(), List.of(), List.of(askedForFaceThenSummed()));

        JsonNode json = StructuredJson.MAPPER.valueToTree(prior);

        assertThat(json.has("pastLoops")).isFalse();
        assertThat(json.has("past_loops")).isFalse();
        assertThat(json.path("memory").has("goal")).isTrue();
    }

    @Test
    @DisplayName("연습 루프에 넘길 기억에서는 화법 두 칸만 빠지고 나머지와 지난 연습 루프는 그대로다")
    void withoutSpeechDropsOnlyTheSpeechFields() {
        var prior = new PriorContext(Map.of("goal", "입시", "speech_self", "차분하다", "speech_actual", "빠르다"),
                null, false, List.of(), List.of("1차: 호흡"), List.of(askedForFaceThenSummed()));

        var loopPrior = prior.withoutSpeech();

        assertThat(loopPrior.memory()).containsOnlyKeys("goal");
        assertThat(loopPrior.sceneHistory()).containsExactly("1차: 호흡");
        assertThat(loopPrior.pastLoops()).hasSize(1);
        assertThat(prior.withoutDemographics().pastLoops()).hasSize(1);
        assertThat(CoachPrompt.priorContextBlock(loopPrior, true)).doesNotContain("차분하다", "빠르다");
    }

    /** 10/4: 시선을 짚자 렌즈를 봤다고 바로잡고, 짧게 답한 뒤 따끔한 평가를 청하고 끝냈다. */
    private static PastPracticeLoop correctedThenAskedForEvaluation() {
        ObjectNode loop = StructuredJson.MAPPER.createObjectNode();
        loop.put("design", "영상: 연기\n버릇: 말하기 전에 시선이 위로 감 | 곳1: 0:05 | 곳2: 0:21\n버릇 쪽: 몸·시선·표정");
        loop.putArray("statuses").add("")
                .add("배우의 말: 정정\n피할 것: 시선\n할 일: 내려놓기")
                .add("배우의 말: 짧은 답\n피할 것: 시선\n할 일: 파고들기")
                .add("배우의 말: 평가 요청\n피할 것: 시선\n할 일: 짚어주기")
                .add("배우의 말: 그만\n할 일: 끝");
        return new PastPracticeLoop(OCT_4, loop, List.of(
                ai("말을 시작하기 전에 시선이 위로 향하는 쪽으로 가요."),
                actor("카메라 렌즈 봤어용"),
                ai("그러면 제가 잘못 봤어요."),
                actor("짜증,한심"),
                ai("한심한 마음이 가득 차 있군요."),
                actor("제 연기 전체적으로 어떤지 평가받고 싶어요. 따끔하게요"),
                ai("제일 아쉬운 건 손동작이에요."),
                actor("그만"),
                ai("오늘은 여기까지 해요.")), null);
    }

    /** 10/1: 코치가 보는 쪽에 이의를 말하고(표정을 봐 달라), 마무리에서 자기 한 줄을 남겼다. */
    private static PastPracticeLoop askedForFaceThenSummed() {
        ObjectNode loop = StructuredJson.MAPPER.createObjectNode();
        loop.put("design", "버릇: 문장 사이를 길게 쉼 | 곳1: 0:10 | 곳2: 0:20");
        loop.putArray("statuses").add("")
                .add("배우의 말: 반박\n피할 것: 문장 사이 쉼\n할 일: 짚어주기(다른 쪽)")
                .add("배우의 말: 답\n피할 것: 문장 사이 쉼\n할 일: 마무리1")
                .add("배우의 말: 자기 한 줄\n할 일: 마무리2");
        return new PastPracticeLoop(OCT_1, loop, List.of(
                ai("지난번에도 문장 사이마다 길게 쉬는 쪽으로 가요."),
                actor("표정 위주로 봐달라고요!!!!"),
                ai("눈빛이 분명하게 보여요."),
                actor("확신에 찬 눈빛이면 충분할 것 같아요"),
                ai("오늘 나에 대해 알게 된 걸 한 줄로 적는다면 뭐라고 쓸래요?"),
                actor("말의 힘을 믿어보자"),
                ai("말의 힘을 믿어보자라고 적어 둘게요.")),
                "한 문장이 끝나면 속으로 셋까지 세고 다음 말 하기");
    }

    /** 9/30: 상태 칸에 배우의 말 분류가 없던 옛 대화. 낱말로 바란 것만 고른다. */
    private static PastPracticeLoop oldExampleRequest() {
        ObjectNode loop = StructuredJson.MAPPER.createObjectNode();
        loop.putArray("statuses").add("").add("파고들기 · 응답 2번째");
        return new PastPracticeLoop(SEP_30, loop, List.of(
                ai("손동작을 크게 쓰는 편이에요."),
                actor("예시로 설명해 주세요."),
                ai("00:15에 손을 뻗는 장면이 그래요.")), null);
    }

    private static PastPracticeLoop.Turn ai(String text) {
        return new PastPracticeLoop.Turn("ai", text);
    }

    private static PastPracticeLoop.Turn actor(String text) {
        return new PastPracticeLoop.Turn("actor", text);
    }
}
