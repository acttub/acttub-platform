package com.acttub.actingapi.feature.analysis.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.analysis.app.AnalysisContext;
import com.acttub.actingapi.feature.analysis.app.AnalysisResult;
import com.acttub.actingapi.feature.analysis.app.PracticeAnalysisStore;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 1.0.0 회차의 분석 저장소 — 큐는 {@code ai_jobs}, 결과는 {@code analyses}·{@code video_transcripts} 다.
 *
 * <p><b>완료는 한 트랜잭션이고 그 안에서 주인과 계정 상태를 다시 본다</b>(02-practice 「연습 자료의 이관·삭제·
 * 탈퇴」). 이관이 먼저 끝났으면 회차의 주인이 이미 회원이라 결과는 회원의 것이 되고, 탈퇴가 먼저 끝났으면
 * 결과를 저장하지 않고 작업을 {@code account_deactivated} 로 닫는다. lease 는 {@link AiJobLedger} 가 본다 —
 * 다른 워커가 재선점했으면 완료가 거절되고 이 트랜잭션은 통째로 되돌아간다(CONTRACT §5-7).
 *
 * <p><b>결과는 완료 뒤 불변이다.</b> 같은 회차에 두 번째 분석이 끝나도 기록을 덮지 않는다({@code ON CONFLICT
 * DO NOTHING}) — 워커 재시도가 기록의 내용이나 판을 바꾸지 않는다.
 *
 * <p><b>받아쓰기는 영상 단위다.</b> 영상당 묶음 하나이고 같은 영상의 다음 회차는 새로 만들지 않는다.
 */
@Repository
class PostgresPracticeAnalysisStore implements PracticeAnalysisStore {
    private static final ObjectMapper JSON = new ObjectMapper();

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final AiJobLedger jobs;

