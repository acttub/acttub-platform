package com.acttub.actingapi.feature.profile.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import com.acttub.actingapi.feature.profile.app.AirbridgeLookupStore.Lookup;
import com.acttub.actingapi.feature.profile.app.ProfileRepository.PhotoUpload;
import com.acttub.actingapi.feature.profile.domain.DiscoveryAnswer;
import com.acttub.actingapi.feature.profile.domain.NotificationSettings;
import com.acttub.actingapi.feature.profile.domain.Profile;
import com.acttub.actingapi.feature.profile.domain.SignupAttribution;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * profile 의 저장소가 자기 표에 보내는 문장의 결과·경계·잠금·문장 수를 실제 PostgreSQL 에서 고정한다. 네이티브 SQL 을 JPA 로
 * 옮기기 전에 네이티브 구현에서 먼저 통과시킨다(apps/api/CONTRACT.md §5-9).
 *
 * <p>HTTP 쪽 응답과 값 검증은 {@code SignupAttributionIT}·{@code AirbridgeDeviceIT}·{@code DiscoveryAnswerIT}·
 * {@code AccountProfileIT} 가, 사진 올리기와 정리 장부의 재시도는 {@code AccountWritesAndPhotoCleanupIT} 가, 탈퇴·이관의
 * 표별 결과와 문장 차례는 {@code AccountLifecycleFreezeIT} 가 본다. 여기서는 그 테스트가 밟지 않는 모든 칸, 시각의 경계와 정밀도,
 * 처음 값만 남기기, 지우는 범위, 트랜잭션 없이 부를 때, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.profile.adapter.db.ProfileStoreIT$Recorder"
})
// 이 클래스만 쓰는 설정이라 끝나면 닫는다(PracticeDeletionStoreIT 와 같은 까닭).
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ProfileStoreIT {

    /** 이 스레드가 보낸 SQL 을 모은다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    private static final String DEVICE = "11111111-2222-3333-4444-555555555555";
    private static final String OTHER_DEVICE = "66666666-7777-8888-9999-000000000000";

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PostgresProfileRepository profiles;

    @Autowired
    PostgresAirbridgeLookupStore lookups;

    @Autowired
    PostgresProfileAccountErasure erasure;

    @Autowired
    PostgresObjectCleanupLedger cleanups;

    @Autowired
    AccountSecrets secrets;

    @Autowired
    PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-11-27T03:00:00Z");
    private UUID user;
    private UUID other;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        user = user("active");
        other = user("active");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- Airbridge 재조회 장부(PostgresAirbridgeLookupStore) ----

    @Test
    @DisplayName("due 는 다음 시도 시각이 지금과 같거나 앞선 줄을 그 시각 순으로 limit 개까지 모든 칸과 함께 돌려준다")
    void dueReturnsRowsWhoseTimeHasCome() {
        UUID later = user("active");
        lookup(user, "ios", DEVICE, now.minusSeconds(3600).plusNanos(123_000), 2, now);
        lookup(other, "android", OTHER_DEVICE, now.minusSeconds(7200), 0, now.minusSeconds(60));
        lookup(later, "ios", DEVICE, now, 0, now.plusNanos(1_000));

        assertThat(lookups.due(now, 10)).containsExactly(
                new Lookup(other, "android", OTHER_DEVICE, now.minusSeconds(7200), 0),
                new Lookup(user, "ios", DEVICE, now.minusSeconds(3600).plusNanos(123_000), 2));
        assertThat(lookups.due(now, 1)).extracting(Lookup::userId).containsExactly(other);
        assertThat(lookups.due(now.minusSeconds(3600), 10)).isEmpty();
    }

    @Test
    @DisplayName("hasAttribution 은 유입 기록이 있는지만 본다. delete 는 그 계정의 줄만 지우고 없는 줄은 그냥 지나간다")
    void hasAttributionAndDelete() {
        attribution(user, "airbridge", "ios", now);
        lookup(user, "ios", DEVICE, now, 0, now);
        lookup(other, "android", OTHER_DEVICE, now, 0, now);

        assertThat(lookups.hasAttribution(user)).isTrue();
        assertThat(lookups.hasAttribution(other)).isFalse();

        lookups.delete(user);
        lookups.delete(UUID.randomUUID());
        assertThat(jdbc.queryForList("SELECT user_id FROM user_airbridge_device_lookups", UUID.class)).containsExactly(other);
    }

    @Test
    @DisplayName("retryAt 은 시도 수를 하나 올리고 다음 시도 시각을 마이크로초로 반올림해 적는다. 다른 줄과 없는 줄은 그대로다")
    void retryAtCountsAndPostpones() {
        lookup(user, "ios", DEVICE, now, 1, now);
        lookup(other, "android", OTHER_DEVICE, now, 0, now);

        lookups.retryAt(user, now.plusSeconds(600).plusNanos(1_500));
        lookups.retryAt(UUID.randomUUID(), now);

        assertThat(lookupRow(user)).isEqualTo("ios:" + DEVICE + ":2:03:10:00.000002");
        assertThat(lookupRow(other)).isEqualTo("android:" + OTHER_DEVICE + ":0:03:00:00.000000");
    }

    @Test
    @DisplayName("retryAt 은 다른 트랜잭션이 FOR KEY SHARE 로 잡은 줄을 기다리지 않고 고치고, delete 는 그 잠금 뒤에서 기다린다")
    void retryAtPassesKeyShareButDeleteWaits() throws Exception {
        lookup(user, "ios", DEVICE, now, 0, now);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lockLookup(probe, user, "FOR KEY SHARE");
            pool.submit(() -> lookups.retryAt(user, now.plusSeconds(60))).get(20, TimeUnit.SECONDS);

            Future<?> deleted = pool.submit(() -> lookups.delete(user));
            assertThat(awaitWaiting("delete from user_airbridge_device_lookups")).isTrue();
            probe.rollback();
            deleted.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_airbridge_device_lookups", Integer.class)).isZero();
    }

    // ---- 유입 기록·기기 ID·유입 경로 답 넣기(PostgresProfileRepository) ----

    @Test
    @DisplayName("recordSignupAttribution 은 모든 칸을 적고 처음 값만 남긴다. 다시 보내도 참이다. 탈퇴했거나 없는 계정은 거짓이고 적지 않는다")
    void recordSignupAttributionKeepsTheFirst() {
        SignupAttribution first = new SignupAttribution("airbridge", "ios", "instagram", null, "fall", "group",
                "creative", "content", "term", "publisher");
        SignupAttribution second = new SignupAttribution("web_utm", "web", "naver", "cpc", null, null, null, null, null, null);

        assertThat(profiles.recordSignupAttribution(user, first, "server")).isTrue();
        assertThat(profiles.recordSignupAttribution(user, second, "web")).isTrue();
        assertThat(profiles.recordSignupAttribution(other, second, "web")).isTrue();

        assertThat(attributionRow(user))
                .isEqualTo("airbridge|ios|instagram|-|fall|group|creative|content|term|publisher|server");
        assertThat(attributionRow(other)).isEqualTo("web_utm|web|naver|cpc|-|-|-|-|-|-|web");
        assertThat(jdbc.queryForObject(
                "SELECT bool_and(recorded_at > now() - interval '1 minute') FROM user_signup_attributions", Boolean.class))
                .as("적은 시각은 DB 기본값(트랜잭션 시작 시각)이다").isTrue();

        UUID closed = user("deactivated");
        assertThat(profiles.recordSignupAttribution(closed, first, "app")).isFalse();
        assertThat(profiles.recordSignupAttribution(UUID.randomUUID(), first, "app")).isFalse();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_signup_attributions", Integer.class)).isEqualTo(2);
    }

    @Test
    @DisplayName("recordAirbridgeDevice 는 유입 기록이 없을 때만 첫 기기 ID 를 남긴다. 시도 수 0, 만든 시각과 다음 시도 시각은 같은 DB 기본값이다")
    void recordAirbridgeDeviceOnlyWithoutAttribution() {
        attribution(other, "airbridge", "android", now);

        assertThat(profiles.recordAirbridgeDevice(user, "ios", DEVICE)).isTrue();
        assertThat(profiles.recordAirbridgeDevice(user, "android", OTHER_DEVICE)).isTrue();
        assertThat(profiles.recordAirbridgeDevice(other, "ios", DEVICE)).as("유입 기록이 이미 있다").isTrue();

        assertThat(jdbc.queryForList("""
                SELECT user_id || ':' || platform || ':' || device_uuid || ':' || attempts || ':' || (created_at = next_attempt_at)
                       || ':' || (created_at > now() - interval '1 minute')
                FROM user_airbridge_device_lookups
                """, String.class)).containsExactly(user + ":ios:" + DEVICE + ":0:true:true");

        UUID closed = user("deactivated");
        assertThat(profiles.recordAirbridgeDevice(closed, "ios", DEVICE)).isFalse();
        assertThat(profiles.recordAirbridgeDevice(UUID.randomUUID(), "ios", DEVICE)).isFalse();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_airbridge_device_lookups", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("recordDiscoveryAnswer 는 처음 답만 남기고 건너뛴 답(모두 NULL)도 한 줄이다. 탈퇴했거나 없는 계정은 거짓이고 적지 않는다")
    void recordDiscoveryAnswerKeepsTheFirst() {
        assertThat(profiles.recordDiscoveryAnswer(user, new DiscoveryAnswer("instagram", "ad", null))).isTrue();
        assertThat(profiles.recordDiscoveryAnswer(user, new DiscoveryAnswer("other", null, "친구 추천"))).isTrue();
        assertThat(profiles.recordDiscoveryAnswer(other, new DiscoveryAnswer(null, null, null))).isTrue();

        assertThat(answerRow(user)).isEqualTo("instagram|ad|-");
        assertThat(answerRow(other)).isEqualTo("-|-|-");
        assertThat(jdbc.queryForObject(
                "SELECT bool_and(answered_at > now() - interval '1 minute') FROM user_discovery_answers", Boolean.class))
                .isTrue();

        UUID closed = user("deactivated");
        assertThat(profiles.recordDiscoveryAnswer(closed, new DiscoveryAnswer("friend", null, null))).isFalse();
        assertThat(profiles.recordDiscoveryAnswer(UUID.randomUUID(), new DiscoveryAnswer("friend", null, null))).isFalse();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_discovery_answers", Integer.class)).isEqualTo(2);
    }

    // ---- 지우기 ----

    @Test
    @DisplayName("이관은 닫힐 게스트의 유입 기록·기기 ID·답만 지운다. 부르는 쪽의 트랜잭션에 얹히고, 트랜잭션 없이 부르면 거절한다")
    void discardTransferredGuestRemovesOnlyTheGuestsRows() {
        seedEverything(user);
        seedEverything(other);

        assertThatThrownBy(() -> profiles.discardTransferredGuest(user)).isInstanceOf(InvalidDataAccessApiUsageException.class);
        assertThatThrownBy(() -> profiles.discardTransferredGuestAnswer(user))
                .isInstanceOf(InvalidDataAccessApiUsageException.class);
        assertThat(owners()).containsExactlyInAnyOrder("lookup:" + other, "lookup:" + user, "answer:" + other,
                "answer:" + user, "attribution:" + other, "attribution:" + user);

        inTransaction(() -> profiles.discardTransferredGuest(user));
        assertThat(owners()).containsExactlyInAnyOrder("lookup:" + other, "answer:" + other, "answer:" + user,
                "attribution:" + other);
        inTransaction(() -> profiles.discardTransferredGuestAnswer(user));
        assertThat(owners()).containsExactlyInAnyOrder("lookup:" + other, "answer:" + other, "attribution:" + other);
    }

    @Test
    @DisplayName("deleteExpiredWebAttributions 는 기준 시각보다 앞선 web_utm 만 지우고(같은 시각은 남긴다) 지운 수를 돌려준다")
    void deleteExpiredWebAttributionsKeepsTheBoundary() {
        UUID boundary = user("active");
        UUID airbridge = user("active");
        Instant before = now.minusSeconds(86_400);
        attribution(user, "web_utm", "web", before.minusNanos(1_000));
        attribution(boundary, "web_utm", "web", before);
        attribution(airbridge, "airbridge", "ios", before.minusSeconds(86_400));

        assertThat(profiles.deleteExpiredWebAttributions(before)).isEqualTo(1);
        assertThat(profiles.deleteExpiredWebAttributions(before)).isZero();
        assertThat(jdbc.queryForList("SELECT user_id FROM user_signup_attributions", UUID.class))
                .containsExactlyInAnyOrder(boundary, airbridge);
    }

    @Test
    @DisplayName("탈퇴의 유입 단계는 그 계정의 유입 기록과 기기 ID 를, 답 단계는 답을 지우고 장부에 올린 것은 없다. 트랜잭션 없이는 거절한다")
    void accountErasureRemovesOnlyTheUsersRows() {
        seedEverything(user);
        seedEverything(other);

        assertThatThrownBy(() -> erasure.erase(AccountErasureStep.SIGNUP_ATTRIBUTION, closing(user)))
                .isInstanceOf(InvalidDataAccessApiUsageException.class);
        assertThat(owners()).hasSize(6);

        assertThat(inTransaction(() -> erasure.erase(AccountErasureStep.SIGNUP_ATTRIBUTION, closing(user)))).isEmpty();
        assertThat(owners()).containsExactlyInAnyOrder("lookup:" + other, "answer:" + other, "answer:" + user,
                "attribution:" + other);
        assertThat(inTransaction(() -> erasure.erase(AccountErasureStep.DISCOVERY_ANSWER, closing(user)))).isEmpty();
        assertThat(owners()).containsExactlyInAnyOrder("lookup:" + other, "answer:" + other, "attribution:" + other);
    }

    // ---- 프로필 방향·알림 읽기·올리던 사진 읽기(PostgresProfileRepository) ----

    @Test
    @DisplayName("saveProfile 은 방향을 통째로 갈아 끼운다 — 지우고 고른 것마다 한 줄(id 는 줄마다 다르다). 탈퇴했거나 없는 계정은 null 이고 아무것도 바꾸지 않는다")
    void saveProfileReplacesDirections() {
        profileRow(other);
        jdbc.update("INSERT INTO user_profile_directions(user_id,direction) VALUES (?,'stage')", other);

        assertThat(profiles.saveProfile(user, profile(List.of("stage", "media")), "app/0.1.4").profile().directions())
                .containsExactly("media", "stage");
        assertThat(directions(user)).containsExactly("media", "stage");
        assertThat(jdbc.queryForObject("SELECT count(DISTINCT id) FROM user_profile_directions", Integer.class)).isEqualTo(3);

        assertThat(profiles.saveProfile(user, profile(List.of("media")), null).profile().directions()).containsExactly("media");
        assertThat(directions(user)).containsExactly("media");
        assertThat(profiles.saveProfile(user, profile(List.of()), null).profile().directions()).isEmpty();
        assertThat(directions(user)).isEmpty();
        assertThat(directions(other)).containsExactly("stage");

        UUID closed = user("deactivated");
        profileRow(closed);
        jdbc.update("INSERT INTO user_profile_directions(user_id,direction) VALUES (?,'media')", closed);
        assertThat(profiles.saveProfile(closed, profile(List.of("stage")), null)).isNull();
        assertThat(directions(closed)).containsExactly("media");
        assertThat(profiles.saveProfile(UUID.randomUUID(), profile(List.of("stage")), null)).isNull();
    }

    @Test
    @DisplayName("notificationSettings 는 프로필이 없으면 null, 있으면 세 토글을 읽는다")
    void notificationSettingsReadsTheToggles() {
        assertThat(profiles.notificationSettings(user)).isNull();
        profileRow(user);
        assertThat(profiles.notificationSettings(user)).isEqualTo(new NotificationSettings(true, true, true));
        jdbc.update("UPDATE user_profiles SET notify_analysis_done=false, notify_evening_reminder=false WHERE user_id=?", user);
        assertThat(profiles.notificationSettings(user)).isEqualTo(new NotificationSettings(false, true, false));
    }

    @Test
    @DisplayName("pendingPhotoUpload 는 올리던 사진이 있을 때만 네 칸을 돌려준다(크기는 long, 시한은 마이크로초)")
    void pendingPhotoUploadReadsTheUpload() {
        assertThat(profiles.pendingPhotoUpload(user)).isNull();
        profileRow(user);
        assertThat(profiles.pendingPhotoUpload(user)).isNull();
        jdbc.update("""
                UPDATE user_profiles
                SET photo_upload_key='users/u/profile/p.jpg', photo_upload_mime_type='image/jpeg',
                    photo_upload_size_bytes=3000000000, photo_upload_expires_at=?
                WHERE user_id=?
                """, timestamp(now.plusNanos(123_000)), user);
        assertThat(profiles.pendingPhotoUpload(user))
                .isEqualTo(new PhotoUpload("users/u/profile/p.jpg", "image/jpeg", 3_000_000_000L, now.plusNanos(123_000)));
    }

    // ---- 정리 장부 넣기(PostgresObjectCleanupLedger) ----

    @Test
    @DisplayName("정리 장부 넣기는 종류마다 모든 칸을 적는다 — 첫 시도는 지금과 미룰 시각 가운데 늦은 쪽, 기한은 그 7일 뒤, 시각은 마이크로초로 반올림한다")
    void cleanupLedgerWritesEveryColumn() {
        Instant at = now.plusNanos(1_500);
        UUID later = inTransaction(() -> cleanups.schedule(user, List.of("users/a/photo.jpg"), at, at.plusSeconds(3600)));
        UUID earlier = inTransaction(() -> cleanups.schedule(user, List.of("users/a/1.mp4", "users/a/1.jpg"), at,
                at.minusSeconds(60)));
        UUID recording = inTransaction(() -> cleanups.schedule(user, List.of("users/a/r.m4a"), at));
        UUID video = inTransaction(() -> cleanups.scheduleObjectDelete(other, List.of("users/b/v.mp4"), at, at.plusSeconds(60)));
        UUID provider = inTransaction(() -> cleanups.enqueue(user, "kakao_unlink", "d1:kakao", at));
        UUID customer = inTransaction(() -> cleanups.enqueueCustomerDeletion(user, "d1:customer", at));

        assertThat(cleanupRow(later)).isEqualTo(user + "|object_delete|0|04:00:00.000002|12-04 04:00:00.000002|03:00:00.000002|03:00:00.000002|-");
        assertThat(secrets.decrypt(payload(later))).isEqualTo("[\"users/a/photo.jpg\"]");
        assertThat(cleanupRow(earlier)).isEqualTo(user + "|object_delete|0|03:00:00.000002|12-04 03:00:00.000002|03:00:00.000002|03:00:00.000002|-");
        assertThat(secrets.decrypt(payload(earlier))).isEqualTo("[\"users/a/1.mp4\",\"users/a/1.jpg\"]");
        assertThat(cleanupRow(recording)).isEqualTo(user + "|reading_recording_delete|0|03:00:00.000002|12-04 03:00:00.000002|03:00:00.000002|03:00:00.000002|-");
        assertThat(secrets.decrypt(payload(recording))).isEqualTo("[\"users/a/r.m4a\"]");
        assertThat(cleanupRow(video)).isEqualTo(other + "|object_delete|0|03:01:00.000002|12-04 03:01:00.000002|03:00:00.000002|03:00:00.000002|-");
        assertThat(cleanupRow(provider)).isEqualTo(user + "|kakao_unlink|0|03:00:00.000002|12-04 03:00:00.000002|03:00:00.000002|03:00:00.000002|-");
        assertThat(payload(provider)).isEqualTo("d1:kakao");
        assertThat(cleanupRow(customer)).isEqualTo(user + "|revenuecat_delete|0|03:00:00.000002|12-04 03:00:00.000002|03:00:00.000002|03:00:00.000002|-");
        assertThat(payload(customer)).isEqualTo("d1:customer");
    }

    @Test
    @DisplayName("정리 장부 넣기는 부르는 쪽의 트랜잭션에 얹힌다 — 트랜잭션 없이 부르면 거절하고, 부르는 쪽이 되돌리면 줄도 없다")
    void cleanupLedgerJoinsTheCallersTransaction() {
        assertThatThrownBy(() -> cleanups.schedule(user, List.of("users/a/photo.jpg"), now, now))
                .isInstanceOf(InvalidDataAccessApiUsageException.class);
        new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
            cleanups.schedule(user, List.of("users/a/photo.jpg"), now, now);
            tx.setRollbackOnly();
        });
        assertThat(jdbc.queryForObject("SELECT count(*) FROM account_cleanup_operations", Integer.class)).isZero();
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류(유입 기록·기기 ID·유입 경로 답)")
    void eachPortMethodSendsTheseStatements() {
        lookup(other, "ios", DEVICE, now, 0, now);
        assertThat(statementsOf(() -> lookups.due(now, 10))).containsExactly("select user_airbridge_device_lookups");
        assertThat(statementsOf(() -> lookups.hasAttribution(other))).containsExactly("select user_signup_attributions");
        assertThat(statementsOf(() -> lookups.retryAt(other, now))).containsExactly("update user_airbridge_device_lookups");
        assertThat(statementsOf(() -> lookups.delete(other))).containsExactly("delete user_airbridge_device_lookups");

        SignupAttribution attribution = new SignupAttribution("airbridge", "ios", "instagram", null, null, null, null, null,
                null, null);
        assertThat(statementsOf(() -> profiles.recordSignupAttribution(user, attribution, "app")))
                .containsExactly("select users for update", "insert user_signup_attributions on conflict");
        assertThat(statementsOf(() -> profiles.recordAirbridgeDevice(other, "ios", DEVICE)))
                .containsExactly("select users for update",
                        "insert user_airbridge_device_lookups user_signup_attributions on conflict");
        assertThat(statementsOf(() -> profiles.recordDiscoveryAnswer(user, new DiscoveryAnswer("friend", null, null))))
                .containsExactly("select users for update", "insert user_discovery_answers on conflict");
        assertThat(statementsOf(() -> profiles.recordSignupAttribution(user("deactivated"), attribution, "app")))
                .as("탈퇴한 계정은 잠가 보고 끝난다").containsExactly("select users for update");

        assertThat(statementsOf(() -> inTransaction(() -> profiles.discardTransferredGuest(user))))
                .containsExactly("delete user_signup_attributions", "delete user_airbridge_device_lookups");
        assertThat(statementsOf(() -> inTransaction(() -> profiles.discardTransferredGuestAnswer(user))))
                .containsExactly("delete user_discovery_answers");
        assertThat(statementsOf(() -> profiles.deleteExpiredWebAttributions(now)))
                .containsExactly("delete user_signup_attributions");
        assertThat(statementsOf(() -> inTransaction(() -> erasure.erase(AccountErasureStep.SIGNUP_ATTRIBUTION, closing(user)))))
                .containsExactly("delete user_signup_attributions", "delete user_airbridge_device_lookups");
        assertThat(statementsOf(() -> inTransaction(() -> erasure.erase(AccountErasureStep.DISCOVERY_ANSWER, closing(user)))))
                .containsExactly("delete user_discovery_answers");
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류(프로필 방향·알림 읽기·올리던 사진 읽기·정리 장부 넣기)")
    void eachProfileAndLedgerMethodSendsTheseStatements() {
        assertThat(statementsOf(() -> profiles.saveProfile(user, profile(List.of("stage", "media")), null)))
                .containsExactly("select users for update", "insert user_profiles users on conflict",
                        "delete user_profile_directions", "insert user_profile_directions", "insert user_profile_directions",
                        "select user_identities user_profile_directions user_profiles users");
        assertThat(statementsOf(() -> profiles.notificationSettings(user))).containsExactly("select user_profiles");
        assertThat(statementsOf(() -> profiles.pendingPhotoUpload(user))).containsExactly("select user_profiles");
        assertThat(statementsOf(() -> inTransaction(() -> cleanups.schedule(user, List.of("users/a/photo.jpg"), now, now))))
                .containsExactly("insert account_cleanup_operations");
    }

    // ---- 도움 ----

    private static final Pattern KIND = Pattern.compile("^(select|insert|update|delete)\\b.*");
    private static final Pattern TABLE = Pattern.compile(
            "\\b(?:from|join|into|update) (?!(?:set|skip|of|nowait|lateral)\\b)(\\w+)\\b");

    /** 문장을 "<종류> <문장에 나오는 표(가나다 순)>[ on conflict][ for update]" 로 줄인다. 별칭·열 목록은 견주지 않는다. */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        Matcher kind = KIND.matcher(text);
        if (!kind.matches()) {
            return text;
        }
        TreeSet<String> tables = new TreeSet<>();
        Matcher table = TABLE.matcher(text);
        while (table.find()) {
            tables.add(table.group(1));
        }
        return kind.group(1) + " " + String.join(" ", tables) + (text.contains(" on conflict") ? " on conflict" : "")
                + (text.contains(" for update") ? " for update" : "");
    }

    private List<String> statementsOf(Runnable call) {
        Recorder.STATEMENTS.get().clear();
        call.run();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(ProfileStoreIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    private <T> T inTransaction(java.util.function.Supplier<T> call) {
        return new TransactionTemplate(transactionManager).execute(tx -> call.get());
    }

    private void inTransaction(Runnable call) {
        new TransactionTemplate(transactionManager).executeWithoutResult(tx -> call.run());
    }

    private ClosingAccount closing(UUID userId) {
        return new ClosingAccount(userId, false, now, LocalDate.of(2026, 11, 27));
    }

    private UUID user(String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,?)", id, status);
        return id;
    }

    private void attribution(UUID userId, String source, String platform, Instant recordedAt) {
        jdbc.update("""
                INSERT INTO user_signup_attributions(user_id,source,platform,channel,recorded_at)
                VALUES (?,?,?,'instagram',?)
                """, userId, source, platform, timestamp(recordedAt));
    }

    private void lookup(UUID userId, String platform, String device, Instant createdAt, int attempts, Instant nextAttemptAt) {
        jdbc.update("""
                INSERT INTO user_airbridge_device_lookups(user_id,platform,device_uuid,created_at,attempts,next_attempt_at)
                VALUES (?,?,?,?,?,?)
                """, userId, platform, device, timestamp(createdAt), attempts, timestamp(nextAttemptAt));
    }

    private void seedEverything(UUID userId) {
        attribution(userId, "airbridge", "ios", now);
        lookup(userId, "ios", DEVICE, now, 0, now);
        jdbc.update("INSERT INTO user_discovery_answers(user_id,source) VALUES (?,'friend')", userId);
    }

    private void profileRow(UUID userId) {
        jdbc.update("INSERT INTO user_profiles(user_id,name) VALUES (?,'이름')", userId);
    }

    private static Profile profile(List<String> directions) {
        return new Profile("김배우", "female", LocalDate.of(2001, 3, 14), directions, "exam_prep", "audition", null, "소개");
    }

    private List<String> directions(UUID userId) {
        return jdbc.queryForList("SELECT direction FROM user_profile_directions WHERE user_id=? ORDER BY direction",
                String.class, userId);
    }

    /** 정리 장부 한 줄의 값 칸 말고 전부. 시각은 UTC 마이크로초. */
    private String cleanupRow(UUID id) {
        return jdbc.queryForObject("""
                SELECT user_id || '|' || kind || '|' || attempt_count || '|'
                       || to_char(next_attempt_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US') || '|'
                       || to_char(expires_at AT TIME ZONE 'UTC', 'MM-DD HH24:MI:SS.US') || '|'
                       || to_char(created_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US') || '|'
                       || to_char(updated_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US') || '|' || coalesce(last_error, '-')
                FROM account_cleanup_operations WHERE id=?
                """, String.class, id);
    }

    private String payload(UUID id) {
        return jdbc.queryForObject("SELECT payload_encrypted FROM account_cleanup_operations WHERE id=?", String.class, id);
    }

    /** 세 표의 줄을 "표:주인" 으로. */
    private List<String> owners() {
        return jdbc.queryForList("""
                SELECT 'lookup:' || user_id FROM user_airbridge_device_lookups
                UNION ALL SELECT 'answer:' || user_id FROM user_discovery_answers
                UNION ALL SELECT 'attribution:' || user_id FROM user_signup_attributions
                """, String.class);
    }

    private String attributionRow(UUID userId) {
        return jdbc.queryForObject("""
                SELECT concat_ws('|', source, platform, channel, coalesce(medium, '-'), coalesce(campaign, '-'),
                                 coalesce(ad_group, '-'), coalesce(ad_creative, '-'), coalesce(content, '-'),
                                 coalesce(term, '-'), coalesce(sub_publisher, '-'), recorded_via)
                FROM user_signup_attributions WHERE user_id=?
                """, String.class, userId);
    }

    private String answerRow(UUID userId) {
        return jdbc.queryForObject("""
                SELECT concat_ws('|', coalesce(source, '-'), coalesce(detail, '-'), coalesce(other_text, '-'))
                FROM user_discovery_answers WHERE user_id=?
                """, String.class, userId);
    }

    private String lookupRow(UUID userId) {
        return jdbc.queryForObject("""
                SELECT platform || ':' || device_uuid || ':' || attempts || ':'
                       || to_char(next_attempt_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US')
                FROM user_airbridge_device_lookups WHERE user_id=?
                """, String.class, userId);
    }

    private Connection probe() throws SQLException {
        Connection probe = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        probe.setAutoCommit(false);
        return probe;
    }

    private static void lockLookup(Connection probe, UUID userId, String strength) throws SQLException {
        try (PreparedStatement statement = probe.prepareStatement(
                "SELECT 1 FROM user_airbridge_device_lookups WHERE user_id=? " + strength)) {
            statement.setObject(1, userId);
            statement.execute();
        }
    }

    /** {@code fragment} 를 담은 문장이 잠금 뒤에서 기다리면 참이다(소문자, 공백 하나로 줄여 견준다). */
    private boolean awaitWaiting(String fragment) throws InterruptedException {
        for (int attempt = 0; attempt < 1000; attempt++) {
            boolean waiting = jdbc.queryForList("""
                    SELECT lower(regexp_replace(query, '\\s+', ' ', 'g')) FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                    """, String.class).stream().anyMatch(query -> query.contains(fragment));
            if (waiting) {
                return true;
            }
            Thread.sleep(10);
        }
        return false;
    }

    private static OffsetDateTime timestamp(Instant value) {
        return value == null ? null : value.atOffset(ZoneOffset.UTC);
    }
}
