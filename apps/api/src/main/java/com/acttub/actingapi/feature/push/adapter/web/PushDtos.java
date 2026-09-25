package com.acttub.actingapi.feature.push.adapter.web;

import com.acttub.actingapi.platform.web.CredentialField;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

final class PushDtos {
    private PushDtos() {
    }

    @Schema(name = "RegisterPushTokenRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record RegisterPushTokenRequest(
            @NotNull
            @CredentialField
            @Schema(minLength = 1, maxLength = 512)
            String token,
            @NotNull
            @Schema(allowableValues = {"ios", "android"})
            String platform) {
    }

    @Schema(name = "UnregisterPushTokenRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record UnregisterPushTokenRequest(
            @NotNull
            @CredentialField
            @Schema(minLength = 1, maxLength = 512)
            String token) {
    }
}
