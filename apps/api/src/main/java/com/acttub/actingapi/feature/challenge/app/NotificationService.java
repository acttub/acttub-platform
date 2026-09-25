package com.acttub.actingapi.feature.challenge.app;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.platform.web.ApiValidationException;
import org.springframework.stereotype.Service;

/** 알림함 조회·읽음·배지 (challenge.notification). */
@Service
public class NotificationService {
    private final NotificationRepository notifications;
    private final Clock clock;

    public NotificationService(NotificationRepository notifications, Clock clock) {
        this.notifications = notifications; this.clock = clock;
    }

    public NotificationRepository.Inbox inbox(UUID user, String cursor) { return notifications.inbox(user, cursor, clock.instant()); }

    /** 묶음을 열면 그 묶음의 지금까지 사건 전부, "모두 읽음"은 요청이 가리킨 시각·id 까지만 읽음이다. */
    public void read(UUID user, List<String> groupKeys, Instant before, UUID beforeId) {
        if ((groupKeys == null || groupKeys.isEmpty()) && before == null) {
            throw ApiValidationException.valueError(List.of("body"), "Value error, group_keys or all_before is required", null);
        }
        notifications.read(user, groupKeys, before, beforeId, clock.instant());
    }

    public long unread(UUID user) { return notifications.unread(user, clock.instant()); }
}
