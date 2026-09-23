package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.domain.NotificationRules;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Component;

/**
 * 알림 사건 한 행을 원인 행동과 <b>같은 트랜잭션에서</b> 남긴다 (challenge.notification). 자기 행동은 남기지 않고, 같은
 * 원인(event_key)의 재전송은 한 행이다. 토글이 꺼졌거나 푸시 토큰이 없으면 알림함에만 쌓고(skipped), 아니면 발송
 * 시각(push_after)을 정해 둔다 — 실제 발송은 커밋 뒤 따로 도는 일이 한다.
 */
@Component
class NotificationEvents {
    private final EntityManager em;
    NotificationEvents(EntityManager em) { this.em = em; }

    void record(UUID recipient, String kind, UUID actor, UUID challengeId, UUID entryId, UUID commentId, String eventKey,
                Instant now) {
        if (recipient.equals(actor)) return;
        String group = NotificationRules.groupKey(recipient, kind, entryId == null ? challengeId : entryId, now);
        boolean first = NativeTuples.list(em.createNativeQuery(
                "SELECT 1 AS seen FROM notifications WHERE user_id=:user AND group_key=:group LIMIT 1", Tuple.class)
                .setParameter("user", recipient).setParameter("group", group)).isEmpty();
        boolean deliverable = !NativeTuples.list(em.createNativeQuery("""
                SELECT 1 AS deliverable FROM user_profiles p
                WHERE p.user_id=:user AND p.notify_challenge AND EXISTS(SELECT 1 FROM push_tokens t WHERE t.user_id=p.user_id)
                """, Tuple.class).setParameter("user", recipient)).isEmpty();
        em.createNativeQuery("""
                INSERT INTO notifications(id,user_id,kind,actor_user_id,challenge_id,entry_id,comment_id,event_key,group_key,
                    created_at,expires_at,push_after,push_status)
                VALUES (:id,:user,:kind,CAST(NULLIF(:actor,'') AS uuid),:challenge,CAST(NULLIF(:entry,'') AS uuid),
                    CAST(NULLIF(:comment,'') AS uuid),:event,:group,:now,:expires,
                    CASE WHEN :deliverable THEN CAST(:after AS timestamptz) END,
                    CASE WHEN :deliverable THEN 'pending' ELSE 'skipped' END)
                ON CONFLICT (user_id,event_key) DO NOTHING
                """).setParameter("id", UUID.randomUUID()).setParameter("user", recipient).setParameter("kind", kind)
                .setParameter("actor", text(actor)).setParameter("challenge", challengeId).setParameter("entry", text(entryId))
                .setParameter("comment", text(commentId)).setParameter("event", eventKey).setParameter("group", group)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("expires", now.plus(NotificationRules.RETENTION).atOffset(ZoneOffset.UTC))
                .setParameter("deliverable", deliverable)
                .setParameter("after", NotificationRules.pushAfter(now, first).atOffset(ZoneOffset.UTC)).executeUpdate();
    }

    private static String text(UUID id) { return id == null ? "" : id.toString(); }
}
