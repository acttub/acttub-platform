package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 동의 문서 한 판 — 로그인한 사람이 아직 결정하지 않은 문서이거나, 처음 온 신원에게 보일 현재 판
 * 문서다. 응답에 그대로 실린다.
 *
 * <p>{@code type} 이 문자열인 것은 그 값이 곧 계약이기 때문이다 — 열거형으로 받으면 이름을
 * 다시 DB 값으로 되돌리는 지점이 생기고, 그 자리가 계약이 어긋나는 자리다.
 */
public record PendingConsent(
        UUID id,
        String type,
        String version,
        String title,
        String body,
        boolean required,
        Instant publishedAt) {
}
