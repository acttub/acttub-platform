package com.acttub.actingapi.platform.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 02-practice 「1.0.0 스키마 전환」 ③ — 재실행 가능한 전환 명령을 <b>고정 자료</b>로 본다.
 *
 * <p>고정 자료는 요구사항이 이름을 든 네 갈래다: 신형 raw(관찰 기록), 구형 분리 배열(ObservationPack),
 * 한 연습의 복수 대화, 이어하기 체인 셋. 여기서 보는 것은 "무엇이 옮겨졌고 무엇이 왜 남았는가" 와
 * "두 번 돌려도 같은가" 다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false",
    "EXIT_SURVEY_SYNC_ENABLED=false"
})
class PracticeDataMigrationIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("practice_migration");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PracticeDataMigration migration;

    private UUID owner;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        jdbc.execute("TRUNCATE TABLE practice_migration_entries");
        owner = user();
    }

    @Test
    @DisplayName("practice.record·practice.start: 확정된 업로드가 보관함 영상이 되고 예약 장부가 그 영상을 가리킨다. "
            + "이어하기 체인은 묶음(root_id)과 차수(ordinal)로 펴지고 옛 개별 숨김은 legacy_hidden_at 에 남는다")
    void practiceMigration_movesUploadsToVideosAndChainsToRootAndOrdinal() {
        UUID first = session(intent("videos/a.mp4"), null, "analyzed");
        UUID second = session(intent("videos/b.mp4"), first, "analyzed");
        UUID third = session(intent("videos/c.mp4"), second, "analyzing");
        jdbc.update("UPDATE practice_sessions SET hidden_at=now() WHERE id=?", second);

        migration.run(50);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM videos WHERE user_id=?", Integer.class, owner))
                .isEqualTo(3);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM upload_intents WHERE user_id=? AND video_id IS NULL", Integer.class, owner))
                .isZero();
        assertThat(jdbc.queryForList(
                "SELECT id,root_id,ordinal,stage FROM practices WHERE user_id=? ORDER BY ordinal", owner))
                .extracting(row -> row.get("ordinal") + ":" + row.get("root_id") + ":" + row.get("stage"))
                .as("이어받은 회차는 끝난 것이고 묶음의 진행 중 회차는 마지막 하나다")
                .containsExactly(
                        "1:" + first + ":closed",
                        "2:" + first + ":closed",
                        "3:" + first + ":analyzing");
        assertThat(jdbc.queryForObject(
                "SELECT legacy_hidden_at FROM practices WHERE id=?", Object.class, second)).isNotNull();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM practices WHERE hidden_at IS NOT NULL", Integer.class))
                .as("옛 개별 숨김을 묶음 숨김으로 승격하지 않는다").isZero();
        assertThat(jdbc.queryForObject("SELECT id FROM practices WHERE id=?", UUID.class, third)).isEqualTo(third);
    }

    @Test
    @DisplayName("practice.analyze: 신형 raw 는 format video_record_v1 로 id = record_id 이고, 구형 분리 배열은 "
            + "format legacy 로 관찰·불확실을 합친 묶음이 된다. 받아쓰기는 영상당 묶음 하나다")
    void practiceMigration_keepsBothAnalysisFormatsAsTheyAre() {
        UUID recordId = UUID.randomUUID();
        UUID modern = session(intent("videos/modern.mp4"), null, "analyzed");
        jdbc.update("""
                INSERT INTO summaries(id,session_id,model,raw,observations_json,uncertainties_json)
                VALUES (?,?,'gemini',?::jsonb,'[]'::jsonb,'[]'::jsonb)
                """, UUID.randomUUID(), modern,
                "{\"schema_version\":\"acttub.video_record.v1\",\"record_id\":\"" + recordId + "\"}");
        UUID legacy = session(intent("videos/legacy.mp4"), null, "analyzed");
        jdbc.update("""
                INSERT INTO summaries(id,session_id,model,raw,observations_json,uncertainties_json)
                VALUES (?,?,'gpt','null'::jsonb,?::jsonb,?::jsonb)
                """, UUID.randomUUID(), legacy,
                "[{\"what\":\"호흡이 얕다\"}]", "[\"조명이 어둡다\"]");
        jdbc.update("INSERT INTO transcripts(id,session_id,ord,text) VALUES (?,?,0,'지금 놓치면 끝이야')",
                UUID.randomUUID(), legacy);
        jdbc.update("INSERT INTO transcripts(id,session_id,ord,text) VALUES (?,?,1,'그러니까 가지 마')",
                UUID.randomUUID(), legacy);

        migration.run(50);

        Map<String, Object> modernRow = jdbc.queryForMap("SELECT * FROM analyses WHERE practice_id=?", modern);
        assertThat(modernRow.get("format")).isEqualTo("video_record_v1");
        assertThat(modernRow.get("id")).isEqualTo(recordId);
        assertThat(modernRow.get("status")).isEqualTo("ready");

        Map<String, Object> legacyRow = jdbc.queryForMap("SELECT * FROM analyses WHERE practice_id=?", legacy);
        assertThat(legacyRow.get("format")).isEqualTo("legacy");
        assertThat(legacyRow.get("id")).as("구형을 신형으로 위장하지 않는다").isNotEqualTo(recordId);
        assertThat(legacyRow.get("status")).as("못 본 구간이 있으면 partial 이다").isEqualTo("partial");
        assertThat(legacyRow.get("record").toString())
                .contains("호흡이 얕다").contains("조명이 어둡다");

        assertThat(jdbc.queryForObject("SELECT count(*) FROM video_transcripts", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT segments::text FROM video_transcripts", String.class))
                .contains("지금 놓치면 끝이야").contains("그러니까 가지 마");
    }

    @Test
    @DisplayName("practice.coach: 한 연습에 대화가 여럿인 옛 자료는 최신 하나만 옮기고 나머지는 사유와 함께 "
            + "대응표에 남는다 — 옛 테이블은 그대로다. 턴은 순서와 역할을 지킨다")
    void practiceMigration_movesOnlyTheLatestConversationPerPractice() {
        UUID practice = session(intent("videos/talk.mp4"), null, "analyzed");
        UUID older = conversation(practice, "closed", "user_ended", "2026-09-01 00:00:00+00");
        UUID latest = conversation(practice, "open", null, "2026-09-10 00:00:00+00");
        turn(older, 0, "ai", "옛 대화의 첫 말");
        turn(latest, 0, "ai", "무엇이 달라졌나요");
        turn(latest, 1, "actor", "숨이 막혔어요");

        migration.run(50);

        assertThat(jdbc.queryForList("SELECT id FROM coach_conversations", UUID.class))
                .containsExactly(latest);
        assertThat(jdbc.queryForMap(
                "SELECT target_id,skip_reason FROM practice_migration_entries WHERE source_id=?", older))
                .containsEntry("target_id", null)
                .containsEntry("skip_reason", "superseded_conversation");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM coach_sessions", Integer.class))
                .as("옛 테이블은 삭제·수정하지 않는다").isEqualTo(2);
        assertThat(jdbc.queryForList(
                "SELECT role,text FROM coach_messages ORDER BY turn_index"))
                .extracting(row -> row.get("role") + ":" + row.get("text"))
                .containsExactly("ai:무엇이 달라졌나요", "actor:숨이 막혔어요");
    }

    @Test
    @DisplayName("practice.note·practice.memory: 기존 갈래 노트는 format legacy 로 종류를 그대로 두고, 배우 기억은 "
            + "성별·나이를 빼고 네 칸만 옮긴다. 끝난 AI 작업만 새 장부로 가고 진행 중인 것은 옛 워커에게 남는다")
    void practiceMigration_movesNotesMemoriesAndFinishedJobsOnly() {
        UUID practice = session(intent("videos/note.mp4"), null, "analyzed");
        UUID conversation = conversation(practice, "closed", "user_ended", "2026-09-10 00:00:00+00");
        UUID handoff = handoff(practice, conversation);
        jdbc.update("""
                INSERT INTO practice_reports(id,practice_session_id,report_type,report_json,source_handoff_id)
                VALUES (?,?,'expression',?::jsonb,?)
                """, UUID.randomUUID(), practice, "{\"title\":\"옛 노트 제목\"}", handoff);
        for (String field : List.of("goal", "gender")) {
            jdbc.update("""
                    INSERT INTO actor_memory_entries(id,user_id,field,value,written_by,source_practice_session_id)
                    VALUES (?,?,?,?,'actor',?)
                    """, UUID.randomUUID(), owner, field, field.equals("goal") ? "합격" : "여", practice);
        }
        UUID finished = operation(practice, "analyze", "succeeded");
        UUID running = operation(practice, "analyze", "running");

        migration.run(50);

        Map<String, Object> note = jdbc.queryForMap("SELECT * FROM coach_notes");
        assertThat(note.get("format")).isEqualTo("legacy");
        assertThat(note.get("kind")).as("expression 을 observation 으로 이름만 바꾸지 않는다").isEqualTo("expression");
        assertThat(note.get("title")).isEqualTo("옛 노트 제목");
        assertThat(note.get("legacy_report").toString()).contains("옛 노트 제목");

        assertThat(jdbc.queryForList("SELECT field FROM actor_memories", String.class))
                .as("성별·나이는 프로필의 것이다").containsExactly("goal");
        assertThat(jdbc.queryForObject(
                "SELECT source_practice_id FROM actor_memories WHERE field='goal'", UUID.class))
                .isEqualTo(practice);

        assertThat(jdbc.queryForList("SELECT id FROM ai_jobs", UUID.class)).containsExactly(finished);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM practice_migration_entries WHERE source_id=?", Integer.class, running))
                .as("진행 중인 작업은 고르지도 않는다 — 끝나면 다음 실행이 집어 간다").isZero();
    }

    @Test
    void practiceMigration_keepsInstructionTextInsteadOfSerializingItsSourceObject() {
        UUID practice = session(intent("videos/instruction.mp4"), null, "analyzed");
        UUID conversation = conversation(practice, "closed", "user_ended", "2026-09-10 00:00:00+00");
        UUID handoff = handoff(practice, conversation);
        jdbc.update("""
                INSERT INTO practice_reports(id,practice_session_id,report_type,report_json,source_handoff_id)
                VALUES (?,?,'practice_note',CAST(? AS jsonb),?)
                """, UUID.randomUUID(), practice, """
                {"schema_version":"acttub.practice_note.v1","mode":"action","copy":{"title":"말끝"},
                 "practice":{"instruction":{"text":"말끝을 짧게 끝내 보세요.","source_refs":["c2"]}},
                 "direction":{"text":"붙잡고 싶어요"}}
                """, handoff);

        migration.run(50);

        assertThat(jdbc.queryForObject("SELECT next_take FROM coach_notes WHERE conversation_id=?", String.class, conversation))
                .isEqualTo("말끝을 짧게 끝내 보세요.");
    }

    @Test
    @DisplayName("02-practice ③: 새 제약에 맞지 않는 묶음은 임의로 닫거나 지우지 않고 사유와 함께 대응표에 남는다 "
            + "— 진행 중 회차가 둘인 묶음, 가지 친 이어하기, 확정되지 않은 업로드")
    void practiceMigration_leavesGroupsThatDoNotFitTheNewConstraints() {
        UUID openA = session(intent("videos/open-a.mp4"), null, "analyzing");
        UUID openB = session(intent("videos/open-b.mp4"), openA, "analyzing");
        UUID branchRoot = session(intent("videos/branch.mp4"), null, "analyzed");
        session(intent("videos/branch-1.mp4"), branchRoot, "analyzed");
        session(intent("videos/branch-2.mp4"), branchRoot, "analyzed");
        UUID pending = session(pendingIntent("videos/pending.mp4"), null, "analyzing");

        migration.run(50);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM practices", Integer.class)).isZero();
        assertThat(jdbc.queryForList("""
                SELECT DISTINCT skip_reason FROM practice_migration_entries
                WHERE step='practice' ORDER BY skip_reason
                """, String.class))
                .containsExactly("branching_chain", "multiple_open_practices", "video_missing");
        assertThat(jdbc.queryForObject(
                "SELECT skip_reason FROM practice_migration_entries WHERE source_id=?", String.class, openB))
                .isEqualTo("multiple_open_practices");
        assertThat(jdbc.queryForObject(
                "SELECT skip_reason FROM practice_migration_entries WHERE source_id=?", String.class, pending))
                .isEqualTo("video_missing");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_sessions", Integer.class))
                .as("옛 자료는 그대로 남아 호환 읽기가 보여 준다").isEqualTo(6);
    }

    @Test
    @DisplayName("02-practice ③: 전환 명령은 재실행 가능하다 — 두 번째 실행은 아무것도 옮기지 않고 행 수도 "
            + "대응표도 그대로다. 작은 묶음으로 나눠 돌려도 결과가 같다")
    void practiceMigration_isIdempotentAndBatchSizeDoesNotChangeTheResult() {
        UUID first = session(intent("videos/1.mp4"), null, "analyzed");
        UUID second = session(intent("videos/2.mp4"), first, "analyzed");
        conversation(second, "closed", "user_ended", "2026-09-10 00:00:00+00");
        jdbc.update("""
                INSERT INTO summaries(id,session_id,model,raw,observations_json,uncertainties_json)
                VALUES (?,?,'gpt','null'::jsonb,'[]'::jsonb,'[]'::jsonb)
                """, UUID.randomUUID(), first);

        PracticeDataMigration.Report firstRun = migration.run(1);
        Map<String, Integer> after = counts();
        int ledger = ledgerSize();

        PracticeDataMigration.Report secondRun = migration.run(1);

        assertThat(firstRun.moved().get("practice")).isEqualTo(2);
        assertThat(secondRun.moved().values()).allSatisfy(moved -> assertThat(moved).isZero());
        assertThat(secondRun.skipped().values()).allSatisfy(skipped -> assertThat(skipped).isZero());
        assertThat(secondRun.batches()).isZero();
        assertThat(counts()).isEqualTo(after);
        assertThat(ledgerSize()).isEqualTo(ledger);
    }

    // --- 도우미 -------------------------------------------------------------

    private Map<String, Integer> counts() {
        Map<String, Integer> totals = new java.util.LinkedHashMap<>();
        for (String table : List.of("videos", "practices", "video_transcripts", "analyses",
                "coach_conversations", "coach_messages", "coach_notes", "actor_memories", "ai_jobs")) {
            totals.put(table, jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class));
        }
        return totals;
    }

    private int ledgerSize() {
        return jdbc.queryForObject("SELECT count(*) FROM practice_migration_entries", Integer.class);
    }

    private UUID user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        return id;
    }

    private UUID intent(String objectKey) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,
                                           size_bytes,duration_ms,expires_at,finalized_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',1000,12000,now() + interval '1 hour',now())
                """, id, owner, objectKey);
        return id;
    }

    private UUID pendingIntent(String objectKey) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,
                                           size_bytes,expires_at)
                VALUES (?,?,'pending','s3',?,'video/mp4',1000,now() + interval '1 hour')
                """, id, owner, objectKey);
        return id;
    }

    private UUID session(UUID intentId, UUID continuedFrom, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,
                                              blockage_kind,sub_branch,goal,continued_from)
                VALUES (?,?,?,?,'문 앞에서 돌아선다','연인','표현','감정','망설임을 보여 주기',?)
                """, id, owner, intentId, status, continuedFrom);
        return id;
    }

    private UUID conversation(UUID practiceSessionId, String status, String closeReason, String createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_sessions(id,practice_session_id,status,close_reason,conversation_summary,
                                           created_at,updated_at)
                VALUES (?,?,?,?,'',?::timestamptz,?::timestamptz)
                """, id, practiceSessionId, status, closeReason, createdAt, createdAt);
        return id;
    }

    private void turn(UUID coachSessionId, int index, String role, String text) {
        jdbc.update("INSERT INTO coach_turns(session_id,turn_index,role,text) VALUES (?,?,?,?)",
                coachSessionId, index, role, text);
    }

    private UUID handoff(UUID practiceSessionId, UUID coachSessionId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coaching_handoffs(id,coach_session_id,practice_session_id,branch_kind,
                                              handoff_json,state_revision)
                VALUES (?,?,?,'expression','{}'::jsonb,3)
                """, id, coachSessionId, practiceSessionId);
        return id;
    }

    private UUID operation(UUID practiceSessionId, String kind, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO external_operations(id,session_id,user_id,request_id,kind,status,
                                                request_fingerprint)
                VALUES (?,?,?,?,?,?,?)
                """, id, practiceSessionId, owner, UUID.randomUUID(), kind, status, "a".repeat(64));
        return id;
    }
}
