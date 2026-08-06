package com.acttub.actingapi.support;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * 스키마를 정렬된 텍스트 줄로 뽑는다. alembic 이 만든 스키마와 Flyway V1 이 만든 스키마를 비교한다.
 *
 * <p>기대값 fixture {@code alembic-schema-fingerprint.txt} 는
 * {@code apps/api/acting-api} 의 {@code alembic upgrade head} 결과에서 같은 SQL 로 떠 왔다.
 * 재생성 방법은 M0-findings.md 에 적었다.
 */
public final class SchemaFingerprint {

    private SchemaFingerprint() {
    }

    public static List<String> of(Connection connection) {
        List<String> lines = new ArrayList<>();
        try (Statement statement = connection.createStatement();
                ResultSet rs = statement.executeQuery(query())) {
            while (rs.next()) {
                lines.add(rs.getString(1));
            }
        } catch (SQLException exc) {
            throw new IllegalStateException("failed to read schema fingerprint", exc);
        }
        return lines;
    }

    public static String query() {
        try (InputStream in = SchemaFingerprint.class.getResourceAsStream("/schema-fingerprint.sql")) {
            if (in == null) {
                throw new IllegalStateException("schema-fingerprint.sql not on the classpath");
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException exc) {
            throw new IllegalStateException("failed to read schema-fingerprint.sql", exc);
        }
    }

    public static List<String> expectedFromAlembic() {
        try (InputStream in = SchemaFingerprint.class
                .getResourceAsStream("/alembic-schema-fingerprint.txt")) {
            if (in == null) {
                throw new IllegalStateException("alembic-schema-fingerprint.txt not on the classpath");
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).lines().toList();
        } catch (IOException exc) {
            throw new IllegalStateException("failed to read the alembic fingerprint fixture", exc);
        }
    }
}
