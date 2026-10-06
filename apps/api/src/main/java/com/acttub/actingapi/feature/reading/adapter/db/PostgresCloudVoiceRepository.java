package com.acttub.actingapi.feature.reading.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.CloudVoiceRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresCloudVoiceRepository implements CloudVoiceRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresCloudVoiceRepository(EntityManager entityManager, PlatformTransactionManager manager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(manager);
    }

    @Override
    public String consent(UUID userId) {
        var rows = list(entityManager.createNativeQuery("""
                SELECT last_decision.action
                FROM (SELECT id FROM consent_documents
                      WHERE type='cloud_voice' AND locale='ko'
                      ORDER BY published_at DESC,id DESC LIMIT 1) current_document
                LEFT JOIN LATERAL (SELECT action FROM user_consents
                    WHERE user_id=:userId AND document_id=current_document.id
                    ORDER BY occurred_at DESC,id DESC LIMIT 1) last_decision ON true
                """, Tuple.class).setParameter("userId", userId));
        if (rows.isEmpty() || rows.getFirst().get("action", String.class) == null) return "undecided";
        // 계약은 granted·denied·undecided 셋이다 — 거절·철회는 모두 denied.
        return "granted".equals(rows.getFirst().get("action", String.class)) ? "granted" : "denied";
    }

    @Override
    public int dailyUsage(UUID userId, LocalDate day) {
        return ((Number) entityManager.createNativeQuery("SELECT COALESCE(SUM(lines),0) FROM reading_voice_usage WHERE user_id=:userId AND day=:day")
                .setParameter("userId", userId).setParameter("day", day).getSingleResult()).intValue();
    }

    @Override
    public int monthlyUsage(YearMonth month) {
        return ((Number) entityManager.createNativeQuery("SELECT COALESCE(SUM(lines),0) FROM reading_voice_usage WHERE day>=:start AND day<:end")
                .setParameter("start", month.atDay(1)).setParameter("end", month.plusMonths(1).atDay(1)).getSingleResult()).intValue();
    }

    @Override
    public CacheEntry findCache(String hash) {
        var rows = list(entityManager.createNativeQuery("SELECT hash FROM reading_voice_cache WHERE hash=:hash", Tuple.class)
                .setParameter("hash", hash));
        return rows.isEmpty() ? null : new CacheEntry(hash, "reading-voice/" + hash + ".wav");
    }

    @Override
    public void recordSuccess(UUID userId, LocalDate day, CacheEntry entry, String model, String voice, int byteSize, Instant now) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                WITH cached AS (
                    INSERT INTO reading_voice_cache(hash,model,voice,byte_size,created_at)
                    VALUES (:hash,:model,:voice,:byteSize,:now)
                    ON CONFLICT (hash) DO NOTHING RETURNING hash),
                used AS (
                    INSERT INTO reading_voice_usage(user_id,day,lines)
                    SELECT :userId,:day,1 FROM cached
                    ON CONFLICT (user_id,day) DO UPDATE SET lines=reading_voice_usage.lines+1
                    RETURNING lines)
                SELECT COUNT(*) FROM used
                """).setParameter("hash", entry.hash()).setParameter("model", model).setParameter("voice", voice)
                .setParameter("byteSize", byteSize).setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("userId", userId).setParameter("day", day).getSingleResult());
    }
}
