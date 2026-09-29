package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.StubProviders;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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

/**
 * account.login 의 "검증 방법" 가운데 로그인·가입 흐름을 HTTP 와 실제 Postgres 로 본다.
 *
 * <p>제공자 넷은 스텁이다({@link StubProviders}) — 실제 제공자를 부르지 않는다. 제공자별 검증 규칙
 * (카카오 사용자 정보 API, 네이버의 코드 교환과 메일 도메인 판단, 애플 토큰 교환)은 제공자 쪽
 * 테스트가 본다. 여기서 보는 것은 제공자가 무엇을 알려 줬을 때 계정이 어떻게 되는가다.
 *
 * <p>⚠ 로그인은 IP 로 분당 60회까지다. 카운터를 지울 수단이 없어 테스트마다 다른 주소에서 온다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import({StubProviders.class, MutableClock.Fixture.class})
class AccountLoginIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();

    private static final UUID TERMS = id(201);
    private static final UUID PRIVACY = id(202);
    private static final UUID AI_ANALYSIS = id(203);
    private static final UUID RETENTION = id(204);
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_login");
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
    MutableClock clock;

    @Autowired
    StubProviders.StubAppleTokens apple;

    @Autowired
    StubProviders.StubKakaoUsers kakao;

    @Autowired
    StubProviders.StubNaverTokens naver;

    private String address;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        insertDocument(TERMS, "terms", "v1", true, PUBLISHED);
        insertDocument(PRIVACY, "privacy", "v5", true, PUBLISHED);
        insertDocument(AI_ANALYSIS, "ai_analysis", "v1", true, PUBLISHED);
        insertDocument(RETENTION, "retention", "v1", false, PUBLISHED);
        address = "10.1.0." + ADDRESSES.incrementAndGet();
        // 시계는 컨텍스트에 하나라 앞 테스트가 돌려 둔 채로 남는다. 갱신이 발급하는 액세스 토큰은 이
        // 시계로 `iat` 를 적고 검증은 실제 시계로 하므로, 앞서 있으면 방금 받은 토큰이 거절된다.
        clock.set(java.time.Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        apple.reset();
        kakao.reset();
        naver.reset();
    }

    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = {"google", "apple", "kakao", "naver"})
    void accountLogin_firstLoginCreatesNothingUntilTheConsentsAreSubmittedAndTheSecondLoginIsTheSameAccount(
            String provider) throws Exception {
        // 네이버는 검증 표시를 주지 않아 @naver.com 주소만 검증된 것으로 본다. 카카오는 ID 토큰이 아니라
        // 사용자 정보 API 가 인증 여부를 알려 준다.
        String email = "naver".equals(provider) ? "first@naver.com" : "first@example.test";
        kakao.verifiedEmails.add(email);
        String idToken = provider + "-uid|" + email + "|verified";

        JsonNode first = login(provider, idToken);

        assertThat(first.path("result").textValue()).isEqualTo("signup_required");
        assertThat(first.fieldNames()).toIterable()
                .containsExactlyInAnyOrder("result", "signup_token", "expires_in", "documents");
        assertThat(first.path("expires_in").longValue()).isEqualTo(1800);
        assertThat(first.path("documents")).extracting(document -> document.path("type").textValue())
                .containsExactly("terms", "privacy", "ai_analysis", "retention");
        assertThat(count("users")).as("가입 제출 전에는 아무 행도 없다").isZero();
        assertThat(count("user_identities")).isZero();

        JsonNode created = signup(first.path("signup_token").textValue(), decisions("granted"));

        assertThat(created.path("result").textValue()).isEqualTo("signed_in");
        assertThat(created.path("access_token").textValue()).isNotBlank();
        assertThat(created.path("refresh_token").textValue()).isNotBlank();
        assertThat(created.path("token_type").textValue()).isEqualTo("bearer");
        assertThat(created.path("pending_consents")).isEmpty();
        assertThat(created.path("user").path("email").textValue()).isEqualTo(email);
        assertThat(count("users")).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT provider,provider_uid FROM user_identities"))
                .containsEntry("provider", provider)
                .containsEntry("provider_uid", provider + "-uid");
        assertThat(jdbc.queryForList(
                "SELECT action FROM user_consents ORDER BY action", String.class))
                .containsExactly("granted", "granted", "granted", "granted");
        // 리프레시 토큰은 30일이다.
        JsonNode refreshClaims = jwtClaims(created.path("refresh_token").textValue());
        assertThat(refreshClaims.path("exp").longValue() - refreshClaims.path("iat").longValue())
                .isEqualTo(Duration.ofDays(30).toSeconds());

        // 같은 앱 등록의 다른 기기(iOS·안드로이드)에서 와도 제공자 ID 가 같으면 같은 계정이다.
        JsonNode second = login(provider, idToken);

        assertThat(second.path("result").textValue()).isEqualTo("signed_in");
        assertThat(second.path("user").path("id").textValue())
                .isEqualTo(created.path("user").path("id").textValue());
        assertThat(count("users")).isEqualTo(1);
        assertThat(count("user_identities")).isEqualTo(1);
    }

    @Test
    void accountLogin_sameVerifiedEmailFromAnotherProviderJoinsTheSameAccount() throws Exception {
        String userId = signUp("google", "g-1|same@example.test|verified");

        JsonNode apple = login("apple", "a-1|Same@Example.test |verified");

        assertThat(apple.path("result").textValue()).isEqualTo("signed_in");
        assertThat(apple.path("user").path("id").textValue()).isEqualTo(userId);
        assertThat(count("users")).isEqualTo(1);
        assertThat(jdbc.queryForList(
                "SELECT provider FROM user_identities ORDER BY provider", String.class))
                .containsExactly("apple", "google");
    }

    @Test
    void accountLogin_unverifiedEmailThatBelongsToAnAccountIsAConflictNamingItsProvider() throws Exception {
        signUp("google", "g-1|taken@example.test|verified");

        // 외부 메일로 바꾼 네이버 계정처럼, 제공자가 검증하지 않은 주소다.
        var conflict = perform("naver", "n-1|taken@example.test");

        assertThat(conflict.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(conflict.getContentAsString())).isEqualTo(mapper.readTree("""
                {"detail":"account_exists_with_different_provider","providers":["google"]}
                """));
        assertThat(count("users")).as("계정은 늘지 않는다").isEqualTo(1);
        assertThat(count("user_identities")).isEqualTo(1);
    }

    @Test
    void accountLogin_kakaoWithoutEmailConsentCreatesAnAccountWhoseEmailIsNull() throws Exception {
        JsonNode created = signup(
                login("kakao", "k-1").path("signup_token").textValue(), decisions("declined"));

        assertThat(created.path("user").path("email").isNull()).isTrue();
        assertThat(jdbc.queryForObject("SELECT email IS NULL FROM users", Boolean.class))
                .as("빈 문자열이 아니라 NULL 이다")
                .isTrue();
        assertThat(jdbc.queryForObject("""
                SELECT action FROM user_consents WHERE document_id=?
                """, String.class, RETENTION)).as("선택 문서는 거절도 결정이다").isEqualTo("declined");
    }

    @Test
    void accountLogin_unverifiedEmailIsNotStoredEvenWhenItIsFree() throws Exception {
        JsonNode created = signup(
                login("naver", "n-1|outside@example.test").path("signup_token").textValue(),
                decisions("granted"));

        assertThat(created.path("user").path("email").isNull()).isTrue();
    }

    @Test
    void accountLogin_leavingTheConsentScreenLeavesNothingAndTheNextLoginStartsOver() throws Exception {
        assertThat(login("google", "g-1|left@example.test|verified").path("result").textValue())
                .isEqualTo("signup_required");

        assertThat(count("users")).isZero();
        assertThat(count("user_identities")).isZero();
        assertThat(count("user_consents")).isZero();
        assertThat(login("google", "g-1|left@example.test|verified").path("result").textValue())
                .as("다시 로그인하면 동의 화면부터 나온다")
                .isEqualTo("signup_required");
    }

    @Test
    void accountLogin_signupTokenHidesTheProviderIdAndTheEmailFromTheApp() throws Exception {
        String token = login("google", "secret-provider-uid|hidden@example.test|verified")
                .path("signup_token").textValue();

        String[] parts = token.split("\\.");
        assertThat(parts).as("서명(JWS)이 아니라 암호화(JWE)다").hasSize(5);
        for (String part : parts) {
            String decoded = new String(Base64.getUrlDecoder().decode(part), StandardCharsets.ISO_8859_1);
            assertThat(decoded).doesNotContain("secret-provider-uid").doesNotContain("hidden@example.test");
        }
        assertThat(new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8))
                .contains("\"enc\":\"A256GCM\"");
    }

    @Test
    void accountLogin_signupTokenExpiresAfterThirtyMinutesAndAForgedOneIsRejected() throws Exception {
        String token = login("google", "g-1|late@example.test|verified").path("signup_token").textValue();

        clock.advance(Duration.ofMinutes(31));
        var expired = performSignup(token, decisions("granted"));

        assertThat(expired.getStatus()).isEqualTo(401);
        assertThat(mapper.readTree(expired.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"invalid_signup_token\"}"));
        assertThat(performSignup(token.substring(0, token.length() - 2) + "xx", decisions("granted"))
                .getStatus()).isEqualTo(401);
        assertThat(count("users")).isZero();
        assertThat(count("user_identities")).isZero();
    }

    @Test
    void accountLogin_signupNeedsADecisionForEveryCurrentDocumentIncludingTheOptionalOne()
            throws Exception {
        String token = login("google", "g-1|partial@example.test|verified").path("signup_token").textValue();
        Map<UUID, String> withoutOptional = decisions("granted");
        withoutOptional.remove(RETENTION);

        var incomplete = performSignup(token, withoutOptional);

        assertThat(incomplete.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(incomplete.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"consent_decisions_incomplete\"}"));
        assertThat(count("users")).as("빠진 결정이 있으면 어떤 행도 생기지 않는다").isZero();
    }

    @Test
    void accountLogin_signupRejectsDecliningARequiredDocumentAndDecisionsOnOldOrUnknownDocuments()
            throws Exception {
        String token = login("google", "g-1|rules@example.test|verified").path("signup_token").textValue();

        Map<UUID, String> declinedRequired = decisions("granted");
        declinedRequired.put(TERMS, "declined");
        var declined = performSignup(token, declinedRequired);
        assertThat(declined.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(declined.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"required_consent_cannot_be_declined\"}"));

        Map<UUID, String> unknown = decisions("granted");
        unknown.put(id(999), "granted");
        assertThat(performSignup(token, unknown).getStatus()).isEqualTo(404);

        // 동의 화면을 보는 사이 새 판이 발행됐다.
        insertDocument(id(205), "terms", "v2", true, PUBLISHED.plusDays(1));
        var outdated = performSignup(token, decisions("granted"));
        assertThat(outdated.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(outdated.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"consent_document_outdated\"}"));

        var revoked = mvc.perform(post("/v2/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"signup_token\":\"" + token + "\",\"decisions\":[{\"document_id\":\""
                                + TERMS + "\",\"action\":\"revoked\"}]}"))
                .andReturn().getResponse();
        assertThat(revoked.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(revoked.getContentAsString()).path("detail").isArray()).isTrue();
        assertThat(count("users")).isZero();
    }

    @Test
    void accountLogin_twoSignupsForTheSameIdentityAtOnceMakeOneAccountAndBothSucceed() throws Exception {
        String token = login("google", "g-race|race@example.test|verified").path("signup_token").textValue();
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<MockHttpServletResponse>> submissions = List.of(
                    pool.submit(() -> {
                        start.await();
                        return performSignup(token, decisions("granted"));
                    }),
                    pool.submit(() -> {
                        start.await();
                        return performSignup(token, decisions("granted"));
                    }));
            start.countDown();

            String firstUser = null;
            for (Future<MockHttpServletResponse> submission : submissions) {
                MockHttpServletResponse response = submission.get(30, TimeUnit.SECONDS);
                assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
                String user = mapper.readTree(response.getContentAsString())
                        .path("user").path("id").textValue();
                assertThat(user).isNotBlank();
                if (firstUser != null) {
                    assertThat(user).as("둘 다 같은 계정의 토큰을 받는다").isEqualTo(firstUser);
                }
                firstUser = user;
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("users")).isEqualTo(1);
        assertThat(count("user_identities")).isEqualTo(1);
    }

    @Test
    void accountLogin_withdrawnMemberWhoLogsInAgainStartsAsABrandNewAccount() throws Exception {
        JsonNode first = signup(
                login("google", "g-1|back@example.test|verified").path("signup_token").textValue(),
                decisions("granted"));
        String firstUser = first.path("user").path("id").textValue();
        assertThat(mvc.perform(delete("/v2/me")
                        .header("Authorization", "Bearer " + first.path("access_token").textValue()))
                .andReturn().getResponse().getStatus()).isLessThan(300);

        JsonNode again = login("google", "g-1|back@example.test|verified");

        assertThat(again.path("result").textValue()).as("동의 화면부터 나온다").isEqualTo("signup_required");
        JsonNode second = signup(again.path("signup_token").textValue(), decisions("granted"));
        assertThat(second.path("user").path("id").textValue()).isNotEqualTo(firstUser);
        assertThat(count("users")).isEqualTo(2);
        assertThat(jdbc.queryForObject(
                "SELECT status FROM users WHERE id=?", String.class, UUID.fromString(firstUser)))
                .isEqualTo("deactivated");
    }

    @Test
    void accountLogin_emailFollowsTheProviderUnlessAnotherAccountAlreadyUsesIt() throws Exception {
        String userId = signUp("google", "g-1|old@example.test|verified");
        kakao.verifiedEmails.add("other@example.test");
        signUp("kakao", "k-1|other@example.test|verified");

        JsonNode moved = login("google", "g-1|new@example.test|verified");

        assertThat(moved.path("user").path("id").textValue()).as("이메일은 신원이 아니다").isEqualTo(userId);
        assertThat(moved.path("user").path("email").textValue()).isEqualTo("new@example.test");

        JsonNode blocked = login("google", "g-1|other@example.test|verified");

        assertThat(blocked.path("user").path("id").textValue()).isEqualTo(userId);
        assertThat(blocked.path("user").path("email").textValue())
                .as("다른 계정이 쓰는 주소면 옛 주소가 남는다")
                .isEqualTo("new@example.test");
    }

    @Test
    void accountLogin_appleLoginWithoutAnAuthorizationCodeIsRejected() throws Exception {
        var response = mvc.perform(post("/v2/auth/login")
                        .with(request -> {
                            request.setRemoteAddr(address);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"provider\":\"apple\",\"id_token\":\"a-1|a@example.test|verified\"}"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"authorization_code_required\"}"));
    }

    @Test
    void accountLogin_newRequiredVersionBlocksProtectedApisUntilItIsGrantedEvenAcrossARefresh()
            throws Exception {
        JsonNode member = signup(
                login("google", "g-1|member@example.test|verified").path("signup_token").textValue(),
                decisions("granted"));
        AccountFixtures.completeProfile(jdbc, UUID.fromString(member.path("user").path("id").textValue()));
        String access = member.path("access_token").textValue();
        assertThat(protectedApi(access).getStatus()).isEqualTo(200);

        UUID termsV2 = id(205);
        insertDocument(termsV2, "terms", "v2", true, PUBLISHED.plusDays(30));

        JsonNode relogin = login("google", "g-1|member@example.test|verified");
        assertThat(relogin.path("result").textValue()).as("로그인은 된다").isEqualTo("signed_in");
        assertThat(relogin.path("pending_consents")).extracting(document -> document.path("id").textValue())
                .containsExactly(termsV2.toString());

        var blocked = protectedApi(access);
        assertThat(blocked.getStatus()).isEqualTo(403);
        JsonNode body = mapper.readTree(blocked.getContentAsString());
        assertThat(body.path("detail").textValue()).isEqualTo("consent_required");
        assertThat(body.path("pending_consents")).extracting(document -> document.path("id").textValue())
                .containsExactly(termsV2.toString());

        // 토큰을 갱신해도 열리지 않는다 — 게이트는 요청마다 DB 의 동의 상태로 판정한다.
        // 갱신은 리프레시 토큰의 iat(실제 시계)를 애플리케이션 시계로 검사한다. setUp 이 시계를 초 단위로
        // 고정해 두어, 다시 로그인한 순간이 다음 초로 넘어가 있으면 "아직 유효하지 않다"로 거절된다(CI 에서
        // 그렇게 401 이 났다). 갱신 직전에 시계를 지금으로 맞춘다.
        clock.set(java.time.Instant.now());
        JsonNode refreshed = mapper.readTree(mvc.perform(post("/v2/auth/refresh")
                        .with(request -> {
                            request.setRemoteAddr(address);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refresh_token\":\"" + relogin.path("refresh_token").textValue() + "\"}"))
                .andReturn().getResponse().getContentAsString());
        assertThat(protectedApi(refreshed.path("access_token").textValue()).getStatus()).isEqualTo(403);

        assertThat(mvc.perform(post("/v2/consents")
                        .header("Authorization", "Bearer " + access)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"document_id\":\"" + termsV2 + "\",\"action\":\"granted\"}"))
                .andReturn().getResponse().getStatus()).isEqualTo(201);
        assertThat(protectedApi(access).getStatus()).as("같은 토큰으로 허용된다").isEqualTo(200);
    }

    // ---- helpers ----

    /** 가입까지 끝낸 회원의 id. */
    private String signUp(String provider, String idToken) throws Exception {
        return signup(login(provider, idToken).path("signup_token").textValue(), decisions("granted"))
                .path("user").path("id").textValue();
    }

    private JsonNode login(String provider, String idToken) throws Exception {
        var response = perform(provider, idToken);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private MockHttpServletResponse perform(String provider, String idToken) throws Exception {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("provider", provider);
        if ("naver".equals(provider)) {
            // 네이버는 ID 토큰을 내지 않는다. 스텁의 코드 교환이 받은 코드를 그대로 ID 토큰으로 돌려준다.
            body.put("authorization_code", idToken);
            body.put("code_verifier", "naver-verifier");
            body.put("redirect_uri", "actingapp://auth/naver");
            body.put("state", "naver-state");
        } else {
            body.put("id_token", idToken);
        }
        if ("apple".equals(provider)) {
            body.put("authorization_code", "apple-code");
        }
        return mvc.perform(post("/v2/auth/login")
                        .with(request -> {
                            request.setRemoteAddr(address);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(body)))
                .andReturn().getResponse();
    }

    private JsonNode signup(String token, Map<UUID, String> decisions) throws Exception {
        var response = performSignup(token, decisions);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private MockHttpServletResponse performSignup(String token, Map<UUID, String> decisions)
            throws Exception {
        List<Map<String, String>> list = decisions.entrySet().stream()
                .map(entry -> Map.of("document_id", entry.getKey().toString(), "action", entry.getValue()))
                .toList();
        return mvc.perform(post("/v2/auth/signup")
                        .with(request -> {
                            request.setRemoteAddr(address);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("signup_token", token, "decisions", list))))
                .andReturn().getResponse();
    }

    /** 필수 셋은 동의, 선택 문서는 받은 값으로. */
    private static Map<UUID, String> decisions(String optional) {
        Map<UUID, String> decisions = new LinkedHashMap<>();
        decisions.put(TERMS, "granted");
        decisions.put(PRIVACY, "granted");
        decisions.put(AI_ANALYSIS, "granted");
        decisions.put(RETENTION, optional);
        return decisions;
    }

    private MockHttpServletResponse protectedApi(String accessToken) throws Exception {
        return mvc.perform(get("/v2/practices").header("Authorization", "Bearer " + accessToken))
                .andReturn().getResponse();
    }

    private JsonNode jwtClaims(String jwt) throws Exception {
        return mapper.readTree(Base64.getUrlDecoder().decode(jwt.split("\\.")[1]));
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private void insertDocument(UUID id, String type, String version, boolean required, OffsetDateTime at) {
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,?,?,?,?,?,?)
                """, id, type, version, type + " 제목", type + " 본문", required, at);
    }

    private static UUID id(int suffix) {
        return UUID.fromString("00000000-0000-4000-8000-%012d".formatted(suffix));
    }
}
