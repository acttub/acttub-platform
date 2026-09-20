package com.acttub.actingapi.integration.oidc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.io.IOException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.crypto.ECDSAVerifier;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

/**
 * 바깥 호출의 요청 형식은 각 제공자의 공식 문서가 정한다. 실제 제공자는 부르지 않는다 — 가짜 서버가
 * 받은 요청이 문서의 모양인지, 제공자의 답을 어떻게 옮기는지만 본다.
 */
class ProviderHttpClientTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    // ---- 네이버: 개발가이드 §3.5.6(OIDC 접근 토큰 발급), §4.3(Token Revocation) ----

    @Test
    @DisplayName("account.login: 네이버 코드 교환은 OIDC 토큰 경로에 client secret·code·state·code_verifier 를 폼으로 보낸다")
    void naverExchangePostsTheDocumentedForm() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        MultiValueMap<String, String> expected = new LinkedMultiValueMap<>();
        expected.add("client_id", "naver-id");
        expected.add("client_secret", "naver-secret");
        expected.add("grant_type", "authorization_code");
        expected.add("code", "the-code");
        expected.add("state", "the-state");
        expected.add("code_verifier", "the-verifier");
        expected.add("redirect_uri", "actingapp://auth/naver");
        server.expect(requestTo("https://nid.naver.com/oauth2/token"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().formData(expected))
                .andRespond(withSuccess("""
                        {"access_token":"at","refresh_token":"rt","token_type":"bearer",
                         "expires_in":3600,"id_token":"header.payload.signature"}
                        """, MediaType.APPLICATION_JSON));

        NaverTokenClient.NaverGrant grant = new HttpNaverTokenClient("naver-id", "naver-secret", builder)
                .exchange("the-code", "the-verifier", "actingapp://auth/naver", "the-state");

        assertThat(grant.idToken()).isEqualTo("header.payload.signature");
        assertThat(grant.refreshToken()).isEqualTo("rt");
        server.verify();
    }

    @Test
    @DisplayName("account.login: 앱이 state 를 주지 않으면 네이버 교환에 난수를 채워 보낸다(발급 때 필수)")
    void naverExchangeFillsInAStateWhenTheAppSentNone() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        AtomicReference<String> body = new AtomicReference<>();
        server.expect(requestTo(HttpNaverTokenClient.TOKEN_URL))
                .andExpect(request -> body.set(((MockClientHttpRequest) request).getBodyAsString()))
                .andRespond(withSuccess("{\"id_token\":\"a.b.c\",\"refresh_token\":\"rt\"}", MediaType.APPLICATION_JSON));

        new HttpNaverTokenClient("naver-id", "naver-secret", builder).exchange("the-code", "v", null, null);

        assertThat(body.get()).containsPattern("(^|&)state=[0-9a-f-]{36}(&|$)").doesNotContain("redirect_uri");
    }

    @Test
    @DisplayName("account.login: 네이버가 코드를 거절하면 잘못된 토큰이고, 5xx 나 무응답이면 제공자 장애다")
    void naverExchangeTellsABadCodeFromAnOutage() {
        assertThatThrownBy(() -> naver(withSuccess(
                        "{\"error\":\"invalid_request\",\"error_description\":\"no valid data in session\"}",
                        MediaType.APPLICATION_JSON))
                .exchange("used", "v", null, "s"))
                .isInstanceOf(InvalidIdentityToken.class);
        assertThatThrownBy(() -> naver(withStatus(HttpStatus.SERVICE_UNAVAILABLE)).exchange("c", "v", null, "s"))
                .isInstanceOf(ProviderUnavailable.class);
        assertThatThrownBy(() -> naver(withStatus(HttpStatus.UNAUTHORIZED)
                        .body("{\"error\":\"unauthorized_client\"}").contentType(MediaType.APPLICATION_JSON))
                .exchange("c", "v", null, "s"))
                .isInstanceOf(ProviderConfigurationError.class);
        assertThatThrownBy(() -> naver(request -> {
                    throw new IOException("connection reset");
                }).exchange("c", "v", null, "s"))
                .isInstanceOf(ProviderUnavailable.class);
        assertThatThrownBy(() -> new HttpNaverTokenClient("", "", RestClient.builder()).exchange("c", "v", null, "s"))
                .isInstanceOf(ProviderConfigurationError.class);
    }

    @Test
    @DisplayName("account.withdraw: 네이버 연동 해제는 refresh token 을 토큰 폐기 경로에 보내고 HTTP 200 을 성공으로 본다")
    void naverRevokePostsTheRefreshTokenToTheRevocationEndpoint() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        MultiValueMap<String, String> expected = new LinkedMultiValueMap<>();
        expected.add("client_id", "naver-id");
        expected.add("client_secret", "naver-secret");
        expected.add("token", "the-refresh-token");
        expected.add("token_type_hint", "refresh_token");
        server.expect(requestTo("https://nid.naver.com/oauth2.0/revoke"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().formData(expected))
                .andRespond(withSuccess());

        new HttpNaverTokenClient("naver-id", "naver-secret", builder).revoke("the-refresh-token");

        server.verify();
        assertThatThrownBy(() -> naver(withStatus(HttpStatus.SERVICE_UNAVAILABLE)).revoke("rt"))
                .as("일시 장애(503)는 다시 시도한다")
                .isInstanceOf(ProviderUnavailable.class);
    }

    // ---- 카카오: 「사용자 정보 조회」·「연결 해제」의 어드민 키 방식 ----

    @Test
    @DisplayName("account.login: 카카오 이메일 검증은 어드민 키와 회원번호로 사용자 정보 API 에 묻고 is_email_verified 를 본다")
    void kakaoEmailVerificationAsksTheUserApiWithTheAdminKey() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        MultiValueMap<String, String> expected = new LinkedMultiValueMap<>();
        expected.add("target_id_type", "user_id");
        expected.add("target_id", "987654321");
        server.expect(requestTo("https://kapi.kakao.com/v2/user/me"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "KakaoAK admin-key"))
                .andExpect(content().formData(expected))
                .andRespond(withSuccess("""
                        {"id":987654321,"kakao_account":{"email":"Actor@Example.test",
                         "is_email_valid":true,"is_email_verified":true}}
                        """, MediaType.APPLICATION_JSON));

        assertThat(new HttpKakaoUserClient("admin-key", builder).emailVerified("987654321", "actor@example.test"))
                .isTrue();
        server.verify();
    }

    @Test
    @DisplayName("account.login: 카카오가 인증하지 않았거나, 만료된 주소이거나, ID 토큰의 주소와 다르면 검증되지 않은 이메일이다")
    void kakaoEmailIsUnverifiedUnlessKakaoSaysSoForThatAddress() {
        assertThat(kakao(withSuccess("""
                {"kakao_account":{"email":"a@example.test","is_email_valid":true,"is_email_verified":false}}
                """, MediaType.APPLICATION_JSON)).emailVerified("1", "a@example.test")).isFalse();
        assertThat(kakao(withSuccess("""
                {"kakao_account":{"email":"a@example.test","is_email_valid":false,"is_email_verified":true}}
                """, MediaType.APPLICATION_JSON)).emailVerified("1", "a@example.test")).isFalse();
        assertThat(kakao(withSuccess("""
                {"kakao_account":{"email":"other@example.test","is_email_valid":true,"is_email_verified":true}}
                """, MediaType.APPLICATION_JSON)).emailVerified("1", "a@example.test")).isFalse();
        assertThat(kakao(withSuccess("{\"id\":1}", MediaType.APPLICATION_JSON)).emailVerified("1", "a@example.test"))
                .as("이메일 제공에 동의하지 않은 사람").isFalse();
    }

    @Test
    @DisplayName("account.login: 카카오가 답하지 않으면 제공자 장애이고, 어드민 키를 거절하면 설정 사고다")
    void kakaoTellsAnOutageFromARejectedAdminKey() {
        assertThatThrownBy(() -> kakao(withStatus(HttpStatus.BAD_GATEWAY)).emailVerified("1", "a@example.test"))
                .isInstanceOf(ProviderUnavailable.class);
        assertThatThrownBy(() -> kakao(withStatus(HttpStatus.UNAUTHORIZED)).emailVerified("1", "a@example.test"))
                .isInstanceOf(ProviderConfigurationError.class);
        assertThatThrownBy(() -> new HttpKakaoUserClient("", RestClient.builder()).unlink("1"))
                .isInstanceOf(ProviderConfigurationError.class);
    }

    @Test
    @DisplayName("account.withdraw: 카카오 연결 끊기는 어드민 키와 회원번호를 연결 해제 API 에 보낸다")
    void kakaoUnlinkPostsTheUserIdWithTheAdminKey() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        MultiValueMap<String, String> expected = new LinkedMultiValueMap<>();
        expected.add("target_id_type", "user_id");
        expected.add("target_id", "987654321");
        server.expect(requestTo("https://kapi.kakao.com/v1/user/unlink"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "KakaoAK admin-key"))
                .andExpect(content().formData(expected))
                .andRespond(withSuccess("{\"id\":987654321}", MediaType.APPLICATION_JSON));

        new HttpKakaoUserClient("admin-key", builder).unlink("987654321");

        server.verify();
        assertThatThrownBy(() -> kakao(withStatus(HttpStatus.INTERNAL_SERVER_ERROR)).unlink("1"))
                .isInstanceOf(ProviderUnavailable.class);
    }

    // ---- 애플: 「Generate and validate tokens」·「Revoke tokens」·「Creating a client secret」 ----

    @Test
    @DisplayName("account.login: 애플 코드 교환은 ES256 client secret 과 함께 보내고, 받은 refresh token 을 Client ID 와 묶어 돌려준다")
    void appleExchangeSendsASignedClientSecretAndKeepsTheClientId() throws Exception {
        KeyPair keys = ecKeys();
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        AtomicReference<String> body = new AtomicReference<>();
        server.expect(requestTo("https://appleid.apple.com/auth/token"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(request -> body.set(((MockClientHttpRequest) request).getBodyAsString()))
                .andRespond(withSuccess("""
                        {"access_token":"at","token_type":"Bearer","expires_in":3600,
                         "refresh_token":"apple-refresh","id_token":"a.b.c"}
                        """, MediaType.APPLICATION_JSON));
        Instant now = Instant.parse("2026-10-02T03:00:00Z");

        String grant = apple(keys, now, builder).exchange("the-code", "com.acttub.app");

        MultiValueMap<String, String> form = form(body.get());
        assertThat(form.getFirst("client_id")).isEqualTo("com.acttub.app");
        assertThat(form.getFirst("code")).isEqualTo("the-code");
        assertThat(form.getFirst("grant_type")).isEqualTo("authorization_code");
        SignedJWT secret = SignedJWT.parse(form.getFirst("client_secret"));
        assertThat(secret.verify(new ECDSAVerifier((ECPublicKey) keys.getPublic()))).isTrue();
        assertThat(secret.getHeader().getAlgorithm().getName()).isEqualTo("ES256");
        assertThat(secret.getHeader().getKeyID()).isEqualTo("KEYID12345");
        assertThat(secret.getJWTClaimsSet().getIssuer()).isEqualTo("TEAMID1234");
        assertThat(secret.getJWTClaimsSet().getSubject()).isEqualTo("com.acttub.app");
        assertThat(secret.getJWTClaimsSet().getAudience()).containsExactly("https://appleid.apple.com");
        assertThat(secret.getJWTClaimsSet().getIssueTime().toInstant()).isEqualTo(now);
        assertThat(secret.getJWTClaimsSet().getExpirationTime().toInstant()).isAfter(now).isBefore(now.plusSeconds(601));
        JsonNode packed = JSON.readTree(grant);
        assertThat(packed.path("client_id").asText()).isEqualTo("com.acttub.app");
        assertThat(packed.path("refresh_token").asText()).isEqualTo("apple-refresh");
    }

    @Test
    @DisplayName("account.withdraw: 애플 폐기는 저장해 둔 refresh token 을 그것을 받은 Client ID 로 폐기 경로에 보낸다")
    void appleRevokeSendsTheStoredRefreshTokenForItsClientId() throws Exception {
        KeyPair keys = ecKeys();
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        AtomicReference<String> body = new AtomicReference<>();
        server.expect(requestTo("https://appleid.apple.com/auth/revoke"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(request -> body.set(((MockClientHttpRequest) request).getBodyAsString()))
                .andRespond(withSuccess());

        apple(keys, Instant.parse("2026-10-02T03:00:00Z"), builder)
                .revoke("{\"client_id\":\"com.acttub.app\",\"refresh_token\":\"apple-refresh\"}");

        MultiValueMap<String, String> form = form(body.get());
        assertThat(form.getFirst("client_id")).isEqualTo("com.acttub.app");
        assertThat(form.getFirst("token")).isEqualTo("apple-refresh");
        assertThat(form.getFirst("token_type_hint")).isEqualTo("refresh_token");
        assertThat(form.getFirst("client_secret")).isNotBlank();
    }

    @Test
    @DisplayName("account.login: 애플이 코드를 거절하면 잘못된 토큰이고, 답하지 않으면 제공자 장애이며, 키가 없으면 설정 사고다")
    void appleTellsABadCodeFromAnOutageFromMissingKeys() throws Exception {
        KeyPair keys = ecKeys();
        Instant now = Instant.parse("2026-10-02T03:00:00Z");

        assertThatThrownBy(() -> apple(keys, now, responding(withStatus(HttpStatus.BAD_REQUEST)
                        .body("{\"error\":\"invalid_grant\"}").contentType(MediaType.APPLICATION_JSON)))
                .exchange("used", "com.acttub.app"))
                .isInstanceOf(InvalidIdentityToken.class);
        assertThatThrownBy(() -> apple(keys, now, responding(withStatus(HttpStatus.BAD_REQUEST)
                        .body("{\"error\":\"invalid_client\"}").contentType(MediaType.APPLICATION_JSON)))
                .exchange("c", "com.acttub.app"))
                .isInstanceOf(ProviderConfigurationError.class);
        assertThatThrownBy(() -> apple(keys, now, responding(withStatus(HttpStatus.SERVICE_UNAVAILABLE)))
                .exchange("c", "com.acttub.app"))
                .isInstanceOf(ProviderUnavailable.class);
        assertThatThrownBy(() -> apple(keys, now, responding(withStatus(HttpStatus.BAD_REQUEST)))
                .revoke("{\"client_id\":\"com.acttub.app\",\"refresh_token\":\"rt\"}"))
                .isInstanceOf(ProviderUnavailable.class);
        assertThatThrownBy(() -> new HttpAppleTokenClient("", "", "", Clock.systemUTC(), RestClient.builder())
                .exchange("c", "com.acttub.app"))
                .isInstanceOf(ProviderConfigurationError.class);
    }

    // ---- helpers ----

    private static HttpNaverTokenClient naver(org.springframework.test.web.client.ResponseCreator response) {
        return new HttpNaverTokenClient("naver-id", "naver-secret", responding(response));
    }

    private static HttpKakaoUserClient kakao(org.springframework.test.web.client.ResponseCreator response) {
        return new HttpKakaoUserClient("admin-key", responding(response));
    }

    private static RestClient.Builder responding(org.springframework.test.web.client.ResponseCreator response) {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer.bindTo(builder).build()
                .expect(request -> { })
                .andRespond(response);
        return builder;
    }

    private static HttpAppleTokenClient apple(KeyPair keys, Instant now, RestClient.Builder builder) {
        // 환경변수로 들어오는 모양 — 줄바꿈이 `\n` 두 글자다.
        String pem = "-----BEGIN PRIVATE KEY-----\\n"
                + Base64.getEncoder().encodeToString(keys.getPrivate().getEncoded())
                + "\\n-----END PRIVATE KEY-----";
        return new HttpAppleTokenClient(
                "TEAMID1234", "KEYID12345", pem, Clock.fixed(now, ZoneOffset.UTC), builder);
    }

    private static KeyPair ecKeys() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        return generator.generateKeyPair();
    }

    private static MultiValueMap<String, String> form(String body) {
        MultiValueMap<String, String> values = new LinkedMultiValueMap<>();
        for (String pair : body.split("&")) {
            int split = pair.indexOf('=');
            values.add(
                    java.net.URLDecoder.decode(pair.substring(0, split), java.nio.charset.StandardCharsets.UTF_8),
                    java.net.URLDecoder.decode(pair.substring(split + 1), java.nio.charset.StandardCharsets.UTF_8));
        }
        return values;
    }
}
