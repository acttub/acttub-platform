package com.acttub.actingapi.feature.profile.app;

import java.math.BigInteger;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.domain.Account;
import com.acttub.actingapi.feature.profile.domain.KoreanAge;
import com.acttub.actingapi.feature.profile.domain.NotificationSettings;
import com.acttub.actingapi.feature.profile.domain.Profile;
import com.acttub.actingapi.feature.profile.domain.ProfilePhotoType;
import com.acttub.actingapi.platform.security.ProfileGate;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.stereotype.Service;

/**
 * 내 계정 조회, 프로필 저장, 프로필 사진, 탈퇴의 규칙.
 *
 * <p>값의 형태를 따지는 일(이름 길이, 값 목록, 날짜 모양)은 요청을 받는 자리(web)가 하고 422 배열로
 * 답한다. 여기서 거절하는 것은 <b>규칙</b>이고 422 의 본문은 사유 코드 하나다.
 */
@Service
public class ProfileService implements ProfileGate {

    /** 만 나이와 "미래 날짜"를 세는 날짜 기준. 폰의 시간대와 무관하다. */
    public static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    /** 서명 주소와 대기 중인 올리기의 수명. 둘이 같은 값이어야 주소가 살아 있는 동안만 확정된다. */
    static final Duration PHOTO_UPLOAD_TTL = Duration.ofMinutes(30);

    private static final int PHOTO_VIEW_SECONDS = 60 * 60;

    private final ProfileRepository profiles;
    private final ProfilePhotoStorage photos;
    private final AccountCleanup cleanup;
    private final Clock clock;

    public ProfileService(
            ProfileRepository profiles, ProfilePhotoStorage photos, AccountCleanup cleanup, Clock clock) {
        this.profiles = profiles;
        this.photos = photos;
        this.cleanup = cleanup;
        this.clock = clock;
    }

    public AccountView find(UUID userId) {
        return view(require(profiles.find(userId)));
    }

    @Override
    public boolean completeFor(UUID userId) {
        Account account = profiles.find(userId);
        return account != null && account.profileComplete();
    }

    /**
     * 코치와 노트가 읽는 것 — 필수 여섯 항목을 다 채운 프로필과 <b>지금의</b> 만 나이. 프로필이 없거나
     * (게스트) 하나라도 비어 있으면 {@code null} 이다. 만 나이는 읽을 때마다 한국 시간의 오늘로 센다.
     */
    public CompleteProfile completeProfileOf(UUID userId) {
        Account account = profiles.find(userId);
        if (account == null || !account.profileComplete()) {
            return null;
        }
        return new CompleteProfile(
                account.profile(), KoreanAge.on(account.profile().birthDate(), today()));
    }

    /** 한국 시간의 오늘. 만 나이와 생년월일 검사가 같은 날짜를 본다. */
    public LocalDate today() {
        return LocalDate.now(clock.withZone(SEOUL));
    }

    /**
     * 여섯 항목을 한 번에 저장한다. 가입 게이트의 입력 화면과 설정의 수정이 같은 길을 쓴다.
     *
     * <p>만 14세 미만이면 저장하지 않는다. 어느 자리에서 왔는지는 경로가 아니라 <b>저장 전에
     * 프로필이 완성돼 있었는가</b>로 가른다 — 완성돼 있었으면 설정에서 고치던 것이라 거절만 하고
     * ({@code under_14}), 아니면 가입 중이라 계정을 닫는다({@code under_14_account_closed}).
     */
    public AccountView saveProfile(UUID userId, Profile submitted) {
        Account before = require(profiles.find(userId));
        if (KoreanAge.underMinimum(submitted.birthDate(), today())) {
            if (before.profileComplete()) {
                throw new ApiException(422, "under_14");
            }
            // 연습이 있는 1.0.0 이전 회원은 탈퇴와 같은 절차로 닫히고, 보관 동의와 무관하게 영상을
            // 파기한다. 객체 삭제와 제공자 해제는 탈퇴와 같이 트랜잭션 밖에서 시도한다.
            ProfileRepository.Closed closed = profiles.closeUnderage(userId, clock.instant(), today());
            if (closed != null) {
                cleanup.attempt(closed.cleanupOperationIds());
            }
            throw new ApiException(422, "under_14_account_closed");
        }
        Profile kept = before.profile();
        return view(require(profiles.saveProfile(userId, new Profile(
                submitted.name(),
                submitted.gender(),
                submitted.birthDate(),
                submitted.directions(),
                submitted.experience(),
                submitted.goal(),
                kept == null ? null : kept.photoKey(),
                submitted.bio()))));
    }

    public NotificationSettings notificationSettings(UUID userId) {
        NotificationSettings settings = profiles.notificationSettings(userId);
        if (settings == null) {
            throw userNotFound();
        }
        return settings;
    }

