package com.acttub.actingapi.profile;

import com.acttub.actingapi.profile.ProfileDtos.MeResponse;
import com.acttub.actingapi.profile.ProfileDtos.UpdateMeRequest;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import com.acttub.actingapi.auth.AuthDependencies;
import com.acttub.actingapi.web.ApiException;
import com.acttub.actingapi.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v2/me")
class ProfileController {
    private static final Pattern INTERNAL_WHITESPACE = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

    private final ProfileStore store;
    private final AuthDependencies auth;

    ProfileController(ProfileStore store, AuthDependencies auth) {
        this.store = store;
        this.auth = auth;
    }

    @Operation(
            summary = "Get Me",
            operationId = "get_me_v2_me_get",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = MeResponse.class)))
    @GetMapping
    MeResponse getMe(HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        return response(store.find(user.id()));
    }

    @Operation(
            summary = "Update Me",
            operationId = "update_me_v2_me_patch",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = MeResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PatchMapping
    MeResponse updateMe(@Valid @RequestBody UpdateMeRequest body, HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        validateLength(body.nickname());
        String nickname = normalize(body.nickname());
        ProfileStore.ProfileRow updated = store.updateNickname(user.id(), nickname);
        if (updated == null) {
            throw new ApiException(404, "user_not_found");
        }
        return response(updated);
    }

    private static String normalize(String raw) {
        String collapsed = INTERNAL_WHITESPACE.matcher(raw).replaceAll(" ").strip();
        if (collapsed.isEmpty()) {
            throw ApiValidationException.valueError(
                    List.of("body", "nickname"),
                    "Value error, nickname must not be blank",
                    raw);
        }
        return collapsed;
    }

    private static void validateLength(String raw) {
        int length = raw.codePointCount(0, raw.length());
        if (length == 0) {
            throw validationError(
                    "string_too_short",
                    "String should have at least 1 character",
                    raw,
                    Map.of("min_length", 1));
        }
        if (length > 20) {
            throw validationError(
                    "string_too_long",
                    "String should have at most 20 characters",
                    raw,
                    Map.of("max_length", 20));
        }
    }

    private static ApiValidationException validationError(
            String type,
            String message,
            String input,
            Map<String, Object> context) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", type);
        error.put("loc", List.of("body", "nickname"));
        error.put("msg", message);
        error.put("input", input);
        error.put("ctx", context);
        return new ApiValidationException(List.of(error));
    }

    private static MeResponse response(ProfileStore.ProfileRow row) {
        if (row == null) {
            throw new ApiException(404, "user_not_found");
        }
        return new MeResponse(
                row.id(),
                row.email(),
                row.nickname(),
                row.status().dbValue());
    }
}
