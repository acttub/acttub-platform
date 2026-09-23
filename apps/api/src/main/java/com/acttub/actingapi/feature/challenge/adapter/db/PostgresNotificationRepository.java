package com.acttub.actingapi.feature.challenge.adapter.db;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.NotificationRepository;
import com.acttub.actingapi.feature.challenge.domain.NotificationRules;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.web.ApiValidationException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 알림함·발송 (challenge.notification). 사건이 지금도 유효한지(좋아요가 남았는지, 댓글이 지워지거나 숨겨지지 않았는지,
 * 행동자와 수신자 사이에 차단이 없는지)는 저장해 두지 않고 조회·발송 때마다 원본으로 본다.
 */
@Repository
class PostgresNotificationRepository implements NotificationRepository {
    private static final String WITHDRAWN = "탈퇴한 사용자";
    /** 사건이 지금도 유효한가 — 알림함의 인원·수와 발송이 같은 조건을 쓴다. */
    private static final String VALID = """
            ((n.kind='entry_liked' AND EXISTS(SELECT 1 FROM entry_likes l
                   WHERE l.id=CASE WHEN n.kind='entry_liked' THEN CAST(substring(n.event_key FROM 6) AS uuid) END))
             OR (n.kind='entry_commented' AND EXISTS(SELECT 1 FROM entry_comments c
                   WHERE c.id=n.comment_id AND c.deleted_at IS NULL AND c.status='visible'))
             OR n.kind IN ('challenge_ended','entry_ai_report_ready'))
            AND (n.actor_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM user_blocks b
                   WHERE (b.blocker_id=n.user_id AND b.blocked_id=n.actor_user_id)
                      OR (b.blocker_id=n.actor_user_id AND b.blocked_id=n.user_id)))
            """;
    /** 대상을 지금 열 수 있는가. 반응 알림은 공개 조건의 참여작, 종료는 보이는 챌린지, AI 완료는 본인의 남은 참여작. */
    private static final String AVAILABLE = """
            CASE n.kind
              WHEN 'challenge_ended' THEN EXISTS(SELECT 1 FROM challenges c
                   WHERE c.id=n.challenge_id AND c.moderation='visible' AND c.deleted_at IS NULL)
              WHEN 'entry_ai_report_ready' THEN EXISTS(SELECT 1 FROM challenge_entries e
                   WHERE e.id=n.entry_id AND e.user_id=n.user_id AND e.status<>'deleted')
              ELSE EXISTS(SELECT 1 %s WHERE e.id=n.entry_id AND %s)
            END
            """.formatted(ChallengeVisibility.ENTRY_FROM, ChallengeVisibility.PUBLIC_ENTRY);
    private final EntityManager em;

    PostgresNotificationRepository(EntityManager em) { this.em = em; }

