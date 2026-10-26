package com.acttub.actingapi.feature.reading.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptImportRepository;
import com.acttub.actingapi.feature.reading.app.ScriptRepository;
import com.acttub.actingapi.feature.reading.app.ScriptUploadRepository;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptFileRules;
import com.acttub.actingapi.feature.reading.domain.ScriptRules;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 나누기 요청의 Postgres 구현 (V33 {@code script_imports}). 접수는 대본 등록처럼 {@code users} 행을 {@code FOR UPDATE} 로 잡은
 * 채 하므로 같은 회원의 요청이 겹쳐도 하루 한도·대본 수 한도가 정확하다(CONTRACT §6-14). 대본 저장은 {@link ScriptRepository}
 * 를 그대로 쓴다 — 저장 규칙이 두 벌이 되지 않게.
 */
@Repository
class PostgresScriptImportRepository implements ScriptImportRepository {
    private static final String KIND = com.acttub.actingapi.platform.schema.AiJobKind.SCRIPT_SPLIT.dbValue();
    /** 하루 한도의 날짜 경계는 한국 자정이다(고품질 목소리·챌린지 리포트와 같다). */
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private final EntityManager em;
    private final TransactionTemplate transaction;
    private final ScriptRepository scripts;
    private final ScriptUploadRepository uploads;
    private final AiJobLedger ledger;

    PostgresScriptImportRepository(EntityManager em, PlatformTransactionManager manager, ScriptRepository scripts,
            ScriptUploadRepository uploads, AiJobLedger ledger) {
        this.em = em;
        this.transaction = new TransactionTemplate(manager);
        this.scripts = scripts;
        this.uploads = uploads;
        this.ledger = ledger;
    }

    /**
     * 그 사용자의 {@code script_split} 현재 판(한국어 행이 신원) 마지막 결정을 내는 SQL 식. 문서가 없거나 결정이 없으면 NULL 이다.
     * 나누기 접수와 실패 원본 보관의 시작이 같은 판을 보게 한 곳에 둔다.
     */
    static String splitDecision(String userColumn) {
        return """
                (CASE WHEN %s THEN 'granted' ELSE
                (SELECT c.action FROM user_consents c
                 WHERE c.user_id=%s
                   AND c.document_id=(SELECT d.id FROM consent_documents d WHERE d.type='script_split' AND d.locale='ko'
                                      ORDER BY d.published_at DESC,d.id DESC LIMIT 1)
                 ORDER BY c.occurred_at DESC,c.id DESC LIMIT 1) END)""".formatted(privacyCoversReading(userColumn), userColumn);
    }

    /** 개인정보 수집·이용 동의가 대본 리딩의 AI 처리(대본 나누기·고품질 목소리)를 품기 시작한 판. */
    static final int PRIVACY_COVERS_READING_FROM = 9;

    /**
     * 그 사용자가 개인정보 수집·이용 동의 v9 이상에 동의한 상태인지 내는 SQL 불 식. v9 부터 「대본 나누기」와 「대본 리딩
     * 고품질 목소리」를 그 동의에 합쳤으므로(SOMA-726), 이 식이 참이면 두 처리의 동의가 있는 것으로 본다. 판마다 그 판에 대한
     * 마지막 행위가 동의(granted)인지 본다 — 탈퇴 뒤 운영자가 남기는 철회는 동의로 치지 않는다.
     */
    static String privacyCoversReading(String userColumn) {
        return """
                EXISTS (SELECT 1 FROM consent_documents pd
                        WHERE pd.type='privacy'
                          AND (CASE WHEN pd.version ~ '^v[0-9]+$' THEN CAST(substring(pd.version FROM 2) AS integer) ELSE 0 END) >= %d
                          AND (SELECT pc.action FROM user_consents pc
                               WHERE pc.user_id=%s AND pc.document_id=pd.id
                               ORDER BY pc.occurred_at DESC,pc.id DESC LIMIT 1)='granted')""".formatted(PRIVACY_COVERS_READING_FROM, userColumn);
    }

