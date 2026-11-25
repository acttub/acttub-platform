package com.acttub.actingapi.feature.coach.adapter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.time.Clock;
import java.util.List;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.security.AccessGate;
import com.google.genai.Client;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class DirectVideoConfigurationTest {
    // 직접 영상 코치는 객체 저장소가 설정된 곳에서 선다(저장소 빈과 같은 조건). 저장소 자체는 아래 가짜다.
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withPropertyValues("S3_BUCKET=test-bucket", "AWS_REGION=ap-northeast-2")
            .withUserConfiguration(DirectVideoConfiguration.class)
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

    @Test void devAndProductionBuildTheSameDurableCoach() {
        for (String site : List.of("https://dev.acttub.com", "https://acttub.com")) {
            runner.withPropertyValues("SITE_URL=" + site).run(context -> {
                assertThat(context).hasSingleBean(com.acttub.actingapi.feature.coach.app.DirectVideoCoach.class)
                        .hasSingleBean(com.acttub.actingapi.integration.observation.DirectVideoModel.class)
                        .doesNotHaveBean(jakarta.servlet.MultipartConfigElement.class);
            });
        }
    }

    @Test void coachLatencyPartsAreOnByDefaultAndTheHedgeCanBeTurnedOff() {
        runner.withPropertyValues("SITE_URL=https://acttub.com", "MONITORING_ENVIRONMENT=prod")
                .run(context -> {
                    assertThat(context).hasSingleBean(com.acttub.actingapi.feature.analysis.app.DirectVideoWarmup.class);
                    var hedge = context.getBean(com.acttub.actingapi.integration.observation.GeminiDirectVideoModel.Hedge.class);
                    assertThat(hedge.classify()).isEqualTo(java.time.Duration.ofSeconds(6));
                    assertThat(hedge.reply()).isEqualTo(java.time.Duration.ofSeconds(20));
                    assertThat(hedge.stream()).as("스트리밍 다시 보내기는 첫 조각 12초").isEqualTo(java.time.Duration.ofSeconds(12));
                    assertThat(context).as("올리기가 끝나면 첫 질문용 영상을 미리 준비한다")
                            .hasSingleBean(com.acttub.actingapi.feature.video.app.VideoUploadWarmup.class);
                    var cache = context.getBean(com.acttub.actingapi.feature.coach.app.CoachVideoCache.class);
                    assertThat(cache.label(new com.acttub.actingapi.feature.coach.app.CoachVideoCache.Key(
                            java.util.UUID.randomUUID(), "k", "e"))).startsWith("acttub-coach:prod:");
                });
        runner.withPropertyValues("SITE_URL=https://acttub.com",
                        "ACTTUB_COACH_HEDGE_REPLY_SECONDS=0", "ACTTUB_COACH_MODEL_B_SHARE=0")
                .run(context -> assertThat(context.getBean(
                        com.acttub.actingapi.integration.observation.GeminiDirectVideoModel.Hedge.class).reply()).isZero());
    }
}
