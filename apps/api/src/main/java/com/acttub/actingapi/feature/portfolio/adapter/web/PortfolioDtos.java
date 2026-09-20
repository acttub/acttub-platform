package com.acttub.actingapi.feature.portfolio.adapter.web;

import java.math.BigInteger;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.PortfolioCreditKind;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

final class PortfolioDtos {
    private PortfolioDtos() {
    }

    /** 포트폴리오 본문. 항목을 저장하는 API 들이 이 모양을 돌려주고, 앱은 응답으로 화면을 덮는다. */
    @Schema(name = "Portfolio", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PortfolioResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String intro,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<CreditResponse> credits,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PhotoResponse> photos,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ShareResponse share) {
    }

    @Schema(name = "PortfolioCredit", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record CreditResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String role,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int year,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = PortfolioCreditKind.class)
            String kind) {
    }

    /** @param url 서명한 주소. 스토리지가 설정돼 있지 않으면 {@code null} */
    @Schema(name = "PortfolioPhoto", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PhotoResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String url) {
    }

    /** @param url {@code <웹 주소>/p/<slug>}. 한 번도 켜지 않았으면 slug 와 함께 {@code null} */
    @Schema(name = "PortfolioShare", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ShareResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean enabled,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String slug,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String url) {
    }

    /** {@code null} 이나 빈 글이면 지운다. */
    @Schema(name = "PortfolioIntroRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record IntroRequest(@Schema(nullable = true) String intro) {
    }

    @Schema(name = "PortfolioCreditRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record CreditRequest(
            @NotNull String title,
            @NotNull String role,
            @NotNull Integer year,
            @NotNull CreditKind kind) {
    }

    /** 보낸 항목만 바꾼다. */
    @Schema(name = "PortfolioCreditPatch", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record CreditPatch(String title, String role, Integer year, CreditKind kind) {
    }

    /** 값 이름은 DB CHECK 값이자 API 값이다({@link PortfolioCreditKind}). */
    @Schema(name = "PortfolioCreditKindInput")
    enum CreditKind {
        film,
        drama,
        play,
        musical,
        ad,
        other
    }

    /** 지금 있는 id 를 원하는 순서로 <b>전부</b> 보낸다. */
    @Schema(name = "PortfolioOrderRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record OrderRequest(@NotNull List<@NotNull UUID> ids) {
    }

    @Schema(name = "PortfolioPhotoUploadRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PhotoUploadRequest(
            @NotNull @JsonProperty("content_type") String contentType,
            @NotNull @PositiveOrZero @JsonProperty("size_bytes") BigInteger sizeBytes) {
    }

    @Schema(name = "PortfolioPhotoUploadResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PhotoUploadResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID photoId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String uploadUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant expiresAt) {
    }

    @Schema(name = "PortfolioShareRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ShareRequest(@NotNull Boolean enabled) {
    }

    /** 받은 링크를 로그인 없이 여는 사람이 보는 것. 추구하는 방향·경력 구간·목표와 연습·분석은 없다. */
    @Schema(name = "PublicPortfolio", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PublicPortfolioResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String photoUrl,
            // 저장 값이 "선택 안 함"이면 null 이다 — 공개 페이지는 그때 성별 칸을 뺀다.
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, allowableValues = {"female", "male"})
            String gender,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int age,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String intro,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PublicCredit> credits,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PublicPhoto> photos) {
    }

    @Schema(name = "PublicPortfolioCredit", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PublicCredit(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String role,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int year,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = PortfolioCreditKind.class)
            String kind) {
    }

    @Schema(name = "PublicPortfolioPhoto", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PublicPhoto(@Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String url) {
    }
}
