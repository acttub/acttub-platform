package com.acttub.actingapi.feature.challenge.domain;

import java.time.Duration;
import java.util.List;
import java.util.regex.Pattern;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 챌린지 글: 없는 값은 빈 글이고 금지어 검사도 없는 값은 지나간다. */
class ChallengeTextRulesTest {
    @Test void missingTextIsEmptyAndHasNoForbiddenWord() {
        assertThat(ChallengeRules.trim(null)).isEmpty();
        assertThat(ChallengeRules.normalize(null)).isEmpty();
        assertThat(ChallengeRules.normalize("  가지\u3000\uFEFF 마 ")).isEqualTo("가지 마");
        assertThat(ChallengeRules.trim("\uFEFF 가지  마 ")).isEqualTo("가지  마");
        assertThat(ChallengeReportRules.forbiddenWord(null)).isNull();
    }

    @Test void trimDropsTheSameCharactersAsTheRegexItReplaced() {
        Pattern before = Pattern.compile("(?U)^[\\s\\uFEFF]+|[\\s\\uFEFF]+$");
        for (int code = 0; code <= Character.MAX_VALUE; code++) {
            char c = (char) code;
            for (String value : List.of(c + "가" + c + "나" + c, "" + c, "" + c + c, "가" + c + "\n", "\n" + c + "가")) {
                assertThat(ChallengeRules.trim(value)).as("U+%04X", code).isEqualTo(before.matcher(value).replaceAll(""));
            }
        }
    }

    @Test void trimOfALongBlankRunIsFast() {
        String blanks = " ".repeat(200_000);
        // 수정 전에는 공백 2만 자에 720ms, 20만 자면 그 100배였다
        assertTimeoutPreemptively(Duration.ofSeconds(2), () -> {
            assertThat(ChallengeRules.trim(blanks)).isEmpty();
            assertThat(ChallengeRules.trim("가" + blanks + "나")).isEqualTo("가" + blanks + "나");
        });
    }
}
