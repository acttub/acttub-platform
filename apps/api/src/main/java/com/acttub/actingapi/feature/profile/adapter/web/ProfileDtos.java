package com.acttub.actingapi.feature.profile.adapter.web;

import java.math.BigInteger;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

final class ProfileDtos {
    private ProfileDtos() {
    }

    /** 값 이름은 DB CHECK 값이자 API 값이다(결정 12). 목록 밖의 값은 Jackson 이 422 배열로 거른다. */
    @Schema(name = "ProfileGender")
    enum Gender {
        female,
        male,
        unspecified
    }

    @Schema(name = "ActingDirection")
    enum Direction {
        media,
        stage
    }

    @Schema(name = "ActingExperience")
    enum Experience {
        before_start,
        exam_prep,
        under_1y,
        y1_to_3,
        y3_to_5,
        over_5y
    }

    @Schema(name = "ActingGoal")
    enum Goal {
        hobby,
        audition,
        professional
    }

    /** 탈퇴의 응답. 다시 불러도 같고, 시각은 최초 탈퇴 시각이다. */
    @Schema(name = "WithdrawnResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record WithdrawnResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = "deactivated") String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant deactivatedAt) {
    }

    @Schema(name = "MeResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record MeResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String email,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"active", "deactivated"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"member", "guest"})
            String accountType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean profileComplete,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) ProfilePayload profile) {
    }

    /**
     * 여섯 항목과 사진·소개. 1.0.0 이전 회원은 {@code name} 에 옛 닉네임만 있고 나머지가 {@code null}
     * 이다 — 그래서 전부 nullable 이고, 다 찼는지는 {@code profile_complete} 가 말한다.
     */
    @Schema(name = "Profile", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ProfilePayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String name,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, implementation = Gender.class)
            String gender,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, format = "date", example = "2001-03-14")
            String birthDate,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Integer age,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Direction> directions,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, implementation = Experience.class)
            String experience,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, implementation = Goal.class)
            String goal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String photoUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String bio) {
    }

    /**
     * 여섯 항목은 전부 필수다. 생년월일은 {@code 2001-03-14} 모양의 문자열로 받는다 — 이 서비스의
     * Jackson 은 계약을 못박으려고 기본 모듈을 걷어 내 {@code LocalDate} 를 모른다
     * ({@code platform/config/JacksonConfig}). 모양은 요청을 받는 자리가 직접 본다.
     *
     * <p>한 번에 저장하고 부분 저장은 없다. {@code bio} 만 선택이다.
     *
     * <p>이 필수 항목은 개인정보 수집·이용 동의 문서의 필수 항목과 같아야 한다 —
     * {@code ProfileConsentParityTest} 가 둘을 대조한다.
     */
    @Schema(name = "ProfileRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ProfileRequest(
            @NotNull @Schema(minLength = 1, maxLength = 20) String name,
            @NotNull Gender gender,
            @NotNull @JsonProperty("birth_date") @Schema(format = "date", example = "2001-03-14")
            String birthDate,
            @NotNull @ArraySchema(minItems = 1)
            List<@NotNull Direction> directions,
            @NotNull Experience experience,
            @NotNull Goal goal,
            @Schema(nullable = true, maxLength = 80) String bio) {
    }

    @Schema(name = "PhotoUploadRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PhotoUploadRequest(
            @NotNull @JsonProperty("content_type") String contentType,
            @NotNull @PositiveOrZero @JsonProperty("size_bytes") BigInteger sizeBytes) {
    }

    @Schema(name = "PhotoUploadResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PhotoUploadResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String uploadUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant expiresAt) {
    }
}