    /**
     * 판과 상관없이 그 사용자의 가장 최근 {@code script_split} 결정을 내는 SQL 식. 보관 중인 실패 원본은 이것이 granted 가 아닐 때
     * (동의를 거뒀을 때) 지운다 — 새 판을 냈다고 아직 결정하지 않은 사람의 보관 원본까지 지우지 않게.
     */
    static String latestSplitDecision(String userColumn) {
        return """
                (CASE WHEN %s THEN 'granted' ELSE
                (SELECT c.action FROM user_consents c JOIN consent_documents d ON d.id=c.document_id
                 WHERE c.user_id=%s AND d.type='script_split'
                 ORDER BY c.occurred_at DESC,c.id DESC LIMIT 1) END)""".formatted(privacyCoversReading(userColumn), userColumn);
    }

    @Override
    public String consent(UUID userId) {
        String action = list(em.createNativeQuery("SELECT " + splitDecision(":userId") + " AS action", Tuple.class)
                .setParameter("userId", userId)).getFirst().get("action", String.class);
        if (action == null) return "undecided";
        return "granted".equals(action) ? "granted" : "denied";
    }

    @Override
    public Requested request(UUID userId, UUID requestId, String fingerprint, Submission submission, ScriptDraft sample,
            int scriptLimit, int dailyLimit, Instant now) {
        return transaction.execute(status -> {
            lockActive(userId);
            var replay = list(em.createNativeQuery(
                    "SELECT id,request_fingerprint FROM script_imports WHERE user_id=:userId AND request_id=:requestId", Tuple.class)
                    .setParameter("userId", userId).setParameter("requestId", requestId));
            if (!replay.isEmpty()) {
                Tuple row = replay.getFirst();
                return fingerprint.equals(row.get("request_fingerprint", String.class).strip())
                        ? new Requested(row.get("id", UUID.class), null, Outcome.REPLAYED)
                        : new Requested(null, null, Outcome.FINGERPRINT_MISMATCH);
            }
            if (!submission.allowDuplicate()) {
                var duplicate = list(em.createNativeQuery(
                        "SELECT id FROM scripts WHERE user_id=:userId AND raw_hash=:hash ORDER BY created_at,id LIMIT 1", Tuple.class)
                        .setParameter("userId", userId).setParameter("hash", submission.rawHash()));
                if (!duplicate.isEmpty()) {
                    return new Requested(null, duplicate.getFirst().get("id", UUID.class), Outcome.DUPLICATE);
                }
                var inFlight = list(em.createNativeQuery("""
                        SELECT i.id FROM script_imports i JOIN ai_jobs j ON j.id=i.job_id
                        WHERE i.user_id=:userId AND i.raw_hash=:hash AND i.script_id IS NULL AND i.failure IS NULL
                          AND j.status IN ('pending','running')
                        ORDER BY i.created_at,i.id LIMIT 1
                        """, Tuple.class).setParameter("userId", userId).setParameter("hash", submission.rawHash()));
                if (!inFlight.isEmpty()) {
                    return new Requested(inFlight.getFirst().get("id", UUID.class), null, Outcome.IN_FLIGHT);
                }
            }
            long owned = ((Number) em.createNativeQuery("SELECT count(*) FROM scripts WHERE user_id=:userId")
                    .setParameter("userId", userId).getSingleResult()).longValue();
            if (owned >= scriptLimit) {
                return new Requested(null, null, Outcome.OVER_SCRIPT_LIMIT);
            }
            UUID importId = UUID.randomUUID();
            UUID jobId = null;
            UUID scriptId = null;
            int lines = 0;
            if (sample != null) {
                ScriptRepository.Creation created = scripts.create(userId, requestId, fingerprint, sample, scriptLimit);
                if (created.outcome() == ScriptRepository.Outcome.OVER_LIMIT) {
                    return new Requested(null, null, Outcome.OVER_SCRIPT_LIMIT);
                }
                scriptId = created.scriptId();
                lines = sample.lines().size();
            } else {
                long today = ((Number) em.createNativeQuery(
                        "SELECT count(*) FROM ai_jobs WHERE user_id=:userId AND kind=:kind AND created_at>=:since")
                        .setParameter("userId", userId).setParameter("kind", KIND)
                        .setParameter("since", now.atZone(SEOUL).toLocalDate().atStartOfDay(SEOUL).toOffsetDateTime()).getSingleResult()).longValue();
                if (today >= dailyLimit) {
                    return new Requested(null, null, Outcome.OVER_DAILY_LIMIT);
                }
                jobId = UUID.randomUUID();
                em.createNativeQuery("""
                        INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,attempt_count,created_at,updated_at)
                        VALUES (:id,:userId,:kind,:target,:requestId,:fingerprint,'pending',0,:now,:now)
                        """).setParameter("id", jobId).setParameter("userId", userId).setParameter("kind", KIND)
                        .setParameter("target", importId).setParameter("requestId", requestId).setParameter("fingerprint", fingerprint)
                        .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
            }
            em.createNativeQuery("""
                    INSERT INTO script_imports(id,user_id,request_id,request_fingerprint,title,source,raw_text,raw_hash,job_id,script_id,
                                               skip_script_check,upload_id,done_lines,total_lines,created_at,updated_at)
                    VALUES (:id,:userId,:requestId,:fingerprint,:title,:source,:rawText,:hash,:jobId,:scriptId,:skip,:uploadId,:lines,:lines,:now,:now)
                    """).setParameter("id", importId).setParameter("skip", submission.skipScriptCheck()).setParameter("userId", userId).setParameter("requestId", requestId)
                    .setParameter("uploadId", submission.uploadId())
                    .setParameter("fingerprint", fingerprint).setParameter("title", submission.title())
                    .setParameter("source", submission.source()).setParameter("rawText", submission.rawText())
                    .setParameter("hash", submission.rawHash()).setParameter("jobId", jobId).setParameter("scriptId", scriptId)
                    .setParameter("lines", lines).setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
            if (scriptId != null) linkUpload(importId, scriptId, now);
            return new Requested(importId, null, Outcome.ACCEPTED);
        });
    }

