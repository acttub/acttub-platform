package com.acttub.actingapi.support;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 테스트 전체가 공유하는 Postgres 컨테이너 하나.
 *
 * <p>{@code @Container} 로 클래스마다 띄우면 M0 스위트가 컨테이너를 대여섯 번 올린다.
 * 싱글턴으로 두고 JVM 종료 시 Ryuk 이 치우게 한다.
 *
 * <p>이미지 버전은 <b>운영 RDS 와 맞춘다(18.x)</b>. M0 에서 조회한 실제 값은
 * {@code db.t4g.micro / PostgreSQL 18.4} 다.
 *
 * <p>버전을 함부로 바꾸지 않는다. 스키마 fingerprint 비교가 카탈로그 표현에 의존하는데,
 * PG18 은 NOT NULL 을 {@code pg_constraint} 에 별도 제약(contype='n')으로 물질화해서
 * 16 에서 뜬 fixture 와 텍스트가 달라진다. 스키마 자체는 같지만 fixture 는 다시 떠야 한다.
 * 재생성 방법은 M0-findings.md 에 적었다.
 */
public final class PostgresContainerSupport {

    public static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:18-alpine"));

    static {
        POSTGRES.start();
    }

    private PostgresContainerSupport() {
    }

    /** 컨테이너 안에 빈 DB 를 새로 만들고 그 <b>이름</b>을 돌려준다. */
    public static String createDatabaseName(String name) {
        createDatabase(name);
        return name;
    }

    /** 컨테이너 안에 빈 DB 를 새로 만들고 그 JDBC URL 을 돌려준다. */
    public static String createDatabase(String name) {
        try (Connection connection = java.sql.DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                Statement statement = connection.createStatement()) {
            statement.execute("DROP DATABASE IF EXISTS " + name);
            statement.execute("CREATE DATABASE " + name);
        } catch (SQLException exc) {
            throw new IllegalStateException("failed to create database " + name, exc);
        }
        return jdbcUrlFor(name);
    }

    public static String jdbcUrlFor(String database) {
        // testcontainers 가 주는 URL: jdbc:postgresql://localhost:PORT/test?loggerLevel=OFF
        return "jdbc:postgresql://" + POSTGRES.getHost() + ":" + POSTGRES.getFirstMappedPort()
                + "/" + database;
    }

    /** 실제 배포에서 쓰는 {@code postgresql://user:pass@host:port/db} 형태 (/SPEC.md §5-6). */
    public static String deployStyleUrl(String database) {
        return "postgresql://" + POSTGRES.getUsername() + ":" + POSTGRES.getPassword()
                + "@" + POSTGRES.getHost() + ":" + POSTGRES.getFirstMappedPort() + "/" + database;
    }
}
