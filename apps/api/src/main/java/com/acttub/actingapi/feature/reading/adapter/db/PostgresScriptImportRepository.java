package com.acttub.actingapi.feature.reading.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository;
import com.acttub.actingapi.feature.reading.app.ScriptRepository;
import com.acttub.actingapi.feature.reading.app.ScriptUploadRepository;
import com.acttub.actingapi.feature.reading.domain.CharacterTraits;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptFileRules;
import com.acttub.actingapi.feature.reading.domain.ScriptRules;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 나누기 요청의 Postgres 구현 (V33 {@code script_imports}). 접수는 대본 등록처럼 {@code users} 행을 {@code FOR UPDATE} 로 잡은
 * 채 하므로 같은 회원의 요청이 겹쳐도 하루 한도·대본 수 한도가 정확하다(CONTRACT §6-14). 대본 저장은 {@link ScriptRepository}
 * 를 그대로 쓴다 — 저장 규칙이 두 벌이 되지 않게.
 *
 * <p>리딩의 표만 읽고 쓰는 문장은 Spring Data 저장소에 있다. 사람 행의 잠금·손님 판정(auth 의 표), 동의(consent 의 표), 나누기
 * 작업({@code ai_jobs}, platform/operation 의 표)을 읽는 문장은 native SQL 로 둔다(apps/api/CONTRACT.md §5-9). 작업을 넣는 것은
 * {@code AiJobLedger} 가 한다.
 */
@Repository
class PostgresScriptImportRepository implements ScriptImportRepository {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(PostgresScriptImportRepository.class);
    private static final String KIND = com.acttub.actingapi.platform.schema.AiJobKind.SCRIPT_SPLIT.dbValue();
    /** 하루 한도의 날짜 경계는 한국 자정이다(고품질 목소리·챌린지 리포트와 같다). */
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private final EntityManager em;
    private final TransactionTemplate transaction;
    private final ScriptRepository scripts;
    private final ScriptUploadRepository uploads;
    private final AiJobLedger ledger;
    private final ScriptImportJpaRepository requests;
    private final ScriptJpaRepository scriptRows;
    private final ScriptUploadJpaRepository uploadRows;
    private final ScriptCharacterJpaRepository characterRows;
    private final ScriptLineJpaRepository lineRows;
    private final boolean reuseEnabled;
    private final int reuseMaxAgeDays;

    private final AccountRowLock accountRows;

