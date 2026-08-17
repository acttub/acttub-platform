package com.acttub.actingapi.platform.health;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

class KeepAlivePingerTest {

    @Test
    void stripsTrailingSlashesAndAppendsHealth() {
        List<String> calls = new ArrayList<>();
        KeepAlivePinger pinger = new KeepAlivePinger("https://acttub.test///", calls::add);

        pinger.ping();

        assertThat(pinger.target()).isEqualTo("https://acttub.test/health");
        assertThat(calls).containsExactly("https://acttub.test/health");
    }

    @Test
    void pingFailuresAreSwallowed() {
        KeepAlivePinger pinger = new KeepAlivePinger("https://acttub.test", target -> {
            throw new IllegalStateException("down");
        });

        assertThatCode(pinger::ping).doesNotThrowAnyException();
    }

    @Test
    void healthReflectsWhetherKeepAliveUrlIsConfigured() {
        assertThat(new HealthController("model", "", "unknown").health().keepAlive())
                .isFalse();
        assertThat(new HealthController(
                "model", "https://acttub.test", "unknown").health().keepAlive())
                .isTrue();
    }
}
