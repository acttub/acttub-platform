package com.acttub.actingapi.feature.feedback.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.feedback.app.ExitSurveyRules;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** 이탈 설문의 요청·응답 (practice.feedback). 셋 다 unknown key 를 거부한다. */
final class ExitSurveyDtos {
    private ExitSurveyDtos() {
    }

    @Schema(name = "PracticeFeedbackRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PracticeFeedbackRequest(
            @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Request Id")
            @JsonProperty("request_id") UUID requestId,
            // 어느 회차에서 나갔는지. 회차를 특정할 수 없는 화면도 있어 선택이다.
            @Schema(title = "Practice Id", nullable = true)
            @JsonProperty("practice_id") UUID practiceId,
            @NotNull @Pattern(regexp = "coach|report")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Screen",
                    allowableValues = {"coach", "report"})
            String screen,
            @NotNull @Pattern(regexp = "x|leave|back")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Trigger",
                    allowableValues = {"x", "leave", "back"})
            String trigger,
            // 그냥 나갔으면 본문이 없다(dismissed). 보냈으면 다듬은 뒤 1~100자다.
            @Schema(title = "Body", nullable = true, description = "공백 정리 뒤 1~100 유니코드 코드 포인트. 생략하면 건너뛰기다.")
            String body,
            @Schema(title = "Contact Email", nullable = true, maxLength = ExitSurveyRules.CONTACT_MAX_CHARS)
            @JsonProperty("contact_email") String contactEmail,
            @Schema(title = "Contact Phone", nullable = true, maxLength = ExitSurveyRules.CONTACT_MAX_CHARS)
            @JsonProperty("contact_phone") String contactPhone) {
    }

    @Schema(name = "PracticeFeedbackResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PracticeFeedbackResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Id") UUID id) {
    }

    /**
     * @param asked 이 계정에 이미 물어봤는가
     * @param askedNow 이번 요청이 노출 표식을 선점했는가. 참일 때만 시트를 띄운다
     */
    @Schema(name = "PracticeFeedbackStatus", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PracticeFeedbackStatus(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Asked") boolean asked,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Asked Now")
            @JsonProperty("asked_now") boolean askedNow) {
    }
}
