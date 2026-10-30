package com.acttub.actingapi.feature.ads.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.app.AdFrequency;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 광고 빈도 상한의 Postgres 구현 — {@code ad_settings}(한 줄)·{@code ad_serves}(V78). */
@Repository
class PostgresAdFrequency implements AdFrequency {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresAdFrequency(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Limits limits() {
        var rows = entityManager.createNativeQuery(
                "SELECT window_minutes,window_cap,first_day_cap FROM ad_settings WHERE id=1", Tuple.class)
                .getResultList();
        if (rows.isEmpty()) {
            return new Limits(10, 5, 3);
        }
        Tuple row = (Tuple) rows.get(0);
        return new Limits(((Number) row.get(0)).intValue(), ((Number) row.get(1)).intValue(),
                ((Number) row.get(2)).intValue());
    }

    @Override
    public Limits update(Limits limits, Instant now) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                INSERT INTO ad_settings(id,window_minutes,window_cap,first_day_cap,updated_at)
                VALUES (1,:minutes,:cap,:firstDay,:now)
                ON CONFLICT (id) DO UPDATE SET window_minutes=:minutes,window_cap=:cap,first_day_cap=:firstDay,updated_at=:now
                """)
                .setParameter("minutes", limits.windowMinutes())
                .setParameter("cap", limits.windowCap())
                .setParameter("firstDay", limits.firstDayCap())
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate());
        return limits();
    }

    @Override
    public int servedSince(UUID userId, Instant since) {
        Object count = entityManager.createNativeQuery(
                "SELECT count(*) FROM ad_serves WHERE user_id=:userId AND served_at > :since")
                .setParameter("userId", userId)
                .setParameter("since", since.atOffset(ZoneOffset.UTC))
                .getSingleResult();
        return ((Number) count).intValue();
    }

    @Override
    public Optional<Instant> signedUpAt(UUID userId) {
        var rows = entityManager.createNativeQuery("SELECT created_at FROM users WHERE id=:userId")
                .setParameter("userId", userId)
                .getResultList();
        if (rows.isEmpty() || rows.get(0) == null) {
            return Optional.empty();
        }
        Object value = rows.get(0);
        if (value instanceof java.time.OffsetDateTime offset) {
            return Optional.of(offset.toInstant());
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return Optional.of(timestamp.toInstant());
        }
        if (value instanceof Instant instant) {
            return Optional.of(instant);
        }
        throw new IllegalStateException("unexpected timestamp type " + value.getClass());
    }

    @Override
    public void recordServe(UUID userId, Instant at) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery(
                "INSERT INTO ad_serves(id,user_id,served_at) VALUES (:id,:userId,:at)")
                .setParameter("id", UUID.randomUUID())
                .setParameter("userId", userId)
                .setParameter("at", at.atOffset(ZoneOffset.UTC))
                .executeUpdate());
    }

    @Override
    public int purgeBefore(Instant before) {
        Integer deleted = transaction.execute(status -> entityManager.createNativeQuery(
                "DELETE FROM ad_serves WHERE served_at < :before")
                .setParameter("before", before.atOffset(ZoneOffset.UTC))
                .executeUpdate());
        return deleted == null ? 0 : deleted;
    }
}
