package com.acttub.actingapi.feature.upload.adapter.web;

import io.swagger.v3.oas.models.media.Schema;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class UploadOpenApiCustomizer {
    @Bean
    OpenApiCustomizer uploadCompleteConstCustomizer() {
        return openApi -> {
            if (openApi.getComponents() == null || openApi.getComponents().getSchemas() == null) {
                return;
            }
            Schema<?> response = openApi.getComponents().getSchemas().get("UploadCompleteResponse");
            if (response == null || response.getProperties() == null) {
                return;
            }
            Schema<?> status = (Schema<?>) response.getProperties().get("status");
            if (status != null) {
                status.setConst("finalized");
                status.setEnum(null);
            }
        };
    }
}
