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

    /** 말이 비었거나(옛 토큰) 공백뿐이면 한국어로 본다. */
    @Test void unknownLocaleFallsBackToKorean() {
        for (String locale : new String[] {null, "", "  "}) {
            assertThat(EveningReminder.message(new PushTarget("token", locale)).title())
                    .as("%s", locale).isEqualTo("오늘 연습 아직이에요");
        }
    }

    /** 실험이 켜지면 문구는 그대로이고 data 에 갈래만 붙는다. kind 는 앱이 읽으므로 그대로다. */
    @Test void experimentMessagesKeepKindAndAddVariant() {
        var a = EveningReminder.message(new PushTarget("t", "ko"), EveningReminderExperiment.Variant.A);
        assertThat(a.title()).isEqualTo("오늘 연습 아직이에요");
        assertThat(a.data()).containsEntry("kind", "evening_reminder").containsEntry("variant", "a")
                .containsEntry("personalized", "false");

        var b = EveningReminder.personal(new PushTarget("t", "ko"), "상대가 흔들리는지 보면서 한 번 더 찍어 봐요.");
        assertThat(b.title()).isEqualTo("지난번에 정한 거, 오늘 해 볼까요?");
        assertThat(b.body()).isEqualTo("상대가 흔들리는지 보면서 한 번 더 찍어 봐요.");
        assertThat(b.data()).containsEntry("kind", "evening_reminder").containsEntry("variant", "b")
                .containsEntry("personalized", "true");
        assertThat(EveningReminder.personal(new PushTarget("t", "en"), "One more take?").title())
                .isEqualTo("Try what you planned last time?");
    }
}
