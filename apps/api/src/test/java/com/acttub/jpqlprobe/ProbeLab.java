package com.acttub.jpqlprobe;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import com.acttub.actingapi.support.PostgresContainerSupport;
import jakarta.persistence.Entity;
import jakarta.persistence.Tuple;
import org.flywaydb.core.Flyway;
import org.hibernate.Session;
import org.hibernate.SessionFactory;
import org.hibernate.Transaction;
import org.hibernate.cfg.Configuration;

/**
 * 실험 배관: Flyway 로 세운 PostgreSQL 18 DB, 실험 엔티티만 올린 Hibernate SessionFactory, 실행한 SQL 기록, 보고서 쓰기.
 *
 * <p>Spring 컨텍스트를 띄우지 않는다. 앱의 엔티티 스캔·설정과 섞이지 않고, 매핑이 없는 표도 실험 엔티티로 다룰 수 있다.
 * Hibernate 설정은 {@code application.yml} 의 영속 설정(UTC, Jackson 3 JSON) 을 따른다.
 */
final class ProbeLab {
    static final List<String> SQL = Collections.synchronizedList(new ArrayList<>());

    final String jdbcUrl;
    /** 앱과 같은 설정. */
    final SessionFactory factory;
    /** 위 설정에 Hibernate 의 tech preview JSON 함수(json_value·json_query 등)만 켠 것. 앱은 켜지 않았다. */
    final SessionFactory previewFactory;
    /** PESSIMISTIC_WRITE 가 FOR UPDATE 를 내도록 방언을 바꾼 것(실험용 {@link ForUpdateDialect}). */
    final SessionFactory forUpdateFactory;
    private final Map<String, Probe> probes = new LinkedHashMap<>();

