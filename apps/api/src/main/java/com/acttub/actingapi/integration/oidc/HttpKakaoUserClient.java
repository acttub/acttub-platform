package com.acttub.actingapi.integration.oidc;

import java.nio.charset.StandardCharsets;

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
 * 카카오 사용자 API 의 실물. 어드민 키 방식이다 — 헤더 {@code Authorization: KakaoAK <어드민 키>} 와
 * {@code target_id_type=user_id}·{@code target_id=<회원번호>}.
 *
 * <p>응답 본문(이메일이 들어 있다)과 회원번호는 로그에도 예외 메시지에도 싣지 않는다.
 */
@Component
public class HttpKakaoUserClient implements KakaoUserClient {
    static final String USER_URL = "https://kapi.kakao.com/v2/user/me";
    static final String UNLINK_URL = "https://kapi.kakao.com/v1/user/unlink";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final String adminKey;
    private final RestClient http;

    @Autowired
    public HttpKakaoUserClient(@Value("${KAKAO_ADMIN_KEY:}") String adminKey) {
        this(adminKey, ProviderHttp.builder());
    }

    public HttpKakaoUserClient(String adminKey, RestClient.Builder http) {
        this.adminKey = adminKey == null ? "" : adminKey.strip();
        this.http = http.build();
    }

    @Override
    public boolean emailVerified(String kakaoUserId, String email) {
        Reply reply = post(USER_URL, kakaoUserId);
        if (reply.status() != 200) {
            throw unanswered("user info", reply.status());
        }
        try {
            JsonNode account = JSON.readTree(reply.body()).path("kakao_account");
            return account.path("is_email_valid").asBoolean(false)
                    && account.path("is_email_verified").asBoolean(false)
                    && email != null
                    && email.equalsIgnoreCase(account.path("email").asText("").strip());
        } catch (Exception notJson) {
            throw new ProviderUnavailable("kakao user info answered something unreadable");
        }
    }

    @Override
    public void unlink(String kakaoUserId) {
        Reply reply = post(UNLINK_URL, kakaoUserId);
        if (reply.status() != 200) {
            throw unanswered("unlink", reply.status());
        }
    }

    private Reply post(String url, String kakaoUserId) {
        if (adminKey.isEmpty()) {
            throw new ProviderConfigurationError("KAKAO_ADMIN_KEY not configured");
        }
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("target_id_type", "user_id");
        form.add("target_id", kakaoUserId);
        try {
            return http.post()
                    .uri(url)
                    .header("Authorization", "KakaoAK " + adminKey)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .exchange((request, response) -> new Reply(
                            response.getStatusCode().value(),
                            new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8)));
        } catch (RestClientException failure) {
            throw new ProviderUnavailable("kakao did not answer", failure);
        }
    }

    /** 401 은 우리 어드민 키가 틀렸다는 뜻이다 — 기다려도 낫지 않는 운영 사고라 무응답과 가른다. */
    private static RuntimeException unanswered(String api, int status) {
        if (status == 401) {
            return new ProviderConfigurationError("kakao rejected the admin key");
        }
        return new ProviderUnavailable("kakao " + api + " answered " + status);
    }

    private record Reply(int status, String body) {
    }
}
