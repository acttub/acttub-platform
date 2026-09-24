package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import com.acttub.actingapi.feature.coach.adapter.DirectVideoConfiguration;
import com.acttub.actingapi.feature.coach.app.CoachVideoSource;
import com.acttub.actingapi.feature.coach.app.DirectVideoCoach;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.google.genai.Client;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class DirectVideoConfigurationTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(DirectVideoConfiguration.class)
            .withBean(Client.class, () -> mock(Client.class))
            .withBean(CoachVideoSource.class, () -> mock(CoachVideoSource.class))
            .withBean(ObjectStorage.class, () -> mock(ObjectStorage.class))
            .withBean(FailureReporter.class, () -> mock(FailureReporter.class))
            .withBean(LlmTelemetry.class, () -> mock(LlmTelemetry.class));

    @Test void deployedFlagEnablesExistingApiWithoutRequiringNewAccountSettings() {
        runner.withPropertyValues("ACTTUB_DIRECT_VIDEO_ENABLED=true").run(context -> {
            assertThat(context).hasSingleBean(DirectVideoCoach.class).hasSingleBean(DirectVideoModel.class)
                    .doesNotHaveBean("directVideoSessions").doesNotHaveBean("directVideoMultipartConfig");
        });
    }

    @Test void practiceLoopIsTheDefaultAndCanBeTurnedOff() {
        runner.withPropertyValues("ACTTUB_DIRECT_VIDEO_ENABLED=true").run(context ->
                assertThat(context.getBean(DirectVideoCoach.class).practiceLoop()).isTrue());
        runner.withPropertyValues("ACTTUB_DIRECT_VIDEO_ENABLED=true", "ACTTUB_DIRECT_VIDEO_PRACTICE_LOOP=false").run(context ->
                assertThat(context.getBean(DirectVideoCoach.class).practiceLoop()).isFalse());
    }

    @Test void disabledOrUnspecifiedFlagKeepsExistingModelPath() {
        for (String flag : new String[]{"false", ""}) {
            runner.withPropertyValues("ACTTUB_DIRECT_VIDEO_ENABLED=" + flag).run(context -> {
                assertThat(context).doesNotHaveBean(DirectVideoCoach.class).doesNotHaveBean(DirectVideoModel.class);
            });
        }
        runner.run(context -> assertThat(context).doesNotHaveBean(DirectVideoCoach.class));
    }
}
