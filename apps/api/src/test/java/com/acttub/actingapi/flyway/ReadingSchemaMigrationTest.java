package com.acttub.actingapi.flyway;

import static com.acttub.actingapi.flyway.FlywaySupport.applyRawBaseline;
import static com.acttub.actingapi.flyway.FlywaySupport.dataSource;
import static com.acttub.actingapi.flyway.FlywaySupport.flywayFor;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.ScriptText;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 리딩 스키마(V13)가 <b>계정 0.1.0 까지 온 DB</b> 위에서 넓히기만 하는지 본다 (SOMA-546, ADR-031).
 *
 * <p>V13 은 새 테이블 여섯을 만들고 정리 장부의 값 목록에 종류 하나를 더한다. 그래서 지키는 것은 둘이다 —
 * 옛 서버가 쓰던 장부 INSERT 가 그대로 통하는가, 그리고 새 테이블이 값 목록·배역 이름·대사의 배역을 DB 에서
 * 지키는가. V31 이 멈춘 회차를 진행 중으로 옮기는 것과 V33 이 같은 글 해시를 채우는 것도 여기서 본다. 빈 DB 에서의 전체 적용은
 * {@code FlywayBaselineTest} 의 fingerprint 가 본다.
 */
class ReadingSchemaMigrationTest {

    private static final UUID USER = UUID.fromString("00000000-0000-4000-8000-000000000801");

