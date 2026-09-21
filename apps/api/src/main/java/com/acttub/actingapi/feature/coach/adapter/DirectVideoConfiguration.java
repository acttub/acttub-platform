package com.acttub.actingapi.feature.coach.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.coach.app.DirectVideoSessions;
import com.acttub.actingapi.integration.observation.GeminiDirectVideoModel;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.google.genai.Client;
import jakarta.servlet.MultipartConfigElement;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.web.servlet.MultipartConfigFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.unit.DataSize;

/** Explicitly scoped to the dev site; the experiment never opens on the production hostname. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnExpression("'${SITE_URL:}' == 'https://dev.acttub.com' && '${ACTTUB_DIRECT_VIDEO_ENABLED:true}' == 'true'")
public class DirectVideoConfiguration {
    @Bean(destroyMethod = "close")
    DirectVideoSessions directVideoSessions(Client client, FailureReporter failures, Clock clock,
            @Value("${GEMINI_MODEL:gemini-3-flash-preview}") String model) {
        return new DirectVideoSessions(new GeminiDirectVideoModel(client, model), failures, clock);
    }

    @Bean
    MultipartConfigElement directVideoMultipartConfig() {
        MultipartConfigFactory factory = new MultipartConfigFactory();
        factory.setMaxFileSize(DataSize.ofMegabytes(50));
        factory.setMaxRequestSize(DataSize.ofMegabytes(51));
        factory.setFileSizeThreshold(DataSize.ofBytes(0));
        return factory.createMultipartConfig();
    }
}
