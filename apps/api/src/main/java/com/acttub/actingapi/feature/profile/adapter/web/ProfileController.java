package com.acttub.actingapi.feature.profile.adapter.web;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.Direction;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.MeResponse;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.NotificationSettingsPatch;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.NotificationSettingsResponse;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.PhotoUploadRequest;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.PhotoUploadResponse;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.ProfilePayload;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.ProfileRequest;
import com.acttub.actingapi.feature.profile.adapter.web.ProfileDtos.WithdrawnResponse;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.feature.profile.domain.Account;
import com.acttub.actingapi.feature.profile.domain.NotificationSettings;
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
import org.springframework.web.bind.annotation.PatchMapping;
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
            summary = "Get Notification Settings",
            description = "알림 토글 셋. 가입 직후에는 셋 다 켜져 있다. 프로필에 저장돼 폰을 바꿔도 유지된다.",
            operationId = "get_notification_settings_v2_me_notification_settings_get",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = NotificationSettingsResponse.class)))
    @GetMapping("/notification-settings")
    NotificationSettingsResponse notificationSettings(HttpServletRequest request) {
        var user = auth.gatedUser(request);
        return settings(profiles.notificationSettings(user.id()));
    }

    @Operation(
            summary = "Update Notification Settings",
            description = """
                    바꿀 토글만 보내고 토글 셋 전체를 돌려받는다. 분석 완료와 챌린지가 둘 다 꺼지면 서버가 그
                    회원의 푸시 토큰을 전부 지운다(토글은 회원 단위다). 저녁 리마인드는 서버가 값만 기억하고
                    알람은 폰이 맞춘다.""",
            operationId = "update_notification_settings_v2_me_notification_settings_patch",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "토글 셋 전체",
                content = @Content(schema = @Schema(implementation = NotificationSettingsResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PatchMapping("/notification-settings")
    NotificationSettingsResponse updateNotificationSettings(
            @Valid @RequestBody NotificationSettingsPatch body, HttpServletRequest request) {
        var user = auth.gatedUser(request);
        if (body.analysisDone() == null && body.challenge() == null && body.eveningReminder() == null) {
            throw ApiValidationException.valueError(
                    List.of("body"), "at least one toggle is required", Map.of());
        }
        return settings(profiles.updateNotificationSettings(
                user.id(), body.analysisDone(), body.challenge(), body.eveningReminder()));
    }

    @Operation(
            summary = "Delete Me",
            description = """
                    회원탈퇴. 바로 알아보게 하는 정보는 파기하고, 나머지는 사람과 끊어 남긴다.

                    연습 기록과 남의 화면에 얽힌 행이 user_id 를 물고 있어 행은 남긴다. 이메일, 프로필의
                    이름·사진·소개, 포트폴리오, 이관 코드를 지우고 신원은 해시만 남기며 리프레시·푸시 토큰을
                    전부 끊는다. 영상 객체는 보관에 동의한 사람 것만 남는다. 객체 삭제와 제공자 연결
                    해제(애플·카카오·네이버)는 응답과 무관하게 뒤에서 다시 시도한다 — 실패해도 200 이다.

                    이 경로만 탈퇴한 계정의 토큰을 받는다. 다시 불러도 같은 응답이고 시각은 최초 탈퇴
                    시각이다. 게스트의 토큰도 받는다. 구글의 연결 해제는 앱이 이 요청 직전에 SDK 로 한다.""",
            operationId = "delete_me_v2_me_delete",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "처음이든 다시든 같은 응답",
            content = @Content(schema = @Schema(implementation = WithdrawnResponse.class)))
    @DeleteMapping
    WithdrawnResponse deleteMe(HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        return new WithdrawnResponse("deactivated", profiles.withdraw(user.id()));
    }

    private static NotificationSettingsResponse settings(NotificationSettings settings) {
        return new NotificationSettingsResponse(
                settings.analysisDone(), settings.challenge(), settings.eveningReminder());
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
