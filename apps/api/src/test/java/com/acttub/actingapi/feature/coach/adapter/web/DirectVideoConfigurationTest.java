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
            .withBean(AccessGate.class, () -> mock(AccessGate.class))
            .withBean(com.acttub.actingapi.feature.coach.app.CoachVideoSource.class,
                    () -> mock(com.acttub.actingapi.feature.coach.app.CoachVideoSource.class))
            .withBean(com.acttub.actingapi.integration.storage.ObjectStorage.class,
                    () -> mock(com.acttub.actingapi.integration.storage.ObjectStorage.class))
            .withBean(com.acttub.actingapi.platform.observability.LlmTelemetry.class,
                    () -> mock(com.acttub.actingapi.platform.observability.LlmTelemetry.class));

    @Test void enabledOnlyOnDev() {
        runner.withPropertyValues("SITE_URL=https://dev.acttub.com", "ACTTUB_DIRECT_VIDEO_ENABLED=true").run(context -> {
            assertThat(context).hasSingleBean(DirectVideoSessions.class).hasSingleBean(DirectVideoController.class)
                    .hasSingleBean(com.acttub.actingapi.feature.coach.app.DirectVideoCoach.class)
                    .hasSingleBean(com.acttub.actingapi.integration.observation.DirectVideoModel.class);
        });
    }

    @Test void productionEnablesDurableCoachButNotDisposableApi() {
        runner.withPropertyValues("SITE_URL=https://acttub.com", "ACTTUB_DIRECT_VIDEO_ENABLED=true").run(context -> {
            assertThat(context).doesNotHaveBean(DirectVideoSessions.class).doesNotHaveBean(DirectVideoController.class)
                    .hasSingleBean(com.acttub.actingapi.feature.coach.app.DirectVideoCoach.class)
                    .hasSingleBean(com.acttub.actingapi.integration.observation.DirectVideoModel.class);
        });
    }

    @Test void practiceLoopIsTheDefaultEverywhereAndCanBeTurnedOff() {
        runner.withPropertyValues("SITE_URL=https://dev.acttub.com", "ACTTUB_DIRECT_VIDEO_ENABLED=true").run(context ->
                assertThat(context.getBean(com.acttub.actingapi.feature.coach.app.DirectVideoCoach.class).practiceLoop()).isTrue());
        // 운영도 기본으로 켜져 있다(핫픽스 #388).
        runner.withPropertyValues("SITE_URL=https://acttub.com", "ACTTUB_DIRECT_VIDEO_ENABLED=true").run(context ->
                assertThat(context.getBean(com.acttub.actingapi.feature.coach.app.DirectVideoCoach.class).practiceLoop()).isTrue());
        runner.withPropertyValues("SITE_URL=https://dev.acttub.com", "ACTTUB_DIRECT_VIDEO_ENABLED=true",
                "ACTTUB_DIRECT_VIDEO_PRACTICE_LOOP=false").run(context ->
                assertThat(context.getBean(com.acttub.actingapi.feature.coach.app.DirectVideoCoach.class).practiceLoop()).isFalse());
    }

    @Test void devCanDisableTheExperiment() {
        runner.withPropertyValues("SITE_URL=https://dev.acttub.com", "ACTTUB_DIRECT_VIDEO_ENABLED=false").run(context -> {
            assertThat(context).doesNotHaveBean(DirectVideoSessions.class).doesNotHaveBean(DirectVideoController.class)
                    .doesNotHaveBean(com.acttub.actingapi.feature.coach.app.DirectVideoCoach.class)
                    .doesNotHaveBean(com.acttub.actingapi.integration.observation.DirectVideoModel.class);
        });
    }

    @Test void coachLatencyPartsAreOnByDefaultAndEachCanBeTurnedOff() {
        runner.withPropertyValues("SITE_URL=https://acttub.com", "ACTTUB_DIRECT_VIDEO_ENABLED=true", "MONITORING_ENVIRONMENT=prod")
                .run(context -> {
                    assertThat(context).hasSingleBean(com.acttub.actingapi.feature.analysis.app.DirectVideoWarmup.class);
                    var hedge = context.getBean(com.acttub.actingapi.integration.observation.GeminiDirectVideoModel.Hedge.class);
                    assertThat(hedge.classify()).isEqualTo(java.time.Duration.ofSeconds(6));
                    assertThat(hedge.reply()).isEqualTo(java.time.Duration.ofSeconds(20));
                    assertThat(hedge.stream()).isEqualTo(java.time.Duration.ofSeconds(12));
                    var cache = context.getBean(com.acttub.actingapi.feature.coach.app.CoachVideoCache.class);
                    assertThat(cache.label(new com.acttub.actingapi.feature.coach.app.CoachVideoCache.Key(
                            java.util.UUID.randomUUID(), "k", "e"))).startsWith("acttub-coach:prod:");
                });
        runner.withPropertyValues("SITE_URL=https://acttub.com", "ACTTUB_DIRECT_VIDEO_ENABLED=true",
                        "ACTTUB_COACH_VIDEO_WARMUP=false", "ACTTUB_COACH_VIDEO_LABELS=false", "ACTTUB_COACH_HEDGE_REPLY_SECONDS=0",
                        "ACTTUB_COACH_MODEL_B_SHARE=0")
                .run(context -> {
                    assertThat(context).doesNotHaveBean(com.acttub.actingapi.feature.analysis.app.DirectVideoWarmup.class);
                    assertThat(context.getBean(com.acttub.actingapi.integration.observation.GeminiDirectVideoModel.Hedge.class).reply())
                            .isZero();
                    assertThat(context.getBean(com.acttub.actingapi.feature.coach.app.CoachVideoCache.class).label(
                            new com.acttub.actingapi.feature.coach.app.CoachVideoCache.Key(java.util.UUID.randomUUID(), "k", "e")))
                            .isNull();
                });
    }
}
