package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.analysis.app.AnalysisResult;
import com.acttub.actingapi.feature.analysis.app.AnalysisStore;
import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.AccountCleanup;
import com.acttub.actingapi.integration.observation.ObservationItem;
import com.acttub.actingapi.integration.observation.ObservationPack;
import com.acttub.actingapi.integration.observation.SpeechFacts;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.StubProviders;
import com.fasterxml.jackson.databind.JsonNode;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * account.withdraw 의 "검증 방법"을 HTTP 와 실제 Postgres 로 본다.
 *
 * <p>바깥은 전부 스텁이다 — 제공자 해제({@link StubProviders}), 오브젝트 스토리지({@link FakeStorage}),
 * 실패 보고({@link RecordingFailureReporter}), 시계({@link MutableClock}). "영상 객체가 없다"·"연결
 * 끊기 호출이 실패해도"는 스텁의 상태로 확인한다. 다시 시도하는 일은 스케줄러를 끄고
 * {@link AccountCleanup#runDue} 를 직접 부른다.
 *
 * <p>여기서 보지 못하는 것: 제공자의 "연결된 서비스" 목록에서 실제로 사라지는지(사람이 확인), 챌린지
 * 댓글·참여작(그 테이블이 아직 없다), 탈퇴 3년 뒤의 파기(매일 도는 일), 폰의 앱 저장소(앱 갈래).
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ACCOUNT_CLEANUP_ENABLED=false"})
@AutoConfigureMockMvc
@Import({StubProviders.class, MutableClock.Fixture.class, AccountWithdrawIT.Fixture.class})
class AccountWithdrawIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_withdraw");
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
    AccountSecrets secrets;

    @Autowired
    AccountCleanup cleanup;

    @Autowired
    AnalysisStore analysis;

    @Autowired
    FakeStorage storage;

    @Autowired
    RecordingFailureReporter failures;

    @Autowired
    StubProviders.StubAppleTokens apple;

    @Autowired
    StubProviders.StubKakaoUsers kakao;

    @Autowired
    StubProviders.StubNaverTokens naver;

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private String address;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        documents.clear();
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            UUID id = UUID.randomUUID();
            documents.put(type, id);
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, id, type, type + " 제목", type + " 본문", !"retention".equals(type), PUBLISHED);
        }
        address = "10.4.0." + ADDRESSES.incrementAndGet();
        clock.set(Instant.now().truncatedTo(ChronoUnit.SECONDS));
        storage.objects.clear();
        failures.clear();
        apple.reset();
        kakao.reset();
        naver.reset();
    }

    @Test
    @DisplayName("account.withdraw: 탈퇴 뒤 DB — users 행은 남고 이메일이 없으며, 신원은 해시만 남고, 토큰과 포트폴리오는 없고, 배우 기억은 남는다")
    void accountWithdraw_destroysWhatIdentifiesAndKeepsTheRest() throws Exception {
        Member member = member("google", "g-1|actor@example.test|verified", "declined");
        jdbc.update("""
                UPDATE user_profiles
                SET name='김배우',gender='female',birth_date=?,experience='exam_prep',goal='audition',
                    photo_key='users/p/profile/photo.jpg',bio='입시 준비 중입니다',
                    photo_upload_key='users/p/profile/pending.jpg',photo_upload_mime_type='image/jpeg',
                    photo_upload_size_bytes=10,photo_upload_expires_at=now()
                WHERE user_id=?
                """, java.sql.Date.valueOf(today().minusYears(27)), member.id());
        jdbc.update("INSERT INTO user_profile_directions(user_id,direction) VALUES (?,'stage') ON CONFLICT DO NOTHING",
                member.id());
        jdbc.update("INSERT INTO push_tokens(user_id,token,platform) VALUES (?,'ExponentPushToken[w]','ios')",
                member.id());
        jdbc.update("INSERT INTO actor_memory_entries(id,user_id,field,value,written_by) VALUES (?,?,'goal','입시 합격','actor')",
                UUID.randomUUID(), member.id());
        jdbc.update("INSERT INTO portfolios(user_id,intro,share_enabled,share_slug) VALUES (?,'소개',true,'slug-1')",
                member.id());
        jdbc.update("""
                INSERT INTO portfolio_photos(id,user_id,object_key,mime_type,size_bytes,sort_order,expires_at,uploaded_at)
                VALUES (?,?,'users/p/portfolio/1.jpg','image/jpeg',10,0,now(),now())
                """, UUID.randomUUID(), member.id());
        jdbc.update("INSERT INTO portfolio_credits(id,user_id,title,role,year,kind,sort_order) VALUES (?,?,'작품','역',2025,'film',0)",
                UUID.randomUUID(), member.id());
        jdbc.update("INSERT INTO guest_transfer_codes(id,user_id,code_hash,expires_at) VALUES (?,?,'hash',now() + interval '10 minutes')",
                UUID.randomUUID(), member.id());
        storage.put("users/p/profile/photo.jpg", "users/p/profile/pending.jpg", "users/p/portfolio/1.jpg");

        var response = withdraw(member.accessToken());

        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = mapper.readTree(response.getContentAsString());
        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder("status", "deactivated_at");
        assertThat(body.path("status").textValue()).isEqualTo("deactivated");
        assertThat(body.path("deactivated_at").textValue()).isEqualTo(
                jdbc.queryForObject("SELECT deactivated_at FROM users WHERE id=?", java.sql.Timestamp.class, member.id())
                        .toInstant().toString().replace("Z", ".000000Z"));

        assertThat(jdbc.queryForMap("SELECT email,nickname,status FROM users WHERE id=?", member.id()))
                .containsEntry("email", null)
                .containsEntry("nickname", null)
                .containsEntry("status", "deactivated");
        Map<String, Object> identity = jdbc.queryForMap(
                "SELECT provider,provider_uid,uid_hash FROM user_identities WHERE user_id=?", member.id());
        assertThat(identity).containsEntry("provider", "google").containsEntry("provider_uid", null);
        assertThat(identity.get("uid_hash")).isEqualTo(secrets.identityHash("google", "g-1"));
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE user_id=? AND revoked_at IS NULL", Integer.class, member.id()))
                .as("리프레시 토큰은 전부 폐기").isZero();
        assertThat(count("push_tokens")).isZero();
        assertThat(count("guest_transfer_codes")).isZero();
        assertThat(count("portfolios")).isZero();
        assertThat(count("portfolio_credits")).isZero();
        assertThat(count("portfolio_photos")).isZero();
        assertThat(count("actor_memory_entries")).as("배우 기억은 사람과 끊겨 남는다").isEqualTo(1);

        // 탈퇴한 사람의 프로필 속성: 이름·사진·소개는 없고 성별·연령대·방향·경력·목표만 남아 있다.
        Map<String, Object> profile = jdbc.queryForMap("SELECT * FROM user_profiles WHERE user_id=?", member.id());
        assertThat(profile)
                .containsEntry("name", null)
                .containsEntry("photo_key", null)
                .containsEntry("bio", null)
                .containsEntry("birth_date", null)
                .containsEntry("photo_upload_key", null)
                .containsEntry("age_band", 25)
                .containsEntry("gender", "female")
                .containsEntry("experience", "exam_prep")
                .containsEntry("goal", "audition")
                .containsEntry("notify_analysis_done", false)
                .containsEntry("notify_challenge", false)
                .containsEntry("notify_evening_reminder", false);
        assertThat(jdbc.queryForList(
                "SELECT direction FROM user_profile_directions WHERE user_id=? ORDER BY direction", String.class, member.id()))
                .containsExactly("media", "stage");

        assertThat(storage.objects).as("사진 객체는 보관 동의와 무관하게 지운다").isEmpty();
        assertThat(count("account_cleanup_operations")).as("끝난 정리는 장부에 남지 않는다").isZero();
    }

    @Test
    @DisplayName("account.withdraw: 탈퇴 뒤 옛 액세스 토큰으로 API 호출 — 403. 같은 토큰으로 탈퇴를 다시 요청 — 200 이고 탈퇴 시각이 처음 값 그대로다")
    void accountWithdraw_oldTokenIsForbiddenEverywhereButWithdrawalItself() throws Exception {
        Member member = member("google", "g-1|actor@example.test|verified", "declined");
        JsonNode first = mapper.readTree(withdraw(member.accessToken()).getContentAsString());
        clock.advance(Duration.ofHours(3));

        var me = mvc.perform(get("/v2/me").header("Authorization", "Bearer " + member.accessToken()))
                .andReturn().getResponse();
        var practice = mvc.perform(get("/v2/practice-sessions").header("Authorization", "Bearer " + member.accessToken()))
                .andReturn().getResponse();
        var again = withdraw(member.accessToken());

        for (var blocked : List.of(me, practice)) {
            assertThat(blocked.getStatus()).isEqualTo(403);
            assertThat(mapper.readTree(blocked.getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"account_deactivated\"}"));
        }
        assertThat(again.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(again.getContentAsString())).as("최초 탈퇴 시각을 유지한다").isEqualTo(first);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_identities WHERE uid_hash IS NOT NULL", Integer.class))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("account.withdraw: 탈퇴 뒤 같은 제공자로 로그인 — 동의 화면이 처음처럼 나오고, 제출하면 새 users 행이 생기며 프로필 게이트가 이어진다. 연습 목록은 비어 있다")
    void accountWithdraw_sameProviderAfterwardsIsABrandNewAccount() throws Exception {
        Member old = member("google", "g-1|actor@example.test|verified", "granted");
        practiceWithVideo(old.id(), "videos/old.mp4", "analyzed");
        withdraw(old.accessToken());

        JsonNode login = login("google", "g-1|actor@example.test|verified");

        assertThat(login.path("result").textValue()).isEqualTo("signup_required");
        assertThat(login.fieldNames()).toIterable()
                .as("이전 계정에 관해 아무것도 묻거나 보여 주지 않는다")
                .containsExactlyInAnyOrder("result", "signup_token", "expires_in", "documents");

        JsonNode created = signup(login.path("signup_token").textValue(), "granted");
        String token = created.path("access_token").textValue();

        assertThat(created.path("user").path("id").textValue()).isNotEqualTo(old.id().toString());
        assertThat(created.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "result", "access_token", "refresh_token", "token_type", "expires_in", "user", "pending_consents");
        assertThat(count("users")).isEqualTo(2);
        var gated = mvc.perform(get("/v2/practice-sessions").header("Authorization", "Bearer " + token))
                .andReturn().getResponse();
        assertThat(gated.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(gated.getContentAsString()).path("detail").textValue()).isEqualTo("profile_required");

        AccountFixtures.completeProfile(jdbc, UUID.fromString(created.path("user").path("id").textValue()));
        var list = mvc.perform(get("/v2/practice-sessions").header("Authorization", "Bearer " + token))
                .andReturn().getResponse();
        assertThat(list.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(list.getContentAsString()).path("sessions")).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_sessions WHERE user_id=?", Integer.class, old.id()))
                .as("옛 연습은 옛 계정에 끊겨 남는다").isEqualTo(1);
    }

    @Test
    @DisplayName("account.withdraw: 애플·카카오·네이버 회원이 탈퇴하면 서버가 제공자 쪽 연결을 끊는다 — 애플 토큰 폐기, 카카오 연결 끊기, 네이버 토큰 폐기")
    void accountWithdraw_serverUnlinksAppleKakaoAndNaver() throws Exception {
        Member appleMember = member("apple", "a-1|apple@example.test|verified", "declined");
        Member kakaoMember = member("kakao", "987654321", "declined");
        Member naverMember = member("naver", "n-1|actor@naver.com", "declined");

        withdraw(appleMember.accessToken());
        withdraw(kakaoMember.accessToken());
        withdraw(naverMember.accessToken());

        assertThat(apple.revokedGrants).containsExactly("apple-grant:apple-code");
        assertThat(kakao.unlinkedUserIds).containsExactly("987654321");
        assertThat(naver.revokedTokens).containsExactly("naver-refresh:n-1|actor@naver.com");
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM user_identities
                WHERE provider_uid IS NOT NULL OR apple_token_encrypted IS NOT NULL OR naver_token_encrypted IS NOT NULL
                """, Integer.class)).as("신원의 제공자 ID 와 토큰은 파기된다").isZero();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("account.withdraw: 구글 회원의 연결 해제는 앱이 SDK 로 한다 — 서버는 아무 제공자도 부르지 않는다")
    void accountWithdraw_googleIsUnlinkedByTheApp() throws Exception {
        withdraw(member("google", "g-1|actor@example.test|verified", "declined").accessToken());

        assertThat(apple.revokedGrants).isEmpty();
        assertThat(kakao.unlinkedUserIds).isEmpty();
        assertThat(naver.revokedTokens).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("account.withdraw: 카카오 연결 끊기 호출이 실패해도 탈퇴는 200 이고 재시도 작업이 한 건 있다. 7일 뒤 — 그 작업과 암호화한 값이 없다")
    void accountWithdraw_failedKakaoUnlinkIsRetriedForSevenDaysAndThenDropped() throws Exception {
        Member member = member("kakao", "987654321", "declined");
        kakao.unavailable = true;

        var response = withdraw(member.accessToken());

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, member.id()))
                .isEqualTo("deactivated");
        Map<String, Object> retry = jdbc.queryForMap("SELECT * FROM account_cleanup_operations");
        assertThat(retry).containsEntry("kind", "kakao_unlink").containsEntry("attempt_count", 1)
                .containsEntry("last_error", "ProviderUnavailable");
        assertThat((String) retry.get("payload_encrypted"))
                .as("해제에 쓸 값은 암호화해 옮긴다").matches("[dk]1:.+").doesNotContain("987654321");
        assertThat(secrets.decrypt((String) retry.get("payload_encrypted"))).isEqualTo("987654321");
        assertThat(failures.contexts()).as("실패는 조용히 묻지 않는다")
                .anyMatch(context -> context.startsWith("AccountCleanup.kakao_unlink"));

        clock.advance(Duration.ofMinutes(4));
        assertThat(cleanup.runDue()).as("아직 다시 시도할 때가 아니다").isZero();
        clock.advance(Duration.ofMinutes(2));
        assertThat(cleanup.runDue()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT attempt_count FROM account_cleanup_operations", Integer.class)).isEqualTo(2);

        clock.advance(Duration.ofDays(7));
        assertThat(cleanup.runDue()).as("기한이 지난 것은 시도하지 않고 치운다").isZero();
        assertThat(count("account_cleanup_operations")).isZero();
        assertThat(kakao.unlinkedUserIds).isEmpty();
    }

    @Test
    @DisplayName("account.withdraw: 실패한 제공자 해제는 제공자가 돌아오면 다시 시도해 끝내고, 끝난 작업과 값은 남지 않는다")
    void accountWithdraw_retrySucceedsOnceTheProviderIsBack() throws Exception {
        Member member = member("naver", "n-1|actor@naver.com", "declined");
        naver.unavailable = true;
        withdraw(member.accessToken());
        assertThat(count("account_cleanup_operations")).isEqualTo(1);

        naver.unavailable = false;
        clock.advance(Duration.ofMinutes(6));

        assertThat(cleanup.runDue()).isEqualTo(1);
        assertThat(naver.revokedTokens).containsExactly("naver-refresh:n-1|actor@naver.com");
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("account.withdraw: 애플 폐기가 7일 뒤에도 실패면 운영자에게 알린다 — 다른 제공자는 알리지 않고 치운다")
    void accountWithdraw_appleRevocationThatNeverSucceedsIsReported() throws Exception {
        Member appleMember = member("apple", "a-1|apple@example.test|verified", "declined");
        Member kakaoMember = member("kakao", "987654321", "declined");
        apple.unavailable = true;
        kakao.unavailable = true;
        withdraw(appleMember.accessToken());
        withdraw(kakaoMember.accessToken());
        failures.clear();

        clock.advance(Duration.ofDays(7).plusSeconds(1));
        cleanup.runDue();

        assertThat(count("account_cleanup_operations")).isZero();
        assertThat(failures.reports())
                .filteredOn(report -> report.failure() instanceof AccountCleanup.AppleRevocationAbandoned)
                .singleElement()
                .satisfies(report -> {
                    assertThat(report.context()).startsWith("AccountCleanup.appleRevocationAbandoned");
                    assertThat(report.failure().getMessage()).doesNotContain("apple-grant");
                });
        assertThat(failures.reports()).as("알림은 애플 하나뿐이다").hasSize(1);
    }

    @Test
    @DisplayName("account.withdraw: 분석이 진행 중일 때 탈퇴 — 작업이 취소되고 결과가 저장되지 않는다")
    void accountWithdraw_cancelsTheAnalysisInProgress() throws Exception {
        Member member = member("google", "g-1|actor@example.test|verified", "declined");
        UUID session = practiceWithVideo(member.id(), "videos/running.mp4", "analyzing");
        UUID operation = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO external_operations(id,session_id,user_id,request_id,kind,status,request_fingerprint)
                VALUES (?,?,?,?,'analyze','pending',?)
                """, operation, session, member.id(), UUID.randomUUID(), "a".repeat(64));
        UUID lease = UUID.randomUUID();
        assertThat(analysis.claimNext(lease, Duration.ofMinutes(5), clock.instant())).isEqualTo(operation);

        withdraw(member.accessToken());

        assertThat(jdbc.queryForMap("SELECT status,error_code,lease_token FROM external_operations WHERE id=?", operation))
                .containsEntry("status", "failed")
                .containsEntry("error_code", "account_deactivated")
                .containsEntry("lease_token", null);
        assertThat(jdbc.queryForObject("SELECT status FROM practice_sessions WHERE id=?", String.class, session))
                .isEqualTo("failed");
        assertThatThrownBy(() -> analysis.complete(operation, lease, analysisResult(), "model", clock.instant()))
                .as("돌고 있던 워커의 완료는 받아들여지지 않는다")
                .isInstanceOf(LeaseOwnershipException.class);
        assertThat(count("summaries")).as("결과가 저장되지 않는다").isZero();
    }

    @Test
    @DisplayName("account.withdraw: 게스트 토큰으로 탈퇴 요청 — 200 이고 게스트 users 행이 deactivated 이며 영상 객체가 없다")
    void accountWithdraw_guestCanWithdrawToo() throws Exception {
        UUID guest = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", guest);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'guest',?)",
                UUID.randomUUID(), guest, UUID.randomUUID().toString());
        practiceWithVideo(guest, "videos/guest.mp4", "analyzed");

        var response = withdraw(jwt.issueAccessToken(guest).value());

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, guest))
                .isEqualTo("deactivated");
        assertThat(storage.objects).doesNotContainKey("videos/guest.mp4");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_sessions WHERE user_id=?", Integer.class, guest))
                .as("연습 행은 남는다").isEqualTo(1);
    }

    @Test
    @DisplayName("account.withdraw: 영상 보관 동의를 한 사람이 탈퇴 — 영상 객체가 남는다. 동의하지 않은 사람이 탈퇴 — 영상 객체가 없다")
    void accountWithdraw_videosSurviveOnlyWithTheRetentionConsent() throws Exception {
        Member consenting = member("google", "g-keep|keep@example.test|verified", "granted");
        Member declining = member("google", "g-drop|drop@example.test|verified", "declined");
        practiceWithVideo(consenting.id(), "videos/keep.mp4", "analyzed");
        practiceWithVideo(declining.id(), "videos/drop.mp4", "analyzed");
        jdbc.update("UPDATE user_profiles SET photo_key='photos/keep.jpg' WHERE user_id=?", consenting.id());
        storage.put("photos/keep.jpg");

        withdraw(consenting.accessToken());
        withdraw(declining.accessToken());

        assertThat(storage.objects.keySet())
                .as("보관에 동의한 사람의 영상만 남는다. 사진은 동의와 무관하게 지운다")
                .containsExactly("videos/keep.mp4");
    }

    @Test
    @DisplayName("account.withdraw: 보관 동의를 거둔 사람과, 보관 문서의 새 판에 아직 답하지 않은 사람의 영상은 파기한다")
    void accountWithdraw_onlyTheLatestDecisionOnTheCurrentVersionCounts() throws Exception {
        Member changedMind = member("google", "g-1|one@example.test|verified", "granted");
        Member undecided = member("google", "g-2|two@example.test|verified", "granted");
        practiceWithVideo(changedMind.id(), "videos/changed.mp4", "analyzed");
        practiceWithVideo(undecided.id(), "videos/undecided.mp4", "analyzed");
        jdbc.update("""
                INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                VALUES (?,?,?,'declined',now() + interval '1 minute')
                """, UUID.randomUUID(), changedMind.id(), documents.get("retention"));
        withdraw(changedMind.accessToken());
        assertThat(storage.objects).doesNotContainKey("videos/changed.mp4");

        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'retention','v2','보관','본문',false,?)
                """, UUID.randomUUID(), PUBLISHED.plusDays(30));
        withdraw(undecided.accessToken());

        assertThat(storage.objects).as("현재 판에 답하지 않았으면 거절로 본다").doesNotContainKey("videos/undecided.mp4");
    }

    @Test
    @DisplayName("account.withdraw: 객체 삭제가 실패해도 탈퇴는 200 이고, 트랜잭션 밖의 작업으로 다시 시도한다")
    void accountWithdraw_failedObjectDeletionIsRetried() throws Exception {
        Member member = member("google", "g-1|actor@example.test|verified", "declined");
        practiceWithVideo(member.id(), "videos/stubborn.mp4", "analyzed");
        storage.failing.add("videos/stubborn.mp4");

        var response = withdraw(member.accessToken());

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT kind FROM account_cleanup_operations", String.class))
                .isEqualTo("object_delete");
        assertThat(jdbc.queryForObject("SELECT payload_encrypted FROM account_cleanup_operations", String.class))
                .matches("[dk]1:.+").doesNotContain("stubborn");

        storage.failing.clear();
        clock.advance(Duration.ofMinutes(6));
        cleanup.runDue();

        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("account.profile: 연습이 있는 1.0.0 이전 회원이 게이트에서 만 14세 미만 — 탈퇴와 같은 절차로 닫히고, 보관에 동의했어도 영상을 파기한다")
    void accountProfile_underageLegacyMemberLosesTheVideosRegardlessOfConsent() throws Exception {
        Member member = member("kakao", "987654321", "granted");
        jdbc.update("DELETE FROM user_profile_directions WHERE user_id=?", member.id());
        jdbc.update("UPDATE user_profiles SET gender=NULL,birth_date=NULL,experience=NULL,goal=NULL WHERE user_id=?",
                member.id());
        practiceWithVideo(member.id(), "videos/child.mp4", "analyzed");

        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("name", "김배우");
        profile.put("gender", "female");
        profile.put("birth_date", today().minusYears(13).toString());
        profile.put("directions", List.of("media"));
        profile.put("experience", "before_start");
        profile.put("goal", "hobby");
        var response = mvc.perform(put("/v2/me/profile")
                        .header("Authorization", "Bearer " + member.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(profile)))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(response.getContentAsString()).path("detail").textValue())
                .isEqualTo("under_14_account_closed");
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, member.id()))
                .isEqualTo("deactivated");
        assertThat(storage.objects).as("보관 동의와 무관하게 파기한다").doesNotContainKey("videos/child.mp4");
        assertThat(kakao.unlinkedUserIds).as("제공자 연결도 탈퇴와 같이 끊는다").containsExactly("987654321");
        assertThat(jdbc.queryForObject("SELECT uid_hash IS NOT NULL FROM user_identities WHERE user_id=?",
                Boolean.class, member.id())).isTrue();
    }

    @Test
    @DisplayName("account.withdraw: 저장된 해시와 암호문에는 빠짐없이 키 판 접두사가 붙어 있다")
    void accountWithdraw_everyStoredSecretCarriesItsKeyVersion() throws Exception {
        member("apple", "a-live|live@example.test|verified", "declined");
        member("naver", "n-live|live@naver.com", "declined");
        Member leaving = member("kakao", "987654321", "declined");
        kakao.unavailable = true;
        withdraw(leaving.accessToken());

        List<String> stored = jdbc.queryForList("""
                SELECT uid_hash FROM user_identities WHERE uid_hash IS NOT NULL
                UNION ALL SELECT apple_token_encrypted FROM user_identities WHERE apple_token_encrypted IS NOT NULL
                UNION ALL SELECT naver_token_encrypted FROM user_identities WHERE naver_token_encrypted IS NOT NULL
                UNION ALL SELECT payload_encrypted FROM account_cleanup_operations
                """, String.class);

        assertThat(stored).hasSize(4).allMatch(value -> value.matches("(d1|k1):.+"));
    }

    // ---- helpers ----

    private record Member(UUID id, String accessToken) {
    }

    /** 가입을 끝내고 프로필까지 채운 회원. 선택 문서(보관)의 결정은 {@code retention} 이다. */
    private Member member(String provider, String idToken, String retention) throws Exception {
        if ("kakao".equals(provider) && idToken.contains("|")) {
            kakao.verifiedEmails.add(idToken.split("\\|")[1]);
        }
        JsonNode created = signup(login(provider, idToken).path("signup_token").textValue(), retention);
        UUID id = UUID.fromString(created.path("user").path("id").textValue());
        AccountFixtures.completeProfile(jdbc, id);
        return new Member(id, created.path("access_token").textValue());
    }

    private JsonNode login(String provider, String idToken) throws Exception {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("provider", provider);
        if ("naver".equals(provider)) {
            body.put("authorization_code", idToken);
            body.put("code_verifier", "naver-verifier");
        } else {
            body.put("id_token", idToken);
        }
        if ("apple".equals(provider)) {
            body.put("authorization_code", "apple-code");
        }
        var response = mvc.perform(post("/v2/auth/login")
                        .with(request -> {
                            request.setRemoteAddr(address);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(body)))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private JsonNode signup(String token, String retention) throws Exception {
        List<Map<String, String>> decisions = documents.entrySet().stream()
                .map(entry -> Map.of(
                        "document_id", entry.getValue().toString(),
                        "action", "retention".equals(entry.getKey()) ? retention : "granted"))
                .toList();
        var response = mvc.perform(post("/v2/auth/signup")
                        .with(request -> {
                            request.setRemoteAddr(address);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("signup_token", token, "decisions", decisions))))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private MockHttpServletResponse withdraw(String accessToken) throws Exception {
        return mvc.perform(delete("/v2/me").header("Authorization", "Bearer " + accessToken))
                .andReturn().getResponse();
    }

    /** 영상을 올려 만든 연습 하나. 객체는 가짜 저장소에 둔다. */
    private UUID practiceWithVideo(UUID userId, String objectKey, String status) {
        UUID upload = UUID.randomUUID();
        UUID session = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at,finalized_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',100,now() + interval '1 hour',now())
                """, upload, userId, objectKey);
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,blockage_kind,sub_branch,goal)
                VALUES (?,?,?,?,'상황','인물','분석','캐릭터 분석','목표')
                """, session, userId, upload, status);
        storage.put(objectKey);
        return session;
    }

    private static AnalysisResult analysisResult() {
        return new AnalysisResult(
                new ObservationPack(
                        "여자가 문 앞에서 돌아선다.",
                        "0:00에 돌아서며 대사를 시작한다.",
                        SpeechFacts.calculate("지금 놓치면 끝이야", List.of(
                                new SpeechFacts.Word("지금", 0, .3),
                                new SpeechFacts.Word("놓치면", .3, .6),
                                new SpeechFacts.Word("끝이야", .6, 1.2))),
                        List.of(new ObservationItem(0, 1200, "호흡이 얕다", "지금 놓치면 끝이야", "호흡", 0.8)),
                        List.of("조명이 어둡다")),
                true, 12345);
    }

    private java.time.LocalDate today() {
        return java.time.LocalDate.now(clock.withZone(java.time.ZoneId.of("Asia/Seoul")));
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Fixture {
        @Bean
        @Primary
        FakeStorage fakeStorage() {
            return new FakeStorage();
        }

        @Bean
        @Primary
        RecordingFailureReporter recordingFailureReporter() {
            return new RecordingFailureReporter();
        }
    }

    /** 메모리의 오브젝트 스토리지. 무엇이 남아 있는지만 안다. {@link #failing} 에 든 키는 지워지지 않는다. */
    static final class FakeStorage implements ObjectStorage {
        final Map<String, Long> objects = new ConcurrentHashMap<>();
        final Set<String> failing = ConcurrentHashMap.newKeySet();

        void put(String... objectKeys) {
            for (String objectKey : objectKeys) {
                objects.put(objectKey, 100L);
            }
        }

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
            if (failing.contains(objectKey)) {
                throw new IllegalStateException("storage refused the delete");
            }
            objects.remove(objectKey);
        }
    }
}
