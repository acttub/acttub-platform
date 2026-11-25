package com.acttub.actingapi.feature.appversion.adapter.store;

import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.platform.http.RestClients;
import com.acttub.actingapi.platform.json.LenientJson;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * 한국 App Store 에 지금 보이는 iOS 판(SOMA-1150). 애플의 공개 조회 주소라 키가 없고 값이 들지 않는다.
 *
 * <p>App Store 는 단계적 릴리스 중에도 누구나 손으로 새 판을 받을 수 있어(자동 업데이트만 나눠 간다) 여기 보이는 판이 곧
 * 누구나 받을 수 있는 판이다. 조회 결과는 캐시라 늦게 바뀌고 잠깐 옛 판으로 돌아가 보이기도 한다 — 올리기 전 기다리는
 * 시간({@code MIN_VERSION_SETTLE_HOURS})이 그것을 덮는다. 결과의 번들 ID 가 우리 앱이 아니면 버린다.
 */
@Component
@ConditionalOnProperty(name = "MIN_VERSION_AUTO_RAISE", havingValue = "true")
class AppStoreLookup {

    static final String ENDPOINT = "https://itunes.apple.com/lookup";
    private static final Duration TIMEOUT = Duration.ofSeconds(10);
    private static final Logger LOG = LoggerFactory.getLogger(AppStoreLookup.class);
    private static final ObjectMapper JSON = JsonMapper.builderWithJackson2Defaults().build();

    private final String endpoint;
    private final String appId;
    private final String bundleId;
    private final RestClient http;

    @Autowired
    AppStoreLookup(
            @Value("${STORE_IOS_APP_ID:6793056855}") String appId,
            @Value("${STORE_IOS_BUNDLE_ID:com.acttub.app}") String bundleId) {
        this(ENDPOINT, appId, bundleId, builder());
    }

    AppStoreLookup(String endpoint, String appId, String bundleId, RestClient.Builder http) {
        this.endpoint = endpoint;
        this.appId = appId.strip();
        this.bundleId = bundleId.strip();
        this.http = http.build();
    }

    static RestClient.Builder builder() {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(TIMEOUT)
                .build());
        factory.setReadTimeout(TIMEOUT);
        return RestClients.builder().requestFactory(factory);
    }

    Optional<AppVersion> live() {
        try {
            // 애플은 본문을 text/javascript 로 준다 — 글자로 받아 직접 읽는다.
            String body = http.get().uri(endpoint + "?id={id}&country=kr", appId).retrieve().body(String.class);
            JsonNode results = JSON.readTree(body == null ? "{}" : body).path("results");
            if (!results.isArray() || results.size() != 1) {
                LOG.warn("app store lookup has no single result app={} count={}", appId, results.size());
                return Optional.empty();
            }
            JsonNode app = results.get(0);
            if (!bundleId.equals(LenientJson.asText(app.path("bundleId"), ""))) {
                LOG.warn("app store lookup returned another bundle app={}", appId);
                return Optional.empty();
            }
            Optional<AppVersion> version = AppVersion.parse(LenientJson.asText(app.path("version"), ""));
            if (version.isEmpty()) {
                LOG.warn("app store lookup version unreadable app={}", appId);
            }
            return version;
        } catch (RuntimeException failure) {
            LOG.warn("app store lookup failed app={} reason={}", appId, failure.getClass().getSimpleName());
            return Optional.empty();
        }
    }
}
