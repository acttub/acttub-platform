package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.ScriptImportRepository;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.Completion;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.ImportView;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.Material;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.Outcome;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.Requested;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.Submission;
import com.acttub.actingapi.feature.reading.app.ScriptRepository;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptRules;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 대본 나누기 요청 저장소가 내는 결과·잠금·경합·문장을 고정한다. 접수에서 나누기·실패·다시 쓰기까지의 HTTP 흐름과 모델 호출은
 * {@link ReadingImportIT} 가 본다. 여기서는 저장소 한 번의 부름이 적는 칸 전체, 접수 판정의 순서(재전송 → 같은 글 → 진행 중 →
 * 대본 수 → 하루 한도), 다시 쓰는 대본을 고르는 조건, 진행률이 뒤로 가지 않는 것, 완료·실패가 요청과 원본 파일에 남기는 것,
 * 사람 행의 잠금과 겹친 접수, 요청 하나가 보내는 문장을 본다 — 접수와 상태 읽기는 요청이 많은 경로다. *
 * <p>저장소를 네이티브 SQL 에서 JPA 로 옮길 때 문장 테스트 한 곳만 달라졌다 — 실패를 적는 {@code UPDATE … RETURNING} 을
 * UPDATE 뒤 다시 읽기로 나눠 워커가 실패를 적을 때 문장이 하나 늘었다. 접수·상태 읽기·진행의 문장 수는 그대로이고 결과·잠금·
 * 경합 테스트는 고치지 않았다.
 */
class ScriptImportRepositoryIT extends ReadingRepositoryFixture {

    private static final String HASH = "a".repeat(64);
    private static final String FINGERPRINT = "f".repeat(64);
    private static final Duration LEASE = Duration.ofMinutes(5);

    @Autowired
    ScriptImportRepository imports;

    @Autowired
    AiJobLedger ledger;

    private UUID owner;

    @BeforeEach
    void setUp() {
        owner = member();
    }

    @Test
    @DisplayName("request: 새 글이면 나누기 작업과 요청을 한 쌍으로 넣는다 — 작업은 pending·시도 0 으로 요청을 가리키고, 요청은 넘긴 값과 줄 수 0 으로 작업을 가리킨다. 시각은 마이크로초로 반올림한다")
    void requestAcceptsANewText() {
        UUID request = UUID.randomUUID();
        UUID upload = upload(owner, "scripts/a.pdf", "대본.pdf");

        Requested accepted = imports.request(owner, request, FINGERPRINT,
                new Submission("제목", "원문", HASH, "file", false, true, upload), null, 10, 5, now.plusNanos(123_456_789));

        assertThat(accepted.outcome()).isEqualTo(Outcome.ACCEPTED);
        assertThat(accepted.duplicateScriptId()).isNull();
        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM script_imports WHERE id=?", accepted.importId());
        assertThat(row).containsEntry("user_id", owner).containsEntry("request_id", request)
                .containsEntry("request_fingerprint", FINGERPRINT).containsEntry("title", "제목").containsEntry("source", "file")
                .containsEntry("raw_text", "원문").containsEntry("raw_hash", HASH).containsEntry("script_id", null)
                .containsEntry("failure", null).containsEntry("skip_script_check", true).containsEntry("upload_id", upload)
                .containsEntry("done_lines", 0).containsEntry("total_lines", 0).containsEntry("progress_percent", 0);
        Instant stamp = now.plus(123_457, ChronoUnit.MICROS);
        assertThat(instant("SELECT created_at FROM script_imports")).isEqualTo(stamp);
        assertThat(instant("SELECT updated_at FROM script_imports")).isEqualTo(stamp);
        assertThat(jdbc.queryForMap("SELECT id,user_id,kind,target_id,request_id,request_fingerprint,status,attempt_count FROM ai_jobs"))
                .containsEntry("id", row.get("job_id")).containsEntry("user_id", owner).containsEntry("kind", "script_split")
                .containsEntry("target_id", accepted.importId()).containsEntry("request_id", request)
                .containsEntry("request_fingerprint", FINGERPRINT).containsEntry("status", "pending")
                .containsEntry("attempt_count", 0);
        assertThat(instant("SELECT created_at FROM ai_jobs")).isEqualTo(stamp);
        assertThat(jdbc.queryForObject("SELECT script_id FROM script_uploads WHERE id=?", UUID.class, upload))
                .as("나누기 전에는 원본 파일을 잇지 않는다").isNull();
    }

