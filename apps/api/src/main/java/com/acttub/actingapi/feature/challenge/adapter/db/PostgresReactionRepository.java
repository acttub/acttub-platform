package com.acttub.actingapi.feature.challenge.adapter.db;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Participant;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 좋아요·저장·댓글·차단 (challenge.react, challenge.block). 좋아요 수는 연결 행을 다시 센다(CONTRACT §7). 차단은 상대에게
 * 알리지 않고 양쪽 화면에서 서로의 참여작·댓글을 뺀다(개인 노출 조건).
 */
@Repository
class PostgresReactionRepository implements ReactionRepository {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final String WITHDRAWN = "탈퇴한 사용자";
    private final EntityManager em;
    private final EntryLocks locks;
    private final EntryCards cards;
    private final NotificationEvents events;

    PostgresReactionRepository(EntityManager em, EntryLocks locks, EntryCards cards, NotificationEvents events) {
        this.em = em; this.locks = locks; this.cards = cards; this.events = events;
    }

    @Override @Transactional
    public Liked like(UUID viewer, UUID entryId, boolean on, Instant now) {
        var target = locks.entry(viewer, entryId, now, false, false);
        if (viewer.equals(target.author())) throw new ApiException(422, "self_like");
        if (on) {
            UUID like = UUID.randomUUID();
            int inserted = em.createNativeQuery("""
                    INSERT INTO entry_likes(id,entry_id,user_id,created_at) VALUES (:id,:entry,:viewer,:now)
                    ON CONFLICT (entry_id,user_id) DO NOTHING
                    """).setParameter("id", like).setParameter("entry", entryId).setParameter("viewer", viewer)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
            // 좋아요 행이 원인이다 — 취소 뒤 다시 누르면 새 사건이고, 이미 눌러 둔 재전송은 사건을 만들지 않는다.
            if (inserted == 1) {
                events.record(target.author(), "entry_liked", viewer, target.challengeId(), entryId, null, "like:" + like, now);
            }
        } else {
            em.createNativeQuery("DELETE FROM entry_likes WHERE entry_id=:entry AND user_id=:viewer")
                    .setParameter("entry", entryId).setParameter("viewer", viewer).executeUpdate();
        }
        long count = ((Number) em.createNativeQuery("SELECT count(*) FROM entry_likes WHERE entry_id=:entry")
                .setParameter("entry", entryId).getSingleResult()).longValue();
        return new Liked(count, on);
    }

    @Override @Transactional
    public Saved save(UUID viewer, UUID entryId, boolean on, Instant now) {
        var target = locks.entry(viewer, entryId, now, false, false);
        if (viewer.equals(target.author())) throw new ApiException(422, "self_save");
        if (on) {
            em.createNativeQuery("""
                    INSERT INTO entry_saves(id,entry_id,user_id,created_at) VALUES (:id,:entry,:viewer,:now)
                    ON CONFLICT (entry_id,user_id) DO NOTHING
                    """).setParameter("id", UUID.randomUUID()).setParameter("entry", entryId).setParameter("viewer", viewer)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
        } else {
            em.createNativeQuery("DELETE FROM entry_saves WHERE entry_id=:entry AND user_id=:viewer")
                    .setParameter("entry", entryId).setParameter("viewer", viewer).executeUpdate();
        }
        return new Saved(on);
    }

    @Override @Transactional(readOnly = true)
    public SavedEntries saved(UUID viewer, String cursor) {
        String visible = """
                FROM entry_saves s JOIN challenge_entries se ON se.id=s.entry_id
                WHERE s.user_id=:viewer AND EXISTS(SELECT 1 %s WHERE e.id=s.entry_id AND %s AND %s)
                """.formatted(ChallengeVisibility.ENTRY_FROM, ChallengeVisibility.PUBLIC_ENTRY, ChallengeVisibility.UNBLOCKED);
        String[] after = cursor == null || cursor.isBlank() ? null : decode(cursor, "V", 3);
        if (after != null && !after[1].equals(viewer.toString())) throw invalidCursor(cursor);
        var query = em.createNativeQuery("SELECT s.entry_id,s.id,s.created_at " + visible
                + (after == null ? "" : " AND (s.created_at,s.id)<(:at,:after) ") + " ORDER BY s.created_at DESC,s.id DESC", Tuple.class)
                .setParameter("viewer", viewer).setMaxResults(ChallengeRules.ENTRY_PAGE + 1);
        if (after != null) {
            try { query.setParameter("at", Instant.parse(after[2]).atOffset(ZoneOffset.UTC)).setParameter("after", UUID.fromString(after[3])); }
            catch (RuntimeException invalid) { throw invalidCursor(cursor); }
        }
        var rows = NativeTuples.list(query);
        boolean more = rows.size() > ChallengeRules.ENTRY_PAGE;
        var page = rows.subList(0, Math.min(rows.size(), ChallengeRules.ENTRY_PAGE));
        var entries = cards.cards(viewer, page.stream().map(row -> row.get("entry_id", UUID.class)).toList(), Map.of(), null, false);
        String next = more ? encode("V", viewer.toString(), page.getLast().get("created_at", Instant.class).toString(),
                page.getLast().get("id", UUID.class).toString()) : null;
        long mine = ((Number) em.createNativeQuery(
                "SELECT count(*) FROM challenge_entries WHERE user_id=:viewer AND status<>'deleted'")
                .setParameter("viewer", viewer).getSingleResult()).longValue();
        long savedCount = ((Number) em.createNativeQuery("SELECT count(*) " + visible)
                .setParameter("viewer", viewer).getSingleResult()).longValue();
        return new SavedEntries(entries, mine, savedCount, next);
    }