    ProbeLab(String prefix) {
        String database = PostgresContainerSupport.createDatabaseName(prefix);
        jdbcUrl = PostgresContainerSupport.jdbcUrlFor(database);
        Flyway.configure()
                .dataSource(jdbcUrl, PostgresContainerSupport.POSTGRES.getUsername(),
                        PostgresContainerSupport.POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();
        factory = build(Map.of());
        previewFactory = build(Map.of("hibernate.query.hql.json_functions_enabled", "true"));
        forUpdateFactory = build(Map.of("hibernate.dialect", ForUpdateDialect.class.getName()));
    }

    /** Hibernate 의 PostgreSQLDialect 는 PESSIMISTIC_WRITE 를 FOR NO KEY UPDATE 로 낸다. 원본과 같은 FOR UPDATE 를 내게 바꾼 방언. */
    public static class ForUpdateDialect extends org.hibernate.dialect.PostgreSQLDialect {
        public ForUpdateDialect() {
            super();
        }

        @Override
        public String getForUpdateString() {
            return " for update";
        }
    }

    private SessionFactory build(Map<String, String> extra) {
        Configuration configuration = new Configuration();
        for (Class<?> type : ProbeEntities.class.getDeclaredClasses()) {
            if (type.isAnnotationPresent(Entity.class)) {
                configuration.addAnnotatedClass(type);
            }
        }
        configuration.setProperty("jakarta.persistence.jdbc.url", jdbcUrl);
        configuration.setProperty("jakarta.persistence.jdbc.user", PostgresContainerSupport.POSTGRES.getUsername());
        configuration.setProperty("jakarta.persistence.jdbc.password",
                PostgresContainerSupport.POSTGRES.getPassword());
        configuration.setProperty("hibernate.jdbc.time_zone", "UTC");
        configuration.setProperty("hibernate.type.json_format_mapper", "jackson3");
        configuration.setProperty("hibernate.connection.pool_size", "8");
        configuration.setStatementInspector(sql -> {
            SQL.add(sql);
            return sql;
        });
        extra.forEach(configuration::setProperty);
        return configuration.buildSessionFactory();
    }

    /** FK 트리거를 끄고(복제 역할) 시드 SQL 을 넣는다. CHECK·NOT NULL 은 그대로 걸린다. */
    void seed(String... statements) {
        try (Connection connection = DriverManager.getConnection(jdbcUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
                Statement statement = connection.createStatement()) {
            statement.execute("SET session_replication_role = replica");
            for (String sql : statements) {
                statement.execute(sql);
            }
        } catch (SQLException exc) {
            throw new IllegalStateException(exc);
        }
    }

    Probe probe(String id, String shape, String source, String nativeSql) {
        return probes.computeIfAbsent(id, key -> new Probe(id, shape, source, nativeSql.strip()));
    }

    /** 한 트랜잭션 안에서 body 를 돌리고 되돌린다. 된 경우 만든 SQL, 안 된 경우 오류 문구를 남긴다. */
    Attempt attempt(Probe probe, String label, String hql, Function<Session, Object> body) {
        return attempt(probe, label, hql, body, false);
    }

    Attempt attempt(Probe probe, String label, String hql, Function<Session, Object> body, boolean jsonPreview) {
        return attempt(probe, jsonPreview ? label + " [json_functions_enabled=true]" : label, hql, body,
                jsonPreview ? previewFactory : factory);
    }

    Attempt attempt(Probe probe, String label, String hql, Function<Session, Object> body, SessionFactory chosen) {
        SQL.clear();
        Attempt attempt;
        try (Session session = chosen.openSession()) {
            Transaction transaction = session.beginTransaction();
            try {
                Object observed = body.apply(session);
                session.flush();
                attempt = new Attempt(label, hql, true, List.copyOf(SQL), null, render(observed));
            } catch (RuntimeException exc) {
                attempt = new Attempt(label, hql, false, List.copyOf(SQL), describe(exc), null);
            } finally {
                if (transaction.isActive()) {
                    transaction.rollback();
                }
            }
        }
        probe.attempts.add(attempt);
        return attempt;
    }

    /** 원본 네이티브 SQL 을 그대로 돌려 결과를 본다(같은 데이터에서 HQL 결과와 견주려고). */
    List<List<Object>> nativeRows(String sql, Map<String, Object> parameters) {
        try (Session session = factory.openSession()) {
            Transaction transaction = session.beginTransaction();
            try {
                var query = session.createNativeQuery(sql, Tuple.class);
                parameters.forEach(query::setParameter);
                return rows(query.getResultList());
            } finally {
                transaction.rollback();
            }
        }
    }

    static List<List<Object>> rows(List<Tuple> tuples) {
        List<List<Object>> out = new ArrayList<>();
        for (Tuple tuple : tuples) {
            List<Object> row = new ArrayList<>();
            for (int index = 0; index < tuple.getElements().size(); index++) {
                row.add(normalize(tuple.get(index)));
            }
            out.add(row);
        }
        return out;
    }

    static Object normalize(Object value) {
        if (value instanceof Number number && !(value instanceof Double) && !(value instanceof Float)) {
            return number.longValue();
        }
        if (value instanceof Object[] array) {
            return java.util.Arrays.toString(array);
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toInstant();
        }
        if (value instanceof java.time.OffsetDateTime time) {
            return time.toInstant();
        }
        if (value instanceof java.sql.Date date) {
            return date.toLocalDate();
        }
        return value == null ? null : value instanceof String || value instanceof Boolean
                || value instanceof java.util.UUID || value instanceof java.time.temporal.Temporal ? value : value.toString();
    }

    static String render(Object observed) {
        if (observed == null) {
            return "(값 없음)";
        }
        String text = String.valueOf(observed);
        return text.length() > 600 ? text.substring(0, 600) + " …" : text;
    }

    static String describe(Throwable exc) {
        StringBuilder out = new StringBuilder();
        Throwable current = exc;
        int depth = 0;
        while (current != null && depth < 4) {
            String message = String.valueOf(current.getMessage()).strip();
            int newline = message.indexOf('\n');
            if (newline > 0 && newline < 400) {
                message = message.substring(0, newline);
            }
            if (message.length() > 400) {
                message = message.substring(0, 400) + " …";
            }
            if (out.length() > 0) {
                out.append(" ← ");
            }
            out.append(current.getClass().getSimpleName()).append(": ").append(message);
            if (current.getCause() == current) {
                break;
            }
            current = current.getCause();
            depth++;
        }
        return out.toString();
    }

    void note(Probe probe, String text) {
        probe.notes.add(text);
    }

    void write(Path path, String title, String preface) throws IOException {
        StringBuilder out = new StringBuilder("# ").append(title).append("\n\n").append(preface).append("\n\n");
        out.append("| 실험 | 모양 | 원본 | 결과 |\n|---|---|---|---|\n");
        for (Probe probe : probes.values()) {
            out.append("| ").append(probe.id).append(" | ").append(probe.shape).append(" | `").append(probe.source)
                    .append("` | ");
            List<String> parts = new ArrayList<>();
            for (Attempt attempt : probe.attempts) {
                parts.add(attempt.label + ": " + (attempt.works ? "된다" : "안 된다"));
            }
            out.append(String.join("<br>", parts).replace("|", "\\|")).append(" |\n");
        }
        for (Probe probe : probes.values()) {
            out.append("\n## ").append(probe.id).append(" ").append(probe.shape).append("\n\n");
            out.append("원본 `").append(probe.source).append("`\n\n```sql\n").append(probe.nativeSql).append("\n```\n");
            for (Attempt attempt : probe.attempts) {
                out.append("\n### ").append(attempt.label).append(" — ").append(attempt.works ? "된다" : "안 된다")
                        .append("\n\n");
                if (attempt.hql != null && !attempt.hql.isBlank()) {
                    out.append("```\n").append(attempt.hql.strip()).append("\n```\n\n");
                }
                if (!attempt.sql.isEmpty()) {
                    out.append("Hibernate 가 보낸 SQL:\n\n```sql\n");
                    for (String sql : attempt.sql) {
                        out.append(sql.strip()).append(";\n");
                    }
                    out.append("```\n\n");
                }
                if (attempt.works) {
                    out.append("관찰: `").append(attempt.observed.replace("`", "'")).append("`\n");
                } else {
                    out.append("오류: `").append(attempt.error.replace("`", "'")).append("`\n");
                }
            }
            for (String note : probe.notes) {
                out.append("\n- ").append(note).append("\n");
            }
        }
        Files.createDirectories(path.getParent());
        Files.writeString(path, out.toString());
    }

    static final class Probe {
        final String id;
        final String shape;
        final String source;
        final String nativeSql;
        final List<Attempt> attempts = new ArrayList<>();
        final List<String> notes = new ArrayList<>();

        Probe(String id, String shape, String source, String nativeSql) {
            this.id = id;
            this.shape = shape;
            this.source = source;
            this.nativeSql = nativeSql;
        }
    }

    record Attempt(String label, String hql, boolean works, List<String> sql, String error, String observed) {
        /** Hibernate 가 보낸 SQL 에 행 잠금 절이 있는가. */
        boolean locked() {
            return sql.stream().anyMatch(text -> text.contains(" for update") || text.contains(" for no key update")
                    || text.contains(" for share") || text.contains(" for key share"));
        }
    }
}
