package com.acttub.actingapi.feature.memory.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.core.JsonProcessingException;
import org.junit.jupiter.api.Test;

class MemoryExtractorTest {
    private static final UUID OPERATION =
            UUID.fromString("99999999-8888-7777-6666-555555555555");

    @Test
    void generatedNonJsonFallsBackAndIsReportedAsExternal() {
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        MemoryExtractor extractor = new MemoryExtractor(reporter);

        Map<String, String> result = extractor.extract(
                material(), Map.of(), (system, user) -> "평문 답변", OPERATION);

        assertThat(result).isEmpty();
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isInstanceOf(JsonProcessingException.class);
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context())
                    .isEqualTo("MemoryExtractor.responseParse operation_id=" + OPERATION);
        });
    }

    @Test
    void emptyGeneratedResponseFallsBackAndIsReportedAsExternal() {
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        MemoryExtractor extractor = new MemoryExtractor(reporter);

        Map<String, String> result = extractor.extract(
                material(), Map.of(), (system, user) -> "", OPERATION);

        assertThat(result).isEmpty();
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context())
                    .isEqualTo("MemoryExtractor.responseParse operation_id=" + OPERATION);
        });
    }

    /** SOMA-603: 모델이 쓰는 칸은 목표·막히는 지점·바라는 것·버릇·말투다. 옛 화법 칸과 다시 말하지 않을 것은 버린다. */
    @Test
    void keepsOnlyTheFieldsTheModelWrites() {
        MemoryExtractor extractor = new MemoryExtractor(new RecordingFailureReporter());
        Map<String, String> result = extractor.extract(material(), Map.of(), (system, user) -> """
                {"goal":"새 목표","wants":"표정을 봐 달라고 했다","habits":"감정이 올라오면 고개를 돌린다",
                 "tone":"짧게 답한다","avoid":"지어낸 것","speech_self":"또박또박"}
                """, OPERATION);
        assertThat(result).containsOnlyKeys("goal", "wants", "habits", "tone");
    }

    /** 세션.md 한 줄은 이번 회차 노트로 실린다. */
    @Test
    void sessionNotesReachTheExtractionPrompt() {
        var material = new MemoryUpdateMaterial(UUID.randomUUID(), UUID.randomUUID(), "", "분석", "그 외", "",
                java.util.List.of(), java.util.List.of("(평가 요청) 평가해 주세요"), java.util.List.of(),
                java.util.List.of("1차: 버릇 고개를 크게 돌림 — 제안: 손을 꽉 쥐기"));
        assertThat(MemoryExtractor.buildExtractionPrompt(material, Map.of("habits", "고개를 돌린다", "speech_self", "옛 칸")))
                .contains("[이번 회차 노트]\n- 1차: 버릇 고개를 크게 돌림 — 제안: 손을 꽉 쥐기",
                        "- (평가 요청) 평가해 주세요", "- 자주 짚인 버릇: 고개를 돌린다")
                .doesNotContain("옛 칸");
        assertThat(MemoryExtractor.SYSTEM_PROMPT).contains("\"wants\"", "\"habits\"", "\"tone\"")
                .doesNotContain("\"speech_self\"");
    }

    private static MemoryUpdateMaterial material() {
        return new MemoryUpdateMaterial(
                UUID.randomUUID(), UUID.randomUUID(), "목표", "분석", "캐릭터 분석", null,
                List.of(), List.of(), List.of());
    }
}
