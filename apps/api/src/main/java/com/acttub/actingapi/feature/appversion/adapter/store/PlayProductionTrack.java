package com.acttub.actingapi.feature.appversion.adapter.store;

import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.platform.json.LenientJson;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.Optional;
import java.util.stream.StreamSupport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Play 운영 트랙에서 <b>단계적 출시를 마친</b> 안드로이드 판(SOMA-1150). Google Play 개발자 API 를 읽기만 한다 — 편집을 열어
 * 트랙을 읽고 저장하지 않고 지운다(무료).
 *
 * <p>단계적 출시 중({@code inProgress})·중단({@code halted})인 출시는 그 판을 못 받는 사람이 있어 세지 않는다. 출시 이름에서 판을
 * 꺼낸다 — 이름을 비우고 올리면 Play 가 앱의 판 이름(1.2.0)으로 채우고, Play Console 기본값은 {@code 28 (1.2.0)} 이다. 이름에
 * 판이 없으면 그 출시를 모르는 것으로 본다.
 *
 * <p>키({@code PLAY_SERVICE_ACCOUNT_JSON}, 서비스 계정 JSON 또는 그 base64)가 없거나 못 읽으면 안드로이드는 늘 「모름」이라
 * 최소 판을 바꾸지 않는다. 키 내용은 로그에 싣지 않는다.
 */
@Component
@ConditionalOnProperty(name = "MIN_VERSION_AUTO_RAISE", havingValue = "true")
class PlayProductionTrack {

    static final String API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/";
    static final String SCOPE = "https://www.googleapis.com/auth/androidpublisher";
    private static final String DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
    private static final Logger LOG = LoggerFactory.getLogger(PlayProductionTrack.class);
    private static final ObjectMapper JSON = JsonMapper.builderWithJackson2Defaults().build();

    private final ServiceAccount account;
    private final String packageName;
    private final String api;
    private final Clock clock;
    private final RestClient http;
    private String token;
    private Instant tokenExpires = Instant.EPOCH;

    @Autowired
    PlayProductionTrack(
            @Value("${PLAY_SERVICE_ACCOUNT_JSON:}") String key,
            @Value("${STORE_ANDROID_PACKAGE:com.acttub.app}") String packageName) {
        this(key, packageName, API, Clock.systemUTC(), AppStoreLookup.builder());
    }

    PlayProductionTrack(String key, String packageName, String api, Clock clock, RestClient.Builder http) {
        this.account = ServiceAccount.read(key);
        this.packageName = packageName.strip();
        this.api = api;
        this.clock = clock;
        this.http = http.build();
        if (account == null) {
            LOG.warn("play service account missing or unreadable — android minimum version stays as is");
        }
    }

    synchronized Optional<AppVersion> live() {
        if (account == null) {
            return Optional.empty();
        }
        try {
            String bearer = "Bearer " + token();
            JsonNode edit = JSON.readTree(http.post().uri(api + "{pkg}/edits", packageName)
                    .header(HttpHeaders.AUTHORIZATION, bearer)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{}")
                    .retrieve().body(String.class));
            String editId = LenientJson.asText(edit.path("id"), "");
            if (editId.isEmpty()) {
                LOG.warn("play edit has no id package={}", packageName);
                return Optional.empty();
            }
            try {
                JsonNode track = JSON.readTree(http.get()
                        .uri(api + "{pkg}/edits/{edit}/tracks/production", packageName, editId)
                        .header(HttpHeaders.AUTHORIZATION, bearer)
                        .retrieve().body(String.class));
                Optional<AppVersion> version = completed(track);
                if (version.isEmpty()) {
                    LOG.warn("play production track has no completed release with a version name package={}", packageName);
                }
                return version;
            } finally {
                discard(editId, bearer);
            }
        } catch (RuntimeException failure) {
            LOG.warn("play track read failed package={} reason={}", packageName, failure.getClass().getSimpleName());
            return Optional.empty();
        }
    }

