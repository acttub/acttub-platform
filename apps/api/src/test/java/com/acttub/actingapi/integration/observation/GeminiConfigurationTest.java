package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acttub.actingapi.integration.media.GeminiVideoCompressor;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import org.junit.jupiter.api.Test;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

class GeminiConfigurationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(GeminiConfiguration.class, MapperConfiguration.class)
            // 관측기는 이 설정의 관심사가 아니지만 관찰·받아쓰기 빈이 요구한다(SOMA-517).
            .withBean(LlmTelemetry.class, RecordingLlmTelemetry::new);

    @Test
    void missingOrBlankGeminiApiKeyFailsStartup() {
        assertThatThrownBy(() -> new GeminiConfiguration().geminiSettings(
                "", GeminiConfiguration.DEFAULT_MODEL))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("GEMINI_API_KEY not found. Set it in ../video-feedback/.env or the environment.");
        runner.withPropertyValues("GEMINI_API_KEY=")
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void configuredApiKeyUsesDefaultModelAndCreatesTheObservationLayer() {
        runner.withPropertyValues("GEMINI_API_KEY=not-a-real-key")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getBean(GeminiSettings.class).model())
                            .isEqualTo("gemini-2.5-flash");
                    assertThat(context).hasSingleBean(Client.class);
                    assertThat(context).hasSingleBean(ObservationAnalyzer.class);
                    assertThat(context).hasSingleBean(SpeechAnalyzer.class);
                    assertThat(context).hasSingleBean(GeminiVideoCompressor.class);
                });
    }

    @Test
    void configuredModelOverridesTheDefault() {
        runner.withPropertyValues(
                        "GEMINI_API_KEY=not-a-real-key",
                        "GEMINI_MODEL=gemini-test-model")
                .run(context -> assertThat(context.getBean(GeminiSettings.class).model())
                        .isEqualTo("gemini-test-model"));
    }

    @Configuration(proxyBeanMethods = false)
    static class MapperConfiguration {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper();
        }

        @Bean
        FailureReporter failureReporter() {
            return new RecordingFailureReporter();
        }
    }
}
