package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import tools.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 옛(legacy) 회차의 첫 질문 정책. 신형 회차는 직접 영상 코치가 맡는다. */
class OpeningQuestionTest {
    private static final String QUESTION = "'가지 마'를 듣고 상대가 어떻게 하길 바랐어요?";
    private static final String REPORTED = "“평생 식물인간으로 살아야 된대요” 뒤에 고개를 숙이고 약 1초 멈춰요. 이 대목이 말의 무게를 잠깐 받아들이는 것처럼 읽혀요.";

    private CoachSessionSnapshot session() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.parse("{\"observations\":[{\"what\":\"말하기 전에 멈춘다\",\"quote\":\"가지 마\"}]}"),
                "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(), PriorContext.EMPTY, "legacy", 0, null, null);
    }

    private static CoachEngine engine(com.acttub.actingapi.integration.llm.TextGenerator generator) {
        return new CoachEngine(generator, new RecordingFailureReporter(), new RecordingLlmTelemetry(), java.util.Optional.empty());
    }

    @Test void groundedOpeningWithoutQuestionIsAcceptedWithoutRegeneration() {
        String explanation = "'가지 마' 전에 멈춘 뒤 말을 시작해요.";
        AtomicInteger calls = new AtomicInteger();
        var engine = engine((system, text) -> {
            calls.incrementAndGet();
            return new GeneratedText(StructuredJson.MAPPER.createObjectNode().put("message", explanation)
                    .put("status", "continue").putNull("handoff").toString(), null, "test");
        });
        var result = engine.start(session(), UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo(explanation);
        assertThat(calls).hasValue(1);
    }

    @Test void legacyVideoFirstUsesTheSameSelectionPolicyAndRejectsTheReportedOpening() {
        AtomicInteger calls = new AtomicInteger();
        var engine = engine((system, text) -> {
            assertThat(system).contains("이 답을 알면 영상의 무엇을 더 정확하게 볼 수 있는가?")
                    .contains("사용자가 할 법한 답이 있다고 가정하고 첫 말을 만든다");
            var reply = StructuredJson.MAPPER.createObjectNode().put("message", calls.getAndIncrement() == 0 ? REPORTED : QUESTION)
                    .put("status", "continue").putNull("handoff");
            return new GeneratedText(reply.toString(), null, "test");
        });
        assertThat(engine.start(session(), UUID.randomUUID()).reply().message()).isEqualTo(QUESTION);
        assertThat(calls).hasValue(2);
    }

    @Test void questionsInsideQuotedDialogueAreNotQuestionsToTheActor() {
        assertThat(OpeningQuestion.failures("'왜?' 뒤에 잠깐 멈춰요.")).isEmpty();
        assertThat(OpeningQuestion.failures("'왜?'를 듣고 상대가 어떻게 반응하길 바랐어요?")).isEmpty();
        assertThat(OpeningQuestion.failures("상대는 누구예요? 어떻게 반응하길 바랐어요?")).isNotEmpty();
        assertThat(OpeningQuestion.failures("말의 무게를 받아들이는 것처럼 읽혀요. 그런 의도였어요?")).isNotEmpty();
    }

    @Test void legacyMaterialUsesDeliveredObservationsOrSpeech() {
        var session = session();
        assertThat(OpeningQuestion.legacyMaterial(session)).isTrue();
        ObjectNode pack = (ObjectNode) session.observationPack();
        pack.removeAll();
        pack.putObject("speech").put("transcript", "가지 마");
        assertThat(OpeningQuestion.legacyMaterial(session)).isTrue();
        pack.removeAll();
        assertThat(OpeningQuestion.legacyMaterial(session)).isFalse();
    }

    @Test void repeatedGenerationFailureDoesNotReturnTheUnclearInterpretation() {
        var engine = engine((system, text) -> new GeneratedText(REPORTED, null, "test"));
        var result = engine.start(session(), UUID.randomUUID());
        assertThat(result.reply().message()).contains("영상에 근거한 설명을 준비하지 못했어요").doesNotContain("말의 무게", "읽혀요");
        assertThat(OpeningQuestion.questionCount(result.reply().message())).isZero();
    }
}
