package com.acttub.actingapi.feature.reading.adapter;

import java.time.Clock;
import java.util.concurrent.ThreadLocalRandom;

import com.acttub.actingapi.feature.reading.adapter.gen.GeminiScriptCocreateModel;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateModel;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateRepository;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateService;
import com.acttub.actingapi.feature.reading.app.ScriptService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 찍을 대사 같이 만들기 (SOMA-721, {@code /v2/sample-scripts}). 늘 켜져 있다 — 새 비밀 값 없이 코칭 키 클라이언트(@Primary)를
 * 쓰므로 기동 조건이 그대로다. 모델은 {@code ACTTUB_SAMPLE_SCRIPT_MODEL}, 비면 인계본에서 검증한 {@code gemini-4-argon}.
 */
@Configuration(proxyBeanMethods = false)
public class ScriptCocreateConfiguration {

    @Bean
    ScriptCocreateModel scriptCocreateModel(
            Client client,
            @Value("${ACTTUB_SAMPLE_SCRIPT_MODEL:gemini-4-argon}") String model) {
        return new GeminiScriptCocreateModel(client, model);
    }

    @Bean
    ScriptCocreateService scriptCocreateService(
            ScriptCocreateRepository cocreations, ScriptCocreateModel model, ScriptService scripts, ObjectMapper mapper, Clock clock) {
        return new ScriptCocreateService(cocreations, model, scripts, mapper, clock,
                bound -> ThreadLocalRandom.current().nextInt(bound));
    }
}
