package com.acttub.actingapi.feature.billing.app;

import java.net.URI;

/**
 * 앱 Pro 정기결제의 설정(SOMA-818). {@code BILLING_APP_ENABLED}(기본 false)가 켜고, 값이 하나라도 틀리면
 * {@link #invalidReason()} 이 이유를 돌려주고 기능은 닫힌다. 운영 토스 계약이 심사 중이라 지금은
 * <b>테스트 키({@code test_ck_}·{@code test_sk_})만</b> 받는다 — 운영에 켜도 라이브 키로는 열리지 않는다.
 *
 * <p>무료 한도 강제({@code BILLING_FREE_LIMITS_ENABLED}, 기본 false)는 결제 기능이 열려 있을 때만 의미가 있다.
 * {@link #toString()} 은 비밀 값을 싣지 않는다.
 *
 * @param origin 토스가 브라우저를 되돌려 보낼 이 API 의 공개 주소(https 도메인, 개발용 루프백 http)
 * @param returnUrl 결제 창이 끝나면 앱으로 돌아갈 주소(앱 스킴)
 */
public record BillingSettings(
        boolean enabled,
        boolean freeLimitsEnabled,
        String origin,
        String returnUrl,
        String clientKey,
        String secretKey) {

    public BillingSettings {
        origin = strip(origin);
        returnUrl = strip(returnUrl);
        clientKey = strip(clientKey);
        secretKey = strip(secretKey);
    }

    public static BillingSettings disabled() {
        return new BillingSettings(false, false, "", "", "", "");
    }

    private static String strip(String value) {
        return value == null ? "" : value.strip();
    }

    /** 닫혀야 하는 이유(비밀 값 없는 짧은 코드). 열 수 있으면 {@code null}. */
    public String invalidReason() {
        if (!enabled) {
            return "disabled";
        }
        if (!validOrigin(origin)) {
            return "origin_invalid";
        }
        if (!validReturnUrl(returnUrl)) {
            return "return_url_invalid";
        }
        if (!PgReviewSettings.isTestClientKey(clientKey)) {
            return "client_key_not_test";
        }
        if (!PgReviewSettings.isTestSecretKey(secretKey)) {
            return "secret_key_not_test";
        }
        return null;
    }

    public boolean usable() {
        return invalidReason() == null;
    }

    /** 무료 한도를 실제로 거는가 — 결제 기능이 열려 있고 한도 플래그도 켜져 있어야 한다. */
    public boolean limitsEnforced() {
        return freeLimitsEnabled && usable();
    }

    private static boolean validOrigin(String value) {
        try {
            URI uri = new URI(value);
            if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null
                    || uri.getFragment() != null || (uri.getPath() != null && !uri.getPath().isEmpty())) {
                return false;
            }
            boolean loopback = "localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost());
            return "https".equals(uri.getScheme()) || ("http".equals(uri.getScheme()) && loopback);
        } catch (Exception notUri) {
            return false;
        }
    }

    /** 앱 스킴 주소({@code actingapp://billing-result}). 쿼리·조각은 서버가 붙인다. */
    private static boolean validReturnUrl(String value) {
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            return scheme != null && scheme.matches("[a-z][a-z0-9+.-]{1,30}") && !"http".equals(scheme)
                    && !"https".equals(scheme) && !"javascript".equals(scheme) && uri.getQuery() == null
                    && uri.getFragment() == null;
        } catch (Exception notUri) {
            return false;
        }
    }

    @Override
    public String toString() {
        return "BillingSettings[enabled=" + enabled + ", freeLimitsEnabled=" + freeLimitsEnabled + ", origin=" + origin
                + ", returnUrl=" + returnUrl + ", secrets=redacted]";
    }
}
