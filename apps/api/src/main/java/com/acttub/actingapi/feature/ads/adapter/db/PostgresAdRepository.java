package com.acttub.actingapi.feature.ads.adapter.db;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.app.AdRepository;
import com.acttub.actingapi.feature.ads.domain.Ad;
import com.acttub.actingapi.feature.ads.domain.AdDraft;
import com.acttub.actingapi.feature.ads.domain.AdStats;
import com.acttub.actingapi.feature.ads.schema.AdEntity;
import jakarta.persistence.EntityManager;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 광고의 Postgres 구현 — {@code ads}·{@code ad_events} (V66). 두 표는 JPA 로 읽고 쓴다. 첫 연습 판정은 다른 기능의 표를
 * 한 문장으로 읽어 native 로 남았다({@link #practiced}).
 */
@Repository
class PostgresAdRepository implements AdRepository {
    private static final Limit ACTIVE_LIMIT = Limit.of(50);

    private final AdJpaRepository ads;
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresAdRepository(AdJpaRepository ads, EntityManager entityManager,
            PlatformTransactionManager transactionManager) {
        this.ads = ads;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public List<Ad> activeFor(String slotKey, Instant now) {
        return ads.activeFor(slotKey, now, ACTIVE_LIMIT).stream().map(PostgresAdRepository::ad).toList();
    }

    @Override
    public Optional<Ad> find(UUID adId) {
        return ads.find(adId).map(PostgresAdRepository::ad);
    }

    /**
     * 첫 연습 판정은 다른 기능의 표(practice 의 practices, coach 의 coach_conversations·coach_notes, reading 의
     * reading_sessions, challenge 의 challenge_entries)를 한 문장으로 읽는다. 그 기능들에 이 조회를 내주는 Port 가 없다(§5-1).
     */
    @Override
    public boolean practiced(UUID userId) {
        Object result = entityManager.createNativeQuery("""
                SELECT EXISTS (
                           SELECT 1 FROM practices p
                           JOIN coach_conversations c ON c.practice_id=p.id
                           JOIN coach_notes n ON n.conversation_id=c.id
                           WHERE p.user_id=:userId)
                    OR EXISTS (SELECT 1 FROM reading_sessions r WHERE r.user_id=:userId AND r.status='completed')
                    OR EXISTS (SELECT 1 FROM challenge_entries e WHERE e.user_id=:userId)
                """)
                .setParameter("userId", userId)
                .getSingleResult();
        return Boolean.TRUE.equals(result);
    }

    @Override
    public boolean recordImpression(UUID adId, UUID userId, String slotKey, LocalDate day, Instant now) {
        Integer inserted = transaction.execute(tx ->
                ads.insertImpression(UUID.randomUUID(), adId, userId, slotKey, day, now));
        return inserted != null && inserted > 0;
    }

    @Override
    public void recordClick(UUID adId, UUID userId, String slotKey, LocalDate day, Instant now) {
        transaction.executeWithoutResult(tx -> ads.insertClick(UUID.randomUUID(), adId, userId, slotKey, day, now));
    }

    @Override
    public List<AdStats.Stored> all() {
        return ads.all().stream().map(PostgresAdRepository::stored).toList();
    }

    @Override
    public Optional<AdStats.Stored> findStored(UUID adId) {
        return ads.findStored(adId).map(PostgresAdRepository::stored);
    }

    @Override
    public AdStats.Stored insert(AdDraft draft, Instant now) {
        UUID id = UUID.randomUUID();
        transaction.executeWithoutResult(tx -> ads.insert(id, draft.kind(), draft.status(), slots(draft),
                draft.audience(), draft.priority(), draft.advertiserName(), draft.headline(), draft.body(),
                draft.imageLargeBanner(), draft.imageBanner(), draft.imageMediumRectangle(), draft.linkUrl(),
                draft.appPath(), draft.sharePercent(), draft.startsAt(), draft.endsAt(), now));
        return findStored(id).orElseThrow();
    }

    @Override
    public Optional<AdStats.Stored> update(UUID adId, AdDraft draft, Instant now) {
        Integer changed = transaction.execute(tx -> ads.update(adId, draft.kind(), draft.status(), slots(draft),
                draft.audience(), draft.priority(), draft.advertiserName(), draft.headline(), draft.body(),
                draft.imageLargeBanner(), draft.imageBanner(), draft.imageMediumRectangle(), draft.linkUrl(),
                draft.appPath(), draft.sharePercent(), draft.startsAt(), draft.endsAt(), now));
        return changed != null && changed > 0 ? findStored(adId) : Optional.empty();
    }

    @Override
    public List<AdStats.Day> dailyEvents(UUID adId, LocalDate from, LocalDate to) {
        return ads.dailyEvents(adId, from, to).stream()
                .map(row -> new AdStats.Day(row.day(), row.impressions(), row.clicks()))
                .toList();
    }

    private static String[] slots(AdDraft draft) {
        return draft.slots().toArray(String[]::new);
    }

    private static AdStats.Stored stored(AdJpaRepository.StoredRow row) {
        AdEntity ad = row.ad();
        AdDraft draft = new AdDraft(ad.getKind(), ad.getStatus(), List.of(ad.getSlots()), ad.getAudience(),
                ad.getPriority(), ad.getAdvertiserName(), ad.getHeadline(), ad.getBody(), ad.getImageLargeBanner(),
                ad.getImageBanner(), ad.getImageMediumRectangle(), ad.getLinkUrl(), ad.getAppPath(), ad.getStartsAt(),
                ad.getEndsAt(), ad.getSharePercent());
        return new AdStats.Stored(ad.getId(), draft, ad.getCreatedAt(), ad.getUpdatedAt(), row.impressions(),
                row.clicks());
    }

    private static Ad ad(AdEntity row) {
        return new Ad(row.getId(), row.getKind(), List.of(row.getSlots()), row.getAudience(), row.getPriority(),
                row.getAdvertiserName(), row.getHeadline(), row.getBody(), row.getImageLargeBanner(),
                row.getImageBanner(), row.getImageMediumRectangle(), row.getLinkUrl(), row.getAppPath(),
                row.getSharePercent());
    }
}
