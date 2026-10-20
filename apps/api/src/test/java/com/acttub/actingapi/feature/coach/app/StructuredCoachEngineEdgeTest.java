package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;

/** 3층 코치: 배우가 자세히를 청하면 길이 한도를 늘리고, 낡은 판으로 답하면 다시 쓰게 하며, 마치는 말에 끝내 실패하면 정해진 정리로 닫는다. */
class StructuredCoachEngineEdgeTest {
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final List<JsonNode> inputs = new ArrayList<>();

    CoachSessionSnapshot session() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.resource("/coaching/record.json"), "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    CoachEngine engine(TextGenerator generator) {
        return new CoachEngine((system, text) -> {
            inputs.add(StructuredJson.parse(text));
            return generator.generate(system, text);
        }, failures, new RecordingLlmTelemetry());
    }

    CoachResult opened(CoachEngine engine) {
        return engine.start(session(), UUID.randomUUID());
    }

    static GeneratedText reply(JsonNode input, String text, String flow) {
        return StructuredCoachEngineTest.generated(StructuredCoachEngineTest.respond(input, text, flow));
    }

    @Test void askingForDetailRaisesTheLengthLimitForThatReply() {
        var engine = engine((system, text) -> {
            JsonNode input = StructuredJson.parse(text);
            return input.path("user_message").isNull()
                    ? reply(input, "“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?", "continue")
                    : reply(input, "말끝이 길게 남아서 부탁처럼 들려요.", "continue");
        });
        var first = opened(engine);
        engine.reply(first.session(), "그 부분을 자세히 설명해 줘", UUID.randomUUID());
        JsonNode controls = inputs.getLast().path("controls");
        assertThat(controls.path("max_message_chars").asInt()).isEqualTo(300);
        assertThat(controls.path("max_sentences").asInt()).isEqualTo(4);
    }

    @Test void aReplyBuiltOnAnOldStateRevisionIsRewritten() {
        var engine = engine((system, text) -> {
            JsonNode input = StructuredJson.parse(text);
            if (input.path("user_message").isNull()) return reply(input, "“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?", "continue");
            var response = StructuredCoachEngineTest.respond(input, "말끝이 길게 남아서 부탁처럼 들려요.", "continue");
            if (!input.has("validation_error")) response.put("base_state_revision", 99);
            return StructuredCoachEngineTest.generated(response);
        });
        var first = opened(engine);
        var second = engine.reply(first.session(), "붙잡고 싶었어", UUID.randomUUID());
        assertThat(second.reply().message()).isEqualTo("말끝이 길게 남아서 부탁처럼 들려요.");
        assertThat(inputs.getLast().path("validation_error").asText()).isEqualTo("stale state revision");
    }

    @Test void anEnglishActorWhoseClosingKeepsFailingGetsTheEnglishWrapUp() {
        LocaleContextHolder.setLocale(Locale.ENGLISH);
        try {
            var engine = engine((system, text) -> {
                JsonNode input = StructuredJson.parse(text);
                return input.path("user_message").isNull()
                        ? reply(input, "What did you want from them when you said it?", "continue")
                        : new GeneratedText("not json", null, "test");
            });
            var first = opened(engine);
            var closed = engine.reply(first.session(), "that's it for today", UUID.randomUUID());
            assertThat(closed.reply().message()).isEqualTo("Let's wrap up with what we've talked through so far.");
            assertThat(closed.reply().status()).isEqualTo("complete");
        } finally {
            LocaleContextHolder.resetLocaleContext();
        }
    }
}