    @Override
    public ImportView find(UUID userId, UUID importId) {
        var rows = list(em.createNativeQuery("""
                SELECT i.id,i.done_lines,i.total_lines,i.script_id,i.failure,j.status AS job_status
                FROM script_imports i LEFT JOIN ai_jobs j ON j.id=i.job_id
                WHERE i.id=:id AND i.user_id=:userId
                """, Tuple.class).setParameter("id", importId).setParameter("userId", userId));
        if (rows.isEmpty()) return null;
        Tuple row = rows.getFirst();
        UUID scriptId = row.get("script_id", UUID.class);
        String failure = row.get("failure", String.class);
        String jobStatus = row.get("job_status", String.class);
        String status;
        if (scriptId != null) {
            status = "succeeded";
        } else if (failure != null || "failed".equals(jobStatus)) {
            // 장부만 닫힌 작업(계정 탈퇴·시도 소진)은 이유 없이 실패한 것으로 보인다.
            status = "failed";
            failure = failure == null ? ScriptImportFailure.FAILED.dbValue() : failure;
        } else {
            status = "running".equals(jobStatus) ? "running" : "pending";
        }
        return new ImportView(row.get("id", UUID.class), status, ((Number) row.get("done_lines")).intValue(),
                ((Number) row.get("total_lines")).intValue(), scriptId, failure == null ? null : failureOf(failure));
    }

    @Override
    public Material material(UUID jobId, UUID importId) {
        var rows = list(em.createNativeQuery("""
                SELECT i.user_id,i.request_id,i.request_fingerprint,i.title,i.raw_text,i.source,i.skip_script_check,su.file_name,
                       NOT EXISTS (SELECT 1 FROM user_identities WHERE user_id=i.user_id AND provider<>'guest') AS guest
                FROM script_imports i JOIN users u ON u.id=i.user_id
                LEFT JOIN script_uploads su ON su.id=i.upload_id AND su.user_id=i.user_id
                WHERE i.id=:id AND i.job_id=:job AND i.script_id IS NULL AND i.failure IS NULL AND u.status='active'
                """, Tuple.class).setParameter("id", importId).setParameter("job", jobId));
        if (rows.isEmpty()) return null;
        Tuple row = rows.getFirst();
        return new Material(row.get("user_id", UUID.class), row.get("guest", Boolean.class), row.get("request_id", UUID.class),
                row.get("request_fingerprint", String.class).strip(), row.get("title", String.class),
                row.get("raw_text", String.class), row.get("source", String.class), row.get("skip_script_check", Boolean.class), row.get("file_name", String.class));
    }

    @Override
    public void progress(UUID importId, int doneLines, int totalLines) {
        transaction.executeWithoutResult(status -> em.createNativeQuery("""
                UPDATE script_imports SET done_lines=:done,total_lines=:total,updated_at=now()
                WHERE id=:id AND script_id IS NULL AND failure IS NULL
                """).setParameter("done", doneLines).setParameter("total", totalLines).setParameter("id", importId).executeUpdate());
    }

