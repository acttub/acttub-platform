package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Video;
import com.acttub.actingapi.feature.challenge.app.EntryModerationRepository;
import com.acttub.actingapi.feature.challenge.app.EntryModerationVerdict;
import com.acttub.actingapi.feature.challenge.app.EntryModerationVerdict.Decision;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.web.Hashing;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 공개 참여작 AI 검사의 장부 (SOMA-907). 숨김·확인 필요·실패는 신고 목록에 사람이 아닌 신고(source='ai')로 남긴다 —
 * 운영은 사람 신고와 같은 화면에서 풀기·유지를 정한다.
 */
@Repository
class PostgresEntryModerationRepository implements EntryModerationRepository {
    private final EntityManager em;
    private final ChallengeSettlement settlement;
    private final TransactionTemplate transaction;

    PostgresEntryModerationRepository(EntityManager em, ChallengeSettlement settlement, PlatformTransactionManager transactions) {
        this.em = em; this.settlement = settlement;
        this.transaction = new TransactionTemplate(transactions);
    }

    @Override
    public Job claim(int maxAttempts, Instant now) {
        return transaction.execute(tx -> {
            var stale = NativeTuples.list(em.createNativeQuery("""
                    SELECT id,challenge_id FROM challenge_entries
                    WHERE moderation_status='pending' AND moderation_attempts>=:max AND status<>'deleted'
                    ORDER BY created_at,id LIMIT 20 FOR UPDATE SKIP LOCKED
                    """, Tuple.class).setParameter("max", maxAttempts));
            for (Tuple row : stale) closeFailed(row.get("id", UUID.class), now);
            var rows = NativeTuples.list(em.createNativeQuery("""
                    WITH next AS (
                        SELECT e.id FROM challenge_entries e
                        JOIN users u ON u.id=e.user_id
                        JOIN videos v ON v.id=e.video_id
                        WHERE e.moderation_status='pending' AND e.moderation_attempts<:max AND e.status<>'deleted'
                          AND u.status='active' AND v.purged_at IS NULL
                        ORDER BY e.created_at,e.id
                        LIMIT 1
                        FOR UPDATE OF e SKIP LOCKED
                    ), claimed AS (
                        UPDATE challenge_entries SET moderation_attempts=moderation_attempts+1
                        FROM next WHERE challenge_entries.id=next.id
                        RETURNING challenge_entries.id,challenge_entries.challenge_id,challenge_entries.video_id,
                                  challenge_entries.moderation_attempts,challenge_entries.content_version,challenge_entries.caption
                    )
                    SELECT c.id,c.moderation_attempts,c.content_version,c.caption,ch.line,
                           v.object_key,v.content_type,v.duration_ms
                    FROM claimed c JOIN videos v ON v.id=c.video_id JOIN challenges ch ON ch.id=c.challenge_id
                    """, Tuple.class).setParameter("max", maxAttempts));
            if (rows.isEmpty()) return null;
            Tuple row = rows.getFirst();
            Number duration = (Number) row.get("duration_ms");
            return new Job(row.get("id", UUID.class), ((Number) row.get("moderation_attempts")).intValue(),
                    ((Number) row.get("content_version")).intValue(),
                    new Video(row.get("object_key", String.class), row.get("content_type", String.class),
                            duration == null ? 0 : duration.intValue()),
                    row.get("line", String.class), row.get("caption", String.class));
        });
    }

    @Override
    public void judged(Job job, EntryModerationVerdict verdict, String model, Instant now) {
        transaction.executeWithoutResult(tx -> {
            Tuple entry = lockCurrent(job, now);
            if (entry == null) return;
            String status = switch (verdict.decision()) {
                case PASS -> "passed";
                case HIDE -> "flagged";
                case REVIEW -> "review";
            };
            em.createNativeQuery("""
                    UPDATE challenge_entries SET moderation_status=:status,moderation_model=:model,moderated_at=:now
                    WHERE id=:id
                    """).setParameter("status", status).setParameter("model", model)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", job.entryId()).executeUpdate();
            if (verdict.decision() == Decision.PASS) return;
            if (verdict.decision() == Decision.HIDE) {
                em.createNativeQuery("""
                        UPDATE challenge_entries SET status='hidden_by_report',updated_at=:now WHERE id=:id AND status='visible'
                        """).setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", job.entryId()).executeUpdate();
            }
            report(job.entryId(), verdict.reportReason(), verdict.reportNote(), entry, now);
        });
    }

    @Override
    public void fail(Job job, Instant now) {
        transaction.executeWithoutResult(tx -> {
            if (lockCurrent(job, now) != null) closeFailed(job.entryId(), now);
        });
    }

    /** 집은 그대로(검사 차례·같은 시도·같은 내용)인 참여작을 잠근다. 아니면 {@code null}. */
    private Tuple lockCurrent(Job job, Instant now) {
        var parent = NativeTuples.list(em.createNativeQuery("SELECT challenge_id FROM challenge_entries WHERE id=:id", Tuple.class)
                .setParameter("id", job.entryId()));
        if (parent.isEmpty()) return null;
        // 신고와 같은 순서로 잠근다 — 마감 집계가 먼저다.
        settlement.aggregateIfDue(parent.getFirst().get("challenge_id", UUID.class), now);
        var rows = NativeTuples.list(em.createNativeQuery("""
                SELECT moderation_status,moderation_attempts,content_version,caption,status FROM challenge_entries
                WHERE id=:id FOR UPDATE
                """, Tuple.class).setParameter("id", job.entryId()));
        if (rows.isEmpty()) return null;
        Tuple row = rows.getFirst();
        if (!"pending".equals(row.get("moderation_status", String.class))
                || ((Number) row.get("moderation_attempts")).intValue() != job.attempts()
                || ((Number) row.get("content_version")).intValue() != job.contentVersion()
                || "deleted".equals(row.get("status", String.class))) return null;
        return row;
    }

    /** 잠근 참여작을 실패로 닫고 운영 확인으로 올린다. 영상은 보이게 둔다. */
    private void closeFailed(UUID entryId, Instant now) {
        em.createNativeQuery("UPDATE challenge_entries SET moderation_status='failed',moderated_at=:now WHERE id=:id")
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", entryId).executeUpdate();
        var row = NativeTuples.list(em.createNativeQuery("SELECT content_version,caption FROM challenge_entries WHERE id=:id",
                Tuple.class).setParameter("id", entryId)).getFirst();
        report(entryId, "other", EntryModerationVerdict.failureNote(), row, now);
    }

    private void report(UUID entryId, String reason, String note, Tuple entry, Instant now) {
        int version = ((Number) entry.get("content_version")).intValue();
        UUID requestId = UUID.randomUUID();
        em.createNativeQuery("""
                INSERT INTO entry_reports(id,target_type,target_id,reporter_id,source,reason,note,status,target_version,target_text,
                    request_id,request_fingerprint,created_at)
                VALUES (:id,'entry',:target,NULL,'ai',:reason,:note,'received',:version,:text,:request,:fingerprint,:now)
                """).setParameter("id", UUID.randomUUID()).setParameter("target", entryId).setParameter("reason", reason)
                .setParameter("note", note).setParameter("version", version).setParameter("text", entry.get("caption", String.class))
                .setParameter("request", requestId)
                .setParameter("fingerprint", Hashing.sha256Hex(String.join("|", List.of("ai_moderation", entryId.toString(),
                        String.valueOf(version), requestId.toString())).getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
    }
}