    @ParameterizedTest(name = "baseline 기록만 있는 DB = {0}")
    @ValueSource(booleans = {false, true})
    @DisplayName("reading.script: V13 은 리딩 테이블 여섯을 더하고 옛 서버의 장부 INSERT 는 그대로 통한다")
    void v13AddsTheReadingTablesWithoutBreakingTheOldServer(boolean baselined) throws Exception {
        String url = databaseAtV12("reading_v13_" + baselined, baselined);
        var jdbc = new JdbcTemplate(dataSource(url));
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", USER);

        var result = Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration")
                .target("13").load().migrate();

        assertThat(result.migrationsExecuted).isEqualTo(1);
        assertThat(result.migrations.getFirst().version).isEqualTo("13");
        assertThat(jdbc.queryForList("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema='public' AND table_name IN
                      ('scripts','script_characters','script_lines','reading_sessions','reading_recordings','line_memorization')
                ORDER BY table_name
                """, String.class))
                .containsExactly("line_memorization", "reading_recordings", "reading_sessions",
                        "script_characters", "script_lines", "scripts");
        // 옛 서버가 쓰던 장부 종류는 그대로 받고, 새 종류도 받는다.
        for (String kind : List.of("object_delete", "reading_recording_delete")) {
            jdbc.update("""
                    INSERT INTO account_cleanup_operations(id,user_id,kind,payload_encrypted,next_attempt_at,expires_at)
                    VALUES (?,?,?,'d1:x',now(),now())
                    """, UUID.randomUUID(), USER, kind);
        }
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO account_cleanup_operations(id,user_id,kind,payload_encrypted,next_attempt_at,expires_at)
                VALUES (?,?,'video_transcode','d1:x',now(),now())
                """, UUID.randomUUID(), USER))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("reading.script·reading.session: 새 테이블이 값 목록, 배역 이름의 공백·유일, 대사의 배역을 DB 에서 지킨다. 한 대본에 진행 중 회차가 여럿일 수 있다")
    void theReadingTablesEnforceTheirRulesInTheDatabase() throws Exception {
        String url = PostgresContainerSupport.createDatabase("reading_v13_rules");
        Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration").load().migrate();
        var jdbc = new JdbcTemplate(dataSource(url));
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", USER);
        UUID script = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint)
                VALUES (?,?,'대본','원문',repeat('0',64),'paste',?,?)
                """, script, USER, UUID.randomUUID(), "a".repeat(64));
        UUID nina = UUID.randomUUID();
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'니나',0)", nina, script);

        for (String rejected : List.of(
                // 값 목록 밖의 입력 경로
                "INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint) VALUES (gen_random_uuid(),'"
                        + USER + "','x','x',repeat('0',64),'email',gen_random_uuid(),'" + "b".repeat(64) + "')",
                // 공백이 남은 이름, 빈 이름, 겹치는 이름
                "INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (gen_random_uuid(),'" + script + "',' 트레플레프',1)",
                "INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (gen_random_uuid(),'" + script + "','',1)",
                "INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (gen_random_uuid(),'" + script + "','니나',1)",
                // 33자 프리셋
                "UPDATE script_characters SET voice_preset='" + "x".repeat(33) + "' WHERE id='" + nina + "'",
                // 배역 없는 대사, 배역 있는 지문, 값 목록 밖의 종류
                "INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (gen_random_uuid(),'" + script + "',1,'dialogue',NULL,'x')",
                "INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (gen_random_uuid(),'" + script + "',1,'direction','" + nina + "','x')",
                "INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (gen_random_uuid(),'" + script + "',1,'monologue',NULL,'x')")) {
            assertThatThrownBy(() -> jdbc.update(rejected)).as(rejected).isInstanceOf(DataIntegrityViolationException.class);
        }

        UUID line = UUID.randomUUID();
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (?,?,1,'dialogue',?,'안녕')",
                line, script, nina);
        String session = """
                INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,
                                             advance,record,status,current_line_id)
                VALUES (gen_random_uuid(),'%s','%s',gen_random_uuid(),ARRAY['%s']::uuid[],'read','%s','%s','silence',true,'%s','%s')
                """;
        jdbc.update(session.formatted(script, USER, nina, line, line, "in_progress", line));
        jdbc.update(session.formatted(script, USER, nina, line, line, "in_progress", line));
        jdbc.update(session.formatted(script, USER, nina, line, line, "completed", line));
        for (String status : List.of("stopped", "paused")) {
            assertThatThrownBy(() -> jdbc.update(session.formatted(script, USER, nina, line, line, status, line)))
                    .as(status).isInstanceOf(DataIntegrityViolationException.class);
        }
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (gen_random_uuid(),?,?,'maybe')
                """, USER, line))
                .isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (gen_random_uuid(),?,?,'memorized')", USER, line);
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (gen_random_uuid(),?,?,'not_yet')", USER, line))
                .as("(사람, 줄)마다 하나다").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("reading.session: V31 은 멈춘 회차를 멈춘 줄 그대로 진행 중으로 옮긴다 — 같은 대본에 진행 중 회차가 이미 있어도 되고, updated_at 은 그대로다")
    void v31MovesStoppedSessionsBackToInProgress() throws Exception {
        String url = PostgresContainerSupport.createDatabase("reading_v31");
        Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration").target("30").load().migrate();
        var jdbc = new JdbcTemplate(dataSource(url));
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", USER);
        UUID script = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,source,request_id,request_fingerprint)
                VALUES (?,?,'대본','원문','paste',?,?)
                """, script, USER, UUID.randomUUID(), "a".repeat(64));
        UUID nina = UUID.randomUUID();
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'니나',0)", nina, script);
        UUID first = UUID.randomUUID();
        UUID third = UUID.randomUUID();
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (?,?,1,'dialogue',?,'하나')",
                first, script, nina);
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (?,?,2,'dialogue',?,'셋')",
                third, script, nina);
        String session = """
                INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,
                                             advance,record,status,current_line_id,updated_at)
                VALUES (?,?,?,gen_random_uuid(),ARRAY[?]::uuid[],'read',?,?,'silence',true,?,?,'2026-09-01T00:00:00Z')
                """;
        UUID stopped = UUID.randomUUID();
        UUID open = UUID.randomUUID();
        UUID completed = UUID.randomUUID();
        jdbc.update(session, stopped, script, USER, nina, first, third, "stopped", third);
        jdbc.update(session, open, script, USER, nina, first, third, "in_progress", first);
        jdbc.update(session, completed, script, USER, nina, first, third, "completed", null);

        var result = Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration")
                .target("31").load().migrate();

        assertThat(result.migrationsExecuted).isEqualTo(1);
        assertThat(jdbc.queryForList("""
                SELECT id || ' ' || status || ' ' || coalesce(CAST(current_line_id AS text), '-') || ' '
                       || to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                FROM reading_sessions ORDER BY status, id
                """, String.class))
                .containsExactlyInAnyOrder(
                        stopped + " in_progress " + third + " 2026-09-01",
                        open + " in_progress " + first + " 2026-09-01",
                        completed + " completed - 2026-09-01");
        assertThatThrownBy(() -> jdbc.update(session, UUID.randomUUID(), script, USER, nina, first, third, "stopped", third))
                .as("멈춤은 더 받지 않는다").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("reading.script: V33 은 기존 대본의 raw_hash 를 Java 의 ScriptText.hash 와 같은 값으로 채우고, 나누기 요청·동의·작업 종류의 값 목록을 넓힌다")
    void v33BackfillsRawHashLikeJavaAndWidensTheValueLists() throws Exception {
        String url = PostgresContainerSupport.createDatabase("reading_v33");
        Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration").target("31").load().migrate();
        var jdbc = new JdbcTemplate(dataSource(url));
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", USER);
        // 맥의 NFD 한글, 줄 앞 U+200B, 탭·NBSP·전각 공백·CRLF, BOM — 운영 대본에서 본 모양들.
        List<String> texts = List.of(
                "윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.",
                "\u110B\u1172\u11AB\u1109\u1165: 여기 있을 줄 알았어.",
                "\u200B윤서:\t여기\u00A0있을\u3000줄 알았어.\r\n\r\n  태오: 어떻게 알았어.  ",
                "\uFEFF\u2028제1막\u2029\n\u0085윤서: 안녕",
                "윤서: 여기 있을 줄 알았어.");
        List<UUID> ids = new ArrayList<>();
        for (String text : texts) {
            UUID id = UUID.randomUUID();
            ids.add(id);
            jdbc.update("""
                    INSERT INTO scripts(id,user_id,title,raw_text,source,request_id,request_fingerprint)
                    VALUES (?,?,'대본',?,'paste',?,?)
                    """, id, USER, text, UUID.randomUUID(), "a".repeat(64));
        }

        var result = Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration")
                .target("33").load().migrate();

        assertThat(result.migrationsExecuted).isEqualTo(1);
        for (int index = 0; index < texts.size(); index++) {
            assertThat(jdbc.queryForObject("SELECT raw_hash FROM scripts WHERE id=?", String.class, ids.get(index)))
                    .as("SQL 과 Java 가 같은 글을 같은 해시로: " + texts.get(index))
                    .isEqualTo(ScriptText.hash(texts.get(index)));
        }
        // 공백·U+200B 만 다른 세 번째 글은 첫 글과, NFD 로 온 두 번째 글은 NFC 인 다섯째 글과 같은 글이다.
        assertThat(jdbc.queryForList("SELECT DISTINCT raw_hash FROM scripts WHERE id IN (?,?)", String.class,
                ids.get(0), ids.get(2))).hasSize(1);
        assertThat(jdbc.queryForList("SELECT DISTINCT raw_hash FROM scripts WHERE id IN (?,?)", String.class,
                ids.get(1), ids.get(4))).hasSize(1);
        assertThat(jdbc.queryForList("SELECT DISTINCT raw_hash FROM scripts", String.class)).hasSize(3);
        // 이 판 앞으로 되돌린 서버는 이 칸을 모른다 — 그 INSERT 도 통한다.
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,source,request_id,request_fingerprint)
                VALUES (gen_random_uuid(),?,'대본','원문','paste',gen_random_uuid(),?)
                """, USER, "b".repeat(64));

        UUID job = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status)
                VALUES (?,?,'script_split',?,gen_random_uuid(),?,'pending')
                """, job, USER, UUID.randomUUID(), "c".repeat(64));
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (gen_random_uuid(),'script_split','v1','대본 나누기','본문',false,now())
                """);
        String imports = """
                INSERT INTO script_imports(id,user_id,request_id,request_fingerprint,source,raw_text,raw_hash,job_id,script_id,failure,
                                           done_lines,total_lines)
                VALUES (gen_random_uuid(),'%s',gen_random_uuid(),'%s','paste','원문','%s',%s,%s,%s,%d,%d)
                """;
        jdbc.update(imports.formatted(USER, "d".repeat(64), "0".repeat(64), "'" + job + "'", "NULL", "NULL", 150, 300));
        jdbc.update(imports.formatted(USER, "d".repeat(64), "0".repeat(64), "NULL", "gen_random_uuid()", "NULL", 0, 0));
        jdbc.update(imports.formatted(USER, "d".repeat(64), "0".repeat(64), "'" + job + "'", "NULL", "'not_script'", 0, 17));
        for (String rejected : List.of(
                // 값 목록 밖의 실패 종류와 입력 경로, 성공과 실패가 함께, 진행이 전체를 넘음
                imports.formatted(USER, "d".repeat(64), "0".repeat(64), "NULL", "NULL", "'timeout'", 0, 0),
                imports.formatted(USER, "d".repeat(64), "0".repeat(64), "NULL", "NULL", "NULL", 0, 0).replace("'paste'", "'email'"),
                imports.formatted(USER, "d".repeat(64), "0".repeat(64), "NULL", "gen_random_uuid()", "'failed'", 0, 0),
                imports.formatted(USER, "d".repeat(64), "0".repeat(64), "NULL", "NULL", "NULL", 5, 4))) {
            assertThatThrownBy(() -> jdbc.update(rejected)).as(rejected).isInstanceOf(DataIntegrityViolationException.class);
        }
    }

    /** V12 까지 온 DB — dev·운영처럼 baseline 기록만 있거나(옛 태그 서버가 있던 자리), 신규 환경처럼 V1 부터 밟았거나. */
    private static String databaseAtV12(String name, boolean baselined) throws Exception {
        String url = PostgresContainerSupport.createDatabase(name);
        if (baselined) {
            applyRawBaseline(url);
            flywayFor(url).baseline();
        }
        Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration")
                .target("12").load().migrate();
        return url;
    }
}