    /**
     * 보낸 토글만 바꾸고 <b>셋 전체</b>를 돌려준다 — 앱이 응답으로 화면과 캐시를 덮는다. 서버 푸시 둘이 다
     * 꺼지면 그 회원의 푸시 토큰을 전부 지운다. 하나를 다시 켜면 앱이 이 폰의 토큰을 다시 등록한다.
     */
    public NotificationSettings updateNotificationSettings(
            UUID userId, Boolean analysisDone, Boolean challenge, Boolean eveningReminder) {
        NotificationSettings settings =
                profiles.updateNotificationSettings(userId, analysisDone, challenge, eveningReminder);
        if (settings == null) {
            throw userNotFound();
        }
        return settings;
    }

    /**
     * 탈퇴. 파기와 상태 전환은 한 트랜잭션이고, 객체 삭제와 제공자 해제는 그 <b>뒤에</b> 시도한다 —
     * 바깥 호출이 실패해도 탈퇴는 끝났고, 실패한 것은 7일 동안 다시 시도된다 ({@link AccountCleanup}).
     *
     * <p>이미 탈퇴한 계정이 다시 와도 같은 결과다. 최초 탈퇴 시각을 돌려주고 파기만 다시 돈다 —
     * 탈퇴 도중 앱이 죽어 다시 누른 경우를 위해서다.
     *
     * @return 최초 탈퇴 시각
     */
    public Instant withdraw(UUID userId) {
        ProfileRepository.Withdrawn withdrawn = profiles.withdraw(userId, false, clock.instant(), today());
        if (withdrawn == null) {
            throw userNotFound();
        }
        cleanup.attempt(withdrawn.cleanupOperationIds());
        return withdrawn.deactivatedAt();
    }

    /**
     * 사진을 올릴 자리를 내준다. 거르는 순서가 응답을 가른다 — 이미지가 아니면 415 가 크기 검사보다
     * 먼저 나온다(영상 올리기와 같다).
     */
    public NewPhotoUpload beginPhotoUpload(UUID userId, String rawContentType, BigInteger sizeBytes) {
        String contentType = ProfilePhotoType.accepted(rawContentType);
        if (contentType == null) {
            throw new ApiException(415, "unsupported_media_type");
        }
        if (sizeBytes.compareTo(BigInteger.valueOf(ProfilePhotoType.MAX_BYTES)) > 0) {
            throw new ApiException(413, "upload_too_large");
        }
        photos.requireConfigured();
        long size = sizeBytes.longValueExact();
        Instant expiresAt = clock.instant().plus(PHOTO_UPLOAD_TTL);
        String objectKey = "users/" + userId + "/profile/"
                + UUID.randomUUID().toString().replace("-", "")
                + ProfilePhotoType.objectSuffix(contentType);
        String uploadUrl = photos.presignUpload(
                objectKey, contentType, size, Math.toIntExact(PHOTO_UPLOAD_TTL.toSeconds()));
        if (!profiles.beginPhotoUpload(
                userId, new ProfileRepository.PhotoUpload(objectKey, contentType, size, expiresAt))) {
            throw userNotFound();
        }
        return new NewPhotoUpload(uploadUrl, expiresAt);
    }

    /** 올라온 것을 확인하고 프로필 사진으로 바꾼다. 옛 사진 객체는 지운다. */
    public AccountView completePhotoUpload(UUID userId) {
        photos.requireConfigured();
        ProfileRepository.PhotoUpload pending = profiles.pendingPhotoUpload(userId);
        if (pending == null || !clock.instant().isBefore(pending.expiresAt())) {
            throw new ApiException(409, "upload_intent_expired");
        }
        Long stored = photos.sizeOf(pending.objectKey());
        if (stored == null) {
            throw new ApiException(409, "upload_not_found");
        }
        if (stored != pending.sizeBytes()) {
            throw new ApiException(409, "upload_size_mismatch");
        }
        String replaced = profiles.completePhotoUpload(userId, pending.objectKey());
        if (replaced != null) {
            photos.delete(replaced);
        }
        return find(userId);
    }

    /** 사진이 없어도 같은 결과다. */
    public void deletePhoto(UUID userId) {
        String removed = profiles.clearPhoto(userId);
        if (removed != null) {
            photos.delete(removed);
        }
    }

    private AccountView view(Account account) {
        Profile profile = account.profile();
        if (profile == null) {
            return new AccountView(account, null, null);
        }
        return new AccountView(
                account,
                profile.birthDate() == null ? null : KoreanAge.on(profile.birthDate(), today()),
                profile.photoKey() == null ? null : photos.viewUrl(profile.photoKey(), PHOTO_VIEW_SECONDS));
    }

    private static Account require(Account account) {
        if (account == null) {
            throw userNotFound();
        }
        return account;
    }

    private static ApiException userNotFound() {
        return new ApiException(404, "user_not_found");
    }

    /**
     * 응답에 실을 모양. 만 나이와 사진 주소는 저장하지 않고 조회할 때마다 계산한다.
     *
     * @param age 생년월일이 없으면 {@code null}
     * @param photoUrl 사진이 없거나 스토리지가 설정돼 있지 않으면 {@code null}
     */
    public record AccountView(Account account, Integer age, String photoUrl) {
    }

    public record NewPhotoUpload(String uploadUrl, Instant expiresAt) {
    }

    /** 완성된 프로필과 그것을 읽은 날의 만 나이. */
    public record CompleteProfile(Profile profile, int age) {
    }
}
