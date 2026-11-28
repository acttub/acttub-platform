package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.consent.app.ReadingConsents;
import com.acttub.actingapi.feature.reading.app.CloudVoiceRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 고품질 목소리의 Postgres 구현. 읽기와 권고 잠금은 Spring Data 저장소에 있다. 동의는 consent 의 {@link ReadingConsents} 가 답하고,
 * 저장 기록과 줄 수 차감은 두 표를 한 문장(CTE)으로 고쳐 native SQL 로 둔다(apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresCloudVoiceRepository implements CloudVoiceRepository {
    private final EntityManager entityManager;
    private final ReadingVoiceUsageJpaRepository usage;
    private final ReadingVoiceCacheJpaRepository cache;
    private final ReadingSessionJpaRepository sessions;
    private final TransactionTemplate transaction;
    private final ReadingConsents consents;

    PostgresCloudVoiceRepository(EntityManager entityManager, ReadingVoiceUsageJpaRepository usage,
            ReadingVoiceCacheJpaRepository cache, ReadingSessionJpaRepository sessions, PlatformTransactionManager manager,
            ReadingConsents consents) {
        this.consents = consents;
        this.entityManager = entityManager;
        this.usage = usage;
        this.cache = cache;
        this.sessions = sessions;
        this.transaction = new TransactionTemplate(manager);
    }

    @Override
    public String consent(UUID userId) {
        return consents.cloudVoice(userId);
    }

    @Override
    public int dailyUsage(UUID userId, LocalDate day) {
        return (int) usage.linesOn(userId, day);
    }

    @Override
    public int monthlyUsage(YearMonth month) {
        return (int) usage.linesBetween(month.atDay(1), month.plusMonths(1).atDay(1));
    }

    @Override
    public int monthlyUsage(UUID userId, YearMonth month) {
        return (int) usage.linesBetween(userId, month.atDay(1), month.plusMonths(1).atDay(1));
    }

    @Override
    public boolean firstReadingSession(UUID userId, UUID sessionId) {
        return sessions.isFirstOf(userId, sessionId);
    }

    @Override
    public boolean firstReadingScript(UUID userId, UUID scriptId) {
        return sessions.noneYetFor(userId, scriptId);
    }

    @Override
    public CacheEntry findCache(String hash) {
        return cache.find(hash).isPresent() ? new CacheEntry(hash, "reading-voice/" + hash + ".wav") : null;
    }

    @Override
    public boolean allCached(java.util.Collection<String> hashes) {
        var distinct = java.util.Set.copyOf(hashes);
        if (distinct.isEmpty()) return false;
        return cache.countIn(distinct) == distinct.size();
    }

    @Override
    public boolean recordSuccessWithinMonthlyCap(UUID userId, LocalDate day, CacheEntry entry, String model,
            String voice, int byteSize, Instant now, int cap) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            // 외부 합성·업로드는 이 트랜잭션 전에 끝났다. 같은 계정의 최종 차감만 직렬화한다.
            cache.lockUntilCommit("reading_voice_monthly:" + userId);
            if (findCache(entry.hash()) != null) return true;
            if (monthlyUsage(userId, YearMonth.from(day)) >= cap) return false;
            recordSuccess(userId, day, entry, model, voice, byteSize, now);
            return true;
        }));
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
