package com.acttub.actingapi.feature.auth.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.ConsentType;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

final class AuthDtos {
    private AuthDtos() {
    }

    /**
     * 제공자마다 내는 자격 값이 다르다 — 구글·카카오는 {@code id_token}, 애플은 {@code id_token} 과
     * {@code authorization_code}, 네이버는 {@code authorization_code}·{@code code_verifier}·
     * {@code redirect_uri}·{@code state}(서버가 교환한다). 그래서 {@code provider} 말고는 칸 자체가
     * 선택이고, 제공자에 필요한 칸이 빠졌는지는 요청을 받는 자리와 서비스가 본다.
     *
     * <p>{@code state} 는 네이버의 토큰 발급이 요구하는 값이다(개발가이드 §3.5.6 "발급 때 필수"). 앱이
     * 인가 요청에 쓴 값을 그대로 보낸다. 없으면 서버가 난수를 채운다.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    @Schema(name = "LoginRequest")
    record LoginRequest(
            @NotNull String provider,
            @JsonProperty("id_token") String idToken,
            @JsonProperty("authorization_code") String authorizationCode,
            @JsonProperty("code_verifier") String codeVerifier,
            @JsonProperty("redirect_uri") String redirectUri,
            String state) {
    }

    /** 켜져 있는 간편 로그인 제공자. 앱이 이 목록으로 로그인 버튼을 그린다. */
    @Schema(name = "AuthProvidersResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ProvidersResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> providers) {
    }

    @Schema(name = "SignupRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record SignupRequest(
            @NotNull @JsonProperty("signup_token") String signupToken,
            @NotNull @Valid List<@NotNull @Valid SignupDecisionInput> decisions) {
    }

    @Schema(name = "SignupDecision", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record SignupDecisionInput(
            @NotNull @JsonProperty("document_id") String documentId,
            @NotNull SignupAction action) {
    }

    /** 철회({@code revoked})는 입력이 아니다. */
    @Schema(name = "SignupAction")
    enum SignupAction {
        granted,
        declined
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record RefreshRequest(@NotNull @JsonProperty("refresh_token") String refreshToken) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record LogoutRequest(@NotNull @JsonProperty("refresh_token") String refreshToken) {
    }

    @Schema(name = "AuthUser", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AuthUser(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String email,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"active", "deactivated"})
            String status) {
    }

    @Schema(
            name = "ConsentDocument",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
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

    /** 로그인은 어느 쪽이든 200 이다. 본문의 {@code result} 로 가른다. */
    @Schema(name = "LoginResponse", oneOf = {SignedInResponse.class, SignupRequiredResponse.class})
    sealed interface LoginResponse permits SignedInResponse, SignupRequiredResponse {
    }

    /** 이미 있는 계정, 그리고 가입 제출이 통과해 방금 생긴 계정. */
    @Schema(name = "SignedInResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record SignedInResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = "signed_in") String result,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String accessToken,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String refreshToken,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String tokenType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long expiresIn,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) AuthUser user,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ConsentDocument> pendingConsents)
            implements LoginResponse {
    }

    /** 처음 온 신원. 아직 아무 행도 없고, 토큰 대신 가입 토큰과 현재 판 동의 문서를 받는다. */
    @Schema(name = "SignupRequiredResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record SignupRequiredResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = "signup_required") String result,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String signupToken,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long expiresIn,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ConsentDocument> documents)
            implements LoginResponse {
    }

    /** 방금 만든 웹 게스트. {@code user.id} 에 웹이 나이 확인과 계측의 user_id 를 묶는다. */
    @Schema(name = "GuestResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record GuestResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String accessToken,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String refreshToken,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String tokenType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long expiresIn,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) AuthUser user,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = "guest") String accountType) {
    }

    @Schema(name = "RefreshTokenResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record RefreshTokenResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String accessToken,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String refreshToken,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String tokenType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long expiresIn) {
    }

    /** 이메일 겹침 409. {@code detail} 옆에 기존 계정의 제공자 이름을 싣는 두 예외 가운데 하나다. */
    @Schema(name = "AccountExistsError", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AccountExistsError(
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = "account_exists_with_different_provider")
            String detail,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> providers) {
    }

    @Schema(name = "ValidationError")
    record ValidationError(List<Object> loc, String msg, String type, Object input, Map<String, Object> ctx) {
    }

    @Schema(name = "HTTPValidationError")
    record HTTPValidationError(List<ValidationError> detail) {
    }
}