    PostgresScriptImportRepository(EntityManager em, PlatformTransactionManager manager, ScriptRepository scripts,
            ScriptUploadRepository uploads, AiJobLedger ledger, ScriptImportJpaRepository requests, ScriptJpaRepository scriptRows,
            ScriptUploadJpaRepository uploadRows, ScriptCharacterJpaRepository characterRows, ScriptLineJpaRepository lineRows,
            @org.springframework.beans.factory.annotation.Value("${SCRIPT_SPLIT_REUSE_ENABLED:true}") boolean reuseEnabled,
            @org.springframework.beans.factory.annotation.Value("${SCRIPT_SPLIT_REUSE_MAX_AGE_DAYS:30}") int reuseMaxAgeDays,
            AccountRowLock accountRows) {
        this.accountRows = accountRows;
        this.em = em;
        this.transaction = new TransactionTemplate(manager);
        this.scripts = scripts;
        this.uploads = uploads;
        this.ledger = ledger;
        this.requests = requests;
        this.scriptRows = scriptRows;
        this.uploadRows = uploadRows;
        this.characterRows = characterRows;
        this.lineRows = lineRows;
        this.reuseEnabled = reuseEnabled;
        this.reuseMaxAgeDays = reuseMaxAgeDays;
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
            var replay = requests.byRequest(userId, requestId);
            if (replay.isPresent()) {
                return fingerprint.equals(replay.get().getRequestFingerprint().strip())
                        ? new Requested(replay.get().getId(), null, Outcome.REPLAYED)
                        : new Requested(null, null, Outcome.FINGERPRINT_MISMATCH);
            }
            if (!submission.allowDuplicate()) {
                List<UUID> duplicate = scriptRows.sameText(userId, submission.rawHash(), Limit.of(1));
                if (!duplicate.isEmpty()) {
                    return new Requested(null, duplicate.getFirst(), Outcome.DUPLICATE);
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
            long owned = scriptRows.countOf(userId);
            if (owned >= scriptLimit) {
                return new Requested(null, null, Outcome.OVER_SCRIPT_LIMIT);
            }
            UUID importId = UUID.randomUUID();
            UUID jobId = null;
            UUID scriptId = null;
            int lines = 0;
            boolean reused = false;
            ScriptDraft ready = sample;
            if (ready == null && !submission.allowDuplicate() && reuseEnabled && reuseMaxAgeDays > 0) {
                ready = reusable(submission, userId, now);
                reused = ready != null;
            }
            if (ready != null) {
                ScriptRepository.Creation created = scripts.create(userId, requestId, fingerprint, ready, scriptLimit);
                if (created.outcome() == ScriptRepository.Outcome.OVER_LIMIT) {
                    return new Requested(null, null, Outcome.OVER_SCRIPT_LIMIT);
                }
                scriptId = created.scriptId();
                lines = ready.lines().size();
            } else {
                long today = ((Number) em.createNativeQuery(
                        "SELECT count(*) FROM ai_jobs WHERE user_id=:userId AND kind=:kind AND created_at>=:since")
                        .setParameter("userId", userId).setParameter("kind", KIND)
                        .setParameter("since", now.atZone(SEOUL).toLocalDate().atStartOfDay(SEOUL).toOffsetDateTime()).getSingleResult()).longValue();
                if (today >= dailyLimit) {
                    return new Requested(null, null, Outcome.OVER_DAILY_LIMIT);
                }
                jobId = ledger.enqueue(userId, KIND, importId, requestId, fingerprint, now);
            }
            requests.insert(importId, userId, requestId, fingerprint, submission.title(), submission.source(), submission.rawText(),
                    submission.rawHash(), jobId, scriptId, submission.skipScriptCheck(), submission.uploadId(), lines, now);
            if (scriptId != null) linkUpload(importId, scriptId, now);
            if (reused) {
                LOG.info("script split reused: reused=true importId={} scriptId={} lines={}", importId, scriptId, lines);
                return new Requested(importId, null, Outcome.REUSED);
            }
            return new Requested(importId, null, Outcome.ACCEPTED);
        });
    }

    /**
     * 같은 글(raw_hash)로 서버가 이미 나눠 둔, 아무도 고치지 않은 가장 최근 대본의 구조(배역·줄)를 요청자의 제목·원문으로 새 초안으로 만든다. 없으면 {@code null}.
     *
     * <p>원본 조건: ① {@code script_imports.script_id} 로 이어진 서버 나누기 결과(기기가 보낸 구조·예시 제외) ② {@code updated_at = created_at}
     * — 제목·배역·줄을 고치는 모든 길이 {@code scripts.updated_at} 을 올리고, 만들 때는 한 트랜잭션의 {@code now()} 라 같다. 편집 흔적이 있으면
     * 쓰지 않는다 ③ 나이 상한 이내. 줄·배역만 읽는다 — 메모·회차·녹음·목소리 설정은 만지지 않는다(배역 목소리는 새로 비움).
     */
    private ScriptDraft reusable(Submission submission, UUID userId, Instant now) {
        var origin = scriptRows.reusable(submission.rawHash(), userId, now.minus(java.time.Duration.ofDays(reuseMaxAgeDays)))
                .orElse(null);
        if (origin == null) return null;
        UUID source = origin.getId();
        String fileName = submission.uploadId() == null ? null : uploadRows.fileName(submission.uploadId(), userId).orElse(null);
        String title = com.acttub.actingapi.feature.reading.domain.SplitDraft.reusedTitle(submission.title(),
                origin.getTitle(), origin.getRequestedTitle(), origin.getFileName(), fileName);
        var characters = characterRows.cast(source);
        var lines = lineRows.content(source);
        if (lines.isEmpty()) return null;
        java.util.Map<UUID, Integer> index = new java.util.HashMap<>();
        for (int i = 0; i < characters.size(); i++) index.put(characters.get(i).getId(), i);
        List<String> names = new java.util.ArrayList<>();
        List<CharacterTraits> traits = new java.util.ArrayList<>();
        List<List<Integer>> members = new java.util.ArrayList<>();
        boolean unnamed = false;
        for (var c : characters) {
            names.add(c.getName());
            traits.add(new CharacterTraits(c.getGender(), c.getAgeBand()));
            members.add(c.getMemberIds() == null ? List.of() : java.util.stream.Stream.of(c.getMemberIds()).map(index::get).toList());
            unnamed |= Boolean.TRUE.equals(c.getUnnamed());
        }
        List<ScriptDraft.Line> draftLines = new java.util.ArrayList<>();
        for (var l : lines) {
            draftLines.add(new ScriptDraft.Line(l.getOrdinal(), l.getKind().dbValue(),
                    l.getCharacterId() == null ? null : index.get(l.getCharacterId()), l.getText(), l.getLang(), l.getSpeech()));
        }
        return new ScriptDraft(title, submission.rawText(), submission.source(), names, draftLines, traits, members, unnamed);
    }

