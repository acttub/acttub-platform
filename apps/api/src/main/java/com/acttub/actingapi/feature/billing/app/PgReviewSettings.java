package com.acttub.actingapi.feature.billing.app;

import java.net.URI;
import java.util.regex.Pattern;

/**
 * PG 심사 전용 테스트 결제의 설정(SOMA-620). 값이 하나라도 틀리면 {@link #invalidReason()} 이 이유를 돌려주고
 * 기능은 닫힌 채로 남는다(fail-closed). 토스 <b>테스트 API 개별 연동 키</b>({@code test_ck_}·{@code test_sk_})만
 * 받으며 라이브 키는 어떤 경우에도 받지 않는다.
 *
 * <p>{@link #toString()} 은 비밀 값을 싣지 않는다.
 */
public record PgReviewSettings(
        String origin,
        String username,
        String passwordSha256,
        String clientKey,
        String secretKey) {

    public static final String CLIENT_KEY_PREFIX = "test_ck_";
    public static final String SECRET_KEY_PREFIX = "test_sk_";
    private static final Pattern SHA256_HEX = Pattern.compile("[0-9a-fA-F]{64}");
    private static final Pattern KEY_BODY = Pattern.compile("[A-Za-z0-9_\\-]{8,200}");

    public PgReviewSettings {
        origin = strip(origin);
        username = strip(username);
        passwordSha256 = strip(passwordSha256);
        clientKey = strip(clientKey);
        secretKey = strip(secretKey);
    }

    private static String strip(String value) {
        return value == null ? "" : value.strip();
    }

    /** 닫혀야 하는 이유(비밀 값 없는 짧은 코드). 켤 수 있으면 {@code null}. */
    public String invalidReason() {
        if (!validOrigin(origin)) {
            return "origin_invalid";
        }
        if (username.isEmpty() || username.length() > 64) {
            return "username_invalid";
        }
        if (!SHA256_HEX.matcher(passwordSha256).matches()) {
            return "password_hash_invalid";
        }
        if (!isTestClientKey(clientKey)) {
            return "client_key_not_test";
        }
        if (!isTestSecretKey(secretKey)) {
            return "secret_key_not_test";
        }
        return null;
    }

    public boolean usable() {
        return invalidReason() == null;
    }

    public boolean secureCookie() {
        return origin.startsWith("https://");
    }

    public static boolean isTestClientKey(String key) {
        return key != null
                && key.startsWith(CLIENT_KEY_PREFIX)
                && KEY_BODY.matcher(key.substring(CLIENT_KEY_PREFIX.length())).matches();
    }

    public static boolean isTestSecretKey(String key) {
        return key != null
                && key.startsWith(SECRET_KEY_PREFIX)
                && KEY_BODY.matcher(key.substring(SECRET_KEY_PREFIX.length())).matches();
    }

    /** https 의 도메인만. 개발 편의로 루프백 http 만 더 받는다. 경로·쿼리·사용자 정보는 없다. */
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

    @Override
    public String toString() {
        return "PgReviewSettings[origin=" + origin + ", username=" + username + ", secrets=redacted]";
    }
}
