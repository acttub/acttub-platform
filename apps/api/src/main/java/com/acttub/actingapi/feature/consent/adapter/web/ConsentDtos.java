package com.acttub.actingapi.feature.consent.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.ConsentAction;
import com.acttub.actingapi.platform.schema.ConsentType;
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

    /** 동의를 받지 않고 알리기만 하는 문서. 판도 결정도 없다. */
    @Schema(name = "ConsentNotice", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ConsentNotice(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = "privacy_policy") String type,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String body) {
    }

    @Schema(
            name = "ConsentNoticesResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ConsentNoticesResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ConsentNotice> notices) {
    }

    @Schema(
            name = "ConsentEntryDocument",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ConsentEntryDocument(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    implementation = ConsentType.class)
            String type,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String version,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean required,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant publishedAt,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    nullable = true,
                    allowableValues = {"granted", "declined"})
            String currentDecision,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant decidedAt) {
    }

    @Schema(name = "ConsentEntryStatus")
    enum ConsentEntryStatus {
        allowed,
        decision_required
    }

    @Schema(
            name = "ConsentEntryResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ConsentEntryResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ConsentEntryStatus entryStatus,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ConsentEntryDocument> documents,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
            List<ConsentEntryDocument> undecidedDocuments) {
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

    @Schema(
            name = "ConsentDocumentOutdatedError",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ConsentDocumentOutdatedError(
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = "consent_document_outdated")
            String detail) {
    }

    // consents.py:ConsentRequest 가 extra 를 지정하지 않아 unknown key 를 받는다.
    // openapi.json 의 ConsentRequest 에도 additionalProperties 가 없다 (apps/api/CONTRACT.md §6-3 의 허용 5개 중 하나).
    @JsonIgnoreProperties(ignoreUnknown = true)
    @Schema(name = "ConsentRequest")
    record ConsentRequest(
            @NotNull @JsonProperty("document_id") String documentId,
            @NotNull ConsentActionInput action,
            // 게스트의 첫 동의에만 필요하다 — "만 14세 이상이에요" 확인. 회원은 생년월일로 거른다.
            @JsonProperty("age_confirmed") Boolean ageConfirmed) {
    }

    /** 철회({@code revoked})는 입력이 아니다 — 탈퇴 뒤 운영자만 DB 에 기록한다. */
    @Schema(name = "ConsentDecision")
    enum ConsentActionInput {
        granted,
        declined
    }
}
