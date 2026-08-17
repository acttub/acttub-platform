package com.acttub.actingapi.integration.observation;

import com.acttub.actingapi.integration.media.GeminiVideoCompressor;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
