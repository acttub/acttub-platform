package com.acttub.actingapi.integration.observation;

import com.acttub.actingapi.integration.media.GeminiVideoCompressor;
import com.acttub.actingapi.integration.media.AudioExtractor;
import com.acttub.actingapi.integration.llm.ApiKeys;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

/**
 * 관측 층(Gemini)의 배선.
 *
 * <p>📌 <b>키가 없으면 기동이 죽는다.</b> 한때 이 설정을 프로파일로 걷어내 키 없이 뜨는 모드가
 * 있었지만(계약 하네스용 {@code contract} 프로파일), 그 모드는 `SOMA-403` 4단계에서 사라졌다.
 * 대체를 만든다면 {@code @Primary} 로는 안 된다 — <b>주입 경합에서 이겨도 빈 생성은 막지
 * 못하므로</b> 진짜 체인이 그대로 서고 키를 다시 요구한다. 조건을 걸어 <b>아예 세우지 않는</b>
 * 쪽이라야 한다.
 */
@Configuration(proxyBeanMethods = false)
class GeminiConfiguration {

    static final String DEFAULT_MODEL = "gemini-2.5-flash";

    /** 키 변수: 코칭(직접 영상 A/B·관찰·영상 기록·음성 전사)은 COACH, 리딩 음성은 TTS, 챌린지 비교는 CHALLENGE. */
    static final String COACH_KEY = "GEMINI_COACH_API_KEY";
    static final String TTS_KEY = "GEMINI_TTS_API_KEY";
    static final String CHALLENGE_KEY = "GEMINI_CHALLENGE_API_KEY";
    static final String LEGACY_KEY = "GEMINI_API_KEY";

    /**
     * 코칭 키는 GEMINI_COACH_API_KEY 가 먼저, 비면 옛 GEMINI_API_KEY(마이그레이션 대체). 둘 다 없으면 기동이 죽는다.
     */
    @Bean
    GeminiSettings geminiSettings(
            @Value("${GEMINI_COACH_API_KEY:}") String coachKey,
            @Value("${GEMINI_API_KEY:}") String legacyKey,
            @Value("${GEMINI_MODEL:" + DEFAULT_MODEL + "}") String model) {
        String apiKey = ApiKeys.firstNonBlank(coachKey, legacyKey);
        if (apiKey.isBlank()) {
            throw new IllegalStateException(
                    "GEMINI_COACH_API_KEY or GEMINI_API_KEY not found. Set it in ../video-feedback/.env or the environment.");
        }
        return new GeminiSettings(apiKey, model);
    }

    /** 코칭 클라이언트. @Primary 라 한정자 없는 주입(기존 코드·테스트)은 코칭 키를 쓴다. */
    @Bean(destroyMethod = "close")
    @Primary
    Client geminiClient(GeminiSettings settings) {
        return Client.builder().apiKey(settings.apiKey()).build();
    }

    /**
     * 리딩 음성(TTS) 전용. GEMINI_TTS_API_KEY → GEMINI_API_KEY. 둘 다 비면 코칭 키로 돌리지 않고 기동을 멈춘다
     * (기능 키를 몰래 다른 기능이 쓰지 않게 한다). 메시지에는 변수 이름만 적고 값은 적지 않는다.
     */
    @Bean(destroyMethod = "close")
    Client geminiTtsClient(
            @Value("${GEMINI_TTS_API_KEY:}") String ttsKey,
            @Value("${GEMINI_API_KEY:}") String legacyKey) {
        return Client.builder().apiKey(requiredKey(TTS_KEY, ttsKey, legacyKey)).build();
    }

    /** 챌린지 비교 전용. GEMINI_CHALLENGE_API_KEY → GEMINI_API_KEY. 둘 다 비면 기동을 멈춘다. */
    @Bean(destroyMethod = "close")
    Client geminiChallengeClient(
            @Value("${GEMINI_CHALLENGE_API_KEY:}") String challengeKey,
            @Value("${GEMINI_API_KEY:}") String legacyKey) {
        return Client.builder().apiKey(requiredKey(CHALLENGE_KEY, challengeKey, legacyKey)).build();
    }

    static String requiredKey(String scopedName, String scoped, String legacy) {
        String key = ApiKeys.firstNonBlank(scoped, legacy);
        if (key.isEmpty()) {
            throw new IllegalStateException(scopedName + " or " + LEGACY_KEY + " must be set.");
        }
        return key;
    }

    @Bean
    GeminiGateway geminiGateway(@Qualifier("geminiClient") Client client) {
        return new GoogleGenAiGateway(client);
    }

    @Bean
    ObservationAnalyzer observationAnalyzer(
            GeminiGateway gateway,
            ObjectMapper mapper,
            GeminiSettings settings,
            FailureReporter failureReporter,
            LlmTelemetry telemetry) {
        return new GeminiObservationAnalyzer(
                gateway, mapper, settings.model(), failureReporter, telemetry);
    }

    /** 코칭 1층 관찰(SOMA-815). 받아쓰기로 대사 덩어리를 정하고 관찰 모델이 덩어리마다 본 것을 적는다. */
    @Bean
    LayerOneObserver layerOneObserver(SpeechAnalyzer speechAnalyzer, GeminiGateway gateway,
            com.fasterxml.jackson.databind.ObjectMapper mapper, FailureReporter failureReporter, LlmTelemetry telemetry,
            @org.springframework.beans.factory.annotation.Value("${ACTTUB_COACH_LAYER1_MODEL:gemini-4-argon}") String model) {
        return new GeminiLayerOneObserver(speechAnalyzer, gateway, model, mapper, failureReporter, telemetry);
    }

    @Bean
    SpeechAnalyzer speechAnalyzer(
            GeminiGateway gateway, FailureReporter failureReporter, LlmTelemetry telemetry) {
        return new GeminiTranscriber(new AudioExtractor(), gateway, failureReporter, telemetry);
    }

    @Bean
    VideoRecordAnalyzer videoRecordAnalyzer(
            GeminiGateway gateway, GeminiSettings settings,
            FailureReporter failureReporter, LlmTelemetry telemetry) {
        return new GeminiVideoRecordAnalyzer(gateway,
                new com.acttub.actingapi.integration.media.VideoRecordChunks(),
                settings.model(), failureReporter, telemetry);
    }

    @Bean
    GeminiVideoCompressor geminiVideoCompressor(FailureReporter failureReporter) {
        return new GeminiVideoCompressor(failureReporter);
    }
}

record GeminiSettings(String apiKey, String model) {
}