    @Override
    public ImportView find(UUID userId, UUID importId) {
        var rows = list(em.createNativeQuery("""
                SELECT i.id,i.done_lines,i.total_lines,i.progress_percent,i.script_id,i.failure,j.status AS job_status
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
        int percent = scriptId != null ? 100 : ((Number) row.get("progress_percent")).intValue();
        return new ImportView(row.get("id", UUID.class), status, ((Number) row.get("done_lines")).intValue(),
                ((Number) row.get("total_lines")).intValue(), percent, scriptId, failure == null ? null : failureOf(failure));
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
        transaction.executeWithoutResult(status -> requests.progress(importId, doneLines, totalLines));
    }

    @Override
    public void percent(UUID importId, int percent) {
        transaction.executeWithoutResult(status -> requests.percent(importId, Math.clamp(percent, 0, 99)));
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
            requests.linkScript(importId, created.scriptId(), now);
            linkUpload(importId, created.scriptId(), now);
            if (!ledger.succeed(jobId, leaseToken, now)) throw new IllegalStateException("script split job was closed: " + jobId);
            return Completion.SAVED;
        });
    }

    @Override
    public void fail(UUID jobId, UUID leaseToken, UUID importId, ScriptImportFailure failure, boolean keepFile, Instant now) {
        transaction.executeWithoutResult(status -> {
            // 조건부 UPDATE 한 문장이 승패를 정하고, 고친 요청의 원본 파일은 같은 트랜잭션에서 다시 읽는다(§5-9).
            UUID uploadId = requests.fail(importId, failure.dbValue(), now) == 1 ? requests.uploadOf(importId).orElse(null) : null;
            if (uploadId != null && keepFile) {
                uploads.recordFailure(uploadId, failure.dbValue(), now.plus(ScriptFileRules.FAILED_TTL), now);
            }
            ledger.fail(jobId, leaseToken, failure.dbValue(), now);
        });
    }

    /** 원본 파일로 넣은 요청이면 그 파일을 대본에 연결하고 뽑은 글을 비운다 — 글은 대본에 있고 원본은 대본과 함께 지워진다. */
    private void linkUpload(UUID importId, UUID scriptId, Instant now) {
        uploadRows.linkToScript(importId, scriptId, now);
    }

    @Override
    public int sweepExpired(Instant now) {
        return transaction.execute(status -> {
            List<UUID> closed = ledger.failExpired(KIND, now);
            if (closed.isEmpty()) return 0;
            return requests.failOfJobs(closed, now);
        });
    }

    private void lockActive(UUID userId) {
        if (!accountRows.lockActive(userId)) throw new ScriptRepository.OwnerNotActive();
    }

    private static ScriptImportFailure failureOf(String value) {
        for (ScriptImportFailure failure : ScriptImportFailure.values()) {
            if (failure.dbValue().equals(value)) return failure;
        }
        throw new IllegalStateException("unknown script import failure: " + value);
    }
}
