package com.acttub.actingapi.flyway;

import static com.acttub.actingapi.flyway.FlywaySupport.applyRawBaseline;
import static com.acttub.actingapi.flyway.FlywaySupport.dataSource;
import static com.acttub.actingapi.flyway.FlywaySupport.flywayFor;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 리딩 스키마(V13)가 <b>계정 1.0.0 까지 온 DB</b> 위에서 넓히기만 하는지 본다 (SOMA-546, ADR-031).
 *
 * <p>V13 은 새 테이블 여섯을 만들고 정리 장부의 값 목록에 종류 하나를 더한다. 그래서 지키는 것은 둘이다 —
 * 옛 서버가 쓰던 장부 INSERT 가 그대로 통하는가, 그리고 새 테이블이 값 목록·배역 이름·대사의 배역·열린 회차
 * 하나를 DB 에서 지키는가. 빈 DB 에서의 전체 적용은 {@code FlywayBaselineTest} 의 fingerprint 가 본다.
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
    @DisplayName("reading.script·reading.session: 새 테이블이 값 목록, 배역 이름의 공백·유일, 대사의 배역, 대본당 열린 회차 하나를 DB 에서 지킨다")
    void theReadingTablesEnforceTheirRulesInTheDatabase() throws Exception {
        String url = PostgresContainerSupport.createDatabase("reading_v13_rules");
        Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration").load().migrate();
        var jdbc = new JdbcTemplate(dataSource(url));
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", USER);
        UUID script = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,source,request_id,request_fingerprint)
                VALUES (?,?,'대본','원문','paste',?,?)
                """, script, USER, UUID.randomUUID(), "a".repeat(64));
        UUID nina = UUID.randomUUID();
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'니나',0)", nina, script);

        for (String rejected : List.of(
                // 값 목록 밖의 입력 경로
                "INSERT INTO scripts(id,user_id,title,raw_text,source,request_id,request_fingerprint) VALUES (gen_random_uuid(),'"
                        + USER + "','x','x','email',gen_random_uuid(),'" + "b".repeat(64) + "')",
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
        assertThatThrownBy(() -> jdbc.update(session.formatted(script, USER, nina, line, line, "in_progress", line)))
                .as("열린 회차는 대본당 하나다").isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update(session.formatted(script, USER, nina, line, line, "stopped", line));
        assertThatThrownBy(() -> jdbc.update(session.formatted(script, USER, nina, line, line, "paused", line)))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (gen_random_uuid(),?,?,'maybe')
                """, USER, line))
                .isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (gen_random_uuid(),?,?,'memorized')", USER, line);
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (gen_random_uuid(),?,?,'not_yet')", USER, line))
                .as("(사람, 줄)마다 하나다").isInstanceOf(DataIntegrityViolationException.class);
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
