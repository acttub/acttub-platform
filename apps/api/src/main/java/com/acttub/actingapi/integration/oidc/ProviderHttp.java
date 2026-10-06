package com.acttub.actingapi.integration.oidc;

import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * 제공자 API 를 부르는 HTTP 의 공통 설정. 로그인 요청과 탈퇴 요청 안에서 부르므로 오래 기다리지 않는다 —
 * 답이 없으면 {@link ProviderUnavailable} 로 끝낸다.
 */
final class ProviderHttp {
    private static final Duration TIMEOUT = Duration.ofSeconds(5);

    private ProviderHttp() {
    }

    static RestClient.Builder builder() {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(TIMEOUT)
                .build());
        factory.setReadTimeout(TIMEOUT);
        return RestClient.builder().requestFactory(factory);
    }

    /** 요청을 보내고 상태와 본문을 그대로 읽는다. 무엇이 성공인지는 부르는 쪽이 정한다. */
    static Reply send(RestClient.RequestHeadersSpec<?> request, String provider) {
        try {
            return request.exchange((sent, response) -> new Reply(
                    response.getStatusCode().value(),
                    new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8)));
        } catch (RestClientException failure) {
            throw new ProviderUnavailable(provider + " did not answer", failure);
        }
    }

    record Reply(int status, String body) {
    }
}
