package com.acttub.actingapi.integration.oidc;

import java.security.KeyFactory;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * 애플 토큰 API 의 실물. 요청마다 client secret(ES256 JWT)을 새로 만든다 — 애플 문서
 * 「Creating a client secret」: {@code iss}=Team ID, {@code sub}=Client ID,
 * {@code aud}=https://appleid.apple.com, 헤더 {@code kid}=Key ID. 수명은 5분이면 충분하다.
 *
 * <p>응답 본문과 요청 값(코드·토큰)은 로그에도 예외 메시지에도 싣지 않는다.
 */
@Component
public class HttpAppleTokenClient implements AppleTokenClient {
    static final String TOKEN_URL = "https://appleid.apple.com/auth/token";
    static final String REVOKE_URL = "https://appleid.apple.com/auth/revoke";
    private static final String AUDIENCE = "https://appleid.apple.com";
    private static final long CLIENT_SECRET_TTL_SECONDS = 5 * 60;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final String teamId;
    private final String keyId;
    private final String privateKeyPem;
    private final Clock clock;
    private final RestClient http;

    @Autowired
    public HttpAppleTokenClient(
            @Value("${APPLE_TEAM_ID:}") String teamId,
            @Value("${APPLE_KEY_ID:}") String keyId,
            @Value("${APPLE_PRIVATE_KEY:}") String privateKeyPem,
            Clock clock) {
        this(teamId, keyId, privateKeyPem, clock, ProviderHttp.builder());
    }

    public HttpAppleTokenClient(
            String teamId, String keyId, String privateKeyPem, Clock clock, RestClient.Builder http) {
        this.teamId = teamId == null ? "" : teamId.strip();
        this.keyId = keyId == null ? "" : keyId.strip();
        this.privateKeyPem = privateKeyPem == null ? "" : privateKeyPem;
        this.clock = clock;
        this.http = http.build();
    }

    @Override
    public String exchange(String authorizationCode, String clientId) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret(clientId));
        form.add("code", authorizationCode);
        form.add("grant_type", "authorization_code");
        Reply reply = post(TOKEN_URL, form);
        if (reply.status() == 200) {
            String refreshToken = text(reply.body(), "refresh_token");
            if (refreshToken == null) {
                throw new ProviderUnavailable("apple token response has no refresh_token");
            }
            Map<String, String> grant = new LinkedHashMap<>();
            grant.put("client_id", clientId);
            grant.put("refresh_token", refreshToken);
            try {
                return JSON.writeValueAsString(grant);
            } catch (Exception failure) {
                throw new IllegalStateException("failed to pack the apple grant", failure);
            }
        }
        String error = text(reply.body(), "error");
        if (reply.status() == 400 && "invalid_grant".equals(error)) {
            throw new InvalidIdentityToken("apple rejected the authorization code");
        }
        if (reply.status() == 400 && "invalid_client".equals(error)) {
            throw new ProviderConfigurationError("apple rejected the client secret");
        }
        throw new ProviderUnavailable("apple token endpoint answered " + reply.status());
    }

    @Override
    public void revoke(String grant) {
        String clientId;
        String refreshToken;
        try {
            JsonNode packed = JSON.readTree(grant);
            clientId = packed.path("client_id").asText();
            refreshToken = packed.path("refresh_token").asText();
        } catch (Exception failure) {
            throw new IllegalArgumentException("not an apple grant");
        }
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret(clientId));
        form.add("token", refreshToken);
        form.add("token_type_hint", "refresh_token");
        Reply reply = post(REVOKE_URL, form);
        if (reply.status() != 200) {
            throw new ProviderUnavailable("apple revoke endpoint answered " + reply.status());
        }
    }

    private Reply post(String url, MultiValueMap<String, String> form) {
        try {
            return http.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .exchange((request, response) -> new Reply(
                            response.getStatusCode().value(),
                            new String(response.getBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)));
        } catch (RestClientException failure) {
            throw new ProviderUnavailable("apple did not answer", failure);
        }
    }

    private String clientSecret(String clientId) {
        if (teamId.isEmpty() || keyId.isEmpty() || privateKeyPem.isBlank()) {
            throw new ProviderConfigurationError("APPLE_TEAM_ID, APPLE_KEY_ID or APPLE_PRIVATE_KEY not configured");
        }
        try {
            Instant now = clock.instant();
            SignedJWT jwt = new SignedJWT(
                    new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(keyId).build(),
                    new JWTClaimsSet.Builder()
                            .issuer(teamId)
                            .issueTime(Date.from(now))
                            .expirationTime(Date.from(now.plusSeconds(CLIENT_SECRET_TTL_SECONDS)))
                            .audience(AUDIENCE)
                            .subject(clientId)
                            .build());
            jwt.sign(new ECDSASigner(privateKey()));
            return jwt.serialize();
        } catch (ProviderConfigurationError misconfigured) {
            throw misconfigured;
        } catch (Exception failure) {
            throw new ProviderConfigurationError("APPLE_PRIVATE_KEY cannot sign a client secret");
        }
    }

    /** 환경변수에는 줄바꿈이 {@code \n} 두 글자로 들어오는 일이 흔하다. 머리말·꼬리말·공백을 걷어 낸다. */
    private ECPrivateKey privateKey() throws Exception {
        String base64 = privateKeyPem
                .replace("\\n", "\n")
                .replaceAll("-----[A-Z ]+-----", "")
                .replaceAll("\\s", "");
        return (ECPrivateKey) KeyFactory.getInstance("EC")
                .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(base64)));
    }

    private static String text(String body, String field) {
        try {
            JsonNode value = JSON.readTree(body).path(field);
            return value.isTextual() ? value.asText() : null;
        } catch (Exception notJson) {
            return null;
        }
    }

    private record Reply(int status, String body) {
    }
}
