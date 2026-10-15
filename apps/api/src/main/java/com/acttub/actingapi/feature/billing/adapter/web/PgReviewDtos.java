package com.acttub.actingapi.feature.billing.adapter.web;

import com.acttub.actingapi.platform.web.CredentialField;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** PG 심사 전용 테스트 결제의 요청·응답(SOMA-620). 공개 OpenAPI 에는 싣지 않는다. */
final class PgReviewDtos {
    private PgReviewDtos() {
    }

    record LoginRequest(
            // 공통 검증기(RequestBodyTreeValidator)는 @Schema 의 길이만 보고 @Size 는 보지 않는다. @Schema 가 없으면
            // 길이 초과가 검증기를 지나 Bean Validation 오류로 가서 비밀번호 원문이 input 으로 되돌아갈 수 있다.
            @NotBlank @Size(max = 64) @Schema(minLength = 1, maxLength = 64) String username,
            @CredentialField @NotBlank @Size(max = 128) @Schema(minLength = 1, maxLength = 128) String password) {
    }

    record ConfigResponse(boolean available, boolean authenticated, boolean testOnly, long amount) {
    }

    record LoginResponse(boolean authenticated) {
    }

    record CheckoutResponse(String clientKey, String customerKey, String successUrl, String failUrl) {
    }
}
