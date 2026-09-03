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

    private static MemoryUpdateMaterial material() {
        return new MemoryUpdateMaterial(
                UUID.randomUUID(), UUID.randomUUID(), "목표", "분석", "캐릭터 분석", null,
                List.of(), List.of());
    }
}
