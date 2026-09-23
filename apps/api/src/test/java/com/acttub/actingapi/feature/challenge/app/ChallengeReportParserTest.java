package com.acttub.actingapi.feature.challenge.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.domain.ChallengeReportRules;
import org.junit.jupiter.api.Test;

/** challenge.ai-report: 모델 출력은 모양·금지 어휘를 검사한 뒤에만 결과가 된다. */
class ChallengeReportParserTest {
    private final UUID a = UUID.randomUUID(), b = UUID.randomUUID(), c = UUID.randomUUID();
    private final Map<String, UUID> three = new LinkedHashMap<>(Map.of("S1", a, "S2", b, "S3", c));

    @Test void challengeAiReport_mapsLabelsToSampleIdsAndDropsUnknownOnes() {
        var result = ChallengeReportParser.parse("""
                ```json
                {"observations":[{"start_ms":0,"end_ms":1200,"text":"첫 문장 전에 숨을 고른다"},{"start_ms":-1,"end_ms":3,"text":"버림"}],
                 "comparisons":[{"text":"다른 참여작들은 더 빨리 시작했다","samples":["S1","S3","S9"]},{"text":"근거 없음","samples":["S9"]}],
                 "limits":["뒷부분 소리가 작다"],"suggestion":"멈춤을 짧게 해 보세요"}
                ```""", three);
        assertThat(result.observations()).hasSize(1);
        assertThat(result.comparisons()).hasSize(1);
        assertThat(result.comparisons().getFirst().samples()).containsExactly(a, c);
        assertThat(result.limits()).containsExactly("뒷부분 소리가 작다");
        assertThat(result.samples()).containsExactly(a, b, c);
    }

    @Test void challengeAiReport_withFewSamplesKeepsOnlyObservationsAndSaysSo() {
        var result = ChallengeReportParser.parse("""
                {"observations":[{"start_ms":0,"end_ms":900,"text":"시선을 오른쪽으로 둔다"}],
                 "comparisons":[{"text":"비교","samples":["S1"]}],"limits":[],"suggestion":null}""", Map.of("S1", a, "S2", b));
        assertThat(result.comparisons()).isEmpty();
        assertThat(result.limits()).containsExactly(ChallengeReportRules.TOO_FEW_SAMPLES);
        assertThat(result.suggestion()).isNull();
        assertThat(result.samples()).isEmpty();
    }

    @Test void challengeAiReport_rejectsForbiddenWordsMalformedOutputAndMissingObservations() {
        assertThatThrownBy(() -> ChallengeReportParser.parse("""
                {"observations":[{"start_ms":0,"end_ms":900,"text":"재능이 돋보인다"}],"comparisons":[],"limits":[],"suggestion":null}""",
                three)).isInstanceOfSatisfying(ChallengeReportParser.Rejected.class,
                rejected -> assertThat(rejected.reason()).isEqualTo("forbidden_words"));
        assertThatThrownBy(() -> ChallengeReportParser.parse("관찰 결과입니다", three))
                .isInstanceOfSatisfying(ChallengeReportParser.Rejected.class, rejected -> assertThat(rejected.reason()).isEqualTo("parse"));
        assertThatThrownBy(() -> ChallengeReportParser.parse("{\"observations\":[]}", three))
                .isInstanceOf(ChallengeReportParser.Rejected.class);
    }
}
