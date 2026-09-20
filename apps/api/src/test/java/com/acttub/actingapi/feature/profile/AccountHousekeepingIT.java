package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.AccountHousekeeping;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.StubProviders;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 계정 영역에서 매일 도는 일. 시계를 돌린 뒤 {@link AccountHousekeeping#runDaily} 를 한 번 실행하고 결과를
 * DB 와 가짜 저장소로 본다(스케줄러는 꺼 둔다). 경계는 하루 앞뒤로 둘씩 세운다 — 지난 것은 없어지고 아직
 * 안 지난 것은 남는다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false"
})
@AutoConfigureMockMvc
@Import({StubProviders.class, MutableClock.Fixture.class, AccountHousekeepingIT.StorageFixture.class})
class AccountHousekeepingIT {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_housekeeping");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    AccountHousekeeping housekeeping;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    MutableClock clock;

    @Autowired
    AccountSecrets secrets;

    @Autowired
    FakeStorage storage;

    @Autowired
    StubProviders.StubKakaoUsers kakao;

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    ObjectMapper mapper;

    private Instant now;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        storage.objects.clear();
        kakao.reset();
        now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        clock.set(now);
    }

    @Test
    @DisplayName("account.login: 만료된 지 31일 된 refresh_tokens 행 — 정리가 돈 뒤 없다. 29일 된 행 — 남아 있다. 폐기된 지 31일 된 행도 없다")
    void accountLogin_refreshTokensAreKeptThirtyDaysAfterTheyEnd() {
        UUID user = user("active", null);
        UUID expiredLongAgo = refreshToken(user, now.minus(Duration.ofDays(31)), null, null);
        UUID expiredRecently = refreshToken(user, now.minus(Duration.ofDays(29)), null, null);
        UUID alive = refreshToken(user, now.plus(Duration.ofDays(10)), null, null);
        UUID revokedRecently = refreshToken(user, now.plus(Duration.ofDays(10)), now.minus(Duration.ofDays(29)), null);
        // 회전된 옛 토큰은 새 토큰을 가리킨다. 둘 다 지울 때가 됐으면 한 번에 지워진다.
        UUID replacement = refreshToken(user, now.plus(Duration.ofDays(1)), now.minus(Duration.ofDays(31)), null);
        UUID rotated = refreshToken(user, now.plus(Duration.ofDays(1)), now.minus(Duration.ofDays(40)), replacement);

        housekeeping.runDaily();

        assertThat(jdbc.queryForList("SELECT id FROM refresh_tokens", UUID.class))
                .containsExactlyInAnyOrder(expiredRecently, alive, revokedRecently)
                .doesNotContain(expiredLongAgo, replacement, rotated);
    }

    @Test
    @DisplayName("account.guest: 마지막 활동 31일 지난 게스트 — 파기 뒤 영상 객체가 없고 users 행은 deactivated 다. 30일이 안 된 게스트와 회원은 그대로다")
    void accountGuest_idleGuestsAreWithdrawnAfterThirtyDays() {
        UUID idle = guest(now.minus(Duration.ofDays(31)));
        video(idle, "videos/idle.mp4", now.minus(Duration.ofDays(31)));
        UUID recentlyBack = guest(now.minus(Duration.ofDays(60)));
        refreshToken(recentlyBack, now.plus(Duration.ofDays(20)), null, null, now.minus(Duration.ofDays(3)));
        video(recentlyBack, "videos/back.mp4", now.minus(Duration.ofDays(60)));
        UUID young = guest(now.minus(Duration.ofDays(29)));
        video(young, "videos/young.mp4", now.minus(Duration.ofDays(29)));
        UUID member = user("active", now.minus(Duration.ofDays(400)));
        identity(member, "google", "g-1", null);
        video(member, "videos/member.mp4", now.minus(Duration.ofDays(400)));

        housekeeping.runDaily();

        assertThat(status(idle)).isEqualTo("deactivated");
        assertThat(storage.objects).doesNotContainKey("videos/idle.mp4");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_identities WHERE user_id=?", Integer.class, idle))
                .as("게스트 신원은 해시 없이 행째 지운다").isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_sessions WHERE user_id=?", Integer.class, idle))
                .as("연습 행은 사람과 끊겨 남는다").isEqualTo(1);
        assertThat(status(recentlyBack)).as("사흘 전에 토큰을 갱신한 게스트").isEqualTo("active");
        assertThat(status(young)).isEqualTo("active");
        assertThat(status(member)).as("회원은 오래 쉬어도 파기하지 않는다").isEqualTo("active");
        assertThat(storage.objects.keySet())
                .containsExactlyInAnyOrder("videos/back.mp4", "videos/young.mp4", "videos/member.mp4");
    }

    @Test
    @DisplayName("account.guest: 옮겨진 게스트는 이미 닫혀 있어 다시 파기하지 않는다 — 옛 토큰의 사유가 guest_transferred 로 남는다")
    void accountGuest_transferredGuestsAreLeftAlone() throws Exception {
        UUID transferred = user("deactivated", now.minus(Duration.ofDays(40)));
        jdbc.update("UPDATE users SET deactivated_at=? WHERE id=?", at(now.minus(Duration.ofDays(20))), transferred);
        code(transferred, now.minus(Duration.ofDays(20)), now.minus(Duration.ofDays(20)));

        housekeeping.runDaily();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM guest_transfer_codes", Integer.class)).isEqualTo(1);
        var response = mvc.perform(get("/v2/me")
                .header("Authorization", "Bearer " + jwt.issueAccessToken(transferred).value()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(response.getContentAsString()).path("detail").textValue())
                .isEqualTo("guest_transferred");
    }

    @Test
    @DisplayName("account.guest: 이관 코드 행은 쓰였거나 시한이 지난 지 30일이 넘은 것만 지운다")
    void accountGuest_transferCodesAreKeptThirtyDays() {
        UUID guest = guest(now);
        UUID usedLongAgo = code(guest, now.minus(Duration.ofDays(31)), now.minus(Duration.ofDays(31)));
        UUID usedRecently = code(guest, now.minus(Duration.ofDays(29)), now.minus(Duration.ofDays(29)));
        UUID expiredLongAgo = code(guest, now.minus(Duration.ofDays(31)), null);
        // 쓰지 않은 코드는 게스트마다 하나다(V12) — 살아 있는 코드는 다른 게스트의 것으로 둔다.
        UUID live = code(guest(now), now.plus(Duration.ofMinutes(5)), null);

        housekeeping.runDaily();

        assertThat(jdbc.queryForList("SELECT id FROM guest_transfer_codes", UUID.class))
                .containsExactlyInAnyOrder(usedRecently, live)
                .doesNotContain(usedLongAgo, expiredLongAgo);
    }

    @Test
    @DisplayName("account.withdraw: 탈퇴 3년 뒤 — user_identities 행과 보관하던 영상 객체가 없다. 3년이 안 된 계정은 그대로다")
    void accountWithdraw_hashesAndRetainedVideosGoAfterThreeYears() {
        Instant threeYearsAndADay = now.atZone(SEOUL).minusYears(3).minusDays(1).toInstant();
        Instant almostThreeYears = now.atZone(SEOUL).minusYears(3).plusDays(1).toInstant();
        UUID longGone = withdrawn(threeYearsAndADay, "videos/kept-three-years.mp4");
        UUID stillKept = withdrawn(almostThreeYears, "videos/kept-less.mp4");

        housekeeping.runDaily();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_identities WHERE user_id=?", Integer.class, longGone))
                .isZero();
        assertThat(storage.objects).doesNotContainKey("videos/kept-three-years.mp4");
        assertThat(status(longGone)).as("users 행은 남는다").isEqualTo("deactivated");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_sessions WHERE user_id=?", Integer.class, longGone))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_identities WHERE user_id=?", Integer.class, stillKept))
                .isEqualTo(1);
        assertThat(storage.objects).containsKey("videos/kept-less.mp4");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM account_cleanup_operations", Integer.class))
                .as("끝난 객체 삭제는 장부에 남지 않는다").isZero();

        // 다음 날 다시 돌아도 같은 결과다 — 한 번 파기한 계정은 다시 고르지 않는다.
        clock.advance(Duration.ofDays(1));
        housekeeping.runDaily();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM account_cleanup_operations", Integer.class)).isZero();
    }

    @Test
    @DisplayName("account.withdraw: 마지막 소셜 신원이 끊긴 뒤 탈퇴한 회원 — 해시 행이 없어도 탈퇴 3년 뒤 보관하던 영상 객체가 없다. 한 번 파기한 계정은 다시 고르지 않는다")
    void accountWithdraw_retainedVideosGoAfterThreeYearsEvenWithoutAHashRow() throws Exception {
        UUID member = user("active", now.minus(Duration.ofDays(100)));
        identity(member, "kakao", "kakao-" + member, null);
        video(member, "videos/kept-without-hash.mp4", now.minus(Duration.ofDays(50)));
        UUID retention = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'retention','v1','탈퇴 후 보관','본문',false,?)
                """, retention, at(now.minus(Duration.ofDays(200))));
        jdbc.update("""
                INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                VALUES (?,?,?,'granted',?)
                """, UUID.randomUUID(), member, retention, at(now.minus(Duration.ofDays(90))));
        // 카카오의 연결 끊기 알림은 그 신원 행만 지우고 계정은 둔다(ProviderDisconnectCallbackIT). 앱 토큰은 살아 있다.
        jdbc.update("DELETE FROM user_identities WHERE user_id=?", member);

        assertThat(mvc.perform(delete("/v2/me").header("Authorization", "Bearer " + jwt.issueAccessToken(member).value()))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
        assertThat(storage.objects).as("보관에 동의했으므로 영상은 남는다").containsKey("videos/kept-without-hash.mp4");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_identities WHERE user_id=?", Integer.class, member))
                .as("해시로 남길 신원이 없었다").isZero();

        clock.set(now.atZone(SEOUL).plusYears(3).plusDays(1).toInstant());
        housekeeping.runDaily();

        assertThat(storage.objects).doesNotContainKey("videos/kept-without-hash.mp4");

        // 다음 날 다시 돌아도 다시 고르지 않는다 — 객체가 (가정으로) 되살아나 있어도 건드리지 않는다.
        storage.objects.put("videos/kept-without-hash.mp4", 100L);
        clock.advance(Duration.ofDays(1));
        housekeeping.runDaily();
        assertThat(storage.objects).containsKey("videos/kept-without-hash.mp4");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM account_cleanup_operations", Integer.class)).isZero();
    }

    @Test
    @DisplayName("account.withdraw: 7일 지난 해제 재시도 — 매일 도는 일이 돌고 나면 그 작업과 암호화한 값이 없다")
    void accountWithdraw_expiredUnlinkRetriesAreDropped() {
        UUID user = user("deactivated", now.minus(Duration.ofDays(9)));
        UUID expired = cleanup(user, "kakao_unlink", now.minus(Duration.ofDays(8)));
        UUID pending = cleanup(user, "kakao_unlink", now.minus(Duration.ofDays(2)));
        kakao.unavailable = true;

        housekeeping.runDaily();

        assertThat(jdbc.queryForList("SELECT id FROM account_cleanup_operations", UUID.class))
                .as("7일이 안 된 것은 남아 다시 시도된다")
                .containsExactly(pending)
                .doesNotContain(expired);
    }

    // ---- helpers ----

    private UUID user(String status, Instant createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status,created_at) VALUES (?,?,COALESCE(?,now()))",
                id, status, createdAt == null ? null : at(createdAt));
        return id;
    }

    private UUID guest(Instant createdAt) {
        UUID id = user("active", createdAt);
        identity(id, "guest", UUID.randomUUID().toString(), null);
        return id;
    }

    private void identity(UUID user, String provider, String providerUid, String uidHash) {
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid,uid_hash) VALUES (?,?,?,?,?)",
                UUID.randomUUID(), user, provider, providerUid, uidHash);
    }

    /** 보관에 동의하고 탈퇴한 사람 — 신원은 해시만, 영상 객체는 남아 있다. */
    private UUID withdrawn(Instant deactivatedAt, String objectKey) {
        UUID id = user("deactivated", deactivatedAt.minus(Duration.ofDays(100)));
        jdbc.update("UPDATE users SET deactivated_at=? WHERE id=?", at(deactivatedAt), id);
        identity(id, "google", null, secrets.identityHash("google", "g-" + id));
        video(id, objectKey, deactivatedAt.minus(Duration.ofDays(50)));
        return id;
    }

    private void video(UUID owner, String objectKey, Instant createdAt) {
        UUID upload = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,created_at,expires_at,finalized_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',100,?,?,?)
                """, upload, owner, objectKey, at(createdAt), at(createdAt.plusSeconds(3600)), at(createdAt));
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,blockage_kind,sub_branch,goal,created_at)
                VALUES (?,?,?,'analyzed','상황','인물','분석','캐릭터 분석','목표',?)
                """, UUID.randomUUID(), owner, upload, at(createdAt));
        storage.objects.put(objectKey, 100L);
    }

    private UUID refreshToken(UUID user, Instant expiresAt, Instant revokedAt, UUID replacedBy) {
        return refreshToken(user, expiresAt, revokedAt, replacedBy, expiresAt.minus(Duration.ofDays(30)));
    }

    private UUID refreshToken(UUID user, Instant expiresAt, Instant revokedAt, UUID replacedBy, Instant issuedAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO refresh_tokens(id,user_id,token_hash,issued_at,expires_at,revoked_at,replaced_by_id)
                VALUES (?,?,?,?,?,?,?)
                """, id, user, id.toString().replace("-", "") + id.toString().replace("-", ""),
                at(issuedAt), at(expiresAt), revokedAt == null ? null : at(revokedAt), replacedBy);
        return id;
    }

    private UUID code(UUID guest, Instant expiresAt, Instant usedAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO guest_transfer_codes(id,user_id,code_hash,expires_at,used_at) VALUES (?,?,?,?,?)",
                id, guest, "hash-" + id, at(expiresAt), usedAt == null ? null : at(usedAt));
        return id;
    }

    private UUID cleanup(UUID user, String kind, Instant createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO account_cleanup_operations(id,user_id,kind,payload_encrypted,next_attempt_at,expires_at,created_at)
                VALUES (?,?,?,?,?,?,?)
                """, id, user, kind, secrets.encrypt("987654321"), at(createdAt),
                at(createdAt.plus(Duration.ofDays(7))), at(createdAt));
        return id;
    }

    private String status(UUID user) {
        return jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, user);
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageFixture {
        @Bean
        @Primary
        FakeStorage fakeStorage() {
            return new FakeStorage();
        }
    }

    /** 메모리의 오브젝트 스토리지. 무엇이 남아 있는지만 안다. */
    static final class FakeStorage implements ObjectStorage {
        final Map<String, Long> objects = new ConcurrentHashMap<>();

        @Override
        public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
            return "https://storage.test/put/" + objectKey;
        }

        @Override
        public String presignPlayback(String objectKey, int expiresInSeconds) {
            return "https://storage.test/get/" + objectKey;
        }

        @Override
        public StoredObjectMetadata head(String objectKey) {
            Long size = objects.get(objectKey);
            return size == null ? null : new StoredObjectMetadata(size, "video/mp4", "etag");
        }

        @Override
        public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void delete(String objectKey) {
            objects.remove(objectKey);
        }
    }
}
