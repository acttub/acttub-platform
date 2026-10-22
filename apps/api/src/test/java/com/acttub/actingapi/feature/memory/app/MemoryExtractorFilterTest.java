package com.acttub.actingapi.feature.memory.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 모델이 낸 칸 가운데 기억으로 남는 것과 버려지는 것 (practice.memory 「규칙·제약」). */
class MemoryExtractorFilterTest {
    private static final UUID OPERATION = UUID.fromString("11111111-2222-3333-4444-555555555555");

    private final RecordingFailureReporter reporter = new RecordingFailureReporter();
    private final MemoryExtractor extractor = new MemoryExtractor(reporter);

    private Map<String, String> extract(String generated, Map<String, String> existing) {
        return extractor.extract(material(), existing, (system, user) -> generated, OPERATION);
    }

    @Test
    void actorOnlyFieldsNonTextBlankAndJudgingValuesAreDropped() {
        Map<String, String> result = extract("""
                {"gender":"여성","age":"20대","goal":"오디션 합격","blockage":"3초에 멈춘다",
                 "wants":"약점을 알려 달라고 했다","habits":5,"tone":"   ","speech_actual":"옛 칸"}
                """, Map.of());

        assertThat(result).containsExactly(Map.entry("goal", "오디션 합격"));
        assertThat(reporter.reports()).isEmpty();
    }

    @Test
    void valuesAboutTheScreenOrTheCoachInsteadOfTheActorAreDroppedAndThePreviousValueStays() {
        Map<String, String> result = extract("""
                {"blockage":"복합적인 감정을 소리 지르지 않고 표현하는 가운데, 표현과 표정에서 막히는 지점을 골랐다.",
                 "habits":"시선 처리에 대한 지적이 있었고 배우가 받아들였다",
                 "tone":"답이 짧고 존댓말이며 직설적인 평가를 바란다"}
                """, Map.of("blockage", "큰 감정 대목에서 말이 멈춘다고 스스로 말했다"));

        assertThat(result).containsExactly(Map.entry("tone", "답이 짧고 존댓말이며 직설적인 평가를 바란다"));
    }

    @Test
    void goalStillRejectsOtherForbiddenWordsAndTimecodesBesideThePassWord() {
        assertThat(extract("{\"goal\":\"합격 점수 올리기\"}", Map.of())).isEmpty();
        assertThat(extract("{\"goal\":\"0:12 장면으로 합격\"}", Map.of())).isEmpty();
        assertThat(extract("{\"goal\":\"면접 장면으로 합격\"}", Map.of()))
                .containsExactly(Map.entry("goal", "면접 장면으로 합격"));
    }

    @Test
    void unchangedAndOverLongValuesAreNotWritten() {
        String tooLong = "가".repeat(1_001);

        Map<String, String> result = extract(
                "{\"goal\":\"그대로인 목표\",\"habits\":\"" + tooLong + "\",\"wants\":\"" + "나".repeat(1_000) + "\"}",
                Map.of("goal", "그대로인 목표"));

        assertThat(result).containsExactly(Map.entry("wants", "나".repeat(1_000)));
    }

    @Test
    void fencedJsonIsReadAndANonObjectAnswerWritesNothingWithoutAReport() {
        assertThat(extract("```json\n{\"tone\":\"짧게 답한다\"}\n```", Map.of()))
                .containsExactly(Map.entry("tone", "짧게 답한다"));
        assertThat(extract("[\"목표\"]", Map.of())).isEmpty();
        assertThat(reporter.reports()).isEmpty();
    }

    private static MemoryUpdateMaterial material() {
        return new MemoryUpdateMaterial(
                UUID.randomUUID(), UUID.randomUUID(), "목표", "분석", "캐릭터 분석", null,
                List.of(), List.of(), List.of());
    }
}
