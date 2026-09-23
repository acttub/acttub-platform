package com.acttub.actingapi.flyway;

import static com.acttub.actingapi.flyway.FlywaySupport.connect;
import static com.acttub.actingapi.flyway.FlywaySupport.dataSource;
import static com.acttub.actingapi.flyway.FlywaySupport.scalar;
import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.util.List;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.SchemaFingerprint;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>되돌릴 수 있는가</b> — 1.0.0 스키마가 올라간 DB 에서 직전 태그의 서버가 그대로 뜨고 옛 자료를 읽는지를
 * 스키마로 못박는다 (02-practice 「1.0.0 스키마 전환」, BRANCHING-STRATEGY 「DB와 배포 안전성」).
 *
 * <p>롤백은 <b>Flyway 를 되감는 것이 아니다.</b> 되감을 수 없으므로(내리기 마이그레이션이 없다) 대신
 * "새 것을 더하기만 한다" 를 지킨다. 그러면 옛 서버는 자기가 아는 표만 보고 새 표는 존재조차 모른다.
 *
 * <p>여기서 보는 것 둘:
 *
 * <ol>
 *   <li><b>옛 표의 모양이 한 칸도 바뀌지 않았다</b> — V13(1.0.0 직전)까지 적용한 DB 와 전부 적용한 DB 의
 *       fingerprint 를 옛 표만 추려 견준다. 하나라도 다르면 옛 서버의 {@code validate} 가 죽는다.</li>
 *   <li><b>새 표는 더해지기만 했다</b> — 표가 늘기만 하고 사라지지 않았다. Hibernate 의 {@code validate}
 *       는 <b>매핑이 없는 여분 표를 보지 않으므로</b>(이 저장소의 모든 @SpringBootTest 가 매 실행 증명한다 —
 *       {@code EntityMappingIT.AWAITING_MAPPING} 의 표들이 매핑 없이 존재한다) 그 여분은 부팅을 막지 못한다.</li>
 * </ol>
 *
 * <p>사람이 따로 밟아야 하는 절차(직전 태그 이미지를 띄워 옛 화면으로 읽기)는 보고서에 적는다 — 그것은
 * 배포 파이프라인의 일이고 여기서 재현할 수 있는 것은 스키마까지다.
 */
class PracticeRollbackCompatibilityTest {

    /** 1.0.0 이 넓히기를 시작하기 직전의 판. 이 뒤로는 <b>더하기만</b> 했다. */
    private static final String BEFORE_ONE_ZERO = "13";

    /**
     * 롤백한 옛 서버가 읽어야 하는 표들. 1.0.0 이 새로 만든 표와 {@code flyway_schema_history} 만 빼면
     * 나머지는 전부 여기 든다 — 굳이 이름을 적는 것은 "무엇이 옛 것인가" 가 이 검사의 전제이기 때문이다.
     */
    private static final List<String> NEW_IN_ONE_ZERO = List.of(
            "videos", "video_transcripts", "practices", "analyses", "coach_conversations",
            "coach_messages", "coach_notes", "actor_memories", "practice_feedback", "ai_jobs",
            "practice_migration_entries", "challenges", "challenge_entries", "entry_likes", "user_blocks",
            "entry_view_events", "entry_ranking_snapshots", "entry_saves", "entry_comments", "entry_reports");

    @Test
    @DisplayName("1.0.0 은 옛 표를 한 칸도 바꾸지 않았다 — 예약 장부에 더한 NULL 허용 컬럼 셋과 users 의 둘 "
            + "말고는 V13 의 모양 그대로다")
    void expandingToOneZeroLeavesEveryLegacyTableUntouched() throws Exception {
        List<String> before = fingerprintAt(BEFORE_ONE_ZERO);
        List<String> after = fingerprintAt(null);

        List<String> legacyBefore = legacyLines(before);
        List<String> legacyAfter = legacyLines(after);

        assertThat(legacyAfter)
                .as("옛 표의 모양이 바뀌면 롤백한 서버의 ddl-auto: validate 가 죽는다")
                .containsExactlyElementsOf(withExpectedAdditions(legacyBefore));
    }

    @Test
    @DisplayName("1.0.0 은 표를 더하기만 했다 — V13 에 있던 표가 하나도 사라지지 않았고 새 표는 매핑 없이 남아 "
            + "옛 서버의 validate 가 무시한다")
    void expandingToOneZeroOnlyAddsTables() throws Exception {
        List<String> before = tableNames(fingerprintAt(BEFORE_ONE_ZERO));
        List<String> after = tableNames(fingerprintAt(null));

        assertThat(after).containsAll(before);
        assertThat(after).containsAll(NEW_IN_ONE_ZERO);
        assertThat(after).hasSize(before.size() + NEW_IN_ONE_ZERO.size());
    }

