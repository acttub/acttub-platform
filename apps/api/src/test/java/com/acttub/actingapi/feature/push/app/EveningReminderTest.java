package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class EveningReminderTest {
    @Test void choosesCopyByTokenLocale() {
        var ko = EveningReminder.message(new PushTarget("ko-token", "ko"));
        var en = EveningReminder.message(new PushTarget("en-token", "en"));
        assertThat(ko.title()).isEqualTo("오늘 연습 아직이에요");
        assertThat(ko.body()).isEqualTo("5분이면 돼요. 장면 하나 찍거나 대본 한 번 읽어 볼까요?");
        assertThat(en.title()).isEqualTo("No practice yet today");
        assertThat(en.body()).isEqualTo("Five minutes is enough. Shoot one scene or run a script?");
        assertThat(ko.data()).containsExactlyEntriesOf(java.util.Map.of("kind", "evening_reminder"));
    }
}
