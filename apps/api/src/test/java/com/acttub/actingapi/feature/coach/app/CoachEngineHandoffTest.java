package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

/** 기존 코치의 마지막 응답: handoff 의 배우 말은 문자열만 남기고, 걸러낼 것이 없으면 그대로 둔다. */
class CoachEngineHandoffTest {
    static CoachSessionSnapshot lastTurn() {
        var turns = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < 7; i++) {
            turns.add(new CoachTurnSnapshot("actor", "답 " + i));
            turns.add(new CoachTurnSnapshot("ai", "질문 " + i));
        }
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null, "연습실", "지원자",
                "담담하게 말한다", 8000, "분석", "그 외", "", "open", "", turns, PriorContext.EMPTY, "legacy", 0, null, null);
    }

    CoachReply closeWith(String handoff) {
        String reply = "{\"message\":\"오늘 이야기한 말끝을 다음 테이크에서 짧게 해 봐요.\",\"status\":\"complete\",\"handoff\":" + handoff + "}";
        var engine = new CoachEngine((instructions, input) -> new GeneratedText(reply, null, "test"),
                new RecordingFailureReporter(), new RecordingLlmTelemetry());
        return engine.reply(lastTurn(), "붙잡고 싶었어", UUID.randomUUID()).reply();
    }

    @Test void actorWordsThatAreAllRealAnswersAreKeptAsTheModelWroteThem() {
        CoachReply reply = closeWith("{\"actor_words\":[\"붙잡고 싶었어\"],\"handoff_type\":\"analysis\"}");
        assertThat(reply.status()).isEqualTo("complete");
        assertThat(reply.handoff().path("actor_words").toString()).isEqualTo("[\"붙잡고 싶었어\"]");
    }

    @Test void actorWordsThatAreNotAListAreLeftForTheNoteToIgnore() {
        CoachReply reply = closeWith("{\"actor_words\":\"붙잡고 싶었어\"}");
        assertThat(reply.handoff().path("actor_words").asText()).isEqualTo("붙잡고 싶었어");
        assertThat(closeWith("{\"handoff_type\":\"analysis\"}").handoff().has("actor_words")).isFalse();
    }

    @Test void nonObjectJsonIsShownAsWritten() {
        assertThat(CoachEngine.parseCoachingResponse("[1,2]")).isEqualTo(new CoachReply("[1,2]", "continue", null));
        assertThat(List.of(CoachEngine.parseCoachingResponse("{\"message\":\"끝\",\"status\":\"complete\"}").status()))
                .containsExactly("continue");
    }
}
