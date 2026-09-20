package com.acttub.actingapi.integration.oidc;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * 네이버 토큰 API 의 실물.
 *
 * <p>코드 교환은 OIDC 용 경로({@code /oauth2/token})다 — 기존 {@code /oauth2.0/token} 은 ID 토큰을
 * 주지 않는다. client secret 은 본문으로 보낸다(메타데이터의 {@code client_secret_post}). 문서의 요청
 * 변수 표에는 {@code redirect_uri} 가 없지만 RFC 6749 §4.1.3 은 인가 요청에 썼으면 함께 보내라고 하고
 * §3.2 는 모르는 변수를 무시하라고 하므로, 앱이 준 값이 있으면 싣는다.
 *
 * <p>폐기는 {@code /oauth2.0/revoke} 다. 결과는 본문이 아니라 HTTP 상태로 판단한다(문서의 "중요").
 *
 * <p>응답 본문과 요청 값(코드·토큰)은 로그에도 예외 메시지에도 싣지 않는다.
 */
@Component
public class HttpNaverTokenClient implements NaverTokenClient {
    static final String TOKEN_URL = "https://nid.naver.com/oauth2/token";
    static final String REVOKE_URL = "https://nid.naver.com/oauth2.0/revoke";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final String clientId;
    private final String clientSecret;
    private final RestClient http;

    @Autowired
    public HttpNaverTokenClient(
            @Value("${NAVER_OAUTH_CLIENT_ID:}") String clientId,
            @Value("${NAVER_OAUTH_CLIENT_SECRET:}") String clientSecret) {
        this(clientId, clientSecret, ProviderHttp.builder());
    }

    public HttpNaverTokenClient(String clientId, String clientSecret, RestClient.Builder http) {
        this.clientId = clientId == null ? "" : clientId.strip();
        this.clientSecret = clientSecret == null ? "" : clientSecret.strip();
        this.http = http.build();
    }

    @Override
    public NaverGrant exchange(String authorizationCode, String codeVerifier, String redirectUri, String state) {
        MultiValueMap<String, String> form = credentials();
        form.add("grant_type", "authorization_code");
        form.add("code", authorizationCode);
        form.add("state", state == null || state.isBlank() ? UUID.randomUUID().toString() : state);
        if (codeVerifier != null && !codeVerifier.isBlank()) {
            form.add("code_verifier", codeVerifier);
        }
        if (redirectUri != null && !redirectUri.isBlank()) {
            form.add("redirect_uri", redirectUri);
        }
        Reply reply = post(TOKEN_URL, form);
        JsonNode body = json(reply.body());
        String error = body.path("error").isTextual() ? body.path("error").asText() : null;
        // 네이버는 실패도 200 과 error 필드로 답하는 일이 있다. 상태와 필드를 둘 다 본다.
        if (reply.status() == 200 && error == null && body.path("id_token").isTextual()) {
            return new NaverGrant(
                    body.path("id_token").asText(),
                    body.path("refresh_token").isTextual() ? body.path("refresh_token").asText() : null);
        }
        if (reply.status() >= 500) {
            throw new ProviderUnavailable("naver token endpoint answered " + reply.status());
        }
        if ("invalid_client".equals(error) || "unauthorized_client".equals(error) || reply.status() == 401) {
            throw new ProviderConfigurationError("naver rejected the client credentials");
        }
        if (error != null) {
            throw new InvalidIdentityToken("naver rejected the authorization code");
        }
        throw new ProviderUnavailable("naver token endpoint answered without an id_token");
    }

    @Override
    public void revoke(String refreshToken) {
        MultiValueMap<String, String> form = credentials();
        form.add("token", refreshToken);
        form.add("token_type_hint", "refresh_token");
        Reply reply = post(REVOKE_URL, form);
        if (reply.status() == 401) {
            throw new ProviderConfigurationError("naver rejected the client credentials");
        }
        if (reply.status() != 200) {
            throw new ProviderUnavailable("naver revoke endpoint answered " + reply.status());
        }
    }

    private MultiValueMap<String, String> credentials() {
        if (clientId.isEmpty() || clientSecret.isEmpty()) {
            throw new ProviderConfigurationError("NAVER_OAUTH_CLIENT_ID or NAVER_OAUTH_CLIENT_SECRET not configured");
        }
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);
        return form;
    }

    private Reply post(String url, MultiValueMap<String, String> form) {
        try {
            return http.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .exchange((request, response) -> new Reply(
                            response.getStatusCode().value(),
                            new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8)));
        } catch (RestClientException failure) {
            throw new ProviderUnavailable("naver did not answer", failure);
        }
    }

    private static JsonNode json(String body) {
        try {
            JsonNode parsed = JSON.readTree(body);
            return parsed == null ? JSON.createObjectNode() : parsed;
        } catch (Exception notJson) {
            return JSON.createObjectNode();
        }
    }

    private record Reply(int status, String body) {
    }
}
