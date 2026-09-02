package com.acttub.actingapi.platform.health;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

class KeepAlivePingerTest {

    @Test
    void stripsTrailingSlashesAndAppendsHealth() {
        List<String> calls = new ArrayList<>();
        KeepAlivePinger pinger = new KeepAlivePinger(
                "https://acttub.test///", calls::add, new RecordingFailureReporter());

        pinger.ping();

        assertThat(pinger.target()).isEqualTo("https://acttub.test/health");
        assertThat(calls).containsExactly("https://acttub.test/health");
    }

    @Test
    void pingFailuresAreSwallowed() {
        IllegalStateException failure = new IllegalStateException("down");
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        KeepAlivePinger pinger = new KeepAlivePinger("https://acttub.test", target -> {
            throw failure;
        }, reporter);

        assertThatCode(pinger::ping).doesNotThrowAnyException();
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo("KeepAlivePinger.ping");
        });
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
