package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.domain.NotificationRules;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.NotificationKind;
import com.acttub.actingapi.platform.schema.NotificationPushStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Component;

/**
 * 알림 사건 한 행을 원인 행동과 <b>같은 트랜잭션에서</b> 남긴다 (challenge.notification). 자기 행동은 남기지 않고, 같은
 * 원인(event_key)의 재전송은 한 행이다. 토글이 꺼졌거나 푸시 토큰이 없으면 알림함에만 쌓고(skipped), 아니면 발송
 * 시각(push_after)을 정해 둔다 — 실제 발송은 커밋 뒤 따로 도는 일이 한다.
 */
@Component
class NotificationEvents {
    private static final NotificationKind.JpaConverter KINDS = new NotificationKind.JpaConverter();
    private final EntityManager em;
    private final NotificationJpaRepository notifications;
    NotificationEvents(EntityManager em, NotificationJpaRepository notifications) {
        this.em = em; this.notifications = notifications;
    }

    void record(UUID recipient, String kind, UUID actor, UUID challengeId, UUID entryId, UUID commentId, String eventKey,
                Instant now) {
        if (recipient.equals(actor)) return;
        String group = NotificationRules.groupKey(recipient, kind, entryId == null ? challengeId : entryId, now);
        boolean first = notifications.anyInGroup(recipient, group, Limit.of(1)).isEmpty();
        // 프로필과 푸시 토큰은 다른 기능의 표라 네이티브로 둔다(CONTRACT §5-1).
        boolean deliverable = !NativeTuples.list(em.createNativeQuery("""
                SELECT 1 AS deliverable FROM user_profiles p
                WHERE p.user_id=:user AND p.notify_challenge AND EXISTS(SELECT 1 FROM push_tokens t WHERE t.user_id=p.user_id)
                """, Tuple.class).setParameter("user", recipient)).isEmpty();
        notifications.insertUnlessRecorded(UUID.randomUUID(), recipient, KINDS.convertToEntityAttribute(kind), actor, challengeId,
                entryId, commentId, eventKey, group, now, now.plus(NotificationRules.RETENTION),
                deliverable ? NotificationRules.pushAfter(now, first) : null,
                deliverable ? NotificationPushStatus.PENDING : NotificationPushStatus.SKIPPED);
    }
}
