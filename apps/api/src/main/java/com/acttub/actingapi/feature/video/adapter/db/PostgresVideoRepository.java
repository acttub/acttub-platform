package com.acttub.actingapi.feature.video.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.feature.video.app.VideoRepository;
import com.acttub.actingapi.feature.video.app.VideoStorage;
import com.acttub.actingapi.feature.video.app.VideoViews.VideoPage;
import com.acttub.actingapi.feature.video.app.VideoViews.VideoView;
import com.acttub.actingapi.feature.video.domain.VideoRules;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 보관함의 저장소. 예약은 옛 {@code upload_intents} 에 그대로 쓰고(새 쓰기가 이어지는 유일한 옛 테이블),
 * 확정이 {@code videos} 행을 만든다.
 *
 * <p><b>총량 검사와 확정은 {@code users} 행을 잠근 채 한 트랜잭션에서 한다</b>(practice.record) — 한도 직전에
 * 겹쳐 온 확정 둘 가운데 하나만 통과한다. 삭제·파기는 <b>영상 행</b>을 잠근다: 회차 시작(PA2)이 같은 행을 잡고
 * 참조를 만들므로 겹쳐도 하나만 성공한다.
 *
 * <p>객체 키를 잃는 자리(확정 실패·시한 만료·삭제·파기)는 <b>같은 트랜잭션에서</b> 장부에 남긴다 — 따로
 * 커밋되면 "키는 사라졌는데 장부에는 없는" 객체가 생긴다(CONTRACT §6-8).
 */
