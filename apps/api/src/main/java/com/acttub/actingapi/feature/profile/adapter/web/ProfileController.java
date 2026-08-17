package com.acttub.actingapi.feature.profile.adapter.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.MeResponse;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.UpdateMeRequest;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.feature.profile.domain.Nickname;
import com.acttub.actingapi.feature.profile.domain.Profile;
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
    private final ProfileService profiles;
    private final AccessGate auth;

    ProfileController(ProfileService profiles, AccessGate auth) {
        this.profiles = profiles;
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
        return response(profiles.find(user.id()));
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
        Nickname nickname = new Nickname(body.nickname());
        validate(nickname);
        return response(profiles.updateNickname(user.id(), nickname.normalized()));
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
        profiles.deactivate(user.id());
        return ResponseEntity.noContent().build();
    }

    /**
     * 422 본문의 모양이 곧 계약이라 이 판정은 요청을 받는 자리에 남는다. 무엇이 어긋났는지를
     * 아는 것은 {@link Nickname} 이고, 그것을 pydantic 과 같은 형태로 옮기는 것이 여기다.
     *
     * <p>길이를 <b>원본</b>으로 재고 공백 접기를 그 뒤에 보는 순서가 원본과 같다.
     */
    private static void validate(Nickname nickname) {
        if (nickname.tooShort()) {
            throw validationError(
                    "string_too_short",
                    "String should have at least 1 character",
                    nickname.raw(),
                    Map.of("min_length", 1));
        }
        if (nickname.tooLong()) {
            throw validationError(
                    "string_too_long",
                    "String should have at most 20 characters",
                    nickname.raw(),
                    Map.of("max_length", Nickname.MAX_LENGTH));
        }
        if (nickname.blankAfterFolding()) {
            throw ApiValidationException.valueError(
                    List.of("body", "nickname"),
                    "Value error, nickname must not be blank",
                    nickname.raw());
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

    private static MeResponse response(Profile profile) {
        return new MeResponse(
                profile.id(),
                profile.email(),
                profile.nickname(),
                profile.status());
    }
}
