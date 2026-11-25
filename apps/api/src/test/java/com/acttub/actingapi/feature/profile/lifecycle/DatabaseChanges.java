package com.acttub.actingapi.feature.profile.lifecycle;

import java.sql.Array;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.UnaryOperator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * DB 전체를 두 번 읽어 그 사이에 달라진 것을 글로 적는다. 계정 수명 일이 「무엇을 지우고, 무엇을 남기고, 어느 칸을 비우는가」를
 * 기준 파일과 견주려고 쓴다.
 *
 * <p>표마다 적는 것: 행 수(앞 → 뒤), 사람을 가리키는 칸마다 그 사람을 가리키는 행 수(앞 → 뒤), 그리고 달라진 행이다.
 * 달라진 행은 지워짐({@code -}), 생김({@code +}), 고쳐짐({@code ~})으로 적고, 고쳐진 행은 달라진 칸만 적는다. 사람의
 * 자료가 든 표는 아무것도 달라지지 않아도 행 수를 적는다. 남겨야 하는 표가 그대로인지가 거기서 보인다.
 *
 * <p>실행마다 달라지는 값은 이름으로 바꿔 적는다. 심은 id 는 심을 때의 이름으로, 테스트 시계에서 잰 시각은 {@code <now+PT5M>}
 * 처럼, DB 의 {@code now()} 는 {@code <DB 시각>} 으로, 암호문은 {@code decrypt} 가 푼 값으로 적는다.
 */
final class DatabaseChanges {

    private static final Pattern UUID_TEXT =
            Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final Duration DATABASE_NOW_WINDOW = Duration.ofMinutes(10);

    /** 사람을 가리키는 칸 하나. */
    record UserColumn(String table, String column) { }

    /** 표 → (기본 키 → 행). */
    record Snapshot(Map<String, Map<String, Map<String, Object>>> tables) { }

    private final JdbcTemplate jdbc;
    private final Map<String, List<String>> primaryKeys = new TreeMap<>();

    DatabaseChanges(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        jdbc.query("""
                SELECT c.relname AS table_name,
                       (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                        FROM pg_constraint p
                        CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY AS k(attnum, ord)
                        JOIN pg_attribute a ON a.attrelid = p.conrelid AND a.attnum = k.attnum
                        WHERE p.conrelid = c.oid AND p.contype = 'p') AS key_columns
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname <> 'flyway_schema_history'
                """, row -> {
            String keyColumns = row.getString("key_columns");
            if (keyColumns == null) {
                throw new IllegalStateException("기본 키가 없는 표는 행을 짝지을 수 없다: " + row.getString("table_name"));
            }
            primaryKeys.put(row.getString("table_name"), List.of(keyColumns.split(",")));
        });
    }

    Snapshot read() {
        Map<String, Map<String, Map<String, Object>>> tables = new TreeMap<>();
        primaryKeys.forEach((table, keyColumns) -> {
            Map<String, Map<String, Object>> rows = new LinkedHashMap<>();
            for (Map<String, Object> raw : jdbc.queryForList("SELECT * FROM " + table)) {
                Map<String, Object> row = new TreeMap<>();
                raw.forEach((column, value) -> row.put(column, plain(value)));
                rows.put(keyColumns.stream().map(column -> String.valueOf(row.get(column))).collect(Collectors.joining("|")), row);
            }
            tables.put(table, rows);
        });
        return new Snapshot(tables);
    }

