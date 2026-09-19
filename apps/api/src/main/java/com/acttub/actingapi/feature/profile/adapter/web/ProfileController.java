package com.acttub.actingapi.feature.profile.adapter.web;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.Direction;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.MeResponse;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.PhotoUploadRequest;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.PhotoUploadResponse;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.ProfilePayload;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.ProfileRequest;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.feature.profile.domain.Account;
import com.acttub.actingapi.feature.profile.domain.Profile;
import com.acttub.actingapi.feature.profile.domain.ProfileName;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 계정. 조회와 탈퇴는 게이트 밖이고, 프로필 저장은 동의 게이트만, 사진은 보호 기능이다 —
 * 어느 경로가 어느 게이트를 지나는지는 {@code platform/security/ConsentGateInterceptor} 의 표가
 * 정하고, 여기서는 같은 단계의 주체를 받는다(같은 요청에서는 다시 묻지 않는다).
 */
@RestController
@RequestMapping("/v2/me")
class ProfileController {
    private static final int BIO_MAX_LENGTH = 80;

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
            summary = "Save Profile",
            description = """
                    프로필 여섯 항목을 한 번에 저장한다. 가입 게이트의 입력 화면과 설정의 수정이 같은
                    API 를 쓴다. 부분 저장은 없다.""",
            operationId = "save_profile_v2_me_profile_put",
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
    @PutMapping("/profile")
    MeResponse saveProfile(@Valid @RequestBody ProfileRequest body, HttpServletRequest request) {
        var user = auth.consentedUser(request);
        ProfileName name = new ProfileName(body.name());
        validate(name);
        String bio = validBio(body.bio());
        LocalDate birthDate = validBirthDate(body.birthDate());
        if (body.directions().isEmpty()) {
            throw lengthError(
                    "directions",
                    "too_short",
                    "List should have at least 1 item after validation, not 0",
                    body.directions(),
                    Map.of("field_type", "List", "min_length", 1, "actual_length", 0));
        }
        return response(profiles.saveProfile(user.id(), new Profile(
                name.normalized(),
                body.gender().name(),
                birthDate,
                body.directions().stream().distinct().map(Direction::name).toList(),
                body.experience().name(),
                body.goal().name(),
                null,
                bio)));
    }

    @Operation(
            summary = "Create Photo Upload",
            operationId = "create_photo_upload_v2_me_photo_post",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "201",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PhotoUploadResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/photo")
    @ResponseStatus(HttpStatus.CREATED)
    PhotoUploadResponse createPhotoUpload(
            @Valid @RequestBody PhotoUploadRequest body,
            HttpServletRequest request) {
        var user = auth.gatedUser(request);
        ProfileService.NewPhotoUpload upload =
                profiles.beginPhotoUpload(user.id(), body.contentType(), body.sizeBytes());
        return new PhotoUploadResponse(upload.uploadUrl(), upload.expiresAt());
    }

    @Operation(
            summary = "Complete Photo Upload",
            operationId = "complete_photo_upload_v2_me_photo_complete_post",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = MeResponse.class)))
    @PostMapping("/photo/complete")
    MeResponse completePhotoUpload(HttpServletRequest request) {
        var user = auth.gatedUser(request);
        return response(profiles.completePhotoUpload(user.id()));
    }

    @Operation(
            summary = "Delete Photo",
            operationId = "delete_photo_v2_me_photo_delete",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @DeleteMapping("/photo")
    ResponseEntity<Void> deletePhoto(HttpServletRequest request) {
        var user = auth.gatedUser(request);
        profiles.deletePhoto(user.id());
        return ResponseEntity.noContent().build();
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
     * 아는 것은 {@link ProfileName} 이고, 그것을 pydantic 과 같은 형태로 옮기는 것이 여기다.
     *
     * <p>길이를 <b>원본</b>으로 재고 공백 접기를 그 뒤에 보는 순서가 1.0.0 이전의 닉네임 규칙과 같다.
     */
    private static void validate(ProfileName name) {
        if (name.tooShort()) {
            throw lengthError(
                    "name",
                    "string_too_short",
                    "String should have at least 1 character",
                    name.raw(),
                    Map.of("min_length", 1));
        }
        if (name.tooLong()) {
            throw lengthError(
                    "name",
                    "string_too_long",
                    "String should have at most 20 characters",
                    name.raw(),
                    Map.of("max_length", ProfileName.MAX_LENGTH));
        }
        if (name.blankAfterFolding()) {
            throw ApiValidationException.valueError(
                    List.of("body", "name"),
                    "Value error, name must not be blank",
                    name.raw());
        }
    }

    /** {@code 2001-03-14} 모양의 실제 날짜이고 한국 시간의 오늘보다 뒤가 아니어야 한다. */
    private LocalDate validBirthDate(String raw) {
        LocalDate birthDate;
        try {
            birthDate = LocalDate.parse(raw);
        } catch (DateTimeParseException invalid) {
            throw ApiValidationException.valueError(
                    List.of("body", "birth_date"),
                    "Value error, birth_date must be a date like 2001-03-14",
                    raw);
        }
        if (birthDate.isAfter(profiles.today())) {
            throw ApiValidationException.valueError(
                    List.of("body", "birth_date"),
                    "Value error, birth_date must not be in the future",
                    raw);
        }
        return birthDate;
    }

    /** 소개는 선택이다. 비어 있으면 없는 것으로 저장하고, 80자(코드포인트)를 넘으면 거절한다. */
    private static String validBio(String raw) {
        if (raw == null) {
            return null;
        }
        if (raw.codePointCount(0, raw.length()) > BIO_MAX_LENGTH) {
            throw lengthError(
                    "bio",
                    "string_too_long",
                    "String should have at most 80 characters",
                    raw,
                    Map.of("max_length", BIO_MAX_LENGTH));
        }
        String stripped = raw.strip();
        return stripped.isEmpty() ? null : stripped;
    }

    private static ApiValidationException lengthError(
            String field,
            String type,
            String message,
            Object input,
            Map<String, Object> context) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", type);
        error.put("loc", List.of("body", field));
        error.put("msg", message);
        error.put("input", input);
        error.put("ctx", context);
        return new ApiValidationException(List.of(error));
    }

    private static MeResponse response(ProfileService.AccountView view) {
        Account account = view.account();
        Profile profile = account.profile();
        return new MeResponse(
                account.id(),
                account.email(),
                account.status(),
                account.accountType(),
                account.profileComplete(),
                profile == null ? null : new ProfilePayload(
                        profile.name(),
                        profile.gender(),
                        profile.birthDate() == null ? null : profile.birthDate().toString(),
                        view.age(),
                        profile.directions().stream().map(Direction::valueOf).toList(),
                        profile.experience(),
                        profile.goal(),
                        view.photoUrl(),
                        profile.bio()));
    }
}
