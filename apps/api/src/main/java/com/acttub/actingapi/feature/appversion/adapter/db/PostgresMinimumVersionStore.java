package com.acttub.actingapi.feature.appversion.adapter.db;

import com.acttub.actingapi.feature.appversion.app.MinimumVersionStore;
import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.MinimumVersionState;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.EnumMap;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 플랫폼별 자동 최소 판의 Postgres 구현 — {@code app_min_versions}(V95). */
@Repository
@ConditionalOnProperty(name = "MIN_VERSION_AUTO_RAISE", havingValue = "true")
class PostgresMinimumVersionStore implements MinimumVersionStore {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresMinimumVersionStore(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Map<StorePlatform, MinimumVersionState> load() {
        Map<StorePlatform, MinimumVersionState> states = new EnumMap<>(StorePlatform.class);
        var rows = entityManager.createNativeQuery(
                        "SELECT platform,minimum,store_version,store_live_since FROM app_min_versions", Tuple.class)
                .getResultList();
        for (Object row : rows) {
            Tuple tuple = (Tuple) row;
            StorePlatform.fromKey((String) tuple.get(0)).ifPresent(platform -> states.put(platform,
                    new MinimumVersionState(platform, version(tuple.get(1)), version(tuple.get(2)), instant(tuple.get(3)))));
        }
        return states;
    }

    @Override
    public void observe(StorePlatform platform, AppVersion storeVersion, Instant now) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                        INSERT INTO app_min_versions(platform,store_version,store_live_since,updated_at)
                        VALUES (:platform,:version,:now,:now)
                        ON CONFLICT (platform) DO UPDATE SET store_version=EXCLUDED.store_version,
                            store_live_since=EXCLUDED.store_live_since,updated_at=EXCLUDED.updated_at
                        WHERE app_min_versions.store_version IS DISTINCT FROM EXCLUDED.store_version
                           OR app_min_versions.store_live_since IS NULL
                        """)
                .setParameter("platform", platform.key())
                .setParameter("version", storeVersion.toString())
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate());
    }

    @Override
    public boolean raise(StorePlatform platform, AppVersion from, AppVersion to, Instant now) {
        Integer changed = transaction.execute(status -> entityManager.createNativeQuery("""
                        UPDATE app_min_versions SET minimum=:to,raised_at=:now,updated_at=:now
                        WHERE platform=:platform AND minimum IS NOT DISTINCT FROM CAST(:from AS text)
                        """)
                .setParameter("platform", platform.key())
                .setParameter("from", from == null ? null : from.toString())
                .setParameter("to", to.toString())
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate());
        return changed != null && changed == 1;
    }

    private static AppVersion version(Object value) {
        return value instanceof String text ? AppVersion.parse(text).orElse(null) : null;
    }

    private static Instant instant(Object value) {
        if (value instanceof Instant instant) {
            return instant;
        }
        if (value instanceof OffsetDateTime offset) {
            return offset.toInstant();
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant();
        }
        return null;
    }
}