    /** 다 나간({@code completed}) 출시 중 가장 높은 판. */
    static Optional<AppVersion> completed(JsonNode track) {
        JsonNode releases = track.path("releases");
        if (!releases.isArray()) {
            return Optional.empty();
        }
        return StreamSupport.stream(releases.spliterator(), false)
                .filter(release -> "completed".equals(LenientJson.asText(release.path("status"), "")))
                .map(release -> AppVersion.find(LenientJson.asText(release.path("name"), "")))
                .flatMap(Optional::stream)
                .max(AppVersion::compareTo);
    }

    private void discard(String editId, String bearer) {
        try {
            http.delete().uri(api + "{pkg}/edits/{edit}", packageName, editId)
                    .header(HttpHeaders.AUTHORIZATION, bearer)
                    .retrieve().toBodilessEntity();
        } catch (RuntimeException failure) {
            LOG.warn("play edit discard failed package={} reason={}", packageName, failure.getClass().getSimpleName());
        }
    }

    private String token() {
        Instant now = clock.instant();
        if (token != null && now.isBefore(tokenExpires)) {
            return token;
        }
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
        form.add("assertion", account.assertion(now));
        JsonNode reply = JSON.readTree(http.post().uri(account.tokenUri())
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve().body(String.class));
        String accessToken = LenientJson.asText(reply.path("access_token"), "");
        if (accessToken.isEmpty()) {
            throw new IllegalStateException("play token response has no access_token");
        }
        long seconds = LenientJson.asLong(reply.path("expires_in"), 3600);
        token = accessToken;
        tokenExpires = now.plusSeconds(Math.max(0, seconds - 60));
        return token;
    }

    boolean configured() {
        return account != null;
    }

    /** 서비스 계정 JSON 에서 토큰을 받는 데 필요한 것만. */
    record ServiceAccount(String clientEmail, String keyId, PrivateKey privateKey, String tokenUri) {

        static ServiceAccount read(String key) {
            if (key == null || key.isBlank()) {
                return null;
            }
            try {
                String text = key.strip();
                if (!text.startsWith("{")) {
                    text = new String(Base64.getMimeDecoder().decode(text), StandardCharsets.UTF_8);
                }
                JsonNode json = JSON.readTree(text);
                String email = LenientJson.asText(json.path("client_email"), "");
                String pem = LenientJson.asText(json.path("private_key"), "");
                if (email.isEmpty() || pem.isEmpty()) {
                    return null;
                }
                String der = pem.replace("-----BEGIN PRIVATE KEY-----", "")
                        .replace("-----END PRIVATE KEY-----", "")
                        .replaceAll("\\s", "");
                PrivateKey privateKey = KeyFactory.getInstance("RSA")
                        .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(der)));
                String tokenUri = LenientJson.asText(json.path("token_uri"), DEFAULT_TOKEN_URI);
                return new ServiceAccount(email, LenientJson.asText(json.path("private_key_id"), ""), privateKey,
                        tokenUri.isBlank() ? DEFAULT_TOKEN_URI : tokenUri);
            } catch (RuntimeException | GeneralSecurityException failure) {
                return null;
            }
        }

        String assertion(Instant now) {
            JWSHeader.Builder header = new JWSHeader.Builder(JWSAlgorithm.RS256);
            if (!keyId.isEmpty()) {
                header.keyID(keyId);
            }
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer(clientEmail)
                    .audience(tokenUri)
                    .claim("scope", SCOPE)
                    .issueTime(Date.from(now))
                    .expirationTime(Date.from(now.plus(Duration.ofHours(1))))
                    .build();
            SignedJWT jwt = new SignedJWT(header.build(), claims);
            try {
                jwt.sign(new RSASSASigner(privateKey));
            } catch (JOSEException failure) {
                throw new IllegalStateException("play assertion signing failed", failure);
            }
            return jwt.serialize();
        }

        @Override
        public String toString() {
            return "ServiceAccount[" + clientEmail + "]";
        }
    }
}
