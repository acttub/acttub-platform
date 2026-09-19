package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * account.login: "네이버·카카오 연결 끊기 콜백 수신 — 그 신원 행만 없고 users 행은 그대로다. 서명이 틀린
 * 콜백 — 401 이고 신원 행이 그대로다."
 *
 * <p><b>실제 포트로 부른다.</b> 제공자는 값을 폼 본문으로 보내는데, 본문을 미리 읽어 두는 필터 때문에
 * 컨테이너가 폼 값을 파싱하지 못한다. MockMvc 는 폼 본문을 스스로 파라미터로 풀어 주므로 그 차이를
 * 가린다. 제공자가 보내는 그대로 — 우리 헤더({@code X-Acttub-Client}) 없이 — 보낸다.
 *
 * <p>알림의 규격은 각 제공자의 공식 문서다: 네이버 로그인 개발가이드 §4.4, 카카오 로그인 › 웹훅 ›
 * 연결 해제 웹훅.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "JWT_SECRET=test-secret",
            "ACCOUNT_CLEANUP_ENABLED=false",
            "NAVER_OAUTH_CLIENT_ID=naver-client-id",
            "NAVER_OAUTH_CLIENT_SECRET=naver-client-secret",
            "KAKAO_ADMIN_KEY=kakao-admin-key",
            "KAKAO_APP_ID=1234"
        })
class ProviderDisconnectCallbackIT {
    private static final String NAVER_ID = "naver-client-id";
    private static final String NAVER_SECRET = "naver-client-secret";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("provider_disconnect");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbc;

