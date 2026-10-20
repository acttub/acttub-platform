package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import org.junit.jupiter.api.Test;

/** 연습 루프 노트 재료의 경계: 아니라고 한 말의 주제, 한 줄을 청한 자리의 요청, 버릇 없이 다음 테이크만 있는 설계. */
class DirectVideoPracticeLoopRoundTest {
    static CoachSessionSnapshot session(String design, List<String> statuses, String... turns) {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        ObjectNode loop = state.putObject(DirectVideoPracticeLoop.STATE_KEY).put("design", design);
        ArrayNode array = loop.putArray("statuses");
        statuses.forEach(array::add);
        var list = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < turns.length; i++) list.add(new CoachTurnSnapshot(i % 2 == 0 ? "ai" : "actor", turns[i]));
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null, "", "", "", 8000,
                "표현", "  ", "", "open", "", list, PriorContext.EMPTY, "three_layers_v1", 0, state, null);
    }

    @Test void correctionsNameTheirTopicOnceAndRequestsAreNotTheActorsLine() {
        var session = session("다음 테이크: [끝을 짧게]", List.of(
                        "",
                        "배우의 말: 반박\n피할 것: 웃음",
                        "배우의 말: 정정\n피할 것: 웃음\n할 일: 마무리1",
                        "배우의 말: 평가 요청",
                        "",
                        "배우의 말: 답"),
                "첫 질문", "웃는 거 아니야!", "알겠어요", "웃는 거 아니야", "한 줄로 말해 볼래요?", "이거 괜찮아?", "그럼요", null,
                "어떻게 해야 할지 방법 알려줘", "");
        var note = DirectVideoPracticeLoop.note(session, 2);
        assertThat(note.title()).isNull();
        assertThat(note.nextTake()).isEqualTo("끝을 짧게");
        assertThat(note.kind()).isEqualTo("action");
        assertThat(note.corrections().toString()).isEqualTo("[\"웃음: \\\"웃는 거 아니야!\\\"\"]");
        assertThat(note.summaryQuotes()).isEmpty();
    }

    @Test void aLongHabitTitleIsCutAtAWordBoundary() {
        String habit = "대사를 시작하기 전에 고개를 숙이고 숨을 오래 고른 뒤 아주 작은 소리로 첫 마디를 겨우 꺼낸다";
        var note = DirectVideoPracticeLoop.note(session("버릇: " + habit, List.of("")), 1);
        assertThat(note.title()).isEqualTo("대사를 시작하기 전에 고개를 숙이고 숨을 오래 고른 뒤 아주 작은 소리로…");
        assertThat(DirectVideoPracticeLoop.habit("버릇: 몸\n몸: .")).isEqualTo("몸");
    }

    @Test void fixedTextsInKoreanAndSmallParsingEdges() {
        assertThat(DirectVideoPracticeLoop.emptyRetryNote(Locale.KOREAN)).startsWith("[다시 쓰기]\n방금 답에 배우에게 보일 코치의 말이 없었다.");
        assertThat(DirectVideoPracticeLoop.timestampRetryNote(Locale.KOREAN)).startsWith("[다시 쓰기]\n방금 쓴 답에 영상 시간");
        assertThat(DirectVideoPracticeLoop.notActingMessage(Locale.KOREAN)).startsWith("이 영상에서는 연기 장면을 찾지 못했어요.");
        assertThat(DirectVideoPracticeLoop.audioUnavailableMessage(Locale.KOREAN)).startsWith("영상의 소리가 녹음되지 않았어요.");
        assertThat(DirectVideoPracticeLoop.looksBroken("ㅋㅋ 좋아요 정말", null)).isFalse();
        assertThat(DirectVideoPracticeLoop.withoutQuestions("")).isEmpty();
        assertThat(DirectVideoPracticeLoop.actorLanguage(null, "영어로 해줘")).isEqualTo(Locale.ENGLISH);
        assertThat(DirectVideoPracticeLoop.languageOf("가 abcdefghijkl")).isEqualTo(Locale.ROOT);
        assertThat(DirectVideoPracticeLoop.closingNextTake(TextNode.valueOf("x"))).isEmpty();
        assertThat(DirectVideoPracticeLoop.designNextTake("다음 테이크: [끝을 짧게]")).isEqualTo("끝을 짧게");
        assertThat(DirectVideoPracticeLoop.action("순간1 · 장면2 · 누적 3")).isEmpty();
        assertThat(DirectVideoPracticeLoop.statusField(null, "할 일")).isEmpty();
        assertThat(DirectVideoPracticeLoop.actorMaterial(session("", List.of()))).isEqualTo(
                "## 배우가 적은 것\n이번 연습을 올리며 배우가 적은 것이다. 영상 근거가 아니다.\n- 막힌 곳: 표현\n\n");
    }
}
