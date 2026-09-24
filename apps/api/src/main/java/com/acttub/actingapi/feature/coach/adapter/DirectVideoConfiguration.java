package com.acttub.actingapi.feature.coach.adapter;

import com.acttub.actingapi.feature.coach.app.CoachVideoSource;
import com.acttub.actingapi.feature.coach.app.DirectVideoCoach;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.observation.GeminiDirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.google.genai.Client;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Existing durable coach API only; activation is explicit in the deployment configuration. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "ACTTUB_DIRECT_VIDEO_ENABLED", havingValue = "true")
public class DirectVideoConfiguration {
    @Bean
    DirectVideoModel directVideoModel(Client client,
            @Value("${GEMINI_MODEL:gemini-3-flash-preview}") String model) {
        return new GeminiDirectVideoModel(client, model);
    }

    @Bean
    DirectVideoCoach directVideoCoach(DirectVideoModel model, CoachVideoSource videos,
            ObjectStorage storage, FailureReporter failures, LlmTelemetry telemetry,
            // 연습 루프가 기본이다. false 를 명시하면 이전 공통 프롬프트로 돌아간다(롤백).
            @Value("${ACTTUB_DIRECT_VIDEO_PRACTICE_LOOP:true}") boolean practiceLoop) {
        return new DirectVideoCoach(model, videos, storage, failures, telemetry, practiceLoop);
    }
}
