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
 * 스키마를 정렬된 텍스트 줄로 뽑는다. Flyway 마이그레이션이 만든 스키마를 기대값과 비교한다.
 *
 * <p>기대값 fixture {@code baseline-schema-fingerprint.txt} 는 <b>Flyway 가 빈 DB 에 V1 이후
 * 전부를 적용한 결과</b>다. 재생성은 손이 아니라 {@code apps/api/scripts/regen-fingerprint.sh}
 * 가 한다.
 *
 * <p>🔁 <b>정본이 옮겨졌다({@code SOMA-403} 3단계).</b> 이 fixture 는 원래 alembic 결과의
 * 스냅샷이었고, 그래서 {@code V1__baseline.sql} 과 <b>둘이 같이 낡으면 초록이 뜨는</b> 자기참조가
 * 있었다. 지금은 Flyway 가 스키마 정본이라 "V1 이 만드는 것" 이 곧 기대값이고, V1 은 동결이다
 * ({@code FlywayBaselineTest.baselineIsFrozen} 이 checksum 을 못박는다). 자기참조가 아니라
 * 회귀 검사다.
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

    /** 커밋된 기대값 — Flyway 마이그레이션 전체를 빈 DB 에 적용한 결과. */
    public static List<String> expected() {
        try (InputStream in = SchemaFingerprint.class
                .getResourceAsStream("/baseline-schema-fingerprint.txt")) {
            if (in == null) {
                throw new IllegalStateException("baseline-schema-fingerprint.txt not on the classpath");
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).lines().toList();
        } catch (IOException exc) {
            throw new IllegalStateException("failed to read the schema fingerprint fixture", exc);
        }
    }
}