    @Test
    @DisplayName("V13 까지만 적용한 DB 에도 1.0.0 마이그레이션을 이어 붙일 수 있다 — 되돌렸다가 다시 올리는 "
            + "길이 막히지 않는다")
    void theOneZeroMigrationsApplyOnTopOfTheVersionBeforeThem() throws Exception {
        String jdbcUrl = PostgresContainerSupport.createDatabase("rollback_forward");
        Flyway.configure().dataSource(dataSource(jdbcUrl))
                .locations("classpath:db/migration")
                .target(BEFORE_ONE_ZERO)
                .load()
                .migrate();

        var result = FlywaySupport.flywayFor(jdbcUrl).migrate();

        assertThat(result.migrationsExecuted).isEqualTo(NEW_MIGRATIONS);
        try (Connection connection = connect(jdbcUrl)) {
            assertThat(scalar(connection,
                    "SELECT count(*) FROM information_schema.tables "
                            + "WHERE table_schema='public' AND table_name='practice_migration_entries'"))
                    .isEqualTo(1L);
        }
    }

    /** V14~V19 — 연습·챌린지가 더한 마이그레이션의 수. 더 늘면 이 값을 함께 올린다. */
    private static final int NEW_MIGRATIONS = 6;

    private static List<String> fingerprintAt(String target) throws Exception {
        String jdbcUrl = PostgresContainerSupport.createDatabase(
                "rollback_" + (target == null ? "latest" : "v" + target));
        var configuration = Flyway.configure()
                .dataSource(dataSource(jdbcUrl))
                .locations("classpath:db/migration");
        if (target != null) {
            configuration = configuration.target(target);
        }
        configuration.load().migrate();
        try (Connection connection = connect(jdbcUrl)) {
            return SchemaFingerprint.of(connection);
        }
    }

    /** 1.0.0 이 새로 만든 표의 줄을 뺀 나머지 — 롤백한 서버가 보는 것이다. */
    private static List<String> legacyLines(List<String> fingerprint) {
        return fingerprint.stream()
                .filter(line -> NEW_IN_ONE_ZERO.stream().noneMatch(table -> mentions(line, table)))
                .toList();
    }

    /**
     * V14 가 옛 표에 더한 것 — 예약 장부의 NULL 허용 컬럼 셋과 그 FK·부분 인덱스, 그리고 {@code users} 의
     * 둘이다. <b>더한 것뿐이고 바꾼 것은 없다</b>: 옛 서버는 모르는 컬럼을 select 하지 않고, NULL 허용이라
     * 옛 서버의 INSERT 도 그대로 통한다.
     */
    private static List<String> withExpectedAdditions(List<String> legacyBefore) {
        List<String> expected = new java.util.ArrayList<>(legacyBefore);
        expected.addAll(List.of(
                "COLUMN upload_intents.request_id ord=13 type=uuid len=- null=YES default=-",
                "COLUMN upload_intents.request_fingerprint ord=14 type=bpchar len=64 null=YES default=-",
                "COLUMN upload_intents.video_id ord=15 type=uuid len=- null=YES default=-",
                "COLUMN users.exit_survey_asked_at ord=11 type=timestamptz len=- null=YES default=-",
                "COLUMN users.memory_epoch ord=12 type=int4 len=- null=NO default=0",
                "CONSTRAINT users users_memory_epoch_not_null NOT NULL memory_epoch",
                "INDEX CREATE UNIQUE INDEX uq_upload_intents_user_request ON public.upload_intents "
                        + "USING btree (user_id, request_id) WHERE (request_id IS NOT NULL)"));
        return expected.stream().sorted().toList();
    }

    private static List<String> tableNames(List<String> fingerprint) {
        return fingerprint.stream()
                .filter(line -> line.startsWith("TABLE "))
                .map(line -> line.substring("TABLE ".length()).trim())
                .toList();
    }

    /**
     * 그 줄이 그 표를 말하는가. fingerprint 의 다섯 갈래를 모두 본다 —
     * {@code COLUMN <표>.<칸>}, {@code CONSTRAINT <표> …}(FK 의 {@code REFERENCES <표>(} 포함),
     * {@code INDEX … ON public.<표> …}, {@code TABLE <표>}, {@code SEQUENCE <표>_…}.
     */
    private static boolean mentions(String line, String table) {
        return line.startsWith("COLUMN " + table + ".")
                || line.startsWith("CONSTRAINT " + table + " ")
                || line.contains("REFERENCES " + table + "(")
                || line.contains(" ON public." + table + " ")
                || line.equals("TABLE " + table)
                || line.startsWith("SEQUENCE " + table + "_");
    }
}
