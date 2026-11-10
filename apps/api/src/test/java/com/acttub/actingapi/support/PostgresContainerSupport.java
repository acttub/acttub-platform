package com.acttub.actingapi.support;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.atomic.AtomicInteger;

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
 *
 * <p><b>{@code max_connections} 를 올려 둔다.</b> 설정이 다른 Spring 컨텍스트마다 DB 가 따로 뜨고
 * ({@link FreshDatabasePerContext}), 캐시된 컨텍스트들이 저마다 Hikari 풀을 <b>계속 들고
 * 있다.</b> 기본값 100 이면 M3 에서 엔드포인트 테스트가 붙는 순간
 * {@code FATAL: sorry, too many clients already} 로 <b>구현과 무관한</b> 무더기 실패가 난다.
 * 풀 상한은 {@code src/test/resources/application.properties} 가 함께 좁힌다.
 */
public final class PostgresContainerSupport {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    public static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:18-alpine"))
                    .withCommand("postgres", "-c", "max_connections=500");

    static {
        POSTGRES.start();
    }

    private PostgresContainerSupport() {
    }

    /** 컨테이너 안에 빈 DB 를 새로 만들고 그 <b>이름</b>({@code prefix} 뒤에 번호를 붙인 것)을 돌려준다. */
    public static String createDatabaseName(String prefix) {
        return createDatabaseFrom(prefix, null);
    }

    /** 컨테이너 안에 빈 DB 를 새로 만들고 그 JDBC URL 을 돌려준다. */
    public static String createDatabase(String prefix) {
        return jdbcUrlFor(createDatabaseName(prefix));
    }

    /**
     * {@code template} DB 를 복사해({@code null} 이면 빈 DB) 새 DB 를 만들고 이름을 돌려준다. 템플릿에는 연결이 없어야 한다.
     *
     * <p>이름마다 번호를 붙여 늘 처음 보는 이름으로 만든다. 있는 DB 를 {@code DROP DATABASE} 하면 Postgres 가
     * 체크포인트를 돌리는데, 스위트 중반에는 다른 DB 들의 쓰기까지 디스크로 내보내느라 한 번에 30초가 걸렸다(SOMA-1077).
     */
    public static String createDatabaseFrom(String prefix, String template) {
        String name = prefix + "_" + SEQUENCE.incrementAndGet();
        try (Connection connection = java.sql.DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE " + name + (template == null ? "" : " TEMPLATE " + template));
        } catch (SQLException exc) {
            throw new IllegalStateException("failed to create database " + name, exc);
        }
        return name;
    }

    public static String jdbcUrlFor(String database) {
        // testcontainers 가 주는 URL: jdbc:postgresql://localhost:PORT/test?loggerLevel=OFF
        return "jdbc:postgresql://" + POSTGRES.getHost() + ":" + POSTGRES.getFirstMappedPort()
                + "/" + database;
    }

    /** 실제 배포에서 쓰는 {@code postgresql://user:pass@host:port/db} 형태 (apps/api/CONTRACT.md §5-6). */
    public static String deployStyleUrl(String database) {
        return "postgresql://" + POSTGRES.getUsername() + ":" + POSTGRES.getPassword()
                + "@" + POSTGRES.getHost() + ":" + POSTGRES.getFirstMappedPort() + "/" + database;
    }
}
