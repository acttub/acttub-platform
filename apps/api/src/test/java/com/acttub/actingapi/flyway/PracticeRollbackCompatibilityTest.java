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
 * <b>되돌릴 수 있는가</b> — 0.1.0 스키마가 올라간 DB 에서 직전 태그의 서버가 그대로 뜨고 옛 자료를 읽는지를
 * 스키마로 못박는다 (specs/practice 「0.1.0 스키마 전환」, BRANCHING-STRATEGY 「DB와 배포 안전성」).
 *
 * <p>롤백은 <b>Flyway 를 되감는 것이 아니다.</b> 되감을 수 없으므로(내리기 마이그레이션이 없다) 대신
 * "새 것을 더하기만 한다" 를 지킨다. 그러면 옛 서버는 자기가 아는 표만 보고 새 표는 존재조차 모른다.
 *
 * <p>여기서 보는 것 둘:
 *
 * <ol>
 *   <li><b>옛 표의 모양이 한 칸도 바뀌지 않았다</b> — V13(0.1.0 직전)까지 적용한 DB 와 전부 적용한 DB 의
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

    /** 0.1.0 이 넓히기를 시작하기 직전의 판. 이 뒤로는 <b>더하기만</b> 했다. */
    private static final String BEFORE_ONE_ZERO = "13";

    /**
     * 롤백한 옛 서버가 읽어야 하는 표들. 0.1.0 이 새로 만든 표와 {@code flyway_schema_history} 만 빼면
     * 나머지는 전부 여기 든다 — 굳이 이름을 적는 것은 "무엇이 옛 것인가" 가 이 검사의 전제이기 때문이다.
     */
    private static final List<String> NEW_IN_ONE_ZERO = List.of(
            "videos", "video_transcripts", "practices", "analyses", "coach_conversations",
            "coach_messages", "coach_notes", "actor_memories", "practice_feedback", "ai_jobs",
            "practice_migration_entries", "challenges", "challenge_entries", "entry_likes", "user_blocks",
            "entry_view_events", "entry_ranking_snapshots", "entry_saves", "entry_comments", "entry_reports",
            "entry_ai_reports", "notifications", "notification_pushes", "note_ratings",
            "reading_voice_cache", "reading_voice_usage", "evening_reminder_sends", "user_signup_attributions",
            "app_posters", "script_imports");

    @Test
    @DisplayName("0.1.0 은 옛 표를 한 칸도 바꾸지 않았다 — 예약 장부에 더한 NULL 허용 컬럼 셋과 users 의 둘, "
            + "리딩 회차의 멈춤을 없앤 V31, 대본의 NULL 허용 같은 글 해시(V33) 말고는 V13 의 모양 그대로다")
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
    @DisplayName("0.1.0 은 표를 더하기만 했다 — V13 에 있던 표가 하나도 사라지지 않았고 새 표는 매핑 없이 남아 "
            + "옛 서버의 validate 가 무시한다")
    void expandingToOneZeroOnlyAddsTables() throws Exception {
        List<String> before = tableNames(fingerprintAt(BEFORE_ONE_ZERO));
        List<String> after = tableNames(fingerprintAt(null));

        assertThat(after).containsAll(before);
        assertThat(after).containsAll(NEW_IN_ONE_ZERO);
        assertThat(after).hasSize(before.size() + NEW_IN_ONE_ZERO.size());
    }

    @Test
    @DisplayName("V13 까지만 적용한 DB 에도 0.1.0 마이그레이션을 이어 붙일 수 있다 — 되돌렸다가 다시 올리는 "
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

    /** V14~V33 — 연습·챌린지·노트 평가·보관함 포스터·고품질 목소리·저녁 알림·가입 유입 출처·신원 마지막 로그인·앱 공지 포스터·배우 기억 칸 개정·리딩 멈춤 없앰·대본 나누기가 더한 마이그레이션의 수. 더 늘면 이 값을 함께 올린다. */
    private static final int NEW_MIGRATIONS = 19;

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

    /** 0.1.0 이 새로 만든 표의 줄을 뺀 나머지 — 롤백한 서버가 보는 것이다. */
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
        // V24 가 동의 문서 종류에 cloud_voice 를 더했다(ADR-033). CHECK 는 옛 서버의 validate 가 보지 않고,
        // 넓히기만 했으므로 옛 값은 그대로 통한다.
        String consentTypesBefore = "CONSTRAINT consent_documents ck_consent_documents_type CHECK ((type = ANY "
                + "(ARRAY['terms'::text, 'privacy'::text, 'ai_analysis'::text, 'retention'::text])))";
        if (expected.remove(consentTypesBefore)) {
            expected.add("CONSTRAINT consent_documents ck_consent_documents_type CHECK ((type = ANY "
                    + "(ARRAY['terms'::text, 'privacy'::text, 'ai_analysis'::text, 'retention'::text, "
                    + "'cloud_voice'::text, 'script_split'::text])))");
        }
        // V31 은 넓히기가 아니라 좁히기다. validate 는 CHECK·인덱스를 보지 않아 옛 서버가 뜨기는 하지만, 옛 서버는 새 연습을
        // 시작할 때 'stopped' 를 써서 이 CHECK 에 걸린다. 그래서 V31 앞의 이미지로는 되돌리지 않는다(V31 머리 주석).
        String readingStatusBefore = "CONSTRAINT reading_sessions ck_reading_sessions_status CHECK ((status = ANY "
                + "(ARRAY['in_progress'::text, 'completed'::text, 'stopped'::text])))";
        if (expected.remove(readingStatusBefore)) {
            expected.add("CONSTRAINT reading_sessions ck_reading_sessions_status CHECK ((status = ANY "
                    + "(ARRAY['in_progress'::text, 'completed'::text])))");
        }
        expected.remove("INDEX CREATE UNIQUE INDEX uq_reading_sessions_open_script ON public.reading_sessions "
                + "USING btree (script_id) WHERE (status = 'in_progress'::text)");
        expected.addAll(List.of(
                "COLUMN upload_intents.request_id ord=13 type=uuid len=- null=YES default=-",
                "COLUMN upload_intents.request_fingerprint ord=14 type=bpchar len=64 null=YES default=-",
                "COLUMN upload_intents.video_id ord=15 type=uuid len=- null=YES default=-",
                "COLUMN push_tokens.app_version ord=8 type=text len=- null=YES default=-",
                "COLUMN users.exit_survey_asked_at ord=11 type=timestamptz len=- null=YES default=-",
                "COLUMN users.memory_epoch ord=12 type=int4 len=- null=NO default=0",
                "CONSTRAINT users users_memory_epoch_not_null NOT NULL memory_epoch",
                // V27 의 마지막 로그인 시각. NOT NULL 이지만 DB 기본값이 있어 이 칸을 모르는 옛 서버의 INSERT 도 통한다.
                "COLUMN user_identities.last_used_at ord=9 type=timestamptz len=- null=NO default=now()",
                "CONSTRAINT user_identities user_identities_last_used_at_not_null NOT NULL last_used_at",
                "INDEX CREATE UNIQUE INDEX uq_upload_intents_user_request ON public.upload_intents "
                        + "USING btree (user_id, request_id) WHERE (request_id IS NOT NULL)",
                // V33 의 같은 글 해시. NULL 허용이라 이 칸을 모르는 옛 서버의 INSERT 도 통한다.
                "COLUMN scripts.raw_hash ord=10 type=bpchar len=64 null=YES default=-",
                "INDEX CREATE INDEX idx_scripts_user_raw_hash ON public.scripts USING btree (user_id, raw_hash)"));
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