    @Override @Transactional(readOnly = true)
    public Inbox inbox(UUID user, String cursor, Instant now) {
        Instant at = null;
        String after = null;
        if (cursor != null && !cursor.isBlank()) {
            try {
                String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("\\|", 4);
                if (parts.length != 4 || !"N".equals(parts[0]) || !parts[1].equals(user.toString())) throw new IllegalArgumentException();
                at = Instant.parse(parts[2]);
                after = parts[3];
            } catch (RuntimeException invalid) {
                throw ApiValidationException.valueError(List.of("query", "cursor"), "Value error, invalid cursor", cursor);
            }
        }
        var query = em.createNativeQuery("""
                SELECT * FROM (
                  SELECT n.group_key,max(n.kind) AS kind,max(n.created_at) AS latest_at,
                         count(DISTINCT n.actor_user_id) AS actor_count,count(*) AS event_count,
                         count(*) FILTER (WHERE n.read_at IS NULL) AS unread,
                         (array_agg(n.challenge_id ORDER BY n.created_at DESC,n.id DESC))[1] AS challenge_id,
                         (array_agg(n.entry_id ORDER BY n.created_at DESC,n.id DESC))[1] AS entry_id,
                         (array_agg(n.comment_id ORDER BY n.created_at DESC,n.id DESC))[1] AS comment_id,
                         (array_agg(n.actor_user_id ORDER BY n.created_at DESC,n.id DESC))[1] AS actor_id,
                         bool_or(%s) AS available
                  FROM notifications n
                  WHERE n.user_id=:user AND n.expires_at>:now AND %s
                  GROUP BY n.group_key
                ) g
                """.formatted(AVAILABLE, VALID) + (at == null ? "" : " WHERE (g.latest_at,g.group_key)<(:at,:after) ")
                + " ORDER BY g.latest_at DESC,g.group_key DESC", Tuple.class)
                .setParameter("user", user).setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setMaxResults(NotificationRules.PAGE + 1);
        if (at != null) query.setParameter("at", at.atOffset(ZoneOffset.UTC)).setParameter("after", after);
        var rows = NativeTuples.list(query);
        boolean more = rows.size() > NotificationRules.PAGE;
        var groups = new ArrayList<Group>();
        for (Tuple row : rows.subList(0, Math.min(rows.size(), NotificationRules.PAGE))) {
            UUID actor = row.get("actor_id", UUID.class);
            UUID comment = row.get("comment_id", UUID.class);
            boolean available = Boolean.TRUE.equals(row.get("available", Boolean.class));
            groups.add(new Group(row.get("group_key", String.class), row.get("kind", String.class),
                    ((Number) row.get("actor_count")).longValue(), ((Number) row.get("event_count")).longValue(),
                    actor == null ? null : name(actor), row.get("challenge_id", UUID.class), row.get("entry_id", UUID.class), comment,
                    comment == null || !available ? null : excerpt(comment), row.get("latest_at", Instant.class),
                    ((Number) row.get("unread")).longValue() == 0, available));
        }
        String next = more ? Base64.getUrlEncoder().withoutPadding().encodeToString(("N|" + user + "|" + groups.getLast().latestAt()
                + "|" + groups.getLast().groupKey()).getBytes(StandardCharsets.UTF_8)) : null;
        return new Inbox(groups, next);
    }

    @Override @Transactional
    public void read(UUID user, List<String> groupKeys, Instant before, UUID beforeId, Instant now) {
        if (groupKeys != null && !groupKeys.isEmpty()) {
            em.createNativeQuery("""
                    UPDATE notifications SET read_at=:now WHERE user_id=:user AND group_key IN (:groups) AND read_at IS NULL
                      AND created_at<=:now
                    """).setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("user", user).setParameter("groups", groupKeys)
                    .executeUpdate();
        }
        if (before != null) {
            var update = em.createNativeQuery("UPDATE notifications SET read_at=:now WHERE user_id=:user AND read_at IS NULL AND "
                    + (beforeId == null ? "created_at<=:before" : "(created_at,id)<=(:before,:beforeId)"))
                    .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("user", user)
                    .setParameter("before", before.atOffset(ZoneOffset.UTC));
            if (beforeId != null) update.setParameter("beforeId", beforeId);
            update.executeUpdate();
        }
    }

    @Override @Transactional(readOnly = true)
    public long unread(UUID user, Instant now) {
        return ((Number) em.createNativeQuery("""
                SELECT count(DISTINCT n.group_key) FROM notifications n
                WHERE n.user_id=:user AND n.expires_at>:now AND n.read_at IS NULL AND %s
                """.formatted(VALID)).setParameter("user", user).setParameter("now", now.atOffset(ZoneOffset.UTC))
                .getSingleResult()).longValue();
    }

