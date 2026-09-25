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
            @Value("${ACTTUB_DIRECT_VIDEO_PRACTICE_LOOP:true}") boolean practiceLoop) {
        return new com.acttub.actingapi.feature.coach.app.DirectVideoCoach(model, videos, storage, failures, telemetry, practiceLoop);
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
