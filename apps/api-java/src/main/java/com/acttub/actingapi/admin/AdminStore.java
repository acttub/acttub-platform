package com.acttub.actingapi.admin;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.admin.AdminDtos.AdminStats;
import com.acttub.actingapi.admin.AdminDtos.AdminTurn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class AdminStore {
    private final JdbcTemplate jdbc;
    private final Clock clock;

    AdminStore(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    AdminStats stats(List<String> excludeEmails) {
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        OffsetDateTime since7d = now.minusDays(7);
        OffsetDateTime since24h = now.minusHours(24);
        List<UUID> excludedUsers = excludedUserIds(excludeEmails);

        Window users = windowed("users", "created_at", "", "id", excludedUsers, since7d, since24h);
        Window practices = windowed(
                "practice_sessions", "created_at", "", "user_id", excludedUsers, since7d, since24h);
        Window coachSessions = windowed(
                "coach_sessions",
                "created_at",
                "",
                "practice_session_id NOT IN (SELECT id FROM practice_sessions WHERE user_id IN (%s))",
                excludedUsers,
                since7d,
                since24h);
        Window coachTurns = windowed(
                "coach_turns",
                "created_at",
                "",
                "session_id NOT IN (SELECT coach.id FROM coach_sessions AS coach "
                        + "JOIN practice_sessions AS practice ON practice.id=coach.practice_session_id "
                        + "WHERE practice.user_id IN (%s))",
                excludedUsers,
                since7d,
                since24h);

        Pair uploads = pair(
                "upload_intents",
                "status='finalized'::upload_status_t",
                "user_id",
                excludedUsers);
        Pair analyses = pair(
                "practice_sessions",
                "status='analyzed'::practice_status_t",
                "user_id",
                excludedUsers);
        Pair reports = pair(
                "practice_reports",
                "",
                "practice_session_id NOT IN (SELECT id FROM practice_sessions WHERE user_id IN (%s))",
                excludedUsers);
        Pair active7d = distinctPracticeUsers(since7d, excludedUsers);
        Returning returning = returning(excludedUsers);

        return new AdminStats(
                users.total(), users.totalReal(), users.last7d(), users.last7dReal(),
                users.last24h(), users.last24hReal(),
                practices.total(), practices.totalReal(), practices.last7d(), practices.last7dReal(),
                practices.last24h(), practices.last24hReal(),
                uploads.all(), uploads.real(), analyses.all(), analyses.real(),
                coachSessions.total(), coachSessions.totalReal(),
                coachSessions.last7d(), coachSessions.last7dReal(),
                coachSessions.last24h(), coachSessions.last24hReal(),
                coachTurns.total(), coachTurns.totalReal(),
                coachTurns.last7d(), coachTurns.last7dReal(),
                coachTurns.last24h(), coachTurns.last24hReal(),
                reports.all(), reports.real(), active7d.all(), active7d.real(),
                returning.withSession(), returning.withSessionReal(),
                returning.twice(), returning.twiceReal(),
                returning.thrice(), returning.thriceReal(),
                maximum("users", "created_at"),
                maximum("practice_sessions", "created_at"));
    }

    List<SessionRow> sessions(int limit, List<String> excludeEmails) {
        StringBuilder sql = new StringBuilder("""
                SELECT
                    coach.id,
                    coach.created_at,
                    coach.status::text AS status,
                    coach.close_reason::text AS close_reason,
                    practice.situation,
                    practice.character_context,
                    practice.goal,
                    upload.object_key
                FROM coach_sessions AS coach
                LEFT JOIN practice_sessions AS practice
                  ON practice.id = coach.practice_session_id
                LEFT JOIN upload_intents AS upload
                  ON upload.id = practice.upload_intent_id
                 AND upload.status = 'finalized'::upload_status_t
                """);
        List<Object> arguments = new ArrayList<>();
        if (!excludeEmails.isEmpty()) {
            sql.append("""
                    LEFT JOIN users AS app_user
                      ON app_user.id = practice.user_id
                    WHERE app_user.email IS NULL
                       OR lower(app_user.email) NOT IN (
                    """);
            sql.append(placeholders(excludeEmails.size())).append(")\n");
            excludeEmails.stream().map(String::toLowerCase).forEach(arguments::add);
        }
        sql.append("ORDER BY coach.created_at DESC LIMIT ?");
        arguments.add(limit);

        List<SessionBaseRow> rows = jdbc.query(sql.toString(), (result, rowNumber) ->
                new SessionBaseRow(
                        result.getObject("id", UUID.class),
                        result.getObject("created_at", OffsetDateTime.class),
                        result.getString("status"),
                        result.getString("close_reason"),
                        result.getString("situation"),
                        result.getString("character_context"),
                        result.getString("goal"),
                        result.getString("object_key")), arguments.toArray());
        // Python도 세션마다 turns를 한 번씩 조회한다. 이번 이관에서는 그 N+1을 그대로 둔다.
        return rows.stream()
                .map(row -> new SessionRow(
                        row.coachSessionId(),
                        row.createdAt(),
                        row.status(),
                        row.closeReason(),
                        row.situation(),
                        row.characterContext(),
                        row.goal(),
                        turns(row.coachSessionId()),
                        row.objectKey()))
                .toList();
    }

    private List<AdminTurn> turns(UUID coachSessionId) {
        return jdbc.query("""
                SELECT turn_index, role::text AS role, text
                FROM coach_turns
                WHERE session_id = ?
                ORDER BY turn_index
                """, (result, rowNumber) -> new AdminTurn(
                result.getInt("turn_index"),
                result.getString("role"),
                result.getString("text") == null ? "" : result.getString("text")), coachSessionId);
    }

    private List<UUID> excludedUserIds(List<String> excludeEmails) {
        if (excludeEmails.isEmpty()) {
            return List.of();
        }
        String sql = "SELECT id FROM users WHERE lower(email) IN ("
                + placeholders(excludeEmails.size()) + ")";
        Object[] arguments = excludeEmails.stream().map(String::toLowerCase).toArray();
        return jdbc.query(sql, (result, rowNumber) -> result.getObject("id", UUID.class), arguments);
    }

    private Window windowed(
            String table,
            String timeColumn,
            String baseWhere,
            String exclusion,
            List<UUID> excludedUsers,
            OffsetDateTime since7d,
            OffsetDateTime since24h) {
        Pair total = pair(table, baseWhere, exclusion, excludedUsers);
        Pair last7d = pair(
                table, and(baseWhere, timeColumn + ">=?"), exclusion, excludedUsers, since7d);
        Pair last24h = pair(
                table, and(baseWhere, timeColumn + ">=?"), exclusion, excludedUsers, since24h);
        return new Window(
                total.all(), total.real(), last7d.all(), last7d.real(),
                last24h.all(), last24h.real());
    }

    private Pair pair(
            String table,
            String baseWhere,
            String exclusion,
            List<UUID> excludedUsers,
            Object... baseArguments) {
        long all = count(table, baseWhere, List.of(baseArguments));
        if (excludedUsers.isEmpty()) {
            return new Pair(all, all);
        }
        String renderedExclusion = exclusion.contains("%s")
                ? exclusion.formatted(placeholders(excludedUsers.size()))
                : exclusion + " NOT IN (" + placeholders(excludedUsers.size()) + ")";
        List<Object> realArguments = new ArrayList<>(List.of(baseArguments));
        realArguments.addAll(excludedUsers);
        long real = count(table, and(baseWhere, renderedExclusion), realArguments);
        return new Pair(all, real);
    }

    private long count(String table, String where, List<Object> arguments) {
        String sql = "SELECT count(*) FROM " + table + (where.isBlank() ? "" : " WHERE " + where);
        Long value = jdbc.queryForObject(sql, Long.class, arguments.toArray());
        return value == null ? 0L : value;
    }

    private Pair distinctPracticeUsers(OffsetDateTime since, List<UUID> excludedUsers) {
        Long all = jdbc.queryForObject("""
                SELECT count(DISTINCT user_id)
                FROM practice_sessions
                WHERE created_at >= ?
                """, Long.class, since);
        if (excludedUsers.isEmpty()) {
            return new Pair(value(all), value(all));
        }
        List<Object> arguments = new ArrayList<>();
        arguments.add(since);
        arguments.addAll(excludedUsers);
        Long real = jdbc.queryForObject("SELECT count(DISTINCT user_id) FROM practice_sessions "
                + "WHERE created_at >= ? AND user_id NOT IN ("
                + placeholders(excludedUsers.size()) + ")", Long.class, arguments.toArray());
        return new Pair(value(all), value(real));
    }

    private Returning returning(List<UUID> excludedUsers) {
        long[] all = returningCounts(List.of());
        long[] real = excludedUsers.isEmpty() ? all : returningCounts(excludedUsers);
        return new Returning(all[0], real[0], all[1], real[1], all[2], real[2]);
    }

    private long[] returningCounts(List<UUID> excludedUsers) {
        String where = excludedUsers.isEmpty()
                ? ""
                : " WHERE user_id NOT IN (" + placeholders(excludedUsers.size()) + ")";
        List<Long> values = jdbc.query("""
                SELECT
                    count(*) AS with_session,
                    count(*) FILTER (WHERE session_count >= 2) AS twice,
                    count(*) FILTER (WHERE session_count >= 3) AS thrice
                FROM (
                    SELECT user_id, count(*) AS session_count
                    FROM practice_sessions
                """ + where + " GROUP BY user_id) AS grouped", result -> {
            if (!result.next()) {
                return List.of(0L, 0L, 0L);
            }
            return List.of(
                    result.getLong("with_session"),
                    result.getLong("twice"),
                    result.getLong("thrice"));
        }, excludedUsers.toArray());
        return new long[] {values.get(0), values.get(1), values.get(2)};
    }

    private OffsetDateTime maximum(String table, String column) {
        return jdbc.queryForObject(
                "SELECT max(" + column + ") FROM " + table,
                OffsetDateTime.class);
    }

    private static String and(String left, String right) {
        return left.isBlank() ? right : left + " AND " + right;
    }

    private static String placeholders(int count) {
        return String.join(",", java.util.Collections.nCopies(count, "?"));
    }

    private static long value(Long value) {
        return value == null ? 0L : value;
    }

    record SessionRow(
            UUID coachSessionId,
            OffsetDateTime createdAt,
            String status,
            String closeReason,
            String situation,
            String characterContext,
            String goal,
            List<AdminTurn> turns,
            String objectKey) {
    }

    private record SessionBaseRow(
            UUID coachSessionId,
            OffsetDateTime createdAt,
            String status,
            String closeReason,
            String situation,
            String characterContext,
            String goal,
            String objectKey) {
    }

    private record Pair(long all, long real) {
    }

    private record Window(
            long total,
            long totalReal,
            long last7d,
            long last7dReal,
            long last24h,
            long last24hReal) {
    }

    private record Returning(
            long withSession,
            long withSessionReal,
            long twice,
            long twiceReal,
            long thrice,
            long thriceReal) {
    }
}
