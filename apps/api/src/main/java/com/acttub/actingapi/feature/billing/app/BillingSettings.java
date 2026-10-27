package com.acttub.actingapi.feature.billing.app;

import java.net.URI;
import java.time.Instant;

/**
 * ACTTUB Pro 결제의 설정(SOMA-818). 스위치가 둘이다.
 *
 * <ul>
 *   <li>{@code BILLING_WEB_ENABLED}(기본 false) — 웹 토스 정기결제(카드 등록·첫 결제·자동결제 스케줄러). 값이 하나라도 틀리면
 *       {@link #invalidReason()} 이 이유를 돌려주고 닫힌다. 토스 키는 테스트·라이브 둘 다 받되 두 키의 종류가 같아야 한다.
 *       이 플래그가 꺼져 있으면 결제는 단 한 건도 나가지 않는다.</li>
 *   <li>{@code BILLING_APP_ENABLED}(기본 false) — 앱이 Pro 화면·구독 상태를 보게 하는 스위치. 스토어 결제(2단계)가 이 뒤에 붙는다.
 *       토스를 열지는 않는다.</li>
 * </ul>
 *
 * <p>무료 한도 강제({@code BILLING_FREE_LIMITS_ENABLED}, 기본 false)는 둘 중 하나가 열려 있을 때만 의미가 있다.
 * {@link #toString()} 은 비밀 값을 싣지 않는다.
 *
 * @param legacySignupBefore 덮어쓰기용(선택, null 이면 약관 v2 ko 발행 시각). 이 시각 전에 가입한 회원(users.created_at)은 기존 회원이다
 * @param legacyLimitsFrom 기존 회원에게 무료 한도가 걸리기 시작하는 시각. 그 전까지는 한도가 없다(Pro 판정·목소리·광고는 그대로)
 * @param origin 토스가 브라우저를 되돌려 보낼 이 API 의 공개 주소(https 도메인, 개발용 루프백 http)
 * @param returnUrl 카드 등록이 끝나면 웹으로 돌아갈 주소(https, 개발용 루프백 http)
 */
public record BillingSettings(
        boolean enabled,
        boolean appEnabled,
        boolean freeLimitsEnabled,
        String origin,
        String returnUrl,
        String clientKey,
        String secretKey,
        Instant legacySignupBefore,
        Instant legacyLimitsFrom) {

    /** 기존 회원에게도 무료 한도가 걸리기 시작하는 시각(2026-12-01 00:00 KST). */
    public static final Instant DEFAULT_LEGACY_LIMITS_FROM = Instant.parse("2026-11-30T15:00:00Z");

    public BillingSettings(boolean enabled, boolean appEnabled, boolean freeLimitsEnabled, String origin,
            String returnUrl, String clientKey, String secretKey) {
        this(enabled, appEnabled, freeLimitsEnabled, origin, returnUrl, clientKey, secretKey,
                null, DEFAULT_LEGACY_LIMITS_FROM);
    }

    public BillingSettings {
        legacyLimitsFrom = legacyLimitsFrom == null ? DEFAULT_LEGACY_LIMITS_FROM : legacyLimitsFrom;
        origin = strip(origin);
        returnUrl = strip(returnUrl);
        clientKey = strip(clientKey);
        secretKey = strip(secretKey);
    }

    public static BillingSettings disabled() {
        return new BillingSettings(false, false, false, "", "", "", "");
    }

    private static String strip(String value) {
        return value == null ? "" : value.strip();
    }

    /** 웹 토스 결제가 닫혀야 하는 이유(비밀 값 없는 짧은 코드). 열 수 있으면 {@code null}. */
    public String invalidReason() {
        if (!enabled) {
            return "disabled";
        }
        if (!validWebUrl(origin, false)) {
            return "origin_invalid";
        }
        if (!validWebUrl(returnUrl, true)) {
            return "return_url_invalid";
        }
        boolean testClient = PgReviewSettings.isTestClientKey(clientKey);
        boolean liveClient = clientKey.matches("live_ck_[A-Za-z0-9_-]{8,}");
        boolean testSecret = PgReviewSettings.isTestSecretKey(secretKey);
        boolean liveSecret = secretKey.matches("live_sk_[A-Za-z0-9_-]{8,}");
        if (!testClient && !liveClient) {
            return "client_key_invalid";
        }
        if (!testSecret && !liveSecret) {
            return "secret_key_invalid";
        }
        if (testClient != testSecret) {
            return "key_mode_mismatch";
        }
        return null;
    }

    /** 웹 토스 결제를 열 수 있는가 — 카드 등록·첫 결제·자동결제는 이것이 true 일 때만 한다. */
    public boolean webUsable() {
        return invalidReason() == null;
    }

    /** 구독 상태를 보여 주고 Pro 를 판정하는가 — 웹 결제가 열렸거나 앱 스위치가 켜졌을 때. */
    public boolean usable() {
        return webUsable() || appEnabled;
    }

    /** 무료 한도를 실제로 거는가 — 결제 기능이 열려 있고 한도 플래그도 켜져 있어야 한다. */
    public boolean limitsEnforced() {
        return freeLimitsEnabled && usable();
    }

    private static boolean validWebUrl(String value, boolean pathAllowed) {
        try {
            URI uri = new URI(value);
            if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null
                    || uri.getFragment() != null) {
                return false;
            }
            if (!pathAllowed && uri.getPath() != null && !uri.getPath().isEmpty()) {
                return false;
            }
            boolean loopback = "localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost());
            return "https".equals(uri.getScheme()) || ("http".equals(uri.getScheme()) && loopback);
        } catch (Exception notUri) {
            return false;
        }
    }

    @Override
    public String toString() {
        return "BillingSettings[web=" + enabled + ", app=" + appEnabled + ", freeLimitsEnabled=" + freeLimitsEnabled
                + ", origin=" + origin + ", returnUrl=" + returnUrl + ", secrets=redacted]";
    }
}
