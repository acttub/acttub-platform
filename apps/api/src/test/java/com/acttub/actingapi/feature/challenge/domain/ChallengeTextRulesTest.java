package com.acttub.actingapi.feature.challenge.domain;

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
}
