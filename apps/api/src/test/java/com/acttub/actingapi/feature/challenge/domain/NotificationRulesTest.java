package com.acttub.actingapi.feature.challenge.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** challenge.notification: 10분 묶음, 첫 사건 즉시·뒤 사건 구간 끝, 한국 시간 21시~09시는 09시로. */
class NotificationRulesTest {
    @Test void challengeNotification_firstEventGoesNowAndLaterOnesAtTheWindowEnd() {
        Instant noon = Instant.parse("2026-09-23T03:04:30Z");
        assertThat(NotificationRules.pushAfter(noon, true)).isEqualTo(noon);
        assertThat(NotificationRules.pushAfter(noon, false)).isEqualTo(Instant.parse("2026-09-23T03:10:00Z"));
        UUID recipient = UUID.randomUUID(), entry = UUID.randomUUID();
        assertThat(NotificationRules.groupKey(recipient, "entry_liked", entry, noon))
                .isEqualTo(NotificationRules.groupKey(recipient, "entry_liked", entry, Instant.parse("2026-09-23T03:09:59Z")))
                .isNotEqualTo(NotificationRules.groupKey(recipient, "entry_liked", entry, Instant.parse("2026-09-23T03:10:00Z")));
    }

    @Test void challengeNotification_nightPushesWaitUntilNineWithoutAFirstEventException() {
        Instant elevenPm = Instant.parse("2026-09-23T14:00:00Z");
        assertThat(NotificationRules.pushAfter(elevenPm, true)).isEqualTo(Instant.parse("2026-09-24T00:00:00Z"));
        Instant fiveAm = Instant.parse("2026-09-23T20:00:00Z");
        assertThat(NotificationRules.pushAfter(fiveAm, true)).isEqualTo(Instant.parse("2026-09-24T00:00:00Z"));
        Instant justBeforeNine = Instant.parse("2026-09-23T11:59:59Z");
        assertThat(NotificationRules.pushAfter(justBeforeNine, true)).isEqualTo(justBeforeNine);
        assertThat(NotificationRules.pushAfter(Instant.parse("2026-09-23T11:55:00Z"), false))
                .isEqualTo(Instant.parse("2026-09-24T00:00:00Z"));
        assertThat(NotificationRules.pushBody("entry_commented")).doesNotContain("님");
    }
}
