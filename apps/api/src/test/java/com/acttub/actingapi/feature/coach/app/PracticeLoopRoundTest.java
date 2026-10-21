package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import com.acttub.actingapi.feature.coach.app.PracticeLoopRound.Turn;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 지난 회차 한 줄 요약과 배우 말의 분류 표시: 기억(세션.md·유저.md)이 읽는 재료. */
class PracticeLoopRoundTest {
    static ObjectNode state(String design, String... statuses) {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        ObjectNode loop = state.putObject(DirectVideoPracticeLoop.STATE_KEY).put("design", design);
        ArrayNode array = loop.putArray("statuses");
        for (String status : statuses) array.add(status);
        return state;
    }

    @Test void withoutALoopStateThereIsNoLoopLineOrCorrections() {
        assertThat(PracticeLoopRound.line(1, "제목", "제안", null, List.of())).isNull();
        assertThat(PracticeLoopRound.line(1, "제목", "제안", StructuredJson.MAPPER.createObjectNode(), List.of())).isNull();
        assertThat(PracticeLoopRound.corrections(null, List.of())).isEmpty();
        assertThat(PracticeLoopRound.corrections(StructuredJson.MAPPER.createObjectNode(), List.of())).isEmpty();
    }

    @Test void aRoundLineFallsBackToTheDesignHabitAndClipsLongParts() {
        String longTake = "상대 눈을 끝까지 보면서 말끝을 짧게 끊고 한 박자 쉰 다음 다시 붙잡는 말을 아주 낮은 목소리로 건네 본다 그리고 또";
        String line = PracticeLoopRound.line(2, " ", longTake, state("버릇: 말끝을 길게 끈다"), List.of(new Turn("ai", "첫 질문")));
        assertThat(line).isEqualTo("2차: 버릇 말끝을 길게 끈다 — 제안: " + longTake.substring(0, 60).stripTrailing() + "…");
        assertThat(PracticeLoopRound.line(3, null, null, state("인물: 떠나는 사람"), List.of())).isEqualTo("3차: 버릇 없음");
    }

    @Test void actorWordsCarryTheirClassificationWhenTheNextStatusHasOne() {
        ObjectNode state = state("버릇: 말끝", "", "배우의 말: 평가 요청", "배우의 말: 모름");
        List<String> words = PracticeLoopRound.classifiedActorWords(state, List.of(
                new Turn("ai", "첫 질문"), new Turn("actor", "이거 괜찮아?"), new Turn("ai", "괜찮아요"),
                new Turn("actor", " "), new Turn("actor", null), new Turn("actor", "글쎄")));
        assertThat(words).containsExactly("(평가 요청) 이거 괜찮아?", "글쎄");
        assertThat(PracticeLoopRound.classifiedActorWords(null, List.of(new Turn("actor", "그냥 말")))).containsExactly("그냥 말");
    }

    @Test void heardLinesAreCleanedAndCapped() {
        StringBuilder many = new StringBuilder();
        for (int i = 0; i < 40; i++) many.append(i + 1).append(". 대사 ").append(i).append('\n');
        assertThat(ContinuedTake.parseHeardLines(many.toString())).hasSize(ContinuedTake.MAX_LINES).startsWith("대사 0");
        assertThat(ContinuedTake.parseHeardLines("* \"가지 마\"\n\n없음\n" + "가".repeat(201))).containsExactly("가지 마");
    }

    @Test void linesFromAPreviousRoundComeFromHeardLinesOrTheDesign() {
        assertThat(ContinuedTake.linesFromState(" ")).isEmpty();
        assertThat(ContinuedTake.linesFromState("{not json")).isEmpty();
        assertThat(ContinuedTake.linesFromState("{\"practice_loop\":{\"heard_lines\":[],\"design\":\"확인된 대사: “가지 마”\"}}"))
                .containsExactly("가지 마");
    }

    @Test void slateLinesAndShortLinesNeverMakeTwoTakesTheSameScene() {
        assertThat(ContinuedTake.scene(null)).isEmpty();
        assertThat(ContinuedTake.scene(List.of("네", "저는 김배우입니다", "가지 마 제발"))).containsExactly("가지 마 제발");
        assertThat(ContinuedTake.sameScene(List.of("그때 나는 아무 말도 하지 못했어"), List.of("아무 말도 하지 못했어"))).isTrue();
        assertThat(ContinuedTake.sameScene(List.of("아무 말도 하지 못했어"), List.of("그때 나는 아무 말도 하지 못했어 정말로"))).isTrue();
        assertThat(ContinuedTake.normalized(null)).isEmpty();
    }
}
