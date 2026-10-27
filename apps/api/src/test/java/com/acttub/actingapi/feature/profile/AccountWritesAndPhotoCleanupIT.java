package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.math.BigInteger;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.portfolio.app.PortfolioService;
import com.acttub.actingapi.feature.profile.app.AccountCleanup;
import com.acttub.actingapi.feature.profile.app.ProfileRepository;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.feature.profile.domain.Profile;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.StubProviders;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 탈퇴와 겹친 회원 자료 쓰기, 그리고 사진 객체의 키를 잃지 않는 정리를 HTTP 와 실제 Postgres 로 본다
 * (account.withdraw · account.profile · account.portfolio).
 *
 * <p>겹침은 DB 의 문(advisory lock)으로 실행 순서만 고정하고 결과는 공개 계약과 저장된 행에서 확인한다.
 * 게이트를 지난 <b>뒤에</b> 탈퇴가 커밋된 요청은 HTTP 로 만들 수 없어(게이트가 먼저 막는다) 같은 저장
 * 이음매를 직접 부른다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "spring.datasource.hikari.maximum-pool-size=10"
})
@AutoConfigureMockMvc
@Import({StubProviders.class, MutableClock.Fixture.class, AccountWithdrawIT.Fixture.class})
class AccountWritesAndPhotoCleanupIT {
    private static final long SAVE_GATE = 528_001L;
    private static String database;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_writes");
        database = name;
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    JwtService jwt;

    @Autowired
    MutableClock clock;

    @Autowired
    AccountCleanup cleanup;

    @Autowired
    ProfileRepository profiles;

    @Autowired
    ProfileService profileService;

    @Autowired
    PortfolioService portfolioService;

    @Autowired
    AccountWithdrawIT.FakeStorage storage;

    @Autowired
    RecordingFailureReporter failures;

    private UUID member;
    private String token;

