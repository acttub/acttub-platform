package com.acttub.actingapi.platform.health;

import io.swagger.v3.oas.models.media.Schema;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * {@code HealthResponse.status} 에 JSON Schema {@code const} 를 붙인다.
 *
 * <p>Pydantic 은 {@code Literal["ok"]} 를 OpenAPI 3.1 의 {@code "const": "ok"} 로 낸다
 * ({@code apps/api/spec/openapi.json}). swagger-core 어노테이션에는 대응물이 없어
 * ({@code allowableValues} 는 {@code enum: ["ok"]} 이 된다) 모델을 직접 손본다.
 *
 * <p>M1 이후 다른 {@code Literal} 필드가 늘어나면 이 커스터마이저를 일반화한다.
 */
@Configuration(proxyBeanMethods = false)
public class HealthOpenApiCustomizer {

    @Bean
    OpenApiCustomizer healthResponseConstCustomizer() {
        return openApi -> {
            // springdoc 은 컨트롤러 이름으로 태그를 자동 생성한다("health-controller").
            // Python 의 /health 에는 태그가 없다 — /v2/* 만 v2-auth 같은 태그를 단다.
            if (openApi.getPaths() != null && openApi.getPaths().get("/health") != null) {
                openApi.getPaths().get("/health").readOperations()
                        .forEach(operation -> operation.setTags(null));
            }
            if (openApi.getComponents() == null || openApi.getComponents().getSchemas() == null) {
                return;
            }
            Schema<?> health = openApi.getComponents().getSchemas().get("HealthResponse");
            if (health == null || health.getProperties() == null) {
                return;
            }
            Schema<?> status = (Schema<?>) health.getProperties().get("status");
            if (status != null) {
                status.setConst("ok");
            }
        };
    }
}
