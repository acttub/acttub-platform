package com.acttub.actingapi.integration.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.Arguments;

class TextValidatorTest {

    @Test
    void scansLiteralAfterNfkcNormalizationAndKeepsCanonicalTerm() {
        assertThat(TextValidator.scanForbidden("ＡＮＡＬＹＳＩＳ 결과입니다"))
                .containsExactly("ANALYSIS");
    }

    @Test
    void reportsFailuresInPythonValidationOrderWithExactMessages() {
        String message = "1:23에서 점수는 " + "가".repeat(180);

        TextValidation result = TextValidator.validateTurn(message, true);

        assertThat(result.failures()).containsExactly(
                "응답이 191자입니다. 170자 이내여야 합니다.",
                "금지어가 노출됐습니다: 점수",
                "응답에 시각이 들어 있습니다. 숫자를 빼고 대사나 동작으로 그 순간을 가리킵니다.");
        assertThat(result.checks().keySet())
                .containsExactly("sentence_limit", "forbidden_language", "timecode");
    }

    @Test
    void coachDisablesSentenceLimit() {
        TextValidation result = TextValidator.validateTurn("가".repeat(171), false);

        assertThat(result.failures()).isEmpty();
        assertThat(result.checks().get("sentence_limit")).isTrue();
    }

    @ParameterizedTest
    @MethodSource("timecodes")
    void detectsEachCanonicalTimecodePattern(String text) {
        assertThat(TextValidator.hasTimecode(text)).isTrue();
    }

    @ParameterizedTest
    @MethodSource("forbiddenRegexes")
    void detectsEachCanonicalForbiddenRegex(String text, String label) {
        assertThat(TextValidator.scanForbidden(text)).containsExactly(label);
    }

    private static Stream<String> timecodes() {
        return Stream.of(
                "1:23의 대사",
                "3초에서 5초 사이",
                "3-5초 사이",
                "7초쯤 멈춤",
                "1분 12초 부분");
    }

    private static Stream<Arguments> forbiddenRegexes() {
        return Stream.of(
                Arguments.of("배우님이 대사를 실수해서 그래요", "배우 책임 전가"),
                Arguments.of("실제 가족 상처를 떠올려 보세요", "개인 상처 소환"),
                Arguments.of("그건 성격 때문이에요", "정신상태 단정"));
    }
}
