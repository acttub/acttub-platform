package com.acttub.actingapi.platform.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.net.URLDecoder;

/**
 * 배포 환경변수 {@code DATABASE_URL} 을 JDBC 3종(url / username / password)으로 쪼갠다.
 *
 * <p>현행 값은 {@code postgresql://user:pass@host:5432/db} 형태다
 * ({@code deploy/bootstrap-dev.sh}, {@code docs/deploy/DEPLOY-VPC.md}). Python 은 SQLAlchemy 가
 * 이 URI 를 그대로 받지만 Hikari 는 {@code jdbc:postgresql://…} 를 요구한다.
 * 환경변수 이름을 바꾸면 dev·운영 양쪽 api.env 를 동시에 손봐야 하므로 이름은 유지하고
 * 여기서 변환만 한다 (apps/api/CONTRACT.md §5-6).
 */
public record DatabaseUrl(String jdbcUrl, String username, String password) {

    private static final int DEFAULT_PORT = 5432;

    public static DatabaseUrl parse(String databaseUrl) {
        String raw = databaseUrl == null ? "" : databaseUrl.strip();
        if (raw.isEmpty()) {
            throw new IllegalArgumentException("DATABASE_URL is required");
        }
        // 이미 JDBC 형식이면 자격증명 분리 없이 그대로 쓴다(로컬 편의).
        if (raw.startsWith("jdbc:")) {
            return new DatabaseUrl(raw, null, null);
        }
        if (!raw.startsWith("postgresql://") && !raw.startsWith("postgres://")) {
            throw new IllegalArgumentException(
                    "DATABASE_URL must start with postgresql:// or postgres:// (got: "
                            + scheme(raw) + ")");
        }

        URI uri;
        try {
            uri = new URI(raw);
        } catch (URISyntaxException exc) {
            throw new IllegalArgumentException("DATABASE_URL is not a valid URI", exc);
        }

        String host = uri.getHost();
        if (host == null) {
            throw new IllegalArgumentException("DATABASE_URL has no host");
        }
        int port = uri.getPort() == -1 ? DEFAULT_PORT : uri.getPort();

        String path = uri.getPath() == null ? "" : uri.getPath();
        String database = path.startsWith("/") ? path.substring(1) : path;
        if (database.isEmpty()) {
            throw new IllegalArgumentException("DATABASE_URL has no database name");
        }

        String username = null;
        String password = null;
        String userInfo = uri.getRawUserInfo();
        if (userInfo != null && !userInfo.isEmpty()) {
            int sep = userInfo.indexOf(':');
            if (sep < 0) {
                username = decode(userInfo);
            } else {
                username = decode(userInfo.substring(0, sep));
                password = decode(userInfo.substring(sep + 1));
            }
        }

        StringBuilder jdbc = new StringBuilder("jdbc:postgresql://")
                .append(host).append(':').append(port).append('/').append(database);
        String query = uri.getRawQuery();
        if (query != null && !query.isEmpty()) {
            jdbc.append('?').append(query);
        }
        return new DatabaseUrl(jdbc.toString(), username, password);
    }

    /**
     * URI user-info 의 퍼센트 인코딩만 푼다.
     *
     * <p>{@code URLDecoder} 는 form encoding 규칙이라 {@code +} 를 공백으로 바꾼다. user-info 에서
     * {@code +} 는 유효한 리터럴이므로, 비밀번호에 {@code +} 가 들어 있으면 그대로 쓰면 인증이 깨진다.
     * 미리 {@code %2B} 로 escape 해 리터럴을 보존한다.
     */
    private static String decode(String value) {
        return URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8);
    }

    private static String scheme(String raw) {
        int idx = raw.indexOf("://");
        return idx < 0 ? "<none>" : raw.substring(0, idx);
    }
}
