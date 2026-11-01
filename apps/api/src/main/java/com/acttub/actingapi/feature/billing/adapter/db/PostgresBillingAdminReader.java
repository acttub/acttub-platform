package com.acttub.actingapi.feature.billing.adapter.db;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;

import com.acttub.actingapi.feature.billing.app.BillingAdminReader;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** ops 구독 화면 읽기 전용(SOMA-963). 이메일·user id 는 projection 에 넣지 않는다. */
@Repository
@Transactional(readOnly = true)
class PostgresBillingAdminReader implements BillingAdminReader {
    /** 팀 판정. 이메일은 소문자·앞뒤 공백 제거로 맞춘다. */
    private static final String TEAM = """
            team AS (
                SELECT id FROM users
                WHERE lower(btrim(COALESCE(email, ''))) = ANY(string_to_array(:teamEmails, ','))
                   OR left(md5(CAST(id AS text)), 8) = ANY(string_to_array(:teamActors, ','))
            )
            """;

    private final EntityManager entityManager;

    PostgresBillingAdminReader(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public List<SubscriptionRow> subscriptions(List<String> teamEmails, List<String> teamActors) {
        Query query = entityManager.createNativeQuery("WITH " + TEAM + """
                SELECT
                    left(md5(CAST(s.user_id AS text)), 8) AS actor,
                    NULLIF(btrim(profile.name), '') AS name,
                    NULLIF(btrim(u.nickname), '') AS nickname,
                    (s.user_id IN (SELECT id FROM team)) AS is_team,
                    u.created_at AS signed_up_at,
                    s.provider, s.store_product_id, s.amount, s.status,
                    s.current_period_start, s.current_period_end, s.canceled_at, s.created_at,
                    COALESCE(paid.amount, 0) AS paid_amount,
                    COALESCE(paid.n, 0) AS paid_count
                FROM billing_subscriptions AS s
                JOIN users AS u ON u.id = s.user_id
                LEFT JOIN user_profiles AS profile ON profile.user_id = s.user_id
                LEFT JOIN (
                    SELECT subscription_id, sum(amount) AS amount, count(*) AS n
                    FROM billing_payments WHERE status = 'done' GROUP BY subscription_id
                ) AS paid ON paid.subscription_id = s.id
                ORDER BY s.created_at DESC
                """, Tuple.class);
        bindTeam(query, teamEmails, teamActors);
        return NativeTuples.list(query).stream()
                .map(row -> new SubscriptionRow(
                        row.get("actor", String.class),
                        row.get("name", String.class),
                        row.get("nickname", String.class),
                        Boolean.TRUE.equals(row.get("is_team", Boolean.class)),
                        instant(row, "signed_up_at"),
                        row.get("provider", String.class),
                        row.get("store_product_id", String.class),
                        ((Number) row.get("amount")).longValue(),
                        row.get("status", String.class),
                        instant(row, "current_period_start"),
                        instant(row, "current_period_end"),
                        instant(row, "canceled_at"),
                        instant(row, "created_at"),
                        ((Number) row.get("paid_amount")).longValue(),
                        ((Number) row.get("paid_count")).intValue()))
                .toList();
    }

    @Override
    public List<GrantRow> grants(List<String> teamEmails, List<String> teamActors) {
        Query query = entityManager.createNativeQuery("WITH " + TEAM + """
                SELECT
                    left(md5(CAST(g.user_id AS text)), 8) AS actor,
                    NULLIF(btrim(profile.name), '') AS name,
                    NULLIF(btrim(u.nickname), '') AS nickname,
                    (g.user_id IN (SELECT id FROM team)) AS is_team,
                    g.reason, g.starts_at, g.ends_at
                FROM billing_pro_grants AS g
                JOIN users AS u ON u.id = g.user_id
                LEFT JOIN user_profiles AS profile ON profile.user_id = g.user_id
                ORDER BY g.ends_at DESC, g.created_at DESC
                """, Tuple.class);
        bindTeam(query, teamEmails, teamActors);
        return NativeTuples.list(query).stream()
                .map(row -> new GrantRow(
                        row.get("actor", String.class),
                        row.get("name", String.class),
                        row.get("nickname", String.class),
                        Boolean.TRUE.equals(row.get("is_team", Boolean.class)),
                        row.get("reason", String.class),
                        instant(row, "starts_at"),
                        instant(row, "ends_at")))
                .toList();
    }

    @Override
    public Headcount signedUpBefore(Instant cutoff, List<String> teamEmails, List<String> teamActors) {
        Query query = entityManager.createNativeQuery("WITH " + TEAM + """
                SELECT count(*) AS users, count(*) FILTER (WHERE u.id IN (SELECT id FROM team)) AS team
                FROM users AS u
                WHERE u.created_at < CAST(:cutoff AS timestamptz)
                  AND u.deactivated_at IS NULL
                  AND u.retention_purged_at IS NULL
                """, Tuple.class);
        bindTeam(query, teamEmails, teamActors);
        query.setParameter("cutoff", cutoff.atOffset(ZoneOffset.UTC));
        Tuple row = NativeTuples.list(query).get(0);
        return new Headcount(((Number) row.get("users")).intValue(), ((Number) row.get("team")).intValue());
    }

    private static void bindTeam(Query query, List<String> teamEmails, List<String> teamActors) {
        query.setParameter("teamEmails", String.join(",", teamEmails.stream()
                .map(email -> email.strip().toLowerCase(Locale.ROOT))
                .filter(email -> !email.isEmpty())
                .toList()));
        query.setParameter("teamActors", String.join(",", teamActors));
    }

    private static Instant instant(Tuple row, String column) {
        Object value = row.get(column);
        if (value == null) {
            return null;
        }
        if (value instanceof OffsetDateTime offset) {
            return offset.toInstant();
        }
        if (value instanceof Instant direct) {
            return direct;
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toInstant();
        }
        throw new IllegalStateException("unexpected timestamp type for " + column + ": " + value.getClass());
    }
}