@Repository
class PostgresVideoRepository implements VideoRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final VideoObjectCleanup cleanup;

    PostgresVideoRepository(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            VideoObjectCleanup cleanup) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanup = cleanup;
    }

    @Override
    public Reserved reserve(UUID userId, NewIntent intent, long quotaBytes, Instant now) {
        return transaction.execute(tx -> {
            List<Tuple> existing = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id,object_key,expires_at,request_fingerprint
                    FROM upload_intents
                    WHERE user_id=:userId
                      AND request_id=:requestId
                    """, Tuple.class)
                    .setParameter("userId", userId)
                    .setParameter("requestId", intent.requestId()));
            if (!existing.isEmpty()) {
                Tuple row = existing.getFirst();
                if (!intent.fingerprint().equals(trimmed(row.get("request_fingerprint", String.class)))) {
                    return new Reserved(ReserveOutcome.MISMATCH, null, null, null);
                }
                return new Reserved(
                        ReserveOutcome.REPLAYED,
                        row.get("id", UUID.class),
                        row.get("object_key", String.class),
                        row.get("expires_at", Instant.class));
            }
            if (storedBytes(userId) + intent.byteSize() > quotaBytes) {
                return new Reserved(ReserveOutcome.QUOTA, null, null, null);
            }
            UUID id = UUID.randomUUID();
            entityManager.createNativeQuery("""
                    INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,
                                               duration_ms,created_at,expires_at,request_id,request_fingerprint)
                    VALUES (:id,:userId,'pending','s3',:objectKey,:contentType,:byteSize,:durationMs,:now,:expiresAt,
                            :requestId,:fingerprint)
                    """)
                    .setParameter("id", id)
                    .setParameter("userId", userId)
                    .setParameter("objectKey", intent.objectKey())
                    .setParameter("contentType", intent.contentType())
                    .setParameter("byteSize", intent.byteSize())
                    .setParameter("durationMs", intent.durationMs())
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("expiresAt", intent.expiresAt().atOffset(ZoneOffset.UTC))
                    .setParameter("requestId", intent.requestId())
                    .setParameter("fingerprint", intent.fingerprint())
                    .executeUpdate();
            return new Reserved(ReserveOutcome.CREATED, id, intent.objectKey(), intent.expiresAt());
        });
    }

    @Override
    public IntentView findIntent(UUID userId, UUID intentId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id,request_id,object_key,mime_type,size_bytes,duration_ms,expires_at,video_id
                FROM upload_intents
                WHERE id=:intentId
                  AND user_id=:userId
                """, Tuple.class)
                .setParameter("intentId", intentId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        Integer durationMs = row.get("duration_ms", Integer.class);
        return new IntentView(
                row.get("id", UUID.class),
                row.get("request_id", UUID.class),
                row.get("object_key", String.class),
                row.get("mime_type", String.class),
                row.get("size_bytes", Long.class),
                durationMs == null ? 0 : durationMs,
                row.get("expires_at", Instant.class),
                row.get("video_id", UUID.class));
    }

    @Override
    public Completed complete(UUID userId, UUID intentId, VideoStorage.Stored stored, long quotaBytes, Instant now) {
        return transaction.execute(tx -> {
            // 사용자 행을 잡는다 — 겹쳐 온 확정 둘이 여기서 줄을 서므로 총량이 정확하다.
            NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT id FROM users WHERE id=:userId FOR UPDATE", Tuple.class)
                    .setParameter("userId", userId));
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT object_key,mime_type,size_bytes,duration_ms,expires_at,video_id
                    FROM upload_intents
                    WHERE id=:intentId
                      AND user_id=:userId
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("intentId", intentId)
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return new Completed(CompleteOutcome.NOT_FOUND, null, List.of());
            }
            Tuple intent = rows.getFirst();
            UUID already = intent.get("video_id", UUID.class);
            if (already != null) {
                return new Completed(CompleteOutcome.REPLAYED, find(userId, already), List.of());
            }
            if (!now.isBefore(intent.get("expires_at", Instant.class))) {
                return new Completed(CompleteOutcome.EXPIRED, null, expire(userId, intentId, intent, now));
            }
            long declared = intent.get("size_bytes", Long.class);
            if (stored.byteSize() != declared) {
                return new Completed(CompleteOutcome.SIZE_MISMATCH, null, List.of());
            }
            if (storedBytes(userId) + declared > quotaBytes) {
                // 확정하지 않은 객체는 남지 않는다 — 기기가 올린 것을 장부가 지운다.
                return new Completed(CompleteOutcome.QUOTA, null, expire(userId, intentId, intent, now));
            }
            UUID videoId = UUID.randomUUID();
            Integer durationMs = intent.get("duration_ms", Integer.class);
            entityManager.createNativeQuery("""
                    INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,created_at,updated_at)
                    VALUES (:id,:userId,:objectKey,:contentType,:byteSize,:durationMs,:now,:now)
                    """)
                    .setParameter("id", videoId)
                    .setParameter("userId", userId)
                    .setParameter("objectKey", intent.get("object_key", String.class))
                    .setParameter("contentType", intent.get("mime_type", String.class))
                    .setParameter("byteSize", declared)
                    .setParameter("durationMs", durationMs == null ? 0 : durationMs)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE upload_intents
                    SET status='finalized',etag=:etag,finalized_at=:now,video_id=:videoId
                    WHERE id=:intentId
                    """)
                    .setParameter("etag", stored.etag())
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("videoId", videoId)
                    .setParameter("intentId", intentId)
                    .executeUpdate();
            return new Completed(CompleteOutcome.CREATED, find(userId, videoId), List.of());
        });
    }

    @Override
    public List<UUID> expireIntent(UUID userId, UUID intentId, Instant now) {
        return transaction.execute(tx -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT object_key,video_id,status
                    FROM upload_intents
                    WHERE id=:intentId
                      AND user_id=:userId
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("intentId", intentId)
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return List.of();
            }
            Tuple row = rows.getFirst();
            if (row.get("video_id", UUID.class) != null || !"pending".equals(row.get("status", String.class))) {
                return List.of();
            }
            return expire(userId, intentId, row, now);
        });
    }

    @Override
    public List<UUID> sweepExpiredIntents(Instant now) {
        return transaction.execute(tx -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id,user_id,object_key
                    FROM upload_intents
                    WHERE status='pending'
                      AND expires_at<=:now
                    ORDER BY expires_at
                    LIMIT 200
                    FOR UPDATE SKIP LOCKED
                    """, Tuple.class)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC)));
            List<UUID> scheduled = new ArrayList<>();
            for (Tuple row : rows) {
                scheduled.addAll(expire(
                        row.get("user_id", UUID.class), row.get("id", UUID.class), row, now));
            }
            return List.copyOf(scheduled);
        });
    }

    @Override
    public VideoPage list(UUID userId, String filter, String cursor, int limit, Instant now) {
        StringBuilder sql = new StringBuilder("""
                SELECT v.id,v.object_key,v.content_type,v.byte_size,v.duration_ms,v.favorite,v.purged_at,v.created_at,
                       (SELECT count(*) FROM practices p WHERE p.video_id=v.id) AS practice_count,
                       (SELECT count(*) FROM challenge_entries ce WHERE ce.video_id=v.id) AS entry_count
                FROM videos v
                WHERE v.user_id=:userId
                """);
        if ("favorite".equals(filter)) {
            sql.append("  AND v.favorite=true\n");
        }
        if ("recent7".equals(filter)) {
            sql.append("  AND v.created_at>=:since\n");
        }
        Cursor after = Cursor.decode(cursor);
        if (after != null) {
            sql.append("  AND (v.created_at,v.id) < (:cursorAt,:cursorId)\n");
        }
        sql.append("ORDER BY v.created_at DESC,v.id DESC\nLIMIT :limit\n");
        var query = entityManager.createNativeQuery(sql.toString(), Tuple.class)
                .setParameter("userId", userId)
                .setParameter("limit", limit + 1);
        if ("recent7".equals(filter)) {
            query.setParameter("since", now.minus(VideoRules.RECENT_WINDOW).atOffset(ZoneOffset.UTC));
        }
        if (after != null) {
            query.setParameter("cursorAt", after.createdAt().atOffset(ZoneOffset.UTC));
            query.setParameter("cursorId", after.id());
        }
        List<VideoView> rows = new ArrayList<>(NativeTuples.list(query).stream().map(PostgresVideoRepository::view).toList());
        String nextCursor = null;
        if (rows.size() > limit) {
            VideoView last = rows.get(limit - 1);
            rows = rows.subList(0, limit);
            nextCursor = new Cursor(last.createdAt(), last.id()).encode();
        }
        return new VideoPage(List.copyOf(rows), nextCursor);
    }

    @Override
    public VideoView find(UUID userId, UUID videoId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT v.id,v.object_key,v.content_type,v.byte_size,v.duration_ms,v.favorite,v.purged_at,v.created_at,
                       (SELECT count(*) FROM practices p WHERE p.video_id=v.id) AS practice_count,
                       (SELECT count(*) FROM challenge_entries ce WHERE ce.video_id=v.id) AS entry_count
                FROM videos v
                WHERE v.id=:videoId
                  AND v.user_id=:userId
                """, Tuple.class)
                .setParameter("videoId", videoId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : view(rows.getFirst());
    }

    @Override
    public VideoView setFavorite(UUID userId, UUID videoId, boolean favorite, Instant now) {
        return transaction.execute(tx -> {
            int changed = entityManager.createNativeQuery("""
                    UPDATE videos
                    SET favorite=:favorite,updated_at=:now
                    WHERE id=:videoId
                      AND user_id=:userId
                    """)
                    .setParameter("favorite", favorite)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("videoId", videoId)
                    .setParameter("userId", userId)
                    .executeUpdate();
            return changed == 0 ? null : find(userId, videoId);
        });
    }

    @Override
    public Removed delete(UUID userId, UUID videoId, Instant now) {
        return transaction.execute(tx -> {
            Tuple locked = lock(userId, videoId);
            if (locked == null) {
                return new Removed(RemoveOutcome.NOT_FOUND, null, List.of());
            }
            if (referenced(videoId)) {
                return new Removed(RemoveOutcome.IN_USE, null, List.of());
            }
            String objectKey = locked.get("object_key", String.class);
            boolean purged = locked.get("purged_at", Instant.class) != null;
            entityManager.createNativeQuery("DELETE FROM video_transcripts WHERE video_id=:videoId")
                    .setParameter("videoId", videoId)
                    .executeUpdate();
            entityManager.createNativeQuery("UPDATE upload_intents SET video_id=NULL WHERE video_id=:videoId")
                    .setParameter("videoId", videoId)
                    .executeUpdate();
            entityManager.createNativeQuery("DELETE FROM videos WHERE id=:videoId")
                    .setParameter("videoId", videoId)
                    .executeUpdate();
            // 이미 파기된 영상에는 지울 객체가 없다.
            List<UUID> scheduled = purged
                    ? List.of()
                    : List.of(cleanup.scheduleObjectDelete(userId, List.of(objectKey), now, now));
            return new Removed(RemoveOutcome.DELETED, null, scheduled);
        });
    }

    @Override
    public Removed purgeFile(UUID userId, UUID videoId, Instant now) {
        return transaction.execute(tx -> {
            Tuple locked = lock(userId, videoId);
            if (locked == null) {
                return new Removed(RemoveOutcome.NOT_FOUND, null, List.of());
            }
            if (locked.get("purged_at", Instant.class) != null) {
                return new Removed(RemoveOutcome.PURGED, find(userId, videoId), List.of());
            }
            entityManager.createNativeQuery("DELETE FROM video_transcripts WHERE video_id=:videoId")
                    .setParameter("videoId", videoId)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE videos
                    SET purged_at=:now,updated_at=:now
                    WHERE id=:videoId
                    """)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("videoId", videoId)
                    .executeUpdate();
            UUID scheduled = cleanup.scheduleObjectDelete(
                    userId, List.of(locked.get("object_key", String.class)), now, now);
            return new Removed(RemoveOutcome.PURGED, find(userId, videoId), List.of(scheduled));
        });
    }

    /** 영상 행을 잡는다 — 회차 시작(PA2)·삭제·파기가 같은 행에서 줄을 선다. 없거나 남의 것이면 {@code null}. */
    private Tuple lock(UUID userId, UUID videoId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id,object_key,purged_at
                FROM videos
                WHERE id=:videoId
                  AND user_id=:userId
                FOR UPDATE
                """, Tuple.class)
                .setParameter("videoId", videoId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : rows.getFirst();
    }

    /** 회차나 참여작이 이 영상을 쓰는가. 지운 참여작은 영상 참조를 풀어 두므로 세지 않는다. */
    private boolean referenced(UUID videoId) {
        return !NativeTuples.list(entityManager.createNativeQuery("""
                SELECT 1 AS used WHERE EXISTS(SELECT 1 FROM practices WHERE video_id=:videoId)
                   OR EXISTS(SELECT 1 FROM challenge_entries WHERE video_id=:videoId)
                """, Tuple.class)
                .setParameter("videoId", videoId)).isEmpty();
    }

    /** 파기되지 않은 영상의 바이트 합 — 총량은 이것으로 센다(practice.record). */
    private long storedBytes(UUID userId) {
        Number sum = (Number) entityManager.createNativeQuery("""
                SELECT COALESCE(sum(byte_size),0) AS stored
                FROM videos
                WHERE user_id=:userId
                  AND purged_at IS NULL
                """)
                .setParameter("userId", userId)
                .getSingleResult();
        return sum.longValue();
    }

    /** 예약을 시한 지남으로 닫고 미확정 객체의 삭제를 <b>같은 트랜잭션에서</b> 장부에 올린다. */
    private List<UUID> expire(UUID userId, UUID intentId, Tuple intent, Instant now) {
        entityManager.createNativeQuery("UPDATE upload_intents SET status='expired' WHERE id=:intentId")
                .setParameter("intentId", intentId)
                .executeUpdate();
        return List.of(cleanup.scheduleObjectDelete(
                userId, List.of(intent.get("object_key", String.class)), now, now));
    }

    private static VideoView view(Tuple row) {
        return new VideoView(
                row.get("id", UUID.class),
                row.get("object_key", String.class),
                row.get("content_type", String.class),
                row.get("byte_size", Long.class),
                row.get("duration_ms", Integer.class),
                row.get("favorite", Boolean.class),
                row.get("purged_at", Instant.class),
                row.get("created_at", Instant.class),
                ((Number) row.get("practice_count")).intValue(),
                ((Number) row.get("entry_count")).intValue(),
                null,
                null);
    }

    private static String trimmed(String fingerprint) {
        return fingerprint == null ? null : fingerprint.strip();
    }

    /** 보관함 쪽 넘기기의 자리 — 저장 시각과 id 다(같은 시각의 영상 둘이 섞이지 않는다). */
    private record Cursor(Instant createdAt, UUID id) {
        String encode() {
            return Base64.getUrlEncoder().withoutPadding()
                    .encodeToString((createdAt + "|" + id).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }

        static Cursor decode(String raw) {
            if (raw == null || raw.isBlank()) {
                return null;
            }
            try {
                String decoded = new String(
                        Base64.getUrlDecoder().decode(raw), java.nio.charset.StandardCharsets.UTF_8);
                int separator = decoded.lastIndexOf('|');
                return new Cursor(
                        Instant.parse(decoded.substring(0, separator)),
                        UUID.fromString(decoded.substring(separator + 1)));
            } catch (RuntimeException unreadable) {
                // 못 읽는 커서는 처음부터다 — 기기의 낡은 값이 목록을 막지 않는다.
                return null;
            }
        }
    }
}
