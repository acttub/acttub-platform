package com.acttub.actingapi.feature.challenge.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** challenge.entry: 60초 상한으로 찍은 파일이 60.02초로 재어져도 참여할 수 있고, 61초는 거절한다. */
class ChallengeRulesTest {
    @Test void challengeEntry_sixtySecondsRoundsToTheNearestSecond() {
        assertThat(ChallengeRules.withinEntryLength(60_000)).isTrue();
        assertThat(ChallengeRules.withinEntryLength(60_020)).isTrue();
        assertThat(ChallengeRules.withinEntryLength(60_499)).isTrue();
        assertThat(ChallengeRules.withinEntryLength(60_500)).isFalse();
        assertThat(ChallengeRules.withinEntryLength(61_000)).isFalse();
    }
}
