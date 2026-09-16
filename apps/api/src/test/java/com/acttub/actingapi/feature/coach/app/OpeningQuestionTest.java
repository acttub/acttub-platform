package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class OpeningQuestionTest {
    private static final String QUESTION = "'가지 마'를 듣고 상대가 어떻게 하길 바랐어요?";
    private static final String REPORTED = "“평생 식물인간으로 살아야 된대요” 뒤에 고개를 숙이고 약 1초 멈춰요. 이 대목이 말의 무게를 잠깐 받아들이는 것처럼 읽혀요.";

    private CoachSessionSnapshot session(boolean structured) {
        var session = new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                structured ? StructuredJson.resource("/coaching/record.json")
                        : StructuredJson.parse("{\"observations\":[{\"what\":\"말하기 전에 멈춘다\",\"quote\":\"가지 마\"}]}"),
                "", "", "", 8000, "그 외", "그 외", null,
                List.of("가지 마"), "", null, "open", "", List.of());
        return structured ? session.withCoachingState("three_layers_v1", 0, null, "open", "") : session;
    }

    @Test void openingRegeneratesMissingEvidenceFocusAndPrematureFinish() {
        for (String error : List.of("reported", "no_evidence", "no_focus", "finish", "too_long")) {
            AtomicInteger calls = new AtomicInteger();
            var engine = new CoachEngine((system, text) -> {
                assertThat(system).contains("이 답을 알면 영상의 무엇을 더 정확하게 볼 수 있는가?");
                var input = StructuredJson.parse(text);
                assertThat(input.path("controls").path("min_questions").asInt()).isZero();
                assertThat(input.path("controls").path("max_message_chars").asInt()).isEqualTo(100);
                assertThat(input.path("controls").path("max_sentences").asInt()).isEqualTo(2);
                ObjectNode reply = StructuredCoachEngineTest.respond(input, QUESTION, "continue");
                if (calls.getAndIncrement() == 0) {
                    switch (error) {
                        case "reported" -> reply.put("message", REPORTED);

                        case "no_evidence" -> ((ObjectNode) reply.path("reply_link")).putArray("evidence_refs");
                        case "no_focus" -> reply.putNull("context_update");
                        case "finish" -> reply.put("flow", "finish");
                        case "too_long" -> reply.put("message", "영상에서 확인한 내용입니다 ".repeat(10));
                    }
                } else assertThat(input.has("validation_error")).isTrue();
                return StructuredCoachEngineTest.generated(reply);
            }, new RecordingFailureReporter(), new RecordingLlmTelemetry());
            var result = engine.start(session(true), UUID.randomUUID());
            assertThat(calls).as(error).hasValue(2);
            assertThat(result.reply().message()).isEqualTo(QUESTION);
            assertThat(result.session().coachingState().path("context").path("focus").path("evidence_refs")).isNotEmpty();
            assertThat(result.session().coachingState().path("context").path("direction").isNull()).isTrue();
        }
    }

    @Test void groundedOpeningWithoutQuestionIsAcceptedWithoutRegeneration() {
        String explanation = "'가지 마' 전에 멈춘 뒤 말을 시작해요.";
        for (boolean structured : List.of(true, false)) {
            AtomicInteger calls = new AtomicInteger();
            var engine = new CoachEngine((system, text) -> {
                calls.incrementAndGet();
                return structured
                        ? StructuredCoachEngineTest.generated(StructuredCoachEngineTest.respond(StructuredJson.parse(text), explanation, "continue"))
                        : new GeneratedText(StructuredJson.MAPPER.createObjectNode().put("message", explanation)
                                .put("status", "continue").putNull("handoff").toString(), null, "test");
            }, new RecordingFailureReporter(), new RecordingLlmTelemetry());
            var result = engine.start(session(structured), UUID.randomUUID());
            assertThat(result.reply().message()).isEqualTo(explanation);
            assertThat(calls).hasValue(1);
        }
    }

    @Test void legacyVideoFirstUsesTheSameSelectionPolicyAndRejectsTheReportedOpening() {
        AtomicInteger calls = new AtomicInteger();
        var engine = new CoachEngine((system, text) -> {
            assertThat(system).contains("이 답을 알면 영상의 무엇을 더 정확하게 볼 수 있는가?")
                    .contains("사용자가 할 법한 답이 있다고 가정하고 첫 말을 만든다");
            var reply = StructuredJson.MAPPER.createObjectNode().put("message", calls.getAndIncrement() == 0 ? REPORTED : QUESTION)
                    .put("status", "continue").putNull("handoff");
            return new GeneratedText(reply.toString(), null, "test");
        }, new RecordingFailureReporter(), new RecordingLlmTelemetry());
        assertThat(engine.start(session(false), UUID.randomUUID()).reply().message()).isEqualTo(QUESTION);
        assertThat(calls).hasValue(2);
    }

    @Test void questionsInsideQuotedDialogueAreNotQuestionsToTheActor() {
        assertThat(OpeningQuestion.failures("'왜?' 뒤에 잠깐 멈춰요.")).isEmpty();
        assertThat(OpeningQuestion.failures("'왜?'를 듣고 상대가 어떻게 반응하길 바랐어요?")).isEmpty();
        assertThat(OpeningQuestion.failures("상대는 누구예요? 어떻게 반응하길 바랐어요?")).isNotEmpty();
        assertThat(OpeningQuestion.failures("말의 무게를 받아들이는 것처럼 읽혀요. 그런 의도였어요?")).isNotEmpty();
    }

    @Test void legacyMaterialUsesDeliveredObservationsOrSpeechInsteadOfUnusedTranscripts() {
        var session = session(false);
        assertThat(OpeningQuestion.legacyMaterial(session)).isTrue();
        ObjectNode pack = (ObjectNode) session.observationPack();
        pack.removeAll();
        pack.putObject("speech").put("transcript", "가지 마");
        assertThat(OpeningQuestion.legacyMaterial(session)).isTrue();
        pack.removeAll();
        assertThat(session.transcripts()).isNotEmpty();
        assertThat(OpeningQuestion.legacyMaterial(session)).isFalse();
    }

    @Test void repeatedGenerationFailureDoesNotReturnTheUnclearInterpretation() {
        for (boolean structured : List.of(true, false)) {
            var engine = new CoachEngine((system, text) -> structured
                    ? StructuredCoachEngineTest.generated(StructuredCoachEngineTest.respond(StructuredJson.parse(text), REPORTED, "continue"))
                    : new GeneratedText(REPORTED, null, "test"),
                    new RecordingFailureReporter(), new RecordingLlmTelemetry());
            var result = engine.start(session(structured), UUID.randomUUID());
            assertThat(result.reply().message()).contains("영상에 근거한 설명을 준비하지 못했어요").doesNotContain("말의 무게", "읽혀요");
            assertThat(OpeningQuestion.questionCount(result.reply().message())).isZero();
        }
    }
}
