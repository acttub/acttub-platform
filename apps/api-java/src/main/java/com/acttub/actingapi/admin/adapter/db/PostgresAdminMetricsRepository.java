package com.acttub.actingapi.admin.adapter.db;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.admin.app.AdminMetrics.AdminCloseReasonCount;
import com.acttub.actingapi.admin.app.AdminMetrics.AdminSignupSourceCount;
import com.acttub.actingapi.admin.app.AdminMetrics.AdminFunnelStep;
import com.acttub.actingapi.admin.app.AdminMetrics.AdminStats;
import com.acttub.actingapi.admin.app.AdminMetrics.AdminTurn;
import com.acttub.actingapi.admin.app.AdminMetricsRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 지표를 손으로 쓴 SQL 로 집계한다. 파이썬 {@code db/store.py} 의 질의를 그대로 옮긴 것이라
 * <b>세는 방식이 곧 계약</b>이고, 여기서 한 줄을 고치면 운영 지표가 조용히 달라진다.
 *
 * <p>사람이 읽는 말로 옮기는 자리(마감 사유가 없는 세션을 "진행 중"·"사유 없음"으로 가르는
 * 것, 유입 출처가 빈 계정을 "(직접/미상)" 한 버킷으로 묶는 것)도 여기 있다. SQL 이 낸
 * {@code null} 을 해석하는 일이고, 그 해석이 집계·정렬과 같은 문장 안에서 나야 합계가 맞는다.
 */
@Repository
class PostgresAdminMetricsRepository implements AdminMetricsRepository {
    private final JdbcTemplate jdbc;
    private final Clock clock;

    PostgresAdminMetricsRepository(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Override
    public AdminStats stats(List<String> excludeEmails) {
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
        Pair active7d = distinctUsers(
                "practice_sessions", "user_id", "created_at>=?", "user_id",
                excludedUsers, since7d);
        Returning returning = returning(excludedUsers);

        OffsetDateTime yesterdayStart = now.atZoneSameInstant(ZoneId.of("Asia/Seoul"))
                .toLocalDate().minusDays(1).atStartOfDay(ZoneId.of("Asia/Seoul"))
                .toOffsetDateTime();
        OffsetDateTime yesterdayEnd = yesterdayStart.plusDays(1);
        Pair usersYesterday = pair(
                "users", "created_at>=? AND created_at<?", "id", excludedUsers,
                yesterdayStart, yesterdayEnd);
        Pair activeYesterday = distinctUsers(
                "practice_sessions", "user_id", "created_at>=? AND created_at<?", "user_id",
                excludedUsers, yesterdayStart, yesterdayEnd);

        Pair uploadedUsers = distinctUsers(
                "upload_intents", "user_id", "status='finalized'::upload_status_t", "user_id",
                excludedUsers);
        Pair analyzedUsers = distinctUsers(
                "practice_sessions", "user_id", "status='analyzed'::practice_status_t", "user_id",
                excludedUsers);
        String coachJoin = "coach_sessions coach JOIN practice_sessions practice "
                + "ON practice.id=coach.practice_session_id";
        Pair coachedUsers = distinctUsers(
                coachJoin, "practice.user_id", "", "practice.user_id", excludedUsers);
        Pair closedUsers = distinctUsers(
                coachJoin, "practice.user_id", "coach.status='closed'::session_status_t",
                "practice.user_id", excludedUsers);
        Pair gapUsers = distinctUsers(
                coachJoin, "practice.user_id",
                "coach.close_reason='gap_stated'::close_reason_t", "practice.user_id",
                excludedUsers);
        List<AdminFunnelStep> funnelSteps = List.of(
                new AdminFunnelStep("가입", users.total(), users.totalReal()),
                new AdminFunnelStep("업로드 확정", uploadedUsers.all(), uploadedUsers.real()),
                new AdminFunnelStep(
                        "연습 세션", returning.withSession(), returning.withSessionReal()),
                new AdminFunnelStep("분석 완료", analyzedUsers.all(), analyzedUsers.real()),
                new AdminFunnelStep("코치 대화", coachedUsers.all(), coachedUsers.real()),
                new AdminFunnelStep("대화 마무리", closedUsers.all(), closedUsers.real()),
                new AdminFunnelStep("놓친 생각 말함", gapUsers.all(), gapUsers.real()));

        List<AdminCloseReasonCount> closeReasons = closeReasonCounts(excludedUsers);
        String gapWhere = "close_reason='gap_stated'::close_reason_t "
                + "AND status='closed'::session_status_t";
        String coachExclusion = "practice_session_id NOT IN "
                + "(SELECT id FROM practice_sessions WHERE user_id IN (%s))";
        Pair gapAll = pair("coach_sessions", gapWhere, coachExclusion, excludedUsers);
        Pair gap7d = pair(
                "coach_sessions", and(gapWhere, "created_at>=?"), coachExclusion,
                excludedUsers, since7d);
        Pair gap24h = pair(
                "coach_sessions", and(gapWhere, "created_at>=?"), coachExclusion,
                excludedUsers, since24h);

        long observationsTotal = count("anomalies", "", List.of());
        long summariesTotal = count("summaries", "", List.of());
        double observationsPerSummary = BigDecimal.valueOf(
                        (double) observationsTotal / Math.max(1L, summariesTotal))
                .setScale(1, RoundingMode.HALF_EVEN)
                .doubleValue();
        String dbSize;
        try {
            dbSize = jdbc.queryForObject(
                    "SELECT pg_size_pretty(pg_database_size(current_database()))", String.class);
        } catch (RuntimeException exception) {
            dbSize = null;
        }

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
                usersYesterday.all(), usersYesterday.real(),
                activeYesterday.all(), activeYesterday.real(),
                funnelSteps, signupSourceCounts(excludedUsers), closeReasons,
                gap24h.all(), gap24h.real(), gap7d.all(), gap7d.real(),
                gapAll.all(), gapAll.real(), dbSize,
                observationsTotal, observationsPerSummary,
                maximum("users", "created_at"),
                maximum("practice_sessions", "created_at"));
    }

