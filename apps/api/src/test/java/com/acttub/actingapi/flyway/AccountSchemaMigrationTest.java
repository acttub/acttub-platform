package com.acttub.actingapi.flyway;

import static com.acttub.actingapi.flyway.FlywaySupport.applyRawBaseline;
import static com.acttub.actingapi.flyway.FlywaySupport.committedCount;
import static com.acttub.actingapi.flyway.FlywaySupport.connect;
import static com.acttub.actingapi.flyway.FlywaySupport.dataSource;
import static com.acttub.actingapi.flyway.FlywaySupport.flywayFor;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.SchemaFingerprint;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 계정 1.0.0 스키마(V9)가 <b>이미 회원이 있는 DB</b> 위에서 넓히기만 하는지 본다 (SOMA-528).
 *
 * <p>V9 은 세 가지를 한다 — 새 테이블을 더하고, 기존 테이블을 넓히고, 옛 닉네임을
 * {@code user_profiles.name} 으로 복사한다. {@code users.nickname} 은 지우지 않는다: 직전 운영
 * 태그의 서버가 그 컬럼을 Entity 에 매핑하고 있어, 삭제는 그것을 안 쓰는 코드와 한 릴리스에
 * 묶지 않는다({@code docs/BRANCHING-STRATEGY.md} 「DB와 배포 안전성」).
 *
 * <p>그래서 이 테스트가 지키는 것은 둘이다. <b>자료가 옮겨졌는가</b>(account.profile 의
 * "1.0.0 이전 회원은 옛 닉네임이 이름 칸에 채워진 프로필 화면을 만난다"), 그리고 <b>옛 서버로
 * 되돌려도 그 서버의 INSERT 가 계속 통하는가</b>.
 */
class AccountSchemaMigrationTest {

    private static final UUID NAMED = UUID.fromString("00000000-0000-4000-8000-000000000701");
    private static final UUID UNNAMED = UUID.fromString("00000000-0000-4000-8000-000000000702");
    private static final UUID BLANK = UUID.fromString("00000000-0000-4000-8000-000000000703");
    private static final UUID WITHDRAWN = UUID.fromString("00000000-0000-4000-8000-000000000704");
    private static final UUID WITHDRAWN_WITH_LEFTOVER =
            UUID.fromString("00000000-0000-4000-8000-000000000705");

    /** V9 이 기존 테이블에 더한 컬럼. 옛 행이 그대로인지 볼 때 이것만 빼고 비교한다. */
    private static final String ADDED_TO_USERS = "ARRAY['age_confirmed_at']";
    private static final String ADDED_TO_IDENTITIES = "ARRAY['uid_hash', 'apple_token_encrypted']";

