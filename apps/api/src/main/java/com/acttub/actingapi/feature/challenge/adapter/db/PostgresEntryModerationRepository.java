package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Video;
import com.acttub.actingapi.feature.challenge.app.EntryModerationRepository;
import com.acttub.actingapi.feature.challenge.app.EntryModerationVerdict;
import com.acttub.actingapi.feature.challenge.app.EntryModerationVerdict.Decision;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.ChallengeEntryStatus;
import com.acttub.actingapi.platform.schema.EntryReportReason;
import com.acttub.actingapi.platform.schema.EntryReportStatus;
import com.acttub.actingapi.platform.schema.EntryReportTarget;
import com.acttub.actingapi.platform.web.Hashing;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 공개 참여작 AI 검사의 장부 (SOMA-907). 숨김·확인 필요·실패는 신고 목록에 사람이 아닌 신고(source='ai')로 남긴다 —
 * 운영은 사람 신고와 같은 화면에서 풀기·유지를 정한다.
 */
@Repository
class PostgresEntryModerationRepository implements EntryModerationRepository {
    private static final EntryReportReason.JpaConverter REASONS = new EntryReportReason.JpaConverter();
    private final EntityManager em;
    private final ChallengeEntryJpaRepository entries;
    private final EntryReportJpaRepository reports;
    private final ChallengeSettlement settlement;
    private final TransactionTemplate transaction;

    PostgresEntryModerationRepository(EntityManager em, ChallengeEntryJpaRepository entries, EntryReportJpaRepository reports,
                                      ChallengeSettlement settlement, PlatformTransactionManager transactions) {
        this.em = em; this.entries = entries; this.reports = reports; this.settlement = settlement;
        this.transaction = new TransactionTemplate(transactions);
    }

    @Override
    public Job claim(int maxAttempts, Instant now) {
        return transaction.execute(tx -> {
            for (UUID stale : entries.lockExhaustedModeration(maxAttempts, Limit.of(20))) closeFailed(stale, now);
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
            ChallengeEntryJpaRepository.ModerationState entry = lockCurrent(job, now);
            if (entry == null) return;
            String status = switch (verdict.decision()) {
                case PASS -> "passed";
                case HIDE -> "flagged";
                case REVIEW -> "review";
            };
            // 모델이 얼굴 여부를 답하지 않으면(null) 이미 아는 값을 지우지 않는다.
            entries.judge(job.entryId(), status, model, now, verdict.face());
            if (verdict.decision() == Decision.PASS) return;
            if (verdict.decision() == Decision.HIDE) entries.hideByReport(job.entryId(), now);
            report(job.entryId(), verdict.reportReason(), verdict.reportNote(), entry.contentVersion(), entry.caption(), now);
        });
    }

    @Override
    public void fail(Job job, Instant now) {
        transaction.executeWithoutResult(tx -> {
            if (lockCurrent(job, now) != null) closeFailed(job.entryId(), now);
        });
    }

    @Override
    public List<FaceJob> claimFaces(int limit, int maxAttempts) {
        return transaction.execute(tx -> NativeTuples.list(em.createNativeQuery("""
                WITH next AS (
                    SELECT e.id %s
                    WHERE %s AND e.face_visible IS NULL AND e.face_attempts<:max
                      AND e.moderation_status IS NOT NULL AND e.moderation_status<>'pending'
                    ORDER BY e.created_at,e.id
                    LIMIT :limit
                    FOR UPDATE OF e SKIP LOCKED
                ), claimed AS (
                    UPDATE challenge_entries SET face_attempts=face_attempts+1
                    FROM next WHERE challenge_entries.id=next.id
                    RETURNING challenge_entries.id,challenge_entries.video_id,challenge_entries.created_at
                )
                SELECT c.id,v.object_key,v.content_type,v.duration_ms
                FROM claimed c JOIN videos v ON v.id=c.video_id
                ORDER BY c.created_at,c.id
                """.formatted(ChallengeVisibility.ENTRY_FROM, ChallengeVisibility.PUBLIC_ENTRY), Tuple.class)
                .setParameter("max", maxAttempts).setParameter("limit", limit)).stream().map(row -> {
                    Number duration = (Number) row.get("duration_ms");
                    return new FaceJob(row.get("id", UUID.class), new Video(row.get("object_key", String.class),
                            row.get("content_type", String.class), duration == null ? 0 : duration.intValue()));
                }).toList());
    }

    @Override
    public void faceSeen(UUID entryId, boolean face) {
        transaction.executeWithoutResult(tx -> entries.fillFace(entryId, face));
    }

    /** 집은 그대로(검사 차례·같은 시도·같은 내용)인 참여작을 잠근다. 아니면 {@code null}. */
    private ChallengeEntryJpaRepository.ModerationState lockCurrent(Job job, Instant now) {
        var parent = entries.findChallengeId(job.entryId());
        if (parent.isEmpty()) return null;
        // 신고와 같은 순서로 잠근다 — 마감 집계가 먼저다.
        settlement.aggregateIfDue(parent.get(), now);
        var locked = entries.lockModeration(job.entryId());
        if (locked.isEmpty()) return null;
        var row = locked.get();
        if (!"pending".equals(row.moderationStatus()) || row.moderationAttempts() != job.attempts()
                || row.contentVersion() != job.contentVersion() || row.status() == ChallengeEntryStatus.DELETED) return null;
        return row;
    }

    /** 잠근 참여작을 실패로 닫고 운영 확인으로 올린다. 영상은 보이게 둔다. */
    private void closeFailed(UUID entryId, Instant now) {
        entries.failModeration(entryId, now);
        var row = entries.findContent(entryId).orElseThrow();
        report(entryId, "other", EntryModerationVerdict.failureNote(), row.contentVersion(), row.caption(), now);
    }

    private void report(UUID entryId, String reason, String note, int version, String caption, Instant now) {
        UUID requestId = UUID.randomUUID();
        reports.insert(UUID.randomUUID(), EntryReportTarget.ENTRY, entryId, null, "ai", REASONS.convertToEntityAttribute(reason), note,
                EntryReportStatus.RECEIVED, version, caption, requestId,
                Hashing.sha256Hex(String.join("|", List.of("ai_moderation", entryId.toString(), String.valueOf(version),
                        requestId.toString())).getBytes(java.nio.charset.StandardCharsets.UTF_8)), now);
    }
}
