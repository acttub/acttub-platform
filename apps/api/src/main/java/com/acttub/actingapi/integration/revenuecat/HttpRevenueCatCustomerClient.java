package com.acttub.actingapi.integration.revenuecat;

import java.net.http.HttpClient;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * RevenueCat 고객 삭제의 실물. {@code DELETE https://api.revenuecat.com/v1/subscribers/{app_user_id}} 를 V1 비밀 키
 * ({@code REVENUECAT_SECRET_API_KEY}, 조회·웹훅과 같은 키)로 부른다. 200 과 404 가 성공이다(공식 문서: 다시 시도해도 안전한
 * 흐름에서는 둘 다 "지워졌다"로 본다).
 *
 * <p>켜짐은 결제 조회와 같은 스위치다 — {@code BILLING_REVENUECAT_ENABLED} 가 true 이고 비밀 키가 있을 때만. 비밀 키와 사용자 ID 는
 * 로그에도 예외 메시지에도 싣지 않는다.
 */
@Component
public class HttpRevenueCatCustomerClient implements RevenueCatCustomerClient {
    static final String BASE_URL = "https://api.revenuecat.com";
    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private final boolean switchedOn;
    private final String secretKey;
    private final RestClient http;

    @Autowired
    public HttpRevenueCatCustomerClient(
            @Value("${BILLING_REVENUECAT_ENABLED:false}") boolean switchedOn,
            @Value("${REVENUECAT_SECRET_API_KEY:}") String secretKey) {
        this(switchedOn, secretKey, builder());
    }

    public HttpRevenueCatCustomerClient(boolean switchedOn, String secretKey, RestClient.Builder http) {
        this.switchedOn = switchedOn;
        this.secretKey = secretKey == null ? "" : secretKey.strip();
        this.http = http.build();
    }

    private static RestClient.Builder builder() {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(5))
                .build());
        factory.setReadTimeout(TIMEOUT);
        return RestClient.builder().requestFactory(factory);
    }

    @Override
    public boolean enabled() {
        return switchedOn && !secretKey.isEmpty();
    }

    @Override
    public void delete(String appUserId) {
        if (!enabled()) {
            throw new RevenueCatUnavailable("revenuecat customer deletion not configured");
        }
        if (appUserId == null || appUserId.isBlank()) {
            throw new IllegalArgumentException("app user id missing");
        }
        int status;
        try {
            // {id} 자리는 RestClient 가 경로 조각으로 인코딩한다(공식 문서: app_user_id 는 URL 인코딩).
            status = http.delete()
                    .uri(BASE_URL + "/v1/subscribers/{appUserId}", appUserId)
                    .header("Authorization", "Bearer " + secretKey)
                    .header("Accept", "application/json")
                    .exchange((sent, response) -> response.getStatusCode().value());
        } catch (RestClientException failure) {
            // 원인 예외에 요청 주소(사용자 ID)가 들어 있을 수 있어 붙이지 않는다.
            throw new RevenueCatUnavailable("revenuecat did not answer");
        }
        if (status == 200 || status == 404) {
            return;
        }
        if (status == 401 || status == 403) {
            throw new RevenueCatUnavailable("revenuecat rejected the secret api key status=" + status);
        }
        throw new RevenueCatUnavailable("revenuecat customer delete answered " + status);
    }
}