    @BeforeEach
    void setUp() {
        dropHooks();
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        storage.objects.clear();
        storage.failing.clear();
        failures.clear();
        clock.set(Instant.now());
        member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,status) VALUES (?,?,'active')", member, member + "@example.test");
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        token = jwt.issueAccessToken(member).value();
    }

    @AfterEach
    void dropHooks() {
        jdbc.execute("DROP TRIGGER IF EXISTS hold_profile_save ON user_profiles");
    }

    // ---- 탈퇴와 겹친 쓰기 ----

    @Test
    @DisplayName("account.withdraw: 프로필 저장이 끝나기 전에 다른 기기에서 탈퇴해도 파기한 이름·생년월일·소개가 다시 차지 않는다")
    void accountWithdraw_aProfileSaveOverlappingTheWithdrawalLeavesNothingBehind() throws Exception {
        // 이름이 실린 프로필 쓰기(저장)만 문 앞에 세운다. 탈퇴의 파기는 이름을 비우는 쓰기라 지나간다.
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION hold_profile_save() RETURNS trigger AS $$
                BEGIN
                    IF NEW.name IS NOT NULL THEN
                        PERFORM pg_advisory_xact_lock_shared(%d);
                    END IF;
                    RETURN NEW;
                END
                $$ LANGUAGE plpgsql
                """.formatted(SAVE_GATE));
        jdbc.execute("""
                CREATE TRIGGER hold_profile_save
                BEFORE INSERT OR UPDATE ON user_profiles
                FOR EACH ROW EXECUTE FUNCTION hold_profile_save()
                """);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection gate = DriverManager.getConnection(PostgresContainerSupport.jdbcUrlFor(database),
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword())) {
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_lock(" + SAVE_GATE + ")");
            }
            // 기기 A: 게이트와 사전 조회를 지나 저장 문장에서 멈춘다.
            Future<Integer> saving = pool.submit(() -> authorized(put("/v2/me/profile")
                    .contentType(MediaType.APPLICATION_JSON).content("""
                            {"name":"다시 찬 이름","gender":"female","birth_date":"2001-03-14","directions":["media"],
                             "experience":"exam_prep","goal":"audition","bio":"다시 찬 소개"}
                            """)).getStatus());
            awaitLockWaiters(1);
            // 기기 B: 탈퇴. 저장이 users 행을 잡고 있으면 그 뒤에 줄을 서고, 아니면 먼저 끝난다.
            Future<Integer> withdrawing = pool.submit(() -> authorized(delete("/v2/me")).getStatus());
            awaitUntilDoneOrWaiting(withdrawing, 2);
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_unlock(" + SAVE_GATE + ")");
            }

            assertThat(withdrawing.get()).isEqualTo(200);
            saving.get();
            assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, member))
                    .isEqualTo("deactivated");
            Map<String, Object> profile = jdbc.queryForMap(
                    "SELECT name,birth_date,bio FROM user_profiles WHERE user_id=?", member);
            assertThat(profile).as("탈퇴한 계정의 프로필")
                    .containsEntry("name", null).containsEntry("birth_date", null).containsEntry("bio", null);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("account.withdraw: 게이트를 지난 뒤 탈퇴가 끝난 계정의 쓰기는 아무것도 저장하지 않는다 — 프로필·알림·사진·포트폴리오, 사유는 403 account_deactivated")
    void accountWithdraw_writesArrivingAfterTheWithdrawalStoreNothing() throws Exception {
        assertThat(authorized(delete("/v2/me")).getStatus()).isEqualTo(200);
        Profile again = new Profile("다시 찬 이름", "female", LocalDate.of(2001, 3, 14), List.of("media"),
                "exam_prep", "audition", null, "다시 찬 소개");

        assertThat(profiles.saveProfile(member, again)).as("저장소는 닫힌 계정에 쓰지 않는다").isNull();
        assertThat(profiles.updateNotificationSettings(member, true, null, null)).isNull();
        assertDeactivated(() -> profileService.updateNotificationSettings(member, true, null, null));
        assertDeactivated(() -> profileService.beginPhotoUpload(member, "image/jpeg", BigInteger.valueOf(1_000)));
        assertDeactivated(() -> portfolioService.saveIntro(member, "다시 찬 소개글"));
        assertDeactivated(() -> portfolioService.addCredit(member, "작품", "역할", 2024, "film"));
        assertDeactivated(() -> portfolioService.share(member, true));

        assertThat(jdbc.queryForMap("""
                SELECT name,bio,photo_upload_key,notify_analysis_done FROM user_profiles WHERE user_id=?
                """, member))
                .containsEntry("name", null).containsEntry("bio", null)
                .containsEntry("photo_upload_key", null).containsEntry("notify_analysis_done", false);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM portfolios WHERE user_id=?", Integer.class, member))
                .as("탈퇴가 지운 포트폴리오 행이 되살아나지 않는다").isZero();
    }

    // ---- 사진 객체의 키를 잃지 않는다 ----

    @Test
    @DisplayName("account.profile: 올리다 만 사진의 주소를 다시 받으면 앞의 객체는 그 시한이 지난 뒤 지워진다 — 탈퇴해도 남지 않는다")
    void accountProfile_anAbandonedPhotoUploadIsDeletedOnceItsAddressExpires() throws Exception {
        JsonNode first = json(authorized(photoUpload("/v2/me/photo")), 201);
        String abandoned = pendingProfileKey();
        storage.put(abandoned);

        json(authorized(photoUpload("/v2/me/photo")), 201);

        assertThat(first.path("upload_url").textValue()).contains(abandoned);
        assertThat(pendingProfileKey()).isNotEqualTo(abandoned);
        assertThat(jdbc.queryForObject("SELECT kind FROM account_cleanup_operations", String.class))
                .as("키를 덮는 트랜잭션이 객체 삭제를 장부에 남긴다").isEqualTo("object_delete");
        cleanup.runDue();
        assertThat(storage.objects).as("올리기 주소가 살아 있는 동안에는 지우지 않는다 — 지운 뒤에 올라오면 다시 남는다")
                .containsKey(abandoned);

        assertThat(authorized(delete("/v2/me")).getStatus()).isEqualTo(200);
        clock.advance(Duration.ofMinutes(31));
        cleanup.runDue();

        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("account.profile: 사진을 바꾸거나 지울 때 저장소가 옛 객체를 지우지 못해도 요청은 끝나고, 그 객체는 다시 시도해 지운다")
    void accountProfile_aReplacedPhotoThatCouldNotBeDeletedIsRetried() throws Exception {
        String old = uploadProfilePhoto();
        storage.failing.add(old);

        String current = uploadProfilePhoto();

        assertThat(storage.objects).containsKeys(old, current);
        assertThat(count("account_cleanup_operations")).isEqualTo(1);
        assertThat(failures.contexts()).anyMatch(context -> context.startsWith("AccountCleanup.object_delete"));

        storage.failing.add(current);
        assertThat(authorized(delete("/v2/me/photo")).getStatus()).isEqualTo(204);
        assertThat(count("account_cleanup_operations")).isEqualTo(2);

        storage.failing.clear();
        clock.advance(Duration.ofMinutes(6));
        cleanup.runDue();

        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("account.portfolio: 사진 삭제 도중 저장소가 실패해도 204 이고, 지운 행의 객체는 다시 시도해 지운다")
    void accountPortfolio_aDeletedPhotoWhoseObjectCouldNotBeDeletedIsRetried() throws Exception {
        JsonNode begun = json(authorized(photoUpload("/v2/portfolio/photos")), 201);
        String photoId = begun.path("photo_id").textValue();
        String objectKey = jdbc.queryForObject("SELECT object_key FROM portfolio_photos", String.class);
        storage.objects.put(objectKey, 1_000L);
        json(authorized(post("/v2/portfolio/photos/{id}/complete", photoId)), 200);
        storage.failing.add(objectKey);

        var deleted = authorized(delete("/v2/portfolio/photos/{id}", photoId));

        assertThat(deleted.getStatus()).as(deleted.getContentAsString()).isEqualTo(204);
        assertThat(count("portfolio_photos")).isZero();
        assertThat(storage.objects).containsKey(objectKey);
        assertThat(jdbc.queryForObject("SELECT kind FROM account_cleanup_operations", String.class))
                .isEqualTo("object_delete");

        storage.failing.clear();
        clock.advance(Duration.ofMinutes(6));
        cleanup.runDue();

        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("account.portfolio: 시한이 지난 올리기의 찌꺼기를 지우지 못하면 보고하고 다시 시도한다 — 새 올리기는 막지 않는다")
    void accountPortfolio_expiredUploadLeftoversThatCouldNotBeDeletedAreReportedAndRetried() throws Exception {
        json(authorized(photoUpload("/v2/portfolio/photos")), 201);
        String leftover = jdbc.queryForObject("SELECT object_key FROM portfolio_photos", String.class);
        storage.put(leftover);
        storage.failing.add(leftover);
        clock.advance(Duration.ofMinutes(31));

        json(authorized(photoUpload("/v2/portfolio/photos")), 201);

        assertThat(storage.objects).containsKey(leftover);
        assertThat(count("account_cleanup_operations")).isEqualTo(1);
        assertThat(failures.contexts()).as("바깥 의존의 실패는 삼키지 않는다(ADR-025)")
                .anyMatch(context -> context.startsWith("AccountCleanup.object_delete"));

        storage.failing.clear();
        clock.advance(Duration.ofMinutes(6));
        cleanup.runDue();

        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    // ---- helpers ----

    private static void assertDeactivated(org.assertj.core.api.ThrowableAssert.ThrowingCallable write) {
        assertThatThrownBy(write).isInstanceOfSatisfying(ApiException.class, refused -> {
            assertThat(refused.status()).isEqualTo(403);
            assertThat(refused.getMessage()).isEqualTo("account_deactivated");
        });
    }

    /** 프로필 사진 하나를 올리기 끝까지 마치고 그 객체 키를 돌려준다. */
    private String uploadProfilePhoto() throws Exception {
        json(authorized(photoUpload("/v2/me/photo")), 201);
        String objectKey = pendingProfileKey();
        storage.objects.put(objectKey, 1_000L);
        json(authorized(post("/v2/me/photo/complete")), 200);
        return objectKey;
    }

    private String pendingProfileKey() {
        return jdbc.queryForObject("SELECT photo_upload_key FROM user_profiles WHERE user_id=?", String.class, member);
    }

    private MockHttpServletRequestBuilder photoUpload(String path) throws Exception {
        return post(path).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("content_type", "image/jpeg", "size_bytes", 1_000)));
    }

    private MockHttpServletResponse authorized(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token)).andReturn().getResponse();
    }

    private JsonNode json(MockHttpServletResponse response, int status) throws Exception {
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private int lockWaiters() {
        return jdbc.queryForObject("""
                SELECT count(*) FROM pg_stat_activity
                WHERE datname=current_database() AND wait_event_type='Lock'
                """, Integer.class);
    }

    private void awaitLockWaiters(int expected) throws Exception {
        Instant deadline = Instant.now().plusSeconds(20);
        while (Instant.now().isBefore(deadline)) {
            if (lockWaiters() >= expected) {
                return;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("requests did not reach the expected lock waits: " + expected);
    }

    private void awaitUntilDoneOrWaiting(Future<?> request, int waiters) throws Exception {
        Instant deadline = Instant.now().plusSeconds(20);
        while (Instant.now().isBefore(deadline)) {
            if (request.isDone() || lockWaiters() >= waiters) {
                return;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("the overlapping request neither finished nor waited");
    }
}
