package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.integration.oidc.ProviderUnavailable;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import com.acttub.actingapi.support.StubProviders;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

/**
 * account.login 의 "검증 방법" 가운데 제공자별 규칙 — 서버가 제공자에 묻는 자리(카카오 사용자 정보 API,
 * 애플·네이버 코드 교환)와 그것이 답하지 않을 때, 그리고 탈퇴 때 쓸 토큰을 어떻게 맡아 두는가.
 *
 * <p>바깥 호출은 전부 스텁이다({@link StubProviders}). 실제 제공자를 부르지 않는다. 요청 형식이 공식
 * 문서와 맞는지는 {@code integration/oidc} 의 테스트가 본다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ACCOUNT_CLEANUP_ENABLED=false"})
@AutoConfigureMockMvc
@Import({StubProviders.class, AccountProvidersIT.ReportFixture.class})
class AccountProvidersIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_providers");
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
    AccountSecrets secrets;

    @Autowired
    StubProviders.StubAppleTokens apple;

    @Autowired
    RecordingFailureReporter failures;

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
        address = "10.3.0." + ADDRESSES.incrementAndGet();
        apple.reset();
        kakao.reset();
        naver.reset();
    }

    @Test
    @DisplayName("account.login: 제공자 목록 조회 — 켜 둔 제공자가 늘 같은 순서로 나오고 토큰이 만료돼 있어도 열린다")
    void accountLogin_providerListIsPublic() throws Exception {
        var response = mvc.perform(get("/v2/auth/providers").header("Authorization", "Bearer expired.token.value"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"providers\":[\"google\",\"apple\",\"kakao\",\"naver\"]}"));
    }

    @Test
    @DisplayName("account.login: 카카오 사용자 정보 API 가 답하지 않을 때 처음 온 카카오 신원은 502 이고 행이 없다 — 기존 카카오 회원은 로그인된다")
    void accountLogin_kakaoOutageReachesOnlyNewcomers() throws Exception {
        kakao.verifiedEmails.add("member@example.test");
        String member = signUp("kakao", "k-member|member@example.test");
        kakao.unavailable = true;

        var newcomer = perform("kakao", "k-new|new@example.test");

        assertThat(newcomer.getStatus()).isEqualTo(502);
        assertThat(mapper.readTree(newcomer.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"provider_unavailable\"}"));
        assertThat(count("users")).as("계정은 만들어지지 않는다").isEqualTo(1);
        assertThat(count("user_identities")).isEqualTo(1);

        JsonNode existing = login("kakao", "k-member|member@example.test");

        assertThat(existing.path("result").textValue()).isEqualTo("signed_in");
        assertThat(existing.path("user").path("id").textValue()).isEqualTo(member);
        assertThat(kakao.askedUserIds).as("기존 회원은 제공자에 묻지 않는다").containsExactly("k-member", "k-new");
    }

    @Test
    @DisplayName("account.login: 이메일 제공에 동의하지 않은 카카오 신원은 물을 것이 없어 카카오 장애와 무관하게 가입이 열린다")
    void accountLogin_kakaoWithoutAnEmailNeverAsksTheUserApi() throws Exception {
        kakao.unavailable = true;

        JsonNode first = login("kakao", "k-no-email");

        assertThat(first.path("result").textValue()).isEqualTo("signup_required");
        assertThat(kakao.askedUserIds).isEmpty();
    }

    @Test
    @DisplayName("account.login: 카카오가 인증하지 않은 이메일은 저장하지 않고, 기존 계정과 겹치면 409 다")
    void accountLogin_kakaoEmailCountsOnlyWhenKakaoVerifiedIt() throws Exception {
        signUp("google", "g-1|taken@example.test|verified");

        var conflict = perform("kakao", "k-1|taken@example.test");

        assertThat(conflict.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(conflict.getContentAsString()).path("providers"))
                .extracting(JsonNode::textValue).containsExactly("google");

        JsonNode created = signup(login("kakao", "k-2|free@example.test").path("signup_token").textValue());

        assertThat(created.path("user").path("email").isNull()).as("검증된 이메일만 저장한다").isTrue();
    }

    @Test
    @DisplayName("account.login: 구글로 만든 계정과 같은 @naver.com 주소로 네이버 로그인 — 같은 계정이고 신원 행이 하나 더 생긴다")
    void accountLogin_naverOwnAddressJoinsTheAccountWithTheSameEmail() throws Exception {
        String userId = signUp("google", "g-1|actor@naver.com|verified");

        JsonNode joined = login("naver", "n-1|Actor@Naver.com");

        assertThat(joined.path("result").textValue()).isEqualTo("signed_in");
        assertThat(joined.path("user").path("id").textValue()).isEqualTo(userId);
        assertThat(count("users")).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT provider FROM user_identities ORDER BY provider", String.class))
                .containsExactly("google", "naver");
        assertThat(secrets.decrypt(jdbc.queryForObject(
                "SELECT naver_token_encrypted FROM user_identities WHERE provider='naver'", String.class)))
                .as("붙인 신원에도 연동 해제에 쓸 토큰을 맡아 둔다")
                .isEqualTo("naver-refresh:n-1|Actor@Naver.com");
    }

    @Test
    @DisplayName("account.login: 네이버는 앱이 준 authorization code·code verifier·redirect URI·state 를 서버가 교환한다")
    void accountLogin_naverCodeIsExchangedByTheServer() throws Exception {
        login("naver", "n-1|actor@naver.com");

        assertThat(naver.exchanges).containsExactly(new StubProviders.StubNaverTokens.Exchange(
                "n-1|actor@naver.com", "naver-verifier", "actingapp://auth/naver", "naver-state"));
    }

    @Test
    @DisplayName("account.login: 네이버가 답하지 않으면 기존 회원도 502 다 — 로그인마다 코드 교환에 기대기 때문이다(결정 I-5)")
    void accountLogin_naverOutageReachesExistingMembersToo() throws Exception {
        signUp("naver", "n-1|actor@naver.com");
        naver.unavailable = true;

        var response = perform("naver", "n-1|actor@naver.com");

        assertThat(response.getStatus()).isEqualTo(502);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"provider_unavailable\"}"));
    }

    @Test
    @DisplayName("account.login: 네이버 코드가 이미 쓰였으면 401 이고, 코드나 code verifier 가 빠지면 422 배열이다")
    void accountLogin_naverCredentialsAreRequiredAndSingleUse() throws Exception {
        var used = perform("naver", "used-code");
        assertThat(used.getStatus()).isEqualTo(401);
        assertThat(mapper.readTree(used.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"invalid_provider_token\"}"));

        var noVerifier = postLogin("{\"provider\":\"naver\",\"authorization_code\":\"n-1\"}");
        assertThat(noVerifier.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(noVerifier.getContentAsString())).isEqualTo(mapper.readTree("""
                {"detail":[{"type":"missing","loc":["body","code_verifier"],"msg":"Field required",
                  "input":{"provider":"naver"}}]}
                """));

        var noCode = postLogin("{\"provider\":\"naver\",\"code_verifier\":\"v\"}");
        assertThat(noCode.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(noCode.getContentAsString()).path("detail").path(0).path("loc"))
                .extracting(JsonNode::textValue).containsExactly("body", "authorization_code");
        assertThat(naver.exchanges).as("빠진 값이 있으면 네이버를 부르지 않는다").isEmpty();
    }

    @Test
    @DisplayName("account.login: 네이버로 가입하면 refresh token 을 암호화해 저장하고, 다시 로그인하면 새 값으로 바뀐다")
    void accountLogin_naverRefreshTokenIsStoredEncryptedAndFollowsTheLatestLogin() throws Exception {
        signUp("naver", "n-1|actor@naver.com");
        String first = jdbc.queryForObject("SELECT naver_token_encrypted FROM user_identities", String.class);

        assertThat(first).matches("[dk]1:.+").doesNotContain("naver-refresh");
        assertThat(secrets.decrypt(first)).isEqualTo("naver-refresh:n-1|actor@naver.com");

        login("naver", "n-1|actor@naver.com|again");

        assertThat(secrets.decrypt(jdbc.queryForObject(
                "SELECT naver_token_encrypted FROM user_identities", String.class)))
                .isEqualTo("naver-refresh:n-1|actor@naver.com|again");
    }

    @Test
    @DisplayName("account.login: 애플 authorization code 는 로그인 요청에서 바로 바꾸고, 가입 제출 때 암호화해 신원에 저장한다")
    void accountLogin_appleCodeIsExchangedAtLoginAndStoredEncryptedAtSignup() throws Exception {
        JsonNode first = login("apple", "a-1|actor@example.test|verified");

        assertThat(apple.exchangedCodes).as("코드는 5분 동안 한 번만 쓸 수 있다").containsExactly("apple-code");
        assertThat(count("user_identities")).as("가입 제출 전에는 아무 행도 없다").isZero();
        assertThat(first.path("signup_token").textValue()).doesNotContain("apple-grant");

        signup(first.path("signup_token").textValue());

        String stored = jdbc.queryForObject("SELECT apple_token_encrypted FROM user_identities", String.class);
        assertThat(stored).matches("[dk]1:.+").doesNotContain("apple-grant");
        assertThat(secrets.decrypt(stored)).isEqualTo("apple-grant:apple-code");
    }

    @Test
    @DisplayName("account.login: 애플 토큰 교환이 답하지 않을 때 처음 온 애플 신원은 502 이고 행이 없다 — 기존 애플 회원은 로그인된다")
    void accountLogin_appleOutageReachesOnlyNewcomers() throws Exception {
        String member = signUp("apple", "a-member|member@example.test|verified");
        apple.reset();
        apple.unavailable = true;

        var newcomer = perform("apple", "a-new|new@example.test|verified");

        assertThat(newcomer.getStatus()).isEqualTo(502);
        assertThat(count("users")).isEqualTo(1);

        JsonNode existing = login("apple", "a-member|member@example.test|verified");

        assertThat(existing.path("user").path("id").textValue()).isEqualTo(member);
        assertThat(apple.exchangedCodes).as("토큰을 이미 가진 기존 회원은 코드를 바꾸지 않는다").isEmpty();
    }

    @Test
    @DisplayName("account.login: 애플 authorization code 가 잘못됐거나 이미 쓰였으면 처음 온 신원은 401 이다")
    void accountLogin_appleCodeThatWasAlreadyUsedIsRejected() throws Exception {
        var response = postLogin("""
                {"provider":"apple","id_token":"a-1|actor@example.test|verified","authorization_code":"used-code"}
                """);

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"invalid_provider_token\"}"));
        assertThat(count("users")).isZero();
    }

    @Test
    @DisplayName("account.login: 1.0.0 이전에 가입해 애플 토큰이 없는 회원은 다음 로그인 때 채우고, 그때 애플이 답하지 않아도 로그인은 된다")
    void accountLogin_appleMemberWithoutATokenGetsOneAtTheNextLogin() throws Exception {
        String member = signUp("apple", "a-old|old@example.test|verified");
        jdbc.update("UPDATE user_identities SET apple_token_encrypted=NULL");
        apple.reset();
        apple.unavailable = true;

        failures.clear();

        assertThat(login("apple", "a-old|old@example.test|verified").path("user").path("id").textValue())
                .isEqualTo(member);
        assertThat(jdbc.queryForObject("SELECT apple_token_encrypted FROM user_identities", String.class)).isNull();
        // 로그인은 되지만 바깥 의존의 실패는 삼키지 않는다(ADR-025) — 애플이 계속 답하지 않으면 탈퇴 때 폐기할
        // 토큰이 영영 채워지지 않는데, 보고가 없으면 아무도 모른다.
        assertThat(failures.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isInstanceOf(ProviderUnavailable.class);
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo("AuthService.keepProviderToken");
        });

        apple.unavailable = false;
        login("apple", "a-old|old@example.test|verified");

        assertThat(secrets.decrypt(jdbc.queryForObject(
                "SELECT apple_token_encrypted FROM user_identities", String.class)))
                .isEqualTo("apple-grant:apple-code");
    }

    @Test
    @DisplayName("account.login: 토큰을 채우려던 애플 코드가 이미 쓰인 것이면 로그인은 되고 보고하지 않는다 — 예상된 거절이다")
    void accountLogin_aSpentAppleCodeWhileBackfillingIsNotReported() throws Exception {
        String member = signUp("apple", "a-old|old@example.test|verified");
        jdbc.update("UPDATE user_identities SET apple_token_encrypted=NULL");
        failures.clear();

        var response = postLogin("""
                {"provider":"apple","id_token":"a-old|old@example.test|verified","authorization_code":"used-code"}
                """);

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        assertThat(mapper.readTree(response.getContentAsString()).path("user").path("id").textValue())
                .isEqualTo(member);
        assertThat(failures.reports()).isEmpty();
    }

    @Test
    @DisplayName("account.login: 이메일 겹침으로 끝날 애플 로그인에는 한 번뿐인 코드를 쓰지 않는다")
    void accountLogin_appleCodeIsNotSpentOnALoginThatEndsInAConflict() throws Exception {
        signUp("google", "g-1|taken@example.test|verified");

        var conflict = perform("apple", "a-1|taken@example.test");

        assertThat(conflict.getStatus()).isEqualTo(409);
        assertThat(apple.exchangedCodes).isEmpty();
    }

    // ---- helpers ----

    private String signUp(String provider, String idToken) throws Exception {
        return signup(login(provider, idToken).path("signup_token").textValue())
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
        return postLogin(mapper.writeValueAsString(body));
    }

    private MockHttpServletResponse postLogin(String json) throws Exception {
        return mvc.perform(post("/v2/auth/login")
                        .with(request -> {
                            request.setRemoteAddr(address);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andReturn().getResponse();
    }

    private JsonNode signup(String token) throws Exception {
        List<Map<String, String>> decisions = documents.values().stream()
                .map(id -> Map.of("document_id", id.toString(), "action", "granted"))
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

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ReportFixture {
        @Bean
        @Primary
        RecordingFailureReporter recordingFailureReporter() {
            return new RecordingFailureReporter();
        }
    }
}
