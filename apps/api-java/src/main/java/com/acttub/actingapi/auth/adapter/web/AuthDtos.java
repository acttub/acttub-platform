package com.acttub.actingapi.auth.adapter.web;
import com.acttub.actingapi.auth.app.SignupAttribution;
import java.time.Instant; import java.util.*; import com.acttub.actingapi.platform.schema.*; import com.fasterxml.jackson.annotation.*; import com.fasterxml.jackson.databind.PropertyNamingStrategies; import com.fasterxml.jackson.databind.annotation.JsonNaming; import io.swagger.v3.oas.annotations.media.Schema; import jakarta.validation.constraints.NotNull;
final class AuthDtos {private AuthDtos(){}
    @JsonIgnoreProperties(ignoreUnknown=true) record LoginRequest(@NotNull String provider,@NotNull @JsonProperty("id_token") String idToken,@Schema(nullable=true) @JsonProperty("signup_attribution") SignupAttribution signupAttribution){}
    @JsonIgnoreProperties(ignoreUnknown=true) record RefreshRequest(@NotNull @JsonProperty("refresh_token") String refreshToken){}
    @JsonIgnoreProperties(ignoreUnknown=true) record LogoutRequest(@NotNull @JsonProperty("refresh_token") String refreshToken){}
    @Schema(name="AuthUser",additionalProperties=Schema.AdditionalPropertiesValue.FALSE) @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class) record AuthUser(@Schema(requiredMode=Schema.RequiredMode.REQUIRED) UUID id,@Schema(requiredMode=Schema.RequiredMode.REQUIRED,nullable=true) String email,@Schema(requiredMode=Schema.RequiredMode.REQUIRED,allowableValues={"active","suspended","deactivated"}) String status){}
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
    @Schema(name="TokenPairResponse",additionalProperties=Schema.AdditionalPropertiesValue.FALSE) @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class) record TokenPairResponse(@Schema(requiredMode=Schema.RequiredMode.REQUIRED) String accessToken,@Schema(requiredMode=Schema.RequiredMode.REQUIRED) String refreshToken,@Schema(requiredMode=Schema.RequiredMode.REQUIRED) String tokenType,@Schema(requiredMode=Schema.RequiredMode.REQUIRED) long expiresIn,@Schema(requiredMode=Schema.RequiredMode.REQUIRED) AuthUser user,@Schema(requiredMode=Schema.RequiredMode.REQUIRED) List<ConsentDocument> pendingConsents){}
    @Schema(name="RefreshTokenResponse",additionalProperties=Schema.AdditionalPropertiesValue.FALSE) @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class) record RefreshTokenResponse(@Schema(requiredMode=Schema.RequiredMode.REQUIRED) String accessToken,@Schema(requiredMode=Schema.RequiredMode.REQUIRED) String refreshToken,@Schema(requiredMode=Schema.RequiredMode.REQUIRED) String tokenType,@Schema(requiredMode=Schema.RequiredMode.REQUIRED) long expiresIn){}
    @Schema(name="ValidationError") record ValidationError(List<Object> loc,String msg,String type,Object input,Map<String,Object> ctx){}
    @Schema(name="HTTPValidationError") record HTTPValidationError(List<ValidationError> detail){}
}