    @Override @Transactional(readOnly = true)
    public CommentPage comments(UUID viewer, UUID entryId, String cursor) {
        if (!locks.visible(viewer, entryId, true)) throw new ApiException(404, "entry_not_found");
        String[] after = cursor == null || cursor.isBlank() ? null : decode(cursor, "C", 3);
        if (after != null && !after[1].equals(entryId.toString())) throw invalidCursor(cursor);
        var query = em.createNativeQuery(COMMENT + " WHERE cm.entry_id=:entry AND " + ChallengeVisibility.VISIBLE_COMMENT
                + (after == null ? "" : " AND (cm.created_at,cm.id)<(:at,:after) ") + " ORDER BY cm.created_at DESC,cm.id DESC", Tuple.class)
                .setParameter("entry", entryId).setParameter("viewer", viewer).setMaxResults(ChallengeRules.ENTRY_PAGE + 1);
        if (after != null) {
            try { query.setParameter("at", Instant.parse(after[2]).atOffset(ZoneOffset.UTC)).setParameter("after", UUID.fromString(after[3])); }
            catch (RuntimeException invalid) { throw invalidCursor(cursor); }
        }
        var rows = NativeTuples.list(query);
        boolean more = rows.size() > ChallengeRules.ENTRY_PAGE;
        var comments = rows.subList(0, Math.min(rows.size(), ChallengeRules.ENTRY_PAGE)).stream().map(row -> comment(row, viewer)).toList();
        String next = more ? encode("C", entryId.toString(), comments.getLast().createdAt().toString(),
                comments.getLast().id().toString()) : null;
        return new CommentPage(comments, next);
    }

    @Override @Transactional
    public CommentCreation comment(UUID viewer, UUID entryId, UUID requestId, String fingerprint, String body, Instant now) {
        locks.people(viewer, viewer, false);
        // 재전송 확인이 한도·노출 검사보다 먼저다 — 응답을 잃은 재전송이 두 번째 댓글이나 429가 되지 않는다.
        var previous = NativeTuples.list(em.createNativeQuery(
                "SELECT id,request_fingerprint FROM entry_comments WHERE user_id=:viewer AND request_id=:request", Tuple.class)
                .setParameter("viewer", viewer).setParameter("request", requestId));
        if (!previous.isEmpty()) {
            if (!fingerprint.equals(previous.getFirst().get("request_fingerprint", String.class).strip())) {
                throw new ApiException(422, "request_fingerprint_mismatch");
            }
            return new CommentCreation(commentById(previous.getFirst().get("id", UUID.class), viewer), false);
        }
        var target = locks.entry(viewer, entryId, now, false, true);
        Instant midnight = now.atZone(SEOUL).toLocalDate().atStartOfDay(SEOUL).toInstant();
        long today = ((Number) em.createNativeQuery("SELECT count(*) FROM entry_comments WHERE user_id=:viewer AND created_at>=:since")
                .setParameter("viewer", viewer).setParameter("since", midnight.atOffset(ZoneOffset.UTC)).getSingleResult()).longValue();
        if (today >= ChallengeRules.DAILY_COMMENTS) throw new ApiException(429, "daily_comment_limit");
        UUID id = UUID.randomUUID();
        em.createNativeQuery("""
                INSERT INTO entry_comments(id,entry_id,user_id,body,status,request_id,request_fingerprint,created_at)
                VALUES (:id,:entry,:viewer,:body,'visible',:request,:fingerprint,:now)
                """).setParameter("id", id).setParameter("entry", entryId).setParameter("viewer", viewer).setParameter("body", body)
                .setParameter("request", requestId).setParameter("fingerprint", fingerprint)
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
        events.record(target.author(), "entry_commented", viewer, target.challengeId(), entryId, id, "comment:" + id, now);
        return new CommentCreation(commentById(id, viewer), true);
    }

