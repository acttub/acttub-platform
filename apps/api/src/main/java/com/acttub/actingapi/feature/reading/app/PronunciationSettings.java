package com.acttub.actingapi.feature.reading.app;

import java.time.Duration;
import java.util.Set;
import java.util.UUID;

/**
 * 리딩 발음 보고서(SOMA-606)를 켜는 조건. 켜져 있으면 Pro 회원과 허용 사용자 목록(팀 확인용)에게 연다 — Pro 판정은
 * {@link PronunciationReportService} 가 한다. 채점 서비스 주소가 없으면 꺼진 것과 같다.
 *
 * @param scorerUrl 채점 서비스(apps/pron) 주소. 예: {@code http://pron:8000}
 */
public record PronunciationSettings(boolean enabled, Set<UUID> allowedUsers, String scorerUrl, Duration lease, int maxAttempts) {

    public boolean running() {
        return enabled && scorerUrl != null && !scorerUrl.isBlank();
    }

    /** 허용 사용자 목록에 있는가. Pro 여부는 보지 않는다. */
    public boolean allows(UUID userId) {
        return running() && allowedUsers.contains(userId);
    }
}
