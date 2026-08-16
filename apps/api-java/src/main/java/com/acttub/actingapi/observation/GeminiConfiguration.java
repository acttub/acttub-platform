package com.acttub.actingapi.observation;

import com.acttub.actingapi.media.GeminiVideoCompressor;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * contract 프로파일에는 진짜 분석 체인이 존재하지 않는다({@code AnalysisConfiguration} 도 같다).
 *
 * <p>{@code ContractAnalysisProcessor} 가 {@code @Primary} 로 주입 경합에서 이기지만
 * <b>{@code @Primary} 는 빈 생성을 막지 않는다</b> — 조건이 없으면 쓰이지도 않는 이 설정이
 * contract 에서도 로드돼 {@code GEMINI_API_KEY} 가 비면 컨텍스트가 죽는다. 하네스 인스턴스는
 * {@code -Dacttub.dotenv.enabled=false} 로 띄우므로 그 키를 받을 곳이 없다.
 */
@Configuration(proxyBeanMethods = false)
@Profile("!contract")
class GeminiConfiguration {

    static final String DEFAULT_MODEL = "gemini-2.5-flash";

    @Bean
    GeminiSettings geminiSettings(
            @Value("${GEMINI_API_KEY:}") String apiKey,
            @Value("${GEMINI_MODEL:" + DEFAULT_MODEL + "}") String model) {
        if (apiKey.isBlank()) {
            throw new IllegalStateException(
                    "GEMINI_API_KEY not found. Set it in ../video-feedback/.env or the environment.");
        }
        return new GeminiSettings(apiKey, model);
    }

    @Bean(destroyMethod = "close")
    Client geminiClient(GeminiSettings settings) {
        return Client.builder().apiKey(settings.apiKey()).build();
    }

    @Bean
    GeminiGateway geminiGateway(Client client) {
        return new GoogleGenAiGateway(client);
    }

    @Bean
    ObservationAnalyzer observationAnalyzer(
            GeminiGateway gateway,
            ObjectMapper mapper,
            GeminiSettings settings) {
        return new GeminiObservationAnalyzer(gateway, mapper, settings.model());
    }

    @Bean
    GeminiVideoCompressor geminiVideoCompressor() {
        return new GeminiVideoCompressor();
    }
}

record GeminiSettings(String apiKey, String model) {
}