    @Override
    public List<SessionRow> sessions(int limit, List<String> excludeEmails) {
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

    private Pair distinctUsers(
            String from,
            String userColumn,
            String baseWhere,
            String exclusion,
            List<UUID> excludedUsers,
            Object... baseArguments) {
        String prefix = "SELECT count(DISTINCT " + userColumn + ") FROM " + from;
        Long all = jdbc.queryForObject(
                prefix + (baseWhere.isBlank() ? "" : " WHERE " + baseWhere),
                Long.class, baseArguments);
        if (excludedUsers.isEmpty()) {
            return new Pair(value(all), value(all));
        }
        List<Object> arguments = new ArrayList<>(List.of(baseArguments));
        arguments.addAll(excludedUsers);
        String realWhere = and(baseWhere,
                exclusion + " NOT IN (" + placeholders(excludedUsers.size()) + ")");
        Long real = jdbc.queryForObject(
                prefix + " WHERE " + realWhere, Long.class, arguments.toArray());
        return new Pair(value(all), value(real));
    }

    /**
     * 가입 first-touch UTM source. 과거 계정과 direct 유입은 한 버킷으로 묶어
     * 전체 가입 수와 합계가 언제나 맞게 한다 ({@code store.py:source_counts}).
     */
    private List<AdminSignupSourceCount> signupSourceCounts(List<UUID> excludedUsers) {
        Map<String, Long> all = sourceCountsByLabel(List.of());
        Map<String, Long> real = excludedUsers.isEmpty()
                ? all : sourceCountsByLabel(excludedUsers);
        // 원본 정렬: users 내림차순, 같으면 source 오름차순. users_real 은 없으면 0.
        return all.entrySet().stream()
                .sorted(Comparator.comparingLong((Map.Entry<String, Long> entry) -> entry.getValue())
                        .reversed()
                        .thenComparing(Map.Entry::getKey))
                .map(entry -> new AdminSignupSourceCount(
                        entry.getKey(), entry.getValue(), real.getOrDefault(entry.getKey(), 0L)))
                .toList();
    }

    private Map<String, Long> sourceCountsByLabel(List<UUID> excludedUsers) {
        StringBuilder sql = new StringBuilder(
                "SELECT coalesce(nullif(signup_utm_source,''),'(직접/미상)') AS source, "
                        + "count(*) AS users FROM users ");
        List<Object> arguments = new ArrayList<>();
        if (!excludedUsers.isEmpty()) {
            sql.append("WHERE id NOT IN (")
                    .append(placeholders(excludedUsers.size()))
                    .append(") ");
            arguments.addAll(excludedUsers);
        }
        sql.append("GROUP BY source");
        Map<String, Long> counts = new LinkedHashMap<>();
        jdbc.query(sql.toString(), rs -> {
            counts.put(rs.getString("source"), rs.getLong("users"));
        }, arguments.toArray());
        return counts;
    }

    private List<AdminCloseReasonCount> closeReasonCounts(List<UUID> excludedUsers) {
        Map<String, Long> all = closeReasonCounts(false, excludedUsers);
        Map<String, Long> real = excludedUsers.isEmpty()
                ? all : closeReasonCounts(true, excludedUsers);
        LinkedHashSet<String> labels = new LinkedHashSet<>(all.keySet());
        labels.addAll(real.keySet());
        return labels.stream()
                .map(label -> new AdminCloseReasonCount(
                        label, all.getOrDefault(label, 0L), real.getOrDefault(label, 0L)))
                .sorted(Comparator.comparingLong(AdminCloseReasonCount::count).reversed())
                .toList();
    }

    private Map<String, Long> closeReasonCounts(
            boolean excludeTeam,
            List<UUID> excludedUsers) {
        StringBuilder sql = new StringBuilder("""
                SELECT coach.close_reason::text AS close_reason,
                       coach.status::text AS status,
                       count(*) AS count
                FROM coach_sessions coach
                """);
        List<Object> arguments = new ArrayList<>();
        if (excludeTeam) {
            sql.append("JOIN practice_sessions practice ON practice.id=coach.practice_session_id ")
                    .append("WHERE practice.user_id NOT IN (")
                    .append(placeholders(excludedUsers.size()))
                    .append(") ");
            arguments.addAll(excludedUsers);
        }
        sql.append("GROUP BY coach.close_reason,coach.status");
        Map<String, Long> counts = new LinkedHashMap<>();
        jdbc.query(sql.toString(), result -> {
            String reason = result.getString("close_reason");
            String label = reason != null
                    ? reason
                    : "open".equals(result.getString("status")) ? "진행 중" : "사유 없음";
            counts.merge(label, result.getLong("count"), Long::sum);
        }, arguments.toArray());
        return counts;
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
