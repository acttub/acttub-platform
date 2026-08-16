package com.acttub.actingapi.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acttub.actingapi.integration.media.GeminiVideoCompressor;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

class GeminiConfigurationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(GeminiConfiguration.class, MapperConfiguration.class);

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

    /**
     * 하네스 인스턴스는 {@code -Dacttub.dotenv.enabled=false} 로 떠서 키를 받을 곳이 없다.
     * 위 세 테스트가 대조군이다 — {@code !contract} 에서는 키를 요구하고 층을 세운다.
     */
    @Test
    void contractProfileNeitherRequiresTheKeyNorBuildsTheObservationLayer() {
        runner.withPropertyValues("spring.profiles.active=contract")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).doesNotHaveBean(GeminiSettings.class);
                    assertThat(context).doesNotHaveBean(Client.class);
                    assertThat(context).doesNotHaveBean(ObservationAnalyzer.class);
                    assertThat(context).doesNotHaveBean(GeminiVideoCompressor.class);
                });
    }

    @Configuration(proxyBeanMethods = false)
    static class MapperConfiguration {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper();
        }
    }
}
