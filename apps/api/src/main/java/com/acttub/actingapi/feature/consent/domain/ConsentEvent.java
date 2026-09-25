package com.acttub.actingapi.feature.consent.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * 어떤 사람이 어떤 문서에 한 행위 하나. {@code user_consents} 는 <b>덮어쓰지 않고 쌓는</b>
 * 이력이라, 지금 상태는 이 기록들의 마지막 한 줄로 정해진다.
 */
public record ConsentEvent(
        UUID id,
        UUID userId,
        UUID documentId,
        String action,
        Instant occurredAt) {
}