    @Override
    public Completion complete(UUID jobId, UUID leaseToken, UUID importId, ScriptDraft draft, Instant now) {
        return transaction.execute(status -> {
            Material material = material(jobId, importId);
            if (material == null) {
                ledger.fail(jobId, leaseToken, "cancelled", now);
                return Completion.CANCELLED;
            }
            ScriptRepository.Creation created;
            try {
                created = scripts.create(material.userId(), material.requestId(), material.fingerprint(), draft,
                        ScriptRules.scriptLimit(material.guest()));
            } catch (ScriptRepository.OwnerNotActive closed) {
                ledger.fail(jobId, leaseToken, "cancelled", now);
                return Completion.CANCELLED;
            }
            if (created.outcome() == ScriptRepository.Outcome.OVER_LIMIT) {
                return Completion.SCRIPT_LIMIT;
            }
            if (created.outcome() == ScriptRepository.Outcome.FINGERPRINT_MISMATCH) {
                return Completion.FINGERPRINT_MISMATCH;
            }
            em.createNativeQuery("""
                    UPDATE script_imports SET script_id=:scriptId,done_lines=total_lines,raw_text='',updated_at=:now WHERE id=:id
                    """).setParameter("scriptId", created.scriptId()).setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("id", importId).executeUpdate();
            linkUpload(importId, created.scriptId(), now);
            if (!ledger.succeed(jobId, leaseToken, now)) throw new IllegalStateException("script split job was closed: " + jobId);
            return Completion.SAVED;
        });
    }

    @Override
    public void fail(UUID jobId, UUID leaseToken, UUID importId, ScriptImportFailure failure, boolean keepFile, Instant now) {
        transaction.executeWithoutResult(status -> {
            var failed = list(em.createNativeQuery("""
                    WITH failed AS (
                        UPDATE script_imports SET failure=:failure,raw_text='',updated_at=:now WHERE id=:id AND script_id IS NULL
                        RETURNING upload_id
                    )
                    SELECT upload_id FROM failed
                    """, Tuple.class).setParameter("failure", failure.dbValue()).setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("id", importId));
            UUID uploadId = failed.isEmpty() ? null : failed.getFirst().get("upload_id", UUID.class);
            if (uploadId != null && keepFile) {
                uploads.recordFailure(uploadId, failure.dbValue(), now.plus(ScriptFileRules.FAILED_TTL), now);
            }
            ledger.fail(jobId, leaseToken, failure.dbValue(), now);
        });
    }

    /** 원본 파일로 넣은 요청이면 그 파일을 대본에 연결하고 뽑은 글을 비운다 — 글은 대본에 있고 원본은 대본과 함께 지워진다. */
    private void linkUpload(UUID importId, UUID scriptId, Instant now) {
        em.createNativeQuery("""
                UPDATE script_uploads u SET script_id=:scriptId,raw_text=NULL,updated_at=:now
                FROM script_imports i
                WHERE i.id=:importId AND u.id=i.upload_id AND u.script_id IS NULL
                """).setParameter("scriptId", scriptId).setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("importId", importId).executeUpdate();
    }

    @Override
    public int sweepExpired(Instant now) {
        return transaction.execute(status -> {
            List<UUID> closed = ledger.failExpired(KIND, now);
            if (closed.isEmpty()) return 0;
            return em.createNativeQuery("""
                    UPDATE script_imports SET failure='failed',raw_text='',updated_at=:now
                    WHERE job_id IN (:jobs) AND script_id IS NULL AND failure IS NULL
                    """).setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("jobs", closed).executeUpdate();
        });
    }

    private void lockActive(UUID userId) {
        List<Tuple> active = list(em.createNativeQuery(
                "SELECT id FROM users WHERE id=:userId AND status='active' FOR UPDATE", Tuple.class)
                .setParameter("userId", userId));
        if (active.isEmpty()) throw new ScriptRepository.OwnerNotActive();
    }

    private static ScriptImportFailure failureOf(String value) {
        for (ScriptImportFailure failure : ScriptImportFailure.values()) {
            if (failure.dbValue().equals(value)) return failure;
        }
        throw new IllegalStateException("unknown script import failure: " + value);
    }
}
