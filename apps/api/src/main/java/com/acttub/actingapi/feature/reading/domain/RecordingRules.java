package com.acttub.actingapi.feature.reading.domain;

import java.util.UUID;

/**
 * 녹음의 규칙 — 한도와 객체 키 (reading.recording). 프레임워크를 모른다.
 *
 * <p>숫자는 성능·사용량 근거 없는 초기 한도다. 파일 한도는 올린 원본 기준이고 총량은 저장된(변환 뒤) 바이트 합이다.
 */
public final class RecordingRules {

    /** 올린 원본 파일의 상한(바이트). 넘으면 {@code recording_too_long}. */
    public static final long FILE_MAX_BYTES = 10_000_000L;

    /** 한 줄 녹음 길이의 상한(밀리초). 넘으면 {@code recording_too_long}. */
    public static final int DURATION_MAX_MS = 180_000;

    /** 회원 계정의 저장 총량(바이트). 넘으면 기존은 보존하고 새 저장만 {@code recording_quota}. */
    public static final long MEMBER_QUOTA_BYTES = 1_000_000_000L;

    /** 게스트 계정의 저장 총량(바이트). */
    public static final long GUEST_QUOTA_BYTES = 100_000_000L;

    /** 재생 서명 주소의 수명(초). 만료 뒤에는 기기가 목록을 다시 조회한다. */
    public static final int PLAYBACK_TTL_SECONDS = 600;

    /** 저장 형식은 하나다 — 이관 뒤 앱에서 웹 녹음을 들을 수 있어야 한다. */
    public static final String STORED_CONTENT_TYPE = "audio/mp4";

    private RecordingRules() {
    }

    public static long quotaBytes(boolean guest) {
        return guest ? GUEST_QUOTA_BYTES : MEMBER_QUOTA_BYTES;
    }

    /** 이미 m4a(AAC)인가 — 그러면 변환하지 않는다. 그 밖(webm/opus, wav, 인식기가 남긴 파일)은 변환한다. */
    public static boolean alreadyM4a(String contentType) {
        if (contentType == null) {
            return false;
        }
        String type = contentType.split(";")[0].strip().toLowerCase(java.util.Locale.ROOT);
        return type.equals("audio/mp4") || type.equals("audio/m4a") || type.equals("audio/x-m4a") || type.equals("audio/aac");
    }

    /** 사용자·회차·줄·요청 id 로 만드는 객체 키 — 요청마다 달라 재사용하지 않는다. */
    public static String objectKey(UUID userId, UUID sessionId, UUID lineId, UUID requestId) {
        return "reading/" + userId + "/" + sessionId + "/" + lineId + "/" + requestId + ".m4a";
    }
}
