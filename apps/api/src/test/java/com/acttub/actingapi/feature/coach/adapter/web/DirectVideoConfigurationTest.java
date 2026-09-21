package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.time.Clock;
import com.acttub.actingapi.feature.coach.adapter.DirectVideoConfiguration;
import com.acttub.actingapi.feature.coach.app.DirectVideoSessions;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.security.AccessGate;
import com.google.genai.Client;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class DirectVideoConfigurationTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(DirectVideoConfiguration.class, DirectVideoController.class)
            .withBean(Client.class, () -> mock(Client.class))
            .withBean(Clock.class, Clock::systemUTC)
            .withBean(FailureReporter.class, () -> mock(FailureReporter.class))
            .withBean(AccessGate.class, () -> mock(AccessGate.class));

    @Test void enabledOnlyOnDev() {
        runner.withPropertyValues("SITE_URL=https://dev.acttub.com").run(context -> {
            assertThat(context).hasSingleBean(DirectVideoSessions.class).hasSingleBean(DirectVideoController.class);
        });
    }

    @Test void productionStaysDisabledEvenWithTheFlag() {
        runner.withPropertyValues("SITE_URL=https://acttub.com", "ACTTUB_DIRECT_VIDEO_ENABLED=true").run(context -> {
            assertThat(context).doesNotHaveBean(DirectVideoSessions.class).doesNotHaveBean(DirectVideoController.class);
        });
    }

    @Test void devCanDisableTheExperiment() {
        runner.withPropertyValues("SITE_URL=https://dev.acttub.com", "ACTTUB_DIRECT_VIDEO_ENABLED=false").run(context -> {
            assertThat(context).doesNotHaveBean(DirectVideoSessions.class).doesNotHaveBean(DirectVideoController.class);
        });
    }
}
