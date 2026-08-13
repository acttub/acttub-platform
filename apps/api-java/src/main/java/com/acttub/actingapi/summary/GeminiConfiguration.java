package com.acttub.actingapi.summary;

import com.acttub.actingapi.media.GeminiVideoCompressor;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
