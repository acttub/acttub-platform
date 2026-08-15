package com.acttub.actingapi.consent;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.schema.ConsentAction;
import com.acttub.actingapi.schema.ConsentType;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

final class ConsentDtos {
    private ConsentDtos() {
    }

    @Schema(name = "ConsentDocument", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ConsentDocument(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    implementation = ConsentType.class)
            String type,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String version,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean required,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant publishedAt) {
    }

    @Schema(
            name = "ConsentDocumentsResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ConsentDocumentsResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ConsentDocument> documents) {
    }

    @Schema(name = "ConsentEventResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ConsentEventResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID documentId,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    implementation = ConsentAction.class)
            String action,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant occurredAt) {
    }

    // consents.py:ConsentRequest 가 extra 를 지정하지 않아 unknown key 를 받는다.
    // openapi.json 의 ConsentRequest 에도 additionalProperties 가 없다 (/SPEC.md §6-3 의 허용 5개 중 하나).
    @JsonIgnoreProperties(ignoreUnknown = true)
    @Schema(name = "ConsentRequest")
    record ConsentRequest(
            @NotNull @JsonProperty("document_id") String documentId,
            @NotNull ConsentActionInput action) {
    }

    @Schema(name = "ConsentAction")
    enum ConsentActionInput {
        granted,
        declined,
        revoked
    }
}