    private final HttpClient http = HttpClient.newHttpClient();
    private UUID userId;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,status) VALUES (?,'actor@example.test','active')", userId);
        identity("google", "g-1");
        identity("naver", "naver-unique-id-1");
        identity("kakao", "987654321");
    }

    @Test
    @DisplayName("account.login: 네이버 연결 끊기 콜백 수신 — 그 신원 행만 없고 users 행은 그대로다")
    void accountLogin_naverDisconnectRemovesOnlyThatIdentity() throws Exception {
        String encrypted = naverEncrypt("naver-unique-id-1");
        String timestamp = "1693877406";

        HttpResponse<String> response = form("/v2/auth/providers/naver/disconnect", null,
                "clientId=" + NAVER_ID + "&encryptUniqueId=" + encrypted + "&timestamp=" + timestamp
                        + "&signature=" + naverSign(NAVER_SECRET, encrypted, timestamp));

        assertThat(response.statusCode()).as(response.body()).isEqualTo(204);
        assertThat(response.body()).isEmpty();
        assertThat(providers()).containsExactly("google", "kakao");
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, userId))
                .isEqualTo("active");
    }

    @Test
    @DisplayName("account.login: 네이버가 값을 쿼리 문자열로 보내도(문서의 요청문 샘플) 같은 결과다")
    void accountLogin_naverDisconnectAlsoReadsTheQueryString() throws Exception {
        String encrypted = naverEncrypt("naver-unique-id-1");
        String query = "?clientId=" + NAVER_ID + "&encryptUniqueId=" + encrypted + "&timestamp=1693877406"
                + "&signature=" + naverSign(NAVER_SECRET, encrypted, "1693877406");

        HttpResponse<String> response = form("/v2/auth/providers/naver/disconnect" + query, null, "");

        assertThat(response.statusCode()).isEqualTo(204);
        assertThat(providers()).containsExactly("google", "kakao");
    }

    @Test
    @DisplayName("account.login: 서명이 틀린 네이버 콜백 — 401 이고 신원 행이 그대로다")
    void accountLogin_naverDisconnectWithAForgedSignatureRemovesNothing() throws Exception {
        String encrypted = naverEncrypt("naver-unique-id-1");

        HttpResponse<String> response = form("/v2/auth/providers/naver/disconnect", null,
                "clientId=" + NAVER_ID + "&encryptUniqueId=" + encrypted + "&timestamp=1693877406"
                        + "&signature=" + naverSign("someone-elses-secret", encrypted, "1693877406"));

        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(response.body()).isEqualTo("{\"detail\":\"invalid_provider_signature\"}");
        assertThat(providers()).containsExactly("google", "kakao", "naver");
    }

    @Test
    @DisplayName("account.login: 카카오 연결 끊기 콜백 수신 — 그 신원 행만 없고 users 행은 그대로다")
    void accountLogin_kakaoUnlinkRemovesOnlyThatIdentity() throws Exception {
        HttpResponse<String> response = form("/v2/auth/providers/kakao/disconnect", "KakaoAK kakao-admin-key",
                "app_id=1234&user_id=987654321&referrer_type=UNLINK_FROM_APPS");

        assertThat(response.statusCode()).as("카카오는 200 OK 를 요구한다").isEqualTo(200);
        assertThat(response.body()).isEmpty();
        assertThat(providers()).containsExactly("google", "naver");
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, userId))
                .isEqualTo("active");
    }

    @Test
    @DisplayName("account.login: 어드민 키가 틀리거나 없는 카카오 콜백 — 401 이고 신원 행이 그대로다")
    void accountLogin_kakaoUnlinkWithoutTheAdminKeyRemovesNothing() throws Exception {
        HttpResponse<String> forged = form("/v2/auth/providers/kakao/disconnect", "KakaoAK wrong-key",
                "app_id=1234&user_id=987654321&referrer_type=UNLINK_FROM_APPS");
        HttpResponse<String> bare = form("/v2/auth/providers/kakao/disconnect", null,
                "app_id=1234&user_id=987654321&referrer_type=UNLINK_FROM_APPS");

        assertThat(forged.statusCode()).isEqualTo(401);
        assertThat(forged.body()).isEqualTo("{\"detail\":\"invalid_provider_signature\"}");
        assertThat(bare.statusCode()).isEqualTo(401);
        assertThat(providers()).containsExactly("google", "kakao", "naver");
    }

    @Test
    @DisplayName("account.login: 모르는 신원의 콜백도 같은 응답이다 — 카카오는 사용자 정보가 없어도 200 으로 답하라고 한다")
    void accountLogin_disconnectOfAnUnknownIdentityIsTheSameAnswer() throws Exception {
        jdbc.update("UPDATE user_identities SET provider_uid=NULL,uid_hash='d1:' || repeat('0',64) WHERE provider='kakao'");

        HttpResponse<String> response = form("/v2/auth/providers/kakao/disconnect", "KakaoAK kakao-admin-key",
                "app_id=1234&user_id=987654321&referrer_type=UNLINK_FROM_ADMIN");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(providers()).as("해시로 바뀐 신원은 지우지 않는다").containsExactly("google", "kakao", "naver");
    }

    // ---- helpers ----

    private HttpResponse<String> form(String path, String authorization, String body) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        if (authorization != null) {
            request.header("Authorization", authorization);
        }
        return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private void identity(String provider, String providerUid) {
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,?,?)",
                UUID.randomUUID(), userId, provider, providerUid);
    }

    private java.util.List<String> providers() {
        return jdbc.queryForList("SELECT provider FROM user_identities ORDER BY provider", String.class);
    }

    /** 네이버 문서 §4.4.2 의 암호화 예제 그대로다. 제공자가 하는 일이라 테스트가 직접 만든다. */
    private static String naverEncrypt(String uniqueId) throws Exception {
        byte[] iv = new byte[16];
        new SecureRandom().nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(naverKey(NAVER_SECRET), "AES"), new IvParameterSpec(iv));
        byte[] encrypted = cipher.doFinal(uniqueId.getBytes(StandardCharsets.UTF_8));
        byte[] packed = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, packed, 0, iv.length);
        System.arraycopy(encrypted, 0, packed, iv.length, encrypted.length);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(packed);
    }

    /** 네이버 문서 §4.4.3 의 서명 예제 그대로다. */
    private static String naverSign(String clientSecret, String encryptUniqueId, String timestamp) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(naverKey(clientSecret), "HmacSHA256"));
        String base = "clientId=%s&encryptUniqueId=%s&timestamp=%s".formatted(NAVER_ID, encryptUniqueId, timestamp);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(base.getBytes(StandardCharsets.UTF_8)));
    }

    private static byte[] naverKey(String clientSecret) throws Exception {
        return Arrays.copyOfRange(
                MessageDigest.getInstance("MD5").digest(clientSecret.getBytes(StandardCharsets.UTF_8)), 0, 16);
    }
}
