package com.acttub.actingapi.feature.video.domain;

import java.time.Duration;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * 영상의 규칙 — 한도·형식·객체 키 (practice.record). 프레임워크를 모른다.
 *
 * <p>숫자는 사용량 근거 없는 초기 한도다. 기기가 720px 로 줄인 업로드본을 올리고 원본은 서버에 두지 않는다 —
 * 파일 한도는 그 업로드본 기준이다. 기기도 같은 값을 검사하지만 서버가 다시 본다.
 */
public final class VideoRules {

    /** 올리는 파일의 상한(바이트, 100MiB). 넘으면 {@code video_too_large}. */
    public static final long FILE_MAX_BYTES = 100L * 1024 * 1024;

    /** 영상 길이의 상한(밀리초, 5분). 넘으면 {@code video_too_long}. */
    public static final int DURATION_MAX_MS = 300_000;

    /** 회원 계정의 보관 총량(바이트, 5GiB). 넘으면 기존은 보존하고 새 업로드만 {@code video_quota}. */
    public static final long MEMBER_QUOTA_BYTES = 5L * 1024 * 1024 * 1024;

    /** 게스트 계정의 보관 총량(바이트, 500MiB). */
    public static final long GUEST_QUOTA_BYTES = 500L * 1024 * 1024;

    /** 올릴 자리와 예약의 수명. 둘이 같아야 주소가 살아 있는 동안만 확정된다. */
    public static final Duration INTENT_TTL = Duration.ofMinutes(30);

    /** 재생 서명 주소의 수명(초). 만료 뒤에는 기기가 다시 조회한다. */
    public static final int PLAYBACK_TTL_SECONDS = 600;

    /**
     * 포스터를 만들려고 한 영상을 집는 횟수의 상한. 넘으면 더 고르지 않는다 — 깨진 영상 하나가 매 주기 내려받기·ffmpeg 를
     * 되풀이하지 않게 한다. 포스터 주소의 수명은 재생 주소와 같다({@link #PLAYBACK_TTL_SECONDS}).
     */
    public static final int POSTER_MAX_ATTEMPTS = 3;

    /** "최근 7일" 필터의 창. */
    public static final Duration RECENT_WINDOW = Duration.ofDays(7);

    /** 보관함 한 쪽의 기본 크기. */
    public static final int PAGE_SIZE = 30;

    /** MP4·MOV 만 받는다(practice.record). */
    private static final Set<String> ALLOWED = Set.of("video/mp4", "video/quicktime");

    private VideoRules() {
    }

    public static long quotaBytes(boolean guest) {
        return guest ? GUEST_QUOTA_BYTES : MEMBER_QUOTA_BYTES;
    }

    /** 매개변수 없는 소문자 형식. 알 수 없으면 {@code null} — 부르는 쪽이 값 오류로 거절한다. */
    public static String normalize(String contentType) {
        if (contentType == null) {
            return null;
        }
        String type = contentType.split(";")[0].strip().toLowerCase(Locale.ROOT);
        return ALLOWED.contains(type) ? type : null;
    }

    /** {@code videos/{사용자}/{요청}.{확장자}} — 요청마다 달라 객체 키를 재사용하지 않는다. */
    public static String objectKey(UUID userId, UUID requestId, String contentType) {
        return "videos/" + userId + "/" + requestId + ("video/quicktime".equals(contentType) ? ".mov" : ".mp4");
    }

    /**
     * 포스터는 영상 객체 옆이다 — {@code videos/{사용자}/{요청}.poster.jpg}. 영상 키에서 나오므로 같은 영상이면 몇 번을
     * 만들어도 같은 키에 덮어쓴다.
     */
    public static String posterKey(String objectKey) {
        int dot = objectKey.lastIndexOf('.');
        int slash = objectKey.lastIndexOf('/');
        return (dot > slash ? objectKey.substring(0, dot) : objectKey) + ".poster.jpg";
    }
}
