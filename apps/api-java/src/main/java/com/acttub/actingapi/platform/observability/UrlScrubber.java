package com.acttub.actingapi.platform.observability;

import java.util.regex.Pattern;

/**
 * 주소에서 식별자를 지운다. 파이썬 원본은 {@code observability.py:scrub_url} 이고 웹 쪽
 * {@code lib/observability/sentry-shared.ts:scrubUrl} 과도 같은 규칙이다.
 *
 * <p>쿼리를 통째로 버리므로 새 파라미터가 생겨도 따로 손볼 것이 없다. 라우트 템플릿
 * ({@code /v2/practice-sessions/{session_id}})은 Sentry 가 트랜잭션 이름으로 따로 들고 있어서,
 * 여기서 실제 주소를 가려도 어느 엔드포인트인지는 그대로 보인다. UUID 를 가리면 같은 화면에서
 * 난 에러가 주소마다 다른 이슈로 쪼개지지 않는 이득도 따라온다.
 */
public final class UrlScrubber {

    /** 세션·사용자·업로드 식별자가 전부 이 꼴로 주소에 실려 온다. */
    private static final Pattern UUID_PATTERN = Pattern.compile(
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            Pattern.CASE_INSENSITIVE);

    private UrlScrubber() {}

    /** 쿼리·조각을 떼고 경로의 UUID 를 {@code <id>} 로 바꾼다. 절대 주소와 상대 경로 모두 받는다. */
    public static String scrub(String url) {
        if (url == null || url.isEmpty()) {
            return url;
        }
        String path = url.split("#", 2)[0].split("\\?", 2)[0];
        return UUID_PATTERN.matcher(path).replaceAll("<id>");
    }
}
