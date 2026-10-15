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
                "", " ", GeminiConfiguration.DEFAULT_MODEL))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("GEMINI_COACH_API_KEY or GEMINI_API_KEY not found. Set it in ../video-feedback/.env or the environment.");
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
                    // 코칭·TTS·챌린지 클라이언트 셋, 한정자 없는 주입은 @Primary 코칭 클라이언트다.
                    assertThat(context.getBeansOfType(Client.class)).hasSize(3);
                    assertThat(context.getBean(Client.class)).isSameAs(context.getBean("geminiClient"));
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

    @Test
    void coachKeyWinsOverLegacyAndLegacyIsTheMigrationFallback() {
        runner.withPropertyValues("GEMINI_COACH_API_KEY=coach-key", "GEMINI_API_KEY=legacy-key")
                .run(context -> assertThat(context.getBean("geminiClient", Client.class).apiKey()).isEqualTo("coach-key"));
        runner.withPropertyValues("GEMINI_COACH_API_KEY=", "GEMINI_API_KEY=legacy-key")
                .run(context -> assertThat(context.getBean("geminiClient", Client.class).apiKey()).isEqualTo("legacy-key"));
    }

    @Test
    void ttsAndChallengeClientsUseTheirOwnKeysAndNeverTheCoachKeyWhenLegacyExists() {
        runner.withPropertyValues("GEMINI_COACH_API_KEY=coach-key", "GEMINI_TTS_API_KEY=tts-key",
                        "GEMINI_CHALLENGE_API_KEY=challenge-key", "GEMINI_API_KEY=legacy-key")
                .run(context -> {
                    assertThat(context.getBean("geminiClient", Client.class).apiKey()).isEqualTo("coach-key");
                    assertThat(context.getBean("geminiTtsClient", Client.class).apiKey()).isEqualTo("tts-key");
                    assertThat(context.getBean("geminiChallengeClient", Client.class).apiKey()).isEqualTo("challenge-key");
                    // 한정자 없는 주입(기존 코드·테스트)은 코칭 클라이언트다.
                    assertThat(context.getBean(Client.class).apiKey()).isEqualTo("coach-key");
                    // 관찰·영상기록·전사는 코칭 클라이언트의 게이트웨이를 쓴다.
                    assertThat(context).hasSingleBean(GeminiGateway.class);
                });
    }

    @Test
    void unsetNewKeysFallBackToLegacyKeyForTtsAndChallenge() {
        runner.withPropertyValues("GEMINI_API_KEY=legacy-key", "GEMINI_TTS_API_KEY=", "GEMINI_CHALLENGE_API_KEY= ")
                .run(context -> {
                    assertThat(context.getBean("geminiClient", Client.class).apiKey()).isEqualTo("legacy-key");
                    assertThat(context.getBean("geminiTtsClient", Client.class).apiKey()).isEqualTo("legacy-key");
                    assertThat(context.getBean("geminiChallengeClient", Client.class).apiKey()).isEqualTo("legacy-key");
                });
    }

    @Test
    void scopedKeysAloneBootWithoutTheLegacyKey() {
        runner.withPropertyValues("GEMINI_COACH_API_KEY=coach-key", "GEMINI_TTS_API_KEY=tts-key",
                        "GEMINI_CHALLENGE_API_KEY=challenge-key")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getBean("geminiClient", Client.class).apiKey()).isEqualTo("coach-key");
                    assertThat(context.getBean("geminiTtsClient", Client.class).apiKey()).isEqualTo("tts-key");
                    assertThat(context.getBean("geminiChallengeClient", Client.class).apiKey()).isEqualTo("challenge-key");
                });
    }

    @Test
    void ttsAndChallengeNeverBorrowTheCoachKey() {
        // 코칭 키만 있고 TTS·챌린지 키도 공용 키도 없으면 조용히 코칭 키를 쓰지 않고 기동이 멈춘다.
        runner.withPropertyValues("GEMINI_COACH_API_KEY=coach-key")
                .run(context -> {
                    assertThat(context).hasFailed();
                    String message = rootMessages(context.getStartupFailure());
                    assertThat(message).contains("GEMINI_TTS_API_KEY or GEMINI_API_KEY").doesNotContain("coach-key");
                });
        runner.withPropertyValues("GEMINI_COACH_API_KEY=coach-key", "GEMINI_TTS_API_KEY=tts-key",
                        "GEMINI_CHALLENGE_API_KEY= ")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(rootMessages(context.getStartupFailure()))
                            .contains("GEMINI_CHALLENGE_API_KEY or GEMINI_API_KEY");
                });
        assertThatThrownBy(() -> GeminiConfiguration.requiredKey("GEMINI_TTS_API_KEY", " ", ""))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("GEMINI_TTS_API_KEY or GEMINI_API_KEY must be set.");
    }

    private static String rootMessages(Throwable failure) {
        StringBuilder all = new StringBuilder();
        for (Throwable t = failure; t != null; t = t.getCause()) {
            all.append(t.getMessage()).append('\n');
        }
        return all.toString();
    }

    @Test
    void consumersAskForTheirOwnFeatureClient() throws Exception {
        assertThat(qualifierOf(Class.forName("com.acttub.actingapi.feature.reading.adapter.ReadingConfiguration"),
                "voiceSynthesizer")).isEqualTo("geminiTtsClient");
        assertThat(qualifierOfConstructor(Class.forName(
                "com.acttub.actingapi.feature.challenge.adapter.media.GeminiChallengeReportModel")))
                .isEqualTo("geminiChallengeClient");
        assertThat(qualifierOf(GeminiConfiguration.class, "geminiGateway")).isEqualTo("geminiClient");
    }

    private static String qualifierOf(Class<?> type, String method) {
        for (var candidate : type.getDeclaredMethods()) {
            if (candidate.getName().equals(method)) {
                return qualifier(candidate.getParameters()[0]);
            }
        }
        throw new AssertionError(method);
    }

    private static String qualifierOfConstructor(Class<?> type) {
        for (var parameter : type.getDeclaredConstructors()[0].getParameters()) {
            String name = qualifier(parameter);
            if (name != null) {
                return name;
            }
        }
        return null;
    }

    private static String qualifier(java.lang.reflect.Parameter parameter) {
        var annotation = parameter.getAnnotation(org.springframework.beans.factory.annotation.Qualifier.class);
        return annotation == null ? null : annotation.value();
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