    @Test
    @DisplayName("request: 같은 요청 id 는 지문이 같으면 REPLAYED 로 그 요청을, 다르면 FINGERPRINT_MISMATCH 를 낸다. 재전송은 다른 판정보다 먼저다")
    void requestReplaysTheSameRequest() {
        UUID request = UUID.randomUUID();
        Requested accepted = imports.request(owner, request, FINGERPRINT, text("원문", HASH), null, 10, 5, now);

        assertThat(imports.request(owner, request, FINGERPRINT, text("원문", HASH), null, 0, 0, now))
                .as("한도가 0 이어도 재전송이 먼저다").isEqualTo(new Requested(accepted.importId(), null, Outcome.REPLAYED));
        assertThat(imports.request(owner, request, "e".repeat(64), text("원문", HASH), null, 10, 5, now))
                .isEqualTo(new Requested(null, null, Outcome.FINGERPRINT_MISMATCH));
        assertThat(count("script_imports")).isEqualTo(1);
        assertThat(count("ai_jobs")).isEqualTo(1);
    }

    @Test
    @DisplayName("request: 같은 글의 내 대본이 있으면 DUPLICATE 로 가장 먼저 만든 대본을, 같은 글이 나누는 중이면 IN_FLIGHT 로 그 요청을 낸다. 겹쳐 올리기를 허락하면 둘 다 건너뛴다")
    void requestFindsTheSameTextFirst() {
        Requested inFlight = imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now);

