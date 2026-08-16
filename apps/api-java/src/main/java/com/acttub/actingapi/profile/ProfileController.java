package com.acttub.actingapi.profile;

import com.acttub.actingapi.profile.ProfileDtos.MeResponse;
import com.acttub.actingapi.profile.ProfileDtos.UpdateMeRequest;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.acttub.actingapi.platform.web.PythonText;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
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
    private final AccessGate auth;

    ProfileController(ProfileStore store, AccessGate auth) {
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

    @Operation(
            summary = "Delete Me",
            description = """
                    회원탈퇴. 개인정보는 파기하고 글은 남긴다.

                    커뮤니티 글·연습 기록이 user_id 를 물고 있어 행을 지우면 남의 글타래가
                    깨진다. 그래서 행은 남기되 이메일·닉네임·identity 를 지우고 refresh 토큰을
                    전부 끊는다. 남아 있는 액세스 토큰은 만료까지 유효하지만 인증 게이트가
                    deactivated 를 403 으로 막는다. 자세한 처리는 store.deactivate_user 참조.""",
            operationId = "delete_me_v2_me_delete",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @DeleteMapping
    ResponseEntity<Void> deleteMe(HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        if (store.deactivate(user.id()) == null) {
            throw new ApiException(404, "user_not_found");
        }
        return ResponseEntity.noContent().build();
    }

    private static String normalize(String raw) {
        // 앞뒤 제거는 PythonText 로 — String.strip() 은 NBSP 를 남긴다.
        String collapsed = PythonText.strip(INTERNAL_WHITESPACE.matcher(raw).replaceAll(" "));
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