    @Override @Transactional
    public void deleteComment(UUID viewer, UUID commentId, Instant now) {
        locks.people(viewer, viewer, false);
        var rows = NativeTuples.list(em.createNativeQuery(
                "SELECT deleted_at FROM entry_comments WHERE id=:id AND user_id=:viewer FOR UPDATE", Tuple.class)
                .setParameter("id", commentId).setParameter("viewer", viewer));
        if (rows.isEmpty()) throw new ApiException(404, "comment_not_found");
        if (rows.getFirst().get("deleted_at") != null) return;
        em.createNativeQuery("UPDATE entry_comments SET body=NULL,deleted_at=:now WHERE id=:id")
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", commentId).executeUpdate();
        em.createNativeQuery("UPDATE entry_reports SET target_text=NULL WHERE target_type='comment' AND target_id=:id")
                .setParameter("id", commentId).executeUpdate();
    }

    @Override @Transactional
    public Blocked block(UUID viewer, UUID target, boolean on, Instant now) {
        if (viewer.equals(target)) throw new ApiException(422, "self_block");
        boolean exists = locks.people(viewer, target, true);
        if (on) {
            var active = NativeTuples.list(em.createNativeQuery("SELECT 1 AS found FROM users WHERE id=:id AND status='active'", Tuple.class)
                    .setParameter("id", target));
            if (!exists || active.isEmpty()) throw new ApiException(404, "user_not_found");
            em.createNativeQuery("""
                    INSERT INTO user_blocks(id,blocker_id,blocked_id,created_at) VALUES (:id,:viewer,:target,:now)
                    ON CONFLICT (blocker_id,blocked_id) DO NOTHING
                    """).setParameter("id", UUID.randomUUID()).setParameter("viewer", viewer).setParameter("target", target)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
        } else {
            em.createNativeQuery("DELETE FROM user_blocks WHERE blocker_id=:viewer AND blocked_id=:target")
                    .setParameter("viewer", viewer).setParameter("target", target).executeUpdate();
        }
        return new Blocked(target, on);
    }

    @Override @Transactional(readOnly = true)
    public BlockList blocks(UUID viewer) {
        return new BlockList(NativeTuples.list(em.createNativeQuery("""
                SELECT b.blocked_id,coalesce(p.name,'배우') AS name,b.created_at FROM user_blocks b
                LEFT JOIN user_profiles p ON p.user_id=b.blocked_id
                WHERE b.blocker_id=:viewer ORDER BY b.created_at DESC,b.id DESC
                """, Tuple.class).setParameter("viewer", viewer)).stream()
                .map(row -> new BlockedUser(row.get("blocked_id", UUID.class), row.get("name", String.class),
                        row.get("created_at", Instant.class))).toList());
    }

    private static final String COMMENT = """
            SELECT cm.id,cm.user_id,cm.body,cm.status,cm.created_at,cu.status AS author_status,coalesce(cp.name,'배우') AS author_name
            FROM entry_comments cm JOIN users cu ON cu.id=cm.user_id LEFT JOIN user_profiles cp ON cp.user_id=cm.user_id
            """;

    private Comment commentById(UUID id, UUID viewer) {
        return comment(NativeTuples.list(em.createNativeQuery(COMMENT + " WHERE cm.id=:id", Tuple.class).setParameter("id", id))
                .getFirst(), viewer);
    }

    /** 작성자 이름은 지금의 프로필 이름이고, 탈퇴했으면 이름만 바뀐다. 이름 말고 프로필 정보는 싣지 않는다. */
    private static Comment comment(Tuple row, UUID viewer) {
        boolean withdrawn = !"active".equals(row.get("author_status", String.class));
        UUID author = row.get("user_id", UUID.class);
        return new Comment(row.get("id", UUID.class), new Participant(author, withdrawn ? WITHDRAWN : row.get("author_name", String.class)),
                row.get("body", String.class), row.get("created_at", Instant.class), viewer.equals(author), withdrawn,
                row.get("status", String.class));
    }

    private static String encode(String kind, String... parts) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString((kind + "|" + String.join("|", parts)).getBytes(StandardCharsets.UTF_8));
    }

    private static String[] decode(String raw, String kind, int size) {
        try {
            if (raw.length() > 512) throw new IllegalArgumentException();
            String[] parts = new String(Base64.getUrlDecoder().decode(raw), StandardCharsets.UTF_8).split("\\|", -1);
            if (parts.length != size + 1 || !parts[0].equals(kind)) throw new IllegalArgumentException();
            return parts;
        } catch (IllegalArgumentException invalid) {
            throw invalidCursor(raw);
        }
    }

    private static ApiValidationException invalidCursor(String raw) {
        return ApiValidationException.valueError(List.of("query", "cursor"), "Value error, invalid cursor", raw);
    }
}