        assertThat(imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now))
                .isEqualTo(new Requested(inFlight.importId(), null, Outcome.IN_FLIGHT));
        assertThat(imports.request(member(), UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now).outcome())
                .as("남의 진행 중 요청").isEqualTo(Outcome.ACCEPTED);
        assertThat(imports.request(owner, UUID.randomUUID(), FINGERPRINT,
                new Submission(null, "원문", HASH, "paste", true, false, null), null, 10, 5, now).outcome())
                .as("겹쳐 올리기 허락").isEqualTo(Outcome.ACCEPTED);

        jdbc.update("UPDATE ai_jobs SET status='failed' WHERE user_id=?", owner);
        UUID later = scriptWithHash(owner, HASH, now.plusSeconds(10));
        UUID earlier = scriptWithHash(owner, HASH, now);
        assertThat(imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now))
                .isEqualTo(new Requested(null, earlier, Outcome.DUPLICATE));
        assertThat(later).isNotEqualTo(earlier);
    }

    @Test
    @DisplayName("request: 대본 수가 한도에 닿았으면 OVER_SCRIPT_LIMIT, 오늘(한국 자정부터) 넣은 나누기 작업이 한도에 닿았으면 OVER_DAILY_LIMIT 이고 아무것도 넣지 않는다")
    void requestEnforcesTheLimits() {
        scriptWithHash(owner, "b".repeat(64), now);
        assertThat(imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 1, 5, now))
                .isEqualTo(new Requested(null, null, Outcome.OVER_SCRIPT_LIMIT));

        Instant seoulMidnight = Instant.parse("2026-11-24T15:00:00Z");
        imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("어제 글", "c".repeat(64)), null, 10, 5, seoulMidnight.minusSeconds(1));
        imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("오늘 글", "d".repeat(64)), null, 10, 5, seoulMidnight);
        assertThat(imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 1, now))
                .as("자정에 넣은 것부터 오늘이다").isEqualTo(new Requested(null, null, Outcome.OVER_DAILY_LIMIT));
        assertThat(imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 2, now).outcome())
                .isEqualTo(Outcome.ACCEPTED);
        assertThat(count("script_imports")).isEqualTo(3);
    }

    @Test
    @DisplayName("request: 초안을 함께 넘기면(예시) 작업 없이 바로 대본을 만들고 요청을 그 대본에 잇는다 — 줄 수를 다 한 것으로 적고 원본 파일도 잇는다")
    void requestWithADraftSavesTheScriptAtOnce() {
        UUID upload = upload(owner, "scripts/a.pdf", "대본.pdf");
        jdbc.update("UPDATE script_uploads SET raw_text='뽑은 글' WHERE id=?", upload);

        Requested saved = imports.request(owner, UUID.randomUUID(), FINGERPRINT,
                new Submission("제목", "원문", HASH, "sample", false, false, upload), draft("제목", "원문"), 10, 0, now);

        assertThat(saved.outcome()).isEqualTo(Outcome.ACCEPTED);
        UUID script = jdbc.queryForObject("SELECT id FROM scripts", UUID.class);
        assertThat(jdbc.queryForMap("SELECT job_id,script_id,done_lines,total_lines FROM script_imports"))
                .containsEntry("job_id", null).containsEntry("script_id", script).containsEntry("done_lines", 2)
                .containsEntry("total_lines", 2);
        assertThat(count("ai_jobs")).isZero();
        assertThat(jdbc.queryForMap("SELECT script_id,raw_text FROM script_uploads WHERE id=?", upload))
                .containsEntry("script_id", script).containsEntry("raw_text", null);
        assertThat(imports.find(owner, saved.importId()))
                .isEqualTo(new ImportView(saved.importId(), "succeeded", 2, 2, 100, script, null));
    }

    @Test
    @DisplayName("request: 다른 사람이 같은 글로 서버에서 나눠 두고 고치지 않은 최근 대본이 있으면 그 배역과 줄로 바로 만든다(REUSED). 고친 대본·기한이 지난 대본·내 대본·기기가 나눈 대본은 쓰지 않는다")
    void requestReusesAnUntouchedSplitOfTheSameText() {
        UUID other = member();
        UUID source = splitScript(other, HASH, now.minusSeconds(3600));

        Requested reused = imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("내 원문", HASH), null, 10, 0, now);

        assertThat(reused.outcome()).isEqualTo(Outcome.REUSED);
        UUID mine = jdbc.queryForObject("SELECT id FROM scripts WHERE user_id=?", UUID.class, owner);
        assertThat(jdbc.queryForMap("SELECT raw_text,source FROM scripts WHERE id=?", mine))
                .containsEntry("raw_text", "내 원문").containsEntry("source", "paste");
        assertThat(jdbc.queryForList("SELECT name FROM script_characters WHERE script_id=? ORDER BY sort_order", String.class, mine))
                .containsExactly("니나", "코스챠", "니나·코스챠");
        assertThat(jdbc.queryForList("SELECT kind||':'||text FROM script_lines WHERE script_id=? ORDER BY ordinal", String.class, mine))
                .containsExactly("scene:호숫가", "dialogue:안녕", "dialogue:함께");
        assertThat(jdbc.queryForObject("""
                SELECT (SELECT string_agg(m.name,',' ORDER BY m.sort_order) FROM script_characters m WHERE m.id=ANY(c.member_ids))
                FROM script_characters c WHERE c.script_id=? AND c.member_ids IS NOT NULL
                """, String.class, mine)).as("묶음 배역의 멤버도 새 대본의 배역을 가리킨다").isEqualTo("니나,코스챠");
        assertThat(jdbc.queryForMap("SELECT job_id,script_id,done_lines,total_lines FROM script_imports WHERE user_id=?", owner))
                .containsEntry("job_id", null).containsEntry("script_id", mine).containsEntry("done_lines", 3)
                .containsEntry("total_lines", 3);
        assertThat(source).isNotEqualTo(mine);

        for (String spoil : List.of(
                "UPDATE scripts SET updated_at=created_at + interval '1 second' WHERE id=?",
                "UPDATE scripts SET created_at=now() - interval '31 days', updated_at=now() - interval '31 days' WHERE id=?",
                "UPDATE scripts SET source='sample' WHERE id=?",
                "DELETE FROM script_imports WHERE script_id=?")) {
            UUID asker = member();
            UUID origin = splitScript(member(), "e".repeat(64), now.minusSeconds(3600));
            jdbc.update(spoil.replace("now()", "'" + utc(now) + "'::timestamptz"), origin);
            assertThat(imports.request(asker, UUID.randomUUID(), FINGERPRINT, text("원문", "e".repeat(64)), null, 10, 5, now).outcome())
                    .as(spoil).isEqualTo(Outcome.ACCEPTED);
            jdbc.update("DELETE FROM script_imports WHERE script_id=?", origin);
            jdbc.update("UPDATE scripts SET raw_hash=NULL WHERE id=?", origin);
        }
    }

    @Test
    @DisplayName("find: 내 요청의 상태를 낸다 — 작업이 기다리면 pending, 도는 중이면 running, 대본이 이어지면 succeeded·100, 실패 이유가 있거나 작업만 닫혔으면 failed 다. 남의 요청·없는 요청은 null 이다")
    void findReadsTheStatus() {
        UUID id = imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now).importId();

        assertThat(imports.find(owner, id)).isEqualTo(new ImportView(id, "pending", 0, 0, 0, null, null));
        assertThat(imports.find(member(), id)).isNull();
        assertThat(imports.find(owner, UUID.randomUUID())).isNull();

        jdbc.update("UPDATE ai_jobs SET status='running'");
        imports.progress(id, 3, 10);
        imports.percent(id, 40);
        assertThat(imports.find(owner, id)).isEqualTo(new ImportView(id, "running", 3, 10, 40, null, null));

        jdbc.update("UPDATE ai_jobs SET status='failed'");
        assertThat(imports.find(owner, id)).as("작업만 닫혔다")
                .isEqualTo(new ImportView(id, "failed", 3, 10, 40, null, ScriptImportFailure.FAILED));
        jdbc.update("UPDATE script_imports SET failure='not_script'");
        assertThat(imports.find(owner, id).failure()).isEqualTo(ScriptImportFailure.NOT_SCRIPT);
    }

    @Test
    @DisplayName("progress·percent: 끝나지 않은 요청에만 적는다. 진행률은 99 까지만 오르고 뒤로 가지 않는다. 고친 시각은 DB 의 지금이다")
    void progressAndPercentMoveForwardOnly() {
        UUID id = imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now).importId();

        imports.progress(id, 2, 8);
        imports.percent(id, 50);
        imports.percent(id, 30);
        assertThat(jdbc.queryForMap("SELECT done_lines,total_lines,progress_percent FROM script_imports"))
                .containsEntry("done_lines", 2).containsEntry("total_lines", 8).containsEntry("progress_percent", 50);
        assertThat(jdbc.queryForObject("SELECT updated_at > ? FROM script_imports", Boolean.class, utc(now.plusSeconds(1))))
                .as("넘긴 시각이 아니라 DB 의 지금").isTrue();
        imports.percent(id, 150);
        assertThat(jdbc.queryForObject("SELECT progress_percent FROM script_imports", Integer.class)).isEqualTo(99);

        jdbc.update("UPDATE script_imports SET failure='failed'");
        imports.progress(id, 8, 8);
        imports.percent(id, 99);
        assertThat(jdbc.queryForMap("SELECT done_lines,progress_percent FROM script_imports"))
                .as("끝난 요청은 그대로다").containsEntry("done_lines", 2).containsEntry("progress_percent", 99);
    }

    @Test
    @DisplayName("material·complete: 집은 작업의 요청 재료를 내고, 나눈 초안으로 대본을 만들어 요청과 원본 파일에 잇고 작업을 닫는다 — 요청의 원문은 비우고 줄 수를 다 한 것으로 적는다")
    void completeSavesTheScriptAndClosesTheJob() {
        UUID upload = upload(owner, "scripts/a.pdf", "대본.pdf");
        UUID request = UUID.randomUUID();
        UUID id = imports.request(owner, request, FINGERPRINT,
                new Submission("제목", "원문", HASH, "file", false, true, upload), null, 10, 5, now).importId();
        UUID token = UUID.randomUUID();
        AiJobLedger.Claimed job = ledger.claimNext("script_split", token, LEASE, now.plusSeconds(1), true);
        imports.progress(id, 1, 2);

        assertThat(imports.material(job.id(), id))
                .isEqualTo(new Material(owner, true, request, FINGERPRINT, "제목", "원문", "file", true, "대본.pdf"));
        assertThat(imports.material(UUID.randomUUID(), id)).as("다른 작업").isNull();

        assertThat(imports.complete(job.id(), token, id, draft("제목", "원문"), now.plusSeconds(5).plusNanos(1_500)))
                .isEqualTo(Completion.SAVED);

        UUID script = jdbc.queryForObject("SELECT id FROM scripts", UUID.class);
        assertThat(jdbc.queryForMap("SELECT script_id,done_lines,total_lines,raw_text,failure FROM script_imports"))
                .containsEntry("script_id", script).containsEntry("done_lines", 2).containsEntry("total_lines", 2)
                .containsEntry("raw_text", "").containsEntry("failure", null);
        assertThat(instant("SELECT updated_at FROM script_imports")).isEqualTo(now.plusSeconds(5).plus(2, ChronoUnit.MICROS));
        assertThat(jdbc.queryForMap("SELECT script_id,raw_text FROM script_uploads WHERE id=?", upload))
                .containsEntry("script_id", script).containsEntry("raw_text", null);
        assertThat(instant("SELECT updated_at FROM script_uploads WHERE id=?", upload))
                .isEqualTo(now.plusSeconds(5).plus(2, ChronoUnit.MICROS));
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs", String.class)).isEqualTo("succeeded");
        assertThat(imports.material(job.id(), id)).as("끝난 요청은 재료가 없다").isNull();
    }

    @Test
    @DisplayName("complete: 요청이 이미 끝났거나 주인이 활성이 아니면 CANCELLED 로 작업만 닫고 대본을 만들지 않는다. 대본 수 한도에 걸리면 SCRIPT_LIMIT 이고 작업은 그대로다")
    void completeCancelsOrHitsTheLimit() {
        UUID id = imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now).importId();
        UUID token = UUID.randomUUID();
        AiJobLedger.Claimed job = ledger.claimNext("script_split", token, LEASE, now.plusSeconds(1), true);

        for (int i = 0; i < ScriptRules.scriptLimit(true); i++) {
            scriptWithHash(owner, "%064d".formatted(i), now);
        }
        assertThat(imports.complete(job.id(), token, id, draft("제목", "원문"), now)).as("게스트의 대본 수 한도").isEqualTo(Completion.SCRIPT_LIMIT);
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs", String.class)).isEqualTo("running");

        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", owner);
        assertThat(imports.complete(job.id(), token, id, draft("제목", "원문"), now)).isEqualTo(Completion.CANCELLED);
        assertThat(jdbc.queryForMap("SELECT status,failure_reason FROM ai_jobs"))
                .containsEntry("status", "failed").containsEntry("failure_reason", "cancelled");
        assertThat(jdbc.queryForObject("SELECT script_id FROM script_imports", UUID.class)).isNull();
        assertThat(count("scripts")).isEqualTo(ScriptRules.scriptLimit(true));
    }

    @Test
    @DisplayName("fail: 요청에 실패 이유를 적고 원문을 비우고 작업을 닫는다. 원본 파일을 남기기로 했으면 그 파일에도 이유를 적는다. 이미 대본이 이어진 요청은 건드리지 않는다")
    void failRecordsTheReason() {
        UUID upload = upload(owner, "scripts/a.pdf", "대본.pdf");
        UUID kept = imports.request(owner, UUID.randomUUID(), FINGERPRINT,
                new Submission(null, "원문", HASH, "file", false, false, upload), null, 10, 5, now).importId();
        UUID token = UUID.randomUUID();
        AiJobLedger.Claimed job = ledger.claimNext("script_split", token, LEASE, now.plusSeconds(1), true);

        imports.fail(job.id(), token, kept, ScriptImportFailure.NOT_SCRIPT, true, now.plusSeconds(9));

        assertThat(jdbc.queryForMap("SELECT failure,raw_text,script_id FROM script_imports WHERE id=?", kept))
                .containsEntry("failure", "not_script").containsEntry("raw_text", "").containsEntry("script_id", null);
        assertThat(instant("SELECT updated_at FROM script_imports WHERE id=?", kept)).isEqualTo(now.plusSeconds(9));
        assertThat(jdbc.queryForObject("SELECT failure FROM script_uploads WHERE id=?", String.class, upload)).isEqualTo("not_script");
        assertThat(jdbc.queryForMap("SELECT status,failure_reason FROM ai_jobs WHERE id=?", job.id()))
                .containsEntry("status", "failed").containsEntry("failure_reason", "not_script");

        UUID other = member();
        UUID otherUpload = upload(other, "scripts/b.pdf", "둘째.pdf");
        UUID dropped = imports.request(other, UUID.randomUUID(), FINGERPRINT,
                new Submission(null, "원문", HASH, "file", false, false, otherUpload), null, 10, 5, now).importId();
        UUID otherToken = UUID.randomUUID();
        AiJobLedger.Claimed otherJob = ledger.claimNext("script_split", otherToken, LEASE, now.plusSeconds(2), true);
        imports.fail(otherJob.id(), otherToken, dropped, ScriptImportFailure.FAILED, false, now);
        assertThat(jdbc.queryForObject("SELECT failure FROM script_uploads WHERE id=?", String.class, otherUpload))
                .as("남기지 않기로 한 원본 파일").isNull();
        assertThat(jdbc.queryForObject("SELECT failure FROM script_imports WHERE id=?", String.class, dropped)).isEqualTo("failed");
    }

    @Test
    @DisplayName("sweepExpired: 임대가 지났고 시도를 다 쓴 나누기 작업을 닫고 그 요청에 failed 를 적는다. 닫을 작업이 없으면 0 이다")
    void sweepExpiredClosesAbandonedRequests() {
        UUID id = imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now).importId();
        assertThat(imports.sweepExpired(now.plusSeconds(1))).isZero();

        jdbc.update("UPDATE ai_jobs SET status='running', attempt_count=?, lease_token=gen_random_uuid(), lease_expires_at=?",
                AiJobLedger.MAX_ATTEMPTS, utc(now.plusSeconds(60)));
        assertThat(imports.sweepExpired(now.plusSeconds(59))).as("임대가 남았다").isZero();
        assertThat(imports.sweepExpired(now.plusSeconds(61))).isEqualTo(1);

        assertThat(jdbc.queryForMap("SELECT failure,raw_text FROM script_imports WHERE id=?", id))
                .containsEntry("failure", "failed").containsEntry("raw_text", "");
        assertThat(instant("SELECT updated_at FROM script_imports WHERE id=?", id)).isEqualTo(now.plusSeconds(61));
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs", String.class)).isEqualTo("failed");
    }

    @Test
    @DisplayName("request 는 사람 행을 FOR UPDATE 로 잡고 활성인지 본다 — 바깥 연결이 그 행을 FOR KEY SHARE 로 잡고 있으면 그 뒤에서 기다리고, 활성이 아니면 OwnerNotActive 를 던지고 아무것도 넣지 않는다")
    void requestLocksTheOwner() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM users WHERE id=? FOR KEY SHARE", owner);
            Future<Requested> blocked = pool.submit(() ->
                    imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now));
            String waiting = awaitWaiting("from users");
            probe.rollback();

            assertThat(waiting).startsWith("select").contains("for update");
            assertThat(blocked.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(Outcome.ACCEPTED);
        } finally {
            pool.shutdownNow();
        }
        UUID closed = member();
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", closed);
        assertThatThrownBy(() -> imports.request(closed, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now))
                .isInstanceOf(ScriptRepository.OwnerNotActive.class);
        assertThat(count("script_imports")).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 요청 id 의 접수 둘이 겹치면 뒤의 것이 사람 행에서 앞의 커밋을 기다렸다가 REPLAYED 로 같은 요청을 낸다. 같은 글의 다른 요청이 겹치면 뒤의 것은 IN_FLIGHT 다. 요청과 작업은 하나씩이다")
    void twoRequestsAtOnce() throws Exception {
        UUID request = UUID.randomUUID();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch accepted = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            Future<Requested> first = pool.submit(() -> inTransaction(() -> {
                Requested mine = imports.request(owner, request, FINGERPRINT, text("원문", HASH), null, 10, 5, now);
                accepted.countDown();
                await(release);
                return mine;
            }));
            await(accepted);
            Future<Requested> replay = pool.submit(() ->
                    imports.request(owner, request, FINGERPRINT, text("원문", HASH), null, 10, 5, now));
            assertThat(awaitWaiting("from users")).contains("for update");
            release.countDown();
            UUID importId = first.get(20, TimeUnit.SECONDS).importId();
            assertThat(replay.get(20, TimeUnit.SECONDS)).isEqualTo(new Requested(importId, null, Outcome.REPLAYED));

            assertThat(imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now))
                    .isEqualTo(new Requested(importId, null, Outcome.IN_FLIGHT));
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("script_imports")).isEqualTo(1);
        assertThat(count("ai_jobs")).isEqualTo(1);
    }

    @Test
    @DisplayName("요청 하나가 보내는 문장: 접수는 사람 잠금·재전송·같은 글 대본·진행 중·대본 수·다시 쓸 대본·오늘 작업 수·작업 넣기·요청 넣기 아홉, 재전송은 둘, 상태 읽기는 하나다. 진행·진행률은 UPDATE 하나다")
    void eachRequestSendsTheseStatements() {
        UUID request = UUID.randomUUID();
        String usersLock = "select users for update";
        String imported = "select script_imports";

        assertThat(statementsOf(() -> imports.request(owner, request, FINGERPRINT, text("원문", HASH), null, 10, 5, now)))
                .as("접수").containsExactly(usersLock, imported, "select scripts", imported, "count scripts", "select scripts",
                        "count ai_jobs", "insert ai_jobs", "insert script_imports");
        assertThat(statementsOf(() -> imports.request(owner, request, FINGERPRINT, text("원문", HASH), null, 10, 5, now)))
                .as("재전송").containsExactly(usersLock, imported);
        assertThat(statementsOf(() -> imports.request(owner, UUID.randomUUID(), FINGERPRINT, text("원문", HASH), null, 10, 5, now)))
                .as("같은 글이 나누는 중").containsExactly(usersLock, imported, "select scripts", imported);
        UUID id = jdbc.queryForObject("SELECT id FROM script_imports", UUID.class);
        assertThat(statementsOf(() -> imports.find(owner, id))).as("상태 읽기").containsExactly(imported);
        assertThat(statementsOf(() -> imports.progress(id, 1, 2))).containsExactly("update script_imports");
        assertThat(statementsOf(() -> imports.percent(id, 10))).containsExactly("update script_imports");
        assertThat(statementsOf(() -> imports.consent(owner))).containsExactly("select (표 없음)");

        UUID token = UUID.randomUUID();
        AiJobLedger.Claimed job = ledger.claimNext("script_split", token, LEASE, now.plusSeconds(1), true);
        assertThat(statementsOf(() -> imports.material(job.id(), id))).containsExactly(imported);
        assertThat(statementsOf(() -> imports.fail(job.id(), token, id, ScriptImportFailure.FAILED, false, now)))
                .as("실패 — 작업 장부가 보내는 문장은 장부의 것이라 여기서 세지 않는다")
                .filteredOn(statement -> statement.contains("script_imports"))
                .containsExactly("update script_imports", "select script_imports");
        assertThat(statementsOf(() -> imports.fail(job.id(), token, UUID.randomUUID(), ScriptImportFailure.FAILED, false, now)))
                .as("고친 요청이 없으면 다시 읽지 않는다")
                .filteredOn(statement -> statement.contains("script_imports"))
                .containsExactly("update script_imports");
    }

    private static Submission text(String rawText, String hash) {
        return new Submission(null, rawText, hash, "paste", false, false, null);
    }

    /** 배역 하나, 대사 둘. */
    private static ScriptDraft draft(String title, String rawText) {
        return new ScriptDraft(title, rawText, "paste", List.of("니나"),
                List.of(new ScriptDraft.Line(1, "dialogue", 0, "안녕"), new ScriptDraft.Line(2, "dialogue", 0, "잘 가")));
    }

    private UUID upload(UUID user, String objectKey, String fileName) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO script_uploads(id,user_id,object_key,file_name,byte_size,expires_at) VALUES (?,?,?,?,1,?)",
                id, user, objectKey, fileName, utc(now.plusSeconds(600)));
        return id;
    }

    private UUID scriptWithHash(UUID user, String hash, Instant createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint,created_at,updated_at)
                VALUES (?,?,'대본','원문',?,'paste',?,repeat('a',64),?,?)
                """, id, user, hash, UUID.randomUUID(), utc(createdAt), utc(createdAt));
        return id;
    }

    /** 서버가 나눠 둔 고치지 않은 대본: 장면 하나, 니나의 대사, 니나·코스챠가 함께 말하는 대사. 나누기 요청이 이 대본을 가리킨다. */
    private UUID splitScript(UUID user, String hash, Instant createdAt) {
        UUID script = scriptWithHash(user, hash, createdAt);
        UUID nina = character(script, "니나", 0);
        UUID kostya = character(script, "코스챠", 1);
        UUID chorus = character(script, "니나·코스챠", 2);
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("UPDATE script_characters SET member_ids=? WHERE id=?");
            statement.setArray(1, connection.createArrayOf("uuid", new UUID[] {nina, kostya}));
            statement.setObject(2, chorus);
            return statement;
        });
        line(script, 1, "scene", null, "호숫가");
        line(script, 2, "dialogue", nina, "안녕");
        line(script, 3, "dialogue", chorus, "함께");
        jdbc.update("""
                INSERT INTO script_imports(id,user_id,request_id,request_fingerprint,title,source,raw_text,raw_hash,script_id,
                                           created_at,updated_at)
                VALUES (?,?,?,repeat('f',64),'제목','paste','',?,?,?,?)
                """, UUID.randomUUID(), user, UUID.randomUUID(), hash, script, utc(createdAt), utc(createdAt));
        return script;
    }
}
