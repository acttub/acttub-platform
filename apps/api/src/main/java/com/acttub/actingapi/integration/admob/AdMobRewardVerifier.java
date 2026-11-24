package com.acttub.actingapi.integration.admob;

import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;

import com.acttub.actingapi.platform.http.RestClients;
import com.acttub.actingapi.platform.json.LenientJson;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * AdMob 보상형 광고의 서버 측 확인(SSV) 서명 검사(SOMA-1067).
 *
 * <p>AdMob 은 콜백 주소에 쿼리를 붙여 GET 으로 부르고, 마지막 두 칸이 {@code signature} 와 {@code key_id} 다. 서명한 내용은
 * <b>받은 그대로의(URL 인코딩된) 쿼리 문자열에서 {@code &signature=} 앞까지</b>이고, 서명은 ECDSA(SHA-256)의 DER 값을 web-safe
 * base64 로 적은 것이다. 공개키는 Google 이 {@value #KEYS_URL} 에 {@code {"keys":[{"keyId":…,"pem":…,"base64":…}]}} 로 낸다.
 *
 * <p>키는 받은 뒤 {@link #KEY_TTL} 동안 기억한다. 모르는 {@code key_id} 가 오면(키 교체) 다시 받되 {@link #REFETCH_GAP} 에 한 번까지만
 * 받는다 — 공개 경로라 아무나 모르는 id 를 보낼 수 있다. 다시 받기가 실패하면 갖고 있던 키로 검사한다.
 */
@Component
public class AdMobRewardVerifier {
    static final String KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
    static final Duration KEY_TTL = Duration.ofHours(24);
    static final Duration REFETCH_GAP = Duration.ofMinutes(1);
    private static final String SIGNATURE_MARK = "&signature=";
    private static final int MAX_QUERY_LENGTH = 4096;

    private final Supplier<String> keySource;
    private final Clock clock;
    private final ObjectMapper mapper = new ObjectMapper();
    private Map<Long, PublicKey> keys = Map.of();
    private Instant fetchedAt;
    private Instant triedAt;

    @Autowired
    public AdMobRewardVerifier(Clock clock) {
        this(httpKeySource(), clock);
    }

    /** @param keySource 공개키 JSON 본문을 돌려준다. 못 받으면 {@link AdMobKeysUnavailable} 을 던진다. */
    public AdMobRewardVerifier(Supplier<String> keySource, Clock clock) {
        this.keySource = keySource;
        this.clock = clock;
    }

    /**
     * 받은 쿼리 문자열({@code HttpServletRequest#getQueryString}, 디코딩 전)의 서명이 맞는가.
     *
     * @throws AdMobKeysUnavailable 공개키를 한 번도 받지 못했다 — AdMob 이 다시 보내게 5xx 로 답한다
     */
    public boolean verify(String rawQuery) {
        if (rawQuery == null || rawQuery.length() > MAX_QUERY_LENGTH) {
            return false;
        }
        int mark = rawQuery.indexOf(SIGNATURE_MARK);
        if (mark <= 0) {
            return false;
        }
        String content = rawQuery.substring(0, mark);
        Map<String, String> tail = params(rawQuery.substring(mark + 1));
        String signature = tail.get("signature");
        Long keyId = parseLong(tail.get("key_id"));
        if (signature == null || signature.isEmpty() || keyId == null) {
            return false;
        }
        byte[] der;
        try {
            der = Base64.getUrlDecoder().decode(signature.replace('+', '-').replace('/', '_'));
        } catch (IllegalArgumentException malformed) {
            return false;
        }
        PublicKey key = key(keyId);
        if (key == null) {
            return false;
        }
        try {
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(key);
            verifier.update(content.getBytes(StandardCharsets.UTF_8));
            return verifier.verify(der);
        } catch (GeneralSecurityException invalid) {
            return false;
        }
    }

    /** URL 디코딩한 쿼리 값들. 같은 이름이 둘이면 처음 것. */
    public static Map<String, String> params(String rawQuery) {
        Map<String, String> values = new HashMap<>();
        if (rawQuery == null) {
            return values;
        }
        for (String pair : rawQuery.split("&")) {
            int eq = pair.indexOf('=');
            String name = eq < 0 ? pair : pair.substring(0, eq);
            String value = eq < 0 ? "" : pair.substring(eq + 1);
            try {
                values.putIfAbsent(URLDecoder.decode(name, StandardCharsets.UTF_8), URLDecoder.decode(value, StandardCharsets.UTF_8));
            } catch (IllegalArgumentException malformed) {
                // 깨진 % 인코딩은 그 칸만 버린다.
            }
        }
        return values;
    }

    private synchronized PublicKey key(long keyId) {
        Instant now = clock.instant();
        boolean stale = fetchedAt == null || !now.isBefore(fetchedAt.plus(KEY_TTL));
        boolean unknown = !keys.containsKey(keyId);
        boolean mayTry = triedAt == null || !now.isBefore(triedAt.plus(REFETCH_GAP));
        if ((stale || unknown) && mayTry) {
            triedAt = now;
            try {
                keys = parseKeys(keySource.get());
                fetchedAt = now;
            } catch (AdMobKeysUnavailable failure) {
                if (keys.isEmpty()) {
                    throw failure;
                }
                // 갖고 있던 키로 검사한다.
            }
        } else if (keys.isEmpty()) {
            throw new AdMobKeysUnavailable("admob verifier keys not loaded yet");
        }
        return keys.get(keyId);
    }

    Map<Long, PublicKey> parseKeys(String body) {
        Map<Long, PublicKey> parsed = new HashMap<>();
        try {
            JsonNode list = mapper.readTree(body == null ? "" : body).path("keys");
            KeyFactory factory = KeyFactory.getInstance("EC");
            for (JsonNode entry : list) {
                Long id = parseLong(LenientJson.asText(entry.path("keyId"), ""));
                String base64 = LenientJson.asText(entry.path("base64"), "");
                if (id == null || base64.isEmpty()) {
                    continue;
                }
                try {
                    parsed.put(id, factory.generatePublic(new X509EncodedKeySpec(Base64.getMimeDecoder().decode(base64))));
                } catch (GeneralSecurityException | IllegalArgumentException skipped) {
                    // 읽을 수 없는 키 하나는 건너뛴다.
                }
            }
        } catch (JacksonException | GeneralSecurityException failure) {
            throw new AdMobKeysUnavailable("admob verifier keys unreadable");
        }
        if (parsed.isEmpty()) {
            throw new AdMobKeysUnavailable("admob verifier keys empty");
        }
        return Map.copyOf(parsed);
    }

    private static Long parseLong(String value) {
        if (value == null || value.isEmpty() || value.length() > 20) {
            return null;
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException invalid) {
            return null;
        }
    }

    private static Supplier<String> httpKeySource() {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(5))
                .build());
        factory.setReadTimeout(Duration.ofSeconds(10));
        RestClient http = RestClients.builder().requestFactory(factory).build();
        return () -> {
            try {
                String body = http.get().uri(KEYS_URL).retrieve().body(String.class);
                if (body == null) {
                    throw new AdMobKeysUnavailable("admob verifier keys empty response");
                }
                return body;
            } catch (RestClientException failure) {
                throw new AdMobKeysUnavailable("admob verifier keys fetch failed");
            }
        };
    }

    /** 공개키를 받지 못했다. */
    public static class AdMobKeysUnavailable extends RuntimeException {
        public AdMobKeysUnavailable(String message) {
            super(message);
        }
    }
}
