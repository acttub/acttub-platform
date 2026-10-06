package com.acttub.actingapi.feature.reading.adapter.web;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.SourceInput;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

final class ImportDtos {
    private ImportDtos() {
    }

    /**
     * 대본 하나를 나눠 달라는 요청. 글({@code raw_text})이나 읽어 둔 원본 파일({@code upload_id}) 가운데 하나만 싣는다. 제목이
     * 없으면 서버가 글에서 고른다.
     */
    @Schema(name = "ReadingImportRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ImportRequest(
            @NotNull @JsonProperty("request_id") UUID requestId,
            @Schema(nullable = true, maxLength = 200) String title,
            @Schema(nullable = true, description = "upload_id 가 없을 때 필수") @JsonProperty("raw_text") String rawText,
            @Schema(nullable = true, description = "POST /v2/reading/uploads/{upload_id}/complete 를 마친 원본. raw_text 가 없을 때 필수")
            @JsonProperty("upload_id") UUID uploadId,
            @NotNull SourceInput source) {
    }

    /** 원본 파일을 올릴 자리를 달라는 요청. 확장자로 형식을 거르고 크기는 서명에 묶는다. */
    @Schema(name = "ReadingUploadRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record UploadRequest(
            @NotNull @NotBlank @Size(max = 255) String fileName,
            @NotNull @Positive Long byteSize) {
    }

    /** 올릴 자리. 기기는 {@code upload_url} 에 {@code Content-Type: content_type} 으로 파일을 PUT 한다. */
    @Schema(name = "ReadingUpload", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record UploadResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID uploadId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String uploadUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String contentType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant expiresAt) {
    }

    /**
     * 접수 결과. 둘 중 하나만 있다 — 새 요청·재전송·진행 중이면 {@code import_id}(그 id 로 상태를 묻는다), 같은 글의 대본이
     * 이미 있으면 {@code duplicate_script_id}(R2.7).
     */
    @Schema(name = "ReadingImportTicket", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record TicketResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID importId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID duplicateScriptId) {
    }

    /**
     * 요청의 상태. {@code succeeded} 면 {@code script_id} 로 대본을 연다. {@code failed} 면 {@code failure} 가 이유다.
     *
     * @param progress 나눈 줄 수 — 화면의 「N / M줄」
     */
    @Schema(name = "ReadingImport", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ImportResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"pending", "running", "succeeded", "failed"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ProgressResponse progress,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID scriptId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, implementation = ScriptImportFailure.class)
            String failure) {
    }

    @Schema(name = "ReadingImportProgress", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ProgressResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int doneLines,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int totalLines) {
    }
}