    PostgresPracticeAnalysisStore(
            EntityManager entityManager, PlatformTransactionManager transactionManager, AiJobLedger jobs) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.jobs = jobs;
    }

    /** 이 원장에는 작업별 계측 범위를 두지 않는다 — 옛 원장의 모니터링 스키마에 매여 있다. */
    @Override
    public ExternalOperationExecution execution(UUID jobId, UUID leaseToken) {
        return ExternalOperationExecution.unobserved();
    }

    @Override
    public UUID claimNext(UUID leaseToken, Duration leaseDuration, Instant now) {
        AiJobLedger.Claimed claimed = jobs.claimNext("analyze", leaseToken, leaseDuration, now);
        return claimed == null ? null : claimed.id();
    }

    /**
     * 분석이 바깥 호출을 시작하기 전에 읽는 입력. 영상의 검증값({@code etag})은 보관함이 확정 때 적어 둔 것이라
     * 예약 장부에서 가져온다 — 없으면(직접 심은 영상) 워커가 견주지 않는다.
     */
    @Override
    public AnalysisContext getContext(UUID jobId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT j.user_id,p.id AS practice_id,v.object_key,v.content_type,v.duration_ms,
                       p.situation,p.character_context,p.goal,p.blockage_kind,p.blockage_detail,
                       p.experience_version,
                       (SELECT etag FROM upload_intents u WHERE u.video_id=v.id ORDER BY finalized_at DESC LIMIT 1) AS etag
                FROM ai_jobs j
                JOIN practices p ON p.id=j.target_id
                JOIN videos v ON v.id=p.video_id
                WHERE j.id=:jobId
                  AND j.kind='analyze'
                """, Tuple.class)
                .setParameter("jobId", jobId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new AnalysisContext(
                jobId,
                row.get("practice_id", UUID.class),
                row.get("object_key", String.class),
                row.get("content_type", String.class),
                row.get("etag", String.class),
                row.get("duration_ms", Integer.class),
                row.get("situation", String.class),
                row.get("character_context", String.class),
                row.get("goal", String.class),
                row.get("blockage_kind", String.class),
                row.get("blockage_detail", String.class),
                row.get("experience_version", String.class),
                row.get("user_id", UUID.class));
    }

    @Override
    public UUID complete(UUID jobId, UUID leaseToken, AnalysisResult result, String model, Instant now) {
        return transaction.execute(tx -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    SELECT p.id AS practice_id,p.user_id,p.video_id,p.experience_version,u.status
                    FROM ai_jobs j
                    JOIN practices p ON p.id=j.target_id
                    JOIN users u ON u.id=p.user_id
                    WHERE j.id=:jobId
                    FOR UPDATE OF p
                    """, Tuple.class)
                    .setParameter("jobId", jobId));
            if (rows.isEmpty()) {
                throw new IllegalStateException("ai job not found: " + jobId);
            }
            Tuple row = rows.getFirst();
            // 탈퇴가 먼저 끝났으면 결과를 저장하지 않고 작업만 닫는다 — 닫힌 계정에 분석이 남지 않는다.
            if (!"active".equals(row.get("status", String.class))) {
                jobs.fail(jobId, leaseToken, "account_deactivated", now);
                return null;
            }
            UUID practiceId = row.get("practice_id", UUID.class);
            UUID videoId = row.get("video_id", UUID.class);
            boolean fullRecord = result.videoRecord() != null;
            UUID analysisId = fullRecord
                    ? UUID.fromString(result.videoRecord().path("record_id").asText())
                    : UUID.randomUUID();
            JsonNode record = fullRecord ? result.videoRecord() : JSON.valueToTree(result.observationPack());
            // 못 본 구간이 있으면 partial 이다 — 채우지 않는다.
            boolean partial = result.observationPack() != null && !result.observationPack().uncertainties().isEmpty();
            entityManager.createNativeQuery("""
                    INSERT INTO analyses(id,practice_id,format,status,model,record,created_at,completed_at)
                    VALUES (:id,:practiceId,:format,:status,:model,CAST(:record AS jsonb),:now,:now)
                    ON CONFLICT (practice_id) DO NOTHING
                    """)
                    .setParameter("id", analysisId)
                    .setParameter("practiceId", practiceId)
                    .setParameter("format", fullRecord ? "video_record_v1" : "legacy")
                    .setParameter("status", partial ? "partial" : "ready")
                    .setParameter("model", model)
                    .setParameter("record", json(record))
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            storeTranscript(videoId, result, now);
            // 분석 결과가 저장되면 대화로 넘어간다. 이미 닫힌 회차(취소·이관)는 되살리지 않는다.
            entityManager.createNativeQuery("""
                    UPDATE practices
                    SET stage='conversing',updated_at=:now
                    WHERE id=:practiceId
                      AND stage='analyzing'
                    """)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("practiceId", practiceId)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE videos
                    SET duration_ms=:durationMs,updated_at=:now
                    WHERE id=:videoId
                      AND duration_ms=0
                    """)
                    .setParameter("durationMs", result.durationMs())
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("videoId", videoId)
                    .executeUpdate();
            jobs.succeed(jobId, leaseToken, now);
            return analysisId;
        });
    }

    /**
     * 받아쓰기 묶음은 <b>영상당 하나</b>다. 같은 영상의 다음 회차가 분석돼도 새로 만들지 않고, 먼저 만든 묶음이
     * 그대로 재사용된다({@code uq_video_transcripts_video} 가 그것을 보장한다).
     */
    private void storeTranscript(UUID videoId, AnalysisResult result, Instant now) {
        if (result.observationPack() == null || result.observationPack().speech() == null) {
            return;
        }
        entityManager.createNativeQuery("""
                INSERT INTO video_transcripts(id,video_id,status,source,segments,created_at,updated_at,completed_at)
                VALUES (:id,:videoId,'ready',:source,CAST(:segments AS jsonb),:now,:now,:now)
                ON CONFLICT (video_id) DO NOTHING
                """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("videoId", videoId)
                .setParameter("source", "stt")
                .setParameter("segments", json(JSON.valueToTree(result.observationPack().speech())))
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate();
    }

    @Override
    public boolean fail(UUID jobId, UUID leaseToken, String errorCode, String classification, Instant now) {
        boolean closed = jobs.fail(jobId, leaseToken, errorCode, now);
        if (closed) {
            closePractice(jobId, now);
        }
        return closed;
    }

    @Override
    public boolean fail(UUID jobId, UUID leaseToken, String errorCode, Instant now) {
        return fail(jobId, leaseToken, errorCode, null, now);
    }

    @Override
    public void release(UUID jobId, UUID leaseToken, String classification, Instant now) {
        jobs.release(jobId, leaseToken, classification, now);
    }

    @Override
    public void release(UUID jobId, UUID leaseToken, Instant now) {
        release(jobId, leaseToken, null, now);
    }

    /** 만료된 미확정 업로드는 보관함(PA1)의 일이다 — 이 워커는 치우지 않는다. */
    @Override
    public List<String> sweepExpiredUploads(Instant now) {
        return List.of();
    }

    /** 시도를 소진한 작업을 닫고, 그 회차도 함께 닫는다(분석이 없으면 배우에게 보여 줄 것이 없다). */
    @Override
    public int sweepMaxAttempts(Instant now) {
        List<Tuple> exhausted = list(entityManager.createNativeQuery("""
                SELECT id FROM ai_jobs
                WHERE kind='analyze' AND status='pending' AND attempt_count>=:maxAttempts
                """, Tuple.class)
                .setParameter("maxAttempts", AiJobLedger.MAX_ATTEMPTS));
        int swept = jobs.sweepMaxAttempts(now);
        for (Tuple row : exhausted) {
            closePractice(row.get("id", UUID.class), now);
        }
        return swept;
    }

    /** 분석이 최종 실패한 회차는 닫힌다. 배우가 명시적으로 다시 시도하면 PA2 의 재시도가 되살린다. */
    private void closePractice(UUID jobId, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE practices
                SET stage='closed',close_reason='analysis_failed',updated_at=:now
                WHERE id=(SELECT target_id FROM ai_jobs WHERE id=:jobId)
                  AND stage='analyzing'
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("jobId", jobId)
                .executeUpdate());
    }

    private static String json(JsonNode value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (Exception failure) {
            throw new IllegalStateException("failed to write analysis json", failure);
        }
    }
}
