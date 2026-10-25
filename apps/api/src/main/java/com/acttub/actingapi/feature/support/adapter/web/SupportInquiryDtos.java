package com.acttub.actingapi.feature.support.adapter.web;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.support.app.SupportInquiryRules;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 웹 문의하기의 요청·응답 (app.support-inquiry). 모르는 칸은 거부한다. */
final class SupportInquiryDtos {
    private SupportInquiryDtos() {
    }

    @Schema(name = "SupportInquiryRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record SupportInquiryRequest(
            @NotNull @Pattern(regexp = "account|billing|refund|usage|bug|report|other")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Category",
                    allowableValues = {"account", "billing", "refund", "usage", "bug", "report", "other"})
            String category,
            @NotNull @Size(max = SupportInquiryRules.EMAIL_MAX_CHARS + 200)
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Email",
                    description = "공백을 걷어 낸 뒤 254자 이하의 이메일 주소.")
            String email,
            @NotNull @Size(max = SupportInquiryRules.BODY_MAX_CHARS + 2000)
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Body",
                    description = "공백을 걷어 낸 뒤 10~3000 유니코드 코드 포인트.")
            String body) {
    }

    @Schema(name = "SupportInquiryResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record SupportInquiryResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Id") UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Created At")
            @JsonProperty("created_at") Instant createdAt) {
    }
}
