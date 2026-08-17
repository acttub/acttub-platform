package com.acttub.actingapi.platform.health;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * {@code GET /health} 응답. 형상은 기존 계약 그대로다
 * ({@code apps/api/acting-api/src/acting_api/app.py:236-248},
 * {@code apps/api/spec/openapi.json#/components/schemas/HealthResponse}).
 *
 * <p>{@code status} 의 {@code const: "ok"} 는 어노테이션으로 표현되지 않아
 * {@link HealthOpenApiCustomizer} 가 후처리로 넣는다.
 */
@Schema(
        name = "HealthResponse",
        title = "HealthResponse",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"status", "services", "model", "keep_alive", "commit"})
@JsonPropertyOrder({"status", "services", "model", "keep_alive", "commit"})
public record HealthResponse(
        @Schema(title = "Status", requiredMode = Schema.RequiredMode.REQUIRED)
        String status,

        @Schema(title = "Services", requiredMode = Schema.RequiredMode.REQUIRED)
        List<String> services,

        @Schema(title = "Model", requiredMode = Schema.RequiredMode.REQUIRED)
        String model,

        @com.fasterxml.jackson.annotation.JsonProperty("keep_alive")
        @Schema(name = "keep_alive", title = "Keep Alive", requiredMode = Schema.RequiredMode.REQUIRED)
        boolean keepAlive,

        @Schema(title = "Commit", requiredMode = Schema.RequiredMode.REQUIRED)
        String commit) {
}
