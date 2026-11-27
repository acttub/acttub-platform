package com.acttub.actingapi.feature.ads.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.app.AdFrequency;
import com.acttub.actingapi.feature.auth.app.AccountFacts;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 광고 빈도 상한의 Postgres 구현 — {@code ad_settings}(한 줄)·{@code ad_serves}(V78). */
@Repository
class PostgresAdFrequency implements AdFrequency {
    private final AdFrequencyJpaRepository frequency;
    private final TransactionTemplate transaction;

    private final AccountFacts accounts;

    PostgresAdFrequency(AdFrequencyJpaRepository frequency, PlatformTransactionManager transactionManager,
            AccountFacts accounts) {
        this.accounts = accounts;
        this.frequency = frequency;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Limits limits() {
        return frequency.settings()
                .map(row -> new Limits(row.getWindowMinutes(), row.getWindowCap(), row.getFirstDayCap()))
                .orElseGet(() -> new Limits(10, 5, 3));
    }

    @Override
    public Limits update(Limits limits, Instant now) {
        transaction.executeWithoutResult(status -> frequency.upsertSettings(limits.windowMinutes(), limits.windowCap(),
                limits.firstDayCap(), now));
        return limits();
    }

    @Override
    public int servedSince(UUID userId, Instant since) {
        return (int) frequency.servedSince(userId, since);
    }

    @Override
    public Optional<Instant> signedUpAt(UUID userId) {
        return accounts.signedUpAt(userId);
    }

    @Override
    public void recordServe(UUID userId, Instant at) {
        transaction.executeWithoutResult(status -> frequency.insertServe(UUID.randomUUID(), userId, at));
    }

    @Override
    public int purgeBefore(Instant before) {
        Integer deleted = transaction.execute(status -> frequency.purgeBefore(before));
        return deleted == null ? 0 : deleted;
    }
}
