package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PushTargetTest {
    /** 말이 비었거나(옛 토큰) 공백뿐이거나 ko 면 한국어다. */
    @Test void koreanWhenTheLocaleIsUnknownOrKo() {
        for (String locale : new String[] {null, "", "  ", "ko"}) {
            assertThat(new PushTarget("token", locale).korean()).as("%s", locale).isTrue();
        }
        assertThat(new PushTarget("token", "en").korean()).isFalse();
    }
}