    @Override @Transactional
    public List<Outgoing> dispatch(Instant now, int limit) {
        var due = NativeTuples.list(em.createNativeQuery("""
                SELECT DISTINCT user_id,group_key FROM notifications
                WHERE push_status='pending' AND push_after<=:now LIMIT :limit
                """, Tuple.class).setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("limit", limit));
        var outgoing = new ArrayList<Outgoing>();
        for (Tuple group : due) {
            UUID user = group.get("user_id", UUID.class);
            String key = group.get("group_key", String.class);
            var rows = NativeTuples.list(em.createNativeQuery("""
                    SELECT n.id,n.kind,n.challenge_id,n.entry_id,(%s) AND (%s) AS deliverable FROM notifications n
                    WHERE n.user_id=:user AND n.group_key=:group AND n.push_status='pending' AND n.push_after<=:now
                    FOR UPDATE OF n SKIP LOCKED
                    """.formatted(VALID, AVAILABLE), Tuple.class).setParameter("user", user).setParameter("group", key)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC)));
            if (rows.isEmpty()) continue;
            // 발송 직전 확인: 활성 계정, 챌린지 알림 토글, 지금 이 사람 것인 한국어 토큰.
            var tokens = NativeTuples.list(em.createNativeQuery("""
                    SELECT t.token FROM push_tokens t JOIN users u ON u.id=t.user_id JOIN user_profiles p ON p.user_id=t.user_id
                    WHERE t.user_id=:user AND u.status='active' AND p.notify_challenge
                      AND (t.locale IS NULL OR t.locale='' OR t.locale='ko')
                    ORDER BY t.token
                    """, Tuple.class).setParameter("user", user)).stream().map(row -> row.get("token", String.class)).toList();
            var sendable = rows.stream().filter(row -> Boolean.TRUE.equals(row.get("deliverable", Boolean.class))).toList();
            var ids = rows.stream().map(row -> row.get("id", UUID.class)).toList();
            boolean claimed = false;
            if (!tokens.isEmpty() && !sendable.isEmpty()) {
                String stage = NativeTuples.list(em.createNativeQuery(
                        "SELECT 1 AS sent FROM notification_pushes WHERE group_key=:group AND stage='first'", Tuple.class)
                        .setParameter("group", key)).isEmpty() ? "first" : "summary";
                claimed = em.createNativeQuery("""
                        INSERT INTO notification_pushes(id,group_key,stage,user_id,created_at) VALUES (:id,:group,:stage,:user,:now)
                        ON CONFLICT (group_key,stage) DO NOTHING
                        """).setParameter("id", UUID.randomUUID()).setParameter("group", key).setParameter("stage", stage)
                        .setParameter("user", user).setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate() == 1;
            }
            if (claimed) {
                Tuple latest = sendable.getLast();
                var data = new LinkedHashMap<String, String>();
                data.put("type", "challenge_notification");
                data.put("group_key", key);
                data.put("kind", latest.get("kind", String.class));
                data.put("challenge_id", latest.get("challenge_id", UUID.class).toString());
                if (latest.get("entry_id") != null) data.put("entry_id", latest.get("entry_id", UUID.class).toString());
                String body = NotificationRules.pushBody(latest.get("kind", String.class));
                tokens.forEach(token -> outgoing.add(new Outgoing(token, body, java.util.Map.copyOf(data))));
            }
            var sent = claimed ? sendable.stream().map(row -> row.get("id", UUID.class)).toList() : List.<UUID>of();
            mark(sent, "attempted", now);
            mark(ids.stream().filter(id -> !sent.contains(id)).toList(), "skipped", now);
        }
        return outgoing;
    }

    @Override @Transactional
    public void forgetTokens(List<String> tokens) {
        if (tokens.isEmpty()) return;
        em.createNativeQuery("DELETE FROM push_tokens WHERE token IN (:tokens)").setParameter("tokens", tokens).executeUpdate();
    }

    private void mark(List<UUID> ids, String status, Instant now) {
        if (ids.isEmpty()) return;
        em.createNativeQuery("""
                UPDATE notifications SET push_status=:status,push_attempted_at=CASE WHEN :status='attempted' THEN CAST(:now AS timestamptz) END
                WHERE id IN (:ids)
                """).setParameter("status", status).setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("ids", ids)
                .executeUpdate();
    }

    private String name(UUID actor) {
        var rows = NativeTuples.list(em.createNativeQuery("""
                SELECT u.status,coalesce(p.name,'배우') AS name FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=:id
                """, Tuple.class).setParameter("id", actor));
        if (rows.isEmpty() || !"active".equals(rows.getFirst().get("status", String.class))) return WITHDRAWN;
        return rows.getFirst().get("name", String.class);
    }

    private String excerpt(UUID comment) {
        var rows = NativeTuples.list(em.createNativeQuery(
                "SELECT left(body,40) AS body FROM entry_comments WHERE id=:id AND deleted_at IS NULL AND status='visible'", Tuple.class)
                .setParameter("id", comment));
        return rows.isEmpty() ? null : rows.getFirst().get("body", String.class);
    }
}