    /**
     * @param names 심은 id → 이름
     * @param texts 실행마다 같지만 읽기 어려운 글자 → 이름
     * @param people 「가리키는 행 수」를 셀 사람들(이름 → id)
     * @param userColumns 사람을 가리키는 칸
     * @param scope 달라지지 않아도 행 수를 적을 표. 그 밖의 표는 달라졌을 때만 적는다
     * @param now 테스트 시계의 지금
     * @param decrypt 암호문({@code _encrypted} 로 끝나는 칸)을 푸는 법
     */
    List<String> describe(
            Snapshot before,
            Snapshot after,
            Map<UUID, String> names,
            Map<String, String> texts,
            Map<String, UUID> people,
            List<UserColumn> userColumns,
            List<String> scope,
            Instant now,
            UnaryOperator<String> decrypt) {
        Renderer renderer = new Renderer(names, texts, now, Instant.now(), decrypt);
        List<String> lines = new ArrayList<>();
        for (String table : primaryKeys.keySet()) {
            Map<String, Map<String, Object>> old = before.tables().get(table);
            Map<String, Map<String, Object>> current = after.tables().get(table);
            if (old.equals(current) && (old.isEmpty() || !scope.contains(table))) {
                continue;
            }
            lines.add(table + ": " + old.size() + "행 → " + current.size() + "행");
            for (UserColumn reference : userColumns) {
                if (!reference.table().equals(table)) {
                    continue;
                }
                people.forEach((person, id) -> {
                    long was = pointing(old, reference.column(), id);
                    long is = pointing(current, reference.column(), id);
                    if (was != 0 || is != 0) {
                        lines.add("  " + reference.column() + "=" + person + ": " + was + " → " + is);
                    }
                });
            }
            List<String> changes = new ArrayList<>();
            old.forEach((key, row) -> {
                Map<String, Object> updated = current.get(key);
                String label = renderer.key(primaryKeys.get(table), row);
                if (updated == null) {
                    changes.add("  - " + label);
                    return;
                }
                List<String> columns = new ArrayList<>();
                row.forEach((column, value) -> {
                    if (!Objects.equals(value, updated.get(column))) {
                        columns.add("      " + column + ": " + renderer.value(column, value) + " → " + renderer.value(column, updated.get(column)));
                    }
                });
                if (!columns.isEmpty()) {
                    changes.add("  ~ " + label + "\n" + String.join("\n", columns));
                }
            });
            current.forEach((key, row) -> {
                if (!old.containsKey(key)) {
                    changes.add("  + " + row.entrySet().stream()
                            .filter(entry -> entry.getValue() != null)
                            .map(entry -> entry.getKey() + "=" + renderer.value(entry.getKey(), entry.getValue()))
                            .collect(Collectors.joining(", ")));
                }
            });
            changes.stream().sorted().forEach(change -> lines.addAll(Arrays.asList(change.split("\n"))));
        }
        return lines;
    }

    private static long pointing(Map<String, Map<String, Object>> rows, String column, UUID person) {
        return rows.values().stream().filter(row -> person.equals(row.get(column))).count();
    }

    /** JDBC 가 준 값을 견줄 수 있는 값으로 바꾼다(시각은 {@link Instant}, 배열은 목록, jsonb 는 글자). */
    private static Object plain(Object value) {
        try {
            return switch (value) {
                case null -> null;
                case Timestamp timestamp -> timestamp.toInstant();
                case OffsetDateTime time -> time.toInstant();
                case Array array -> Arrays.stream((Object[]) array.getArray()).map(DatabaseChanges::plain).toList();
                // jsonb 는 드라이버의 PGobject 로 온다. 드라이버는 실행 때만 클래스패스에 있어 이름으로 가린다.
                default -> value.getClass().getName().startsWith("org.postgresql.") ? value.toString() : value;
            };
        } catch (SQLException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private record Renderer(
            Map<UUID, String> names, Map<String, String> texts, Instant now, Instant databaseNow, UnaryOperator<String> decrypt) {

        String key(List<String> keyColumns, Map<String, Object> row) {
            return keyColumns.stream().map(column -> value(column, row.get(column))).collect(Collectors.joining(", "));
        }

        String value(String column, Object value) {
            return switch (value) {
                case null -> "NULL";
                case UUID id -> name(id);
                case Instant time -> time(time);
                case List<?> list -> list.stream().map(item -> value(column, item)).collect(Collectors.joining(", ", "[", "]"));
                case String text when column.endsWith("_encrypted") -> "<암호문: " + text(decrypt.apply(text)) + ">";
                case String text -> "'" + text(text) + "'";
                default -> value.toString();
            };
        }

        private String name(UUID id) {
            String name = names.get(id);
            return name == null ? "<새 id>" : "<" + name + ">";
        }

        private String time(Instant time) {
            if (Duration.between(time, databaseNow).abs().compareTo(DATABASE_NOW_WINDOW) < 0) {
                return "<DB 시각>";
            }
            Duration fromNow = Duration.between(now, time);
            return fromNow.isZero() ? "<now>" : "<now" + (fromNow.isNegative() ? "-" + fromNow.negated() : "+" + fromNow) + ">";
        }

        /** 글자 안의 id 도 이름으로 바꾼다(객체 키 목록·사유 글에 id 가 들어간다). 객체 키 목록은 순서를 맞춘다. */
        private String text(String text) {
            String known = texts.get(text);
            if (known != null) {
                return known;
            }
            String ordered = text;
            if (text.startsWith("[\"") && text.endsWith("\"]")) {
                ordered = Arrays.stream(text.substring(1, text.length() - 1).split(",")).sorted().collect(Collectors.joining(",", "[", "]"));
            }
            Matcher matcher = UUID_TEXT.matcher(ordered);
            return matcher.replaceAll(match -> Matcher.quoteReplacement(name(UUID.fromString(match.group()))));
        }
    }
}
