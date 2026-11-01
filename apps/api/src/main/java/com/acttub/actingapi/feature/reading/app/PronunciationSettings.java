package com.acttub.actingapi.feature.reading.app;

import java.time.Duration;
import java.util.Set;
import java.util.UUID;

/**
 * 리딩 발음 보고서(SOMA-606, 실험)를 켜는 조건. 허용 사용자 목록에 있거나 Pro 인 배우가 받는다(Pro 판정은
 * {@link PronunciationPlan}, SOMA-967). 채점 서비스 주소가 없으면 꺼진 것과 같다(운영 compose 에는 채점 서비스가 없다).
 *
 * @param scorerUrl 채점 서비스(apps/pron) 주소. 예: {@code http://pron:8000}
 */
public record PronunciationSettings(boolean enabled, Set<UUID> allowedUsers, String scorerUrl, Duration lease, int maxAttempts) {

    public boolean running() {
        return enabled && scorerUrl != null && !scorerUrl.isBlank();
    }

    public boolean allows(UUID userId) {
        return running() && allowedUsers.contains(userId);
    }
}