    @ParameterizedTest(name = "baseline 기록만 있는 DB = {0}")
    @ValueSource(booleans = {false, true})
    @DisplayName("account.profile: 옛 닉네임이 user_profiles.name 으로 복사되고 옛 행은 그대로다")
    void oldNicknamesAreCopiedIntoProfileNamesWithoutTouchingExistingRows(boolean baselined)
            throws Exception {
        String url = databaseAtV8("account_v9_copy", baselined);
        var jdbc = new JdbcTemplate(dataSource(url));
        seedMembersAsTheOldServerWould(jdbc);
        List<String> history = historyUpTo8(jdbc);
        List<String> usersBefore = rows(jdbc, "users", ADDED_TO_USERS);
        List<String> identitiesBefore = rows(jdbc, "user_identities", ADDED_TO_IDENTITIES);

        var result = Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration")
                .target("9").load().migrate();

        assertThat(result.migrationsExecuted).isEqualTo(1);
        assertThat(result.migrations.getFirst().version).isEqualTo("9");
        assertThat(historyUpTo8(jdbc)).containsExactlyElementsOf(history);

        // 이름이 있던 활성 회원만 프로필 행을 얻는다. 나머지 필수 항목은 비어 있어 게이트 대상이다.
        assertThat(jdbc.queryForList("SELECT user_id FROM user_profiles", UUID.class))
                .containsExactly(NAMED);
        assertThat(jdbc.queryForMap("""
                SELECT name, gender, birth_date, experience, goal, photo_key, bio, age_band,
                       notify_analysis_done, notify_challenge, notify_evening_reminder
                FROM user_profiles WHERE user_id=?
                """, NAMED))
                .containsEntry("name", "옛 닉네임")
                .containsEntry("gender", null)
                .containsEntry("birth_date", null)
                .containsEntry("experience", null)
                .containsEntry("goal", null)
                .containsEntry("photo_key", null)
                .containsEntry("bio", null)
                .containsEntry("age_band", null)
                .containsEntry("notify_analysis_done", true)
                .containsEntry("notify_challenge", true)
                .containsEntry("notify_evening_reminder", true);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profile_directions", Long.class)).isZero();

        // 복사이지 이동이 아니다 — 옛 서버로 되돌려도 닉네임이 그대로 보인다.
        assertThat(rows(jdbc, "users", ADDED_TO_USERS)).containsExactlyElementsOf(usersBefore);
        assertThat(rows(jdbc, "user_identities", ADDED_TO_IDENTITIES))
                .containsExactlyElementsOf(identitiesBefore);
        assertThat(jdbc.queryForObject("SELECT nickname FROM users WHERE id=?", String.class, NAMED))
                .isEqualTo("옛 닉네임");
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM users WHERE age_confirmed_at IS NOT NULL
                """, Long.class)).isZero();

        // 그 뒤 마이그레이션까지 전부 올린 자리가 커밋된 fingerprint 와 같다.
        assertThat(flywayFor(url).migrate().migrationsExecuted).isEqualTo(committedCount() - 9);
        try (var connection = connect(url)) {
            assertThat(SchemaFingerprint.of(connection)).containsExactlyElementsOf(SchemaFingerprint.expected());
        }
        assertThat(flywayFor(url).migrate().migrationsExecuted).isZero();
    }

    @Test
    @DisplayName("V9 뒤에도 옛 서버가 쓰던 INSERT 가 그대로 통한다 — 더한 컬럼은 NULL 허용이거나 DEFAULT 다")
    void insertsOfThePreviousReleaseStillWorkAfterTheMigration() throws Exception {
        String url = databaseAtV8("account_v7_rollback", true);
        flywayFor(url).migrate();
        var jdbc = new JdbcTemplate(dataSource(url));

        seedMembersAsTheOldServerWould(jdbc);
        jdbc.update("""
                INSERT INTO consent_documents(id, type, version, title, body, required)
                VALUES (?, 'privacy', 'old-server', '개인정보처리방침', '본문', true)
                """, UUID.randomUUID());

        assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Long.class)).isEqualTo(5);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_identities", Long.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("account.login·account.guest·account.consent·account.withdraw: 넓힌 값과 빈 provider_uid 를 받는다")
    void widenedValueListsAndHashedIdentitiesAreAccepted() throws Exception {
        String url = databaseAtV8("account_v7_values", false);
        flywayFor(url).migrate();
        var jdbc = new JdbcTemplate(dataSource(url));
        jdbc.update("INSERT INTO users(id, status) VALUES (?, 'active')", NAMED);

        for (String provider : List.of("google", "apple", "kakao", "naver", "guest", "development")) {
            jdbc.update("""
                    INSERT INTO user_identities(id, user_id, provider, provider_uid)
                    VALUES (?, ?, ?, ?)
                    """, UUID.randomUUID(), NAMED, provider, "uid-" + provider);
        }
        jdbc.update("""
                INSERT INTO consent_documents(id, type, version, title, body, required)
                VALUES (?, 'retention', '2026-10-01', '탈퇴 후 영상·녹음 보관·활용', '본문', false)
                """, UUID.randomUUID());

        // 탈퇴한 신원은 provider_uid 를 비우고 해시만 남긴다. 같은 제공자 계정이 재가입 뒤 다시
        // 탈퇴하면 같은 해시가 한 번 더 남으므로 해시에는 UNIQUE 가 없다.
        for (int i = 0; i < 2; i++) {
            jdbc.update("""
                    INSERT INTO user_identities(id, user_id, provider, provider_uid, uid_hash)
                    VALUES (?, ?, 'google', NULL, ?)
                    """, UUID.randomUUID(), NAMED, "h".repeat(64));
        }
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO user_identities(id, user_id, provider, provider_uid, uid_hash)
                VALUES (?, ?, 'google', NULL, NULL)
                """, UUID.randomUUID(), NAMED))
                .as("제공자 ID 도 해시도 없는 신원 행은 아무것도 가리키지 않는다")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO user_identities(id, user_id, provider, provider_uid)
                VALUES (?, ?, 'facebook', 'uid')
                """, UUID.randomUUID(), NAMED))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("account.profile·account.portfolio·account.guest: 새 테이블이 값 목록과 주인 삭제를 DB 에서 지킨다")
    void newTablesKeepTheirValueListsAndFollowTheirOwner() throws Exception {
        String url = databaseAtV8("account_v7_tables", false);
        flywayFor(url).migrate();
        var jdbc = new JdbcTemplate(dataSource(url));
        jdbc.update("INSERT INTO users(id, status) VALUES (?, 'active')", NAMED);

        jdbc.update("""
                INSERT INTO user_profiles(user_id, name, gender, birth_date, experience, goal)
                VALUES (?, '김배우', 'unspecified', DATE '2001-03-14', 'y1_to_3', 'audition')
                """, NAMED);
        jdbc.update("INSERT INTO user_profile_directions(user_id, direction) VALUES (?, 'media'), (?, 'stage')",
                NAMED, NAMED);
        jdbc.update("INSERT INTO portfolios(user_id, intro) VALUES (?, '소개글')", NAMED);
        jdbc.update("""
                INSERT INTO portfolio_credits(user_id, title, role, year, kind, sort_order)
                VALUES (?, '작품', '역할', 2025, 'musical', 0)
                """, NAMED);
        jdbc.update("""
                INSERT INTO portfolio_photos(user_id, object_key, mime_type, size_bytes, expires_at)
                VALUES (?, 'portfolio/1.jpg', 'image/jpeg', 1024, now() + interval '15 minutes')
                """, NAMED);
        jdbc.update("""
                INSERT INTO guest_transfer_codes(user_id, code_hash, expires_at)
                VALUES (?, ?, now() + interval '10 minutes')
                """, NAMED, "c".repeat(64));

        assertThat(jdbc.queryForMap("SELECT share_enabled, share_slug FROM portfolios WHERE user_id=?", NAMED))
                .as("공유 링크는 기본 꺼짐이고 slug 는 처음 켤 때 생긴다")
                .containsEntry("share_enabled", false)
                .containsEntry("share_slug", null);
        for (Map.Entry<String, String> rejected : Map.of(
                "UPDATE user_profiles SET gender='other'", "ck_user_profiles_gender",
                "UPDATE user_profiles SET experience='y10'", "ck_user_profiles_experience",
                "UPDATE user_profiles SET goal='fame'", "ck_user_profiles_goal",
                "UPDATE user_profiles SET age_band=23", "ck_user_profiles_age_band",
                "UPDATE user_profile_directions SET direction='voice'", "ck_user_profile_directions_direction",
                "UPDATE portfolio_credits SET kind='web'", "ck_portfolio_credits_kind").entrySet()) {
            assertThatThrownBy(() -> jdbc.update(rejected.getKey()))
                    .isInstanceOf(DataIntegrityViolationException.class)
                    .hasMessageContaining(rejected.getValue());
        }
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO user_profile_directions(user_id, direction) VALUES (?, 'media')", NAMED))
                .as("같은 방향을 두 번 고를 수 없다")
                .isInstanceOf(DataIntegrityViolationException.class);

        // 만 14세 미만 가입은 계정을 행째 지운다 — 매달린 행이 그 삭제를 막지 않는다.
        jdbc.update("DELETE FROM users WHERE id=?", NAMED);
        for (String table : List.of("user_profiles", "user_profile_directions", "portfolios",
                "portfolio_credits", "portfolio_photos", "guest_transfer_codes")) {
            assertThat(jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class))
                    .as(table).isZero();
        }
    }

    @Test
    @DisplayName("account.guest·account.withdraw: V12 은 이미 겹친 미사용 이관 코드를 늦은 것 하나만 남기고 유일성을 걸며, 쓰인 코드와 기존 회원 행은 그대로다")
    void v12KeepsTheLatestUnusedCodeAndThenEnforcesUniqueness() throws Exception {
        String url = PostgresContainerSupport.createDatabase("account_v12_codes");
        Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration")
                .target("11").load().migrate();
        var jdbc = new JdbcTemplate(dataSource(url));
        UUID other = UUID.fromString("00000000-0000-4000-8000-000000000710");
        jdbc.update("INSERT INTO users(id, status) VALUES (?, 'active'), (?, 'active')", NAMED, other);
        // V11 까지의 발급은 겹쳐 온 두 요청을 막지 못했다: 한 게스트의 미사용 코드 둘, 두 게스트의 같은 숫자.
        jdbc.update("""
                INSERT INTO guest_transfer_codes(user_id, code_hash, created_at, expires_at, used_at) VALUES
                    (?, 'older', now() - interval '2 minutes', now() + interval '8 minutes', NULL),
                    (?, 'same',  now() - interval '1 minute',  now() + interval '9 minutes', NULL),
                    (?, 'same',  now(),                        now() + interval '10 minutes', NULL),
                    (?, 'same',  now() - interval '40 days',   now() - interval '40 days', now() - interval '40 days')
                """, NAMED, NAMED, other, other);

        var result = Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration")
                .target("12").load().migrate();

        assertThat(result.migrationsExecuted).isEqualTo(1);
        assertThat(jdbc.queryForList("""
                SELECT user_id::text || ':' || code_hash || ':' || (used_at IS NOT NULL)
                FROM guest_transfer_codes ORDER BY 1
                """, String.class))
                .as("늦게 만든 미사용 코드 하나와, guest_transferred 의 표식인 쓰인 코드")
                .containsExactly(other + ":same:false", other + ":same:true");
        assertThat(jdbc.queryForObject("SELECT retention_purged_at FROM users WHERE id=?",
                java.sql.Timestamp.class, NAMED)).as("더한 컬럼은 NULL 허용이다").isNull();
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO guest_transfer_codes(user_id, code_hash, expires_at)
                VALUES (?, 'second', now() + interval '10 minutes')
                """, other))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_guest_transfer_codes_unused_user");
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO guest_transfer_codes(user_id, code_hash, expires_at)
                VALUES (?, 'same', now() + interval '10 minutes')
                """, NAMED))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_guest_transfer_codes_unused_code_hash");
    }

    /** dev·운영(baseline 기록만)과 신규 환경 두 경로 모두 직전 릴리스의 자리(V6)에 세운다. */
    private static String databaseAtV8(String name, boolean baselined) throws Exception {
        String url = PostgresContainerSupport.createDatabase(name + (baselined ? "_baselined" : "_fresh"));
        if (baselined) {
            applyRawBaseline(url);
            flywayFor(url).baseline();
        }
        Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration")
                .target("8").load().migrate();
        return url;
    }

    /**
     * 직전 릴리스의 서버가 쓰는 컬럼만으로 회원을 만든다({@code PostgresAuthRepository} 의
     * {@code UserEntity} INSERT 와 {@code PostgresProfileRepository#deactivate} 가 남기는 모양).
     */
    private static void seedMembersAsTheOldServerWould(JdbcTemplate jdbc) {
        jdbc.update("INSERT INTO users(id, email, status, nickname) VALUES (?, 'named@example.test', 'active', '옛 닉네임')",
                NAMED);
        jdbc.update("INSERT INTO users(id, email, status, nickname) VALUES (?, NULL, 'active', NULL)", UNNAMED);
        jdbc.update("INSERT INTO users(id, email, status, nickname) VALUES (?, NULL, 'active', '   ')", BLANK);
        jdbc.update("""
                INSERT INTO users(id, email, status, nickname, deactivated_at)
                VALUES (?, NULL, 'deactivated', NULL, now())
                """, WITHDRAWN);
        // 탈퇴는 닉네임을 비우지만, 비지 않은 행이 섞여 있더라도 탈퇴한 사람의 이름을 새로 퍼뜨리지 않는다.
        jdbc.update("""
                INSERT INTO users(id, email, status, nickname, deactivated_at)
                VALUES (?, NULL, 'deactivated', '남은 이름', now())
                """, WITHDRAWN_WITH_LEFTOVER);
        jdbc.update("""
                INSERT INTO user_identities(id, user_id, provider, provider_uid)
                VALUES (?, ?, 'google', 'google-uid')
                """, UUID.randomUUID(), NAMED);
    }

    private static List<String> historyUpTo8(JdbcTemplate jdbc) {
        return jdbc.queryForList(
                "SELECT version || '|' || type || '|' || coalesce(checksum::text, 'null') "
                        + "FROM flyway_schema_history WHERE version::int <= 8 ORDER BY installed_rank", String.class);
    }

    private static List<String> rows(JdbcTemplate jdbc, String table, String addedColumns) {
        return jdbc.queryForList("SELECT (to_jsonb(stored) - " + addedColumns + ")::text FROM "
                + table + " stored ORDER BY id", String.class);
    }
}
