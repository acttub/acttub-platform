package com.acttub.actingapi.feature.coach.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.coach.app.DirectVideoSessions;
import com.acttub.actingapi.integration.observation.GeminiDirectVideoModel;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.google.genai.Client;
import jakarta.servlet.MultipartConfigElement;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.servlet.MultipartConfigFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.unit.DataSize;

/** Durable coaching is deployment-controlled; disposable sessions remain dev-only. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "ACTTUB_DIRECT_VIDEO_ENABLED", havingValue = "true")
public class DirectVideoConfiguration {
    @Bean
    com.acttub.actingapi.integration.observation.DirectVideoModel directVideoModel(Client client,
            @Value("${GEMINI_MODEL:gemini-3-flash-preview}") String model) {
        return new GeminiDirectVideoModel(client, model);
    }

    @Bean
    com.acttub.actingapi.feature.coach.app.DirectVideoCoach directVideoCoach(
            com.acttub.actingapi.integration.observation.DirectVideoModel model,
            com.acttub.actingapi.feature.coach.app.CoachVideoSource videos,
            com.acttub.actingapi.integration.storage.ObjectStorage storage,
            FailureReporter failures, com.acttub.actingapi.platform.observability.LlmTelemetry telemetry,
            // 연습 루프가 기본이다 — 운영도 핫픽스(#388)로 이미 켜져 있다. false 를 명시하면 분류·과제 조립 경로로 돌아간다(롤백).
            @Value("${ACTTUB_DIRECT_VIDEO_PRACTICE_LOOP:true}") boolean practiceLoop,
            org.springframework.beans.factory.ObjectProvider<com.acttub.actingapi.feature.coach.app.CoachPersonas> personas,
            // 자문위원 코치 성격 비교(SOMA-622). false 면 모두 기본 성격이다(롤백).
            @Value("${ACTTUB_COACH_PERSONAS:true}") boolean personasEnabled,
            Client client,
            // 코치 모델 비교(SOMA-657). 새 대화의 SHARE% 는 코치 답을 이 모델로 쓴다. SHARE=0 이면 모두 GEMINI_MODEL(롤백).
            @Value("${GEMINI_COACH_MODEL_B:gemini-3.8-flash}") String modelB,
            @Value("${ACTTUB_COACH_MODEL_B_SHARE:50}") int modelBShare) {
        var alternate = modelB == null || modelB.isBlank() || modelBShare <= 0 ? null : new GeminiDirectVideoModel(client, modelB.strip());
        return new com.acttub.actingapi.feature.coach.app.DirectVideoCoach(model, videos, storage, failures, telemetry, practiceLoop,
                personasEnabled ? personas.getIfAvailable(() -> com.acttub.actingapi.feature.coach.app.CoachPersonas.NONE)
                        : com.acttub.actingapi.feature.coach.app.CoachPersonas.NONE,
                alternate, modelBShare);
    }

    @Bean(destroyMethod = "close")
    @ConditionalOnExpression("'${SITE_URL:}' == 'https://dev.acttub.com'")
    DirectVideoSessions directVideoSessions(Client client, FailureReporter failures, Clock clock,
            @Value("${GEMINI_MODEL:gemini-3-flash-preview}") String model) {
        return new DirectVideoSessions(new GeminiDirectVideoModel(client, model), failures, clock);
    }

    @Bean
    @ConditionalOnExpression("'${SITE_URL:}' == 'https://dev.acttub.com'")
    MultipartConfigElement directVideoMultipartConfig() {
        MultipartConfigFactory factory = new MultipartConfigFactory();
        factory.setMaxFileSize(DataSize.ofMegabytes(50));
        factory.setMaxRequestSize(DataSize.ofMegabytes(51));
        factory.setFileSizeThreshold(DataSize.ofBytes(0));
        return factory.createMultipartConfig();
    }
}
