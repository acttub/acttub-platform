package com.acttub.actingapi.feature.ads.adapter.db;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.app.AdRepository;
import com.acttub.actingapi.feature.ads.domain.Ad;
import com.acttub.actingapi.feature.ads.domain.AdDraft;
import com.acttub.actingapi.feature.ads.domain.AdStats;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 광고의 Postgres 구현 — {@code ads}·{@code ad_events} (V66). 첫 연습 판정은 코칭·리딩·챌린지 표를 읽기만 한다. */
@Repository
class PostgresAdRepository implements AdRepository {
    private static final String COLUMNS = """
            id,kind,array_to_string(slots,',') AS slots,audience,priority,advertiser_name,headline,body,image_large_banner,image_banner,image_medium_rectangle,link_url,app_path
            """;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresAdRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public List<Ad> activeFor(String slotKey, Instant now) {
        return NativeTuples.list(entityManager.createNativeQuery("SELECT " + COLUMNS + """
                FROM ads
                WHERE status='active' AND kind IN ('direct','house')
                  AND :slot = ANY(slots)
                  AND (starts_at IS NULL OR starts_at <= :now)
                  AND (ends_at IS NULL OR ends_at > :now)
                ORDER BY priority DESC,id
                LIMIT 50
                """, Tuple.class)
                .setParameter("slot", slotKey)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))).stream()
                .map(PostgresAdRepository::ad)
                .toList();
    }

    @Override
    public Optional<Ad> find(UUID adId) {
        return NativeTuples.list(entityManager.createNativeQuery("SELECT " + COLUMNS + " FROM ads WHERE id=:id", Tuple.class)
                .setParameter("id", adId)).stream()
                .map(PostgresAdRepository::ad)
                .findFirst();
    }

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
        Integer inserted = transaction.execute(tx -> entityManager.createNativeQuery("""
                INSERT INTO ad_events(id,ad_id,user_id,slot,event,day,created_at)
                VALUES (:id,:adId,:userId,:slot,'impression',:day,:now)
                ON CONFLICT (ad_id,user_id,day) WHERE event='impression' DO NOTHING
                """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("adId", adId)
                .setParameter("userId", userId)
                .setParameter("slot", slotKey)
                .setParameter("day", day)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate());
        return inserted != null && inserted > 0;
    }

    @Override
    public void recordClick(UUID adId, UUID userId, String slotKey, LocalDate day, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                INSERT INTO ad_events(id,ad_id,user_id,slot,event,day,created_at)
                VALUES (:id,:adId,:userId,:slot,'click',:day,:now)
                """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("adId", adId)
                .setParameter("userId", userId)
                .setParameter("slot", slotKey)
                .setParameter("day", day)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate());
    }

    private static final String STORED = """
            SELECT a.id,a.kind,a.status,array_to_string(a.slots,',') AS slots,a.audience,a.priority,a.advertiser_name,
                   a.headline,a.body,a.image_large_banner,a.image_banner,a.image_medium_rectangle,a.link_url,a.app_path,
                   a.starts_at,a.ends_at,a.created_at,a.updated_at,
                   (SELECT count(*) FROM ad_events e WHERE e.ad_id=a.id AND e.event='impression') AS impressions,
                   (SELECT count(*) FROM ad_events e WHERE e.ad_id=a.id AND e.event='click') AS clicks
            """;

    @Override
    public List<AdStats.Stored> all() {
        return NativeTuples.list(entityManager.createNativeQuery(STORED + """
                FROM ads a
                ORDER BY (a.status='active') DESC,a.priority DESC,a.created_at DESC,a.id
                """, Tuple.class)).stream().map(PostgresAdRepository::stored).toList();
    }

    @Override
    public Optional<AdStats.Stored> findStored(UUID adId) {
        return NativeTuples.list(entityManager.createNativeQuery(STORED + " FROM ads a WHERE a.id=:id", Tuple.class)
                .setParameter("id", adId)).stream().map(PostgresAdRepository::stored).findFirst();
    }

    @Override
    public AdStats.Stored insert(AdDraft draft, Instant now) {
        UUID id = UUID.randomUUID();
        transaction.executeWithoutResult(tx -> bind(entityManager.createNativeQuery("""
                INSERT INTO ads(id,kind,status,slots,audience,priority,advertiser_name,headline,body,image_large_banner,
                                image_banner,image_medium_rectangle,link_url,app_path,starts_at,ends_at,created_at,updated_at)
                VALUES (:id,:kind,:status,CAST(:slots AS text[]),:audience,:priority,CAST(:advertiserName AS text),
                        CAST(:headline AS text),CAST(:body AS text),CAST(:imageLarge AS text),CAST(:imageBanner AS text),
                        CAST(:imageMedium AS text),CAST(:linkUrl AS text),CAST(:appPath AS text),
                        CAST(:startsAt AS timestamptz),CAST(:endsAt AS timestamptz),:now,:now)
                """), draft, now).setParameter("id", id).executeUpdate());
        return findStored(id).orElseThrow();
    }

    @Override
    public Optional<AdStats.Stored> update(UUID adId, AdDraft draft, Instant now) {
        Integer changed = transaction.execute(tx -> bind(entityManager.createNativeQuery("""
                UPDATE ads
                SET kind=:kind,status=:status,slots=CAST(:slots AS text[]),audience=:audience,priority=:priority,
                    advertiser_name=CAST(:advertiserName AS text),headline=CAST(:headline AS text),body=CAST(:body AS text),
                    image_large_banner=CAST(:imageLarge AS text),image_banner=CAST(:imageBanner AS text),
                    image_medium_rectangle=CAST(:imageMedium AS text),link_url=CAST(:linkUrl AS text),
                    app_path=CAST(:appPath AS text),starts_at=CAST(:startsAt AS timestamptz),
                    ends_at=CAST(:endsAt AS timestamptz),updated_at=:now
                WHERE id=:id
                """), draft, now).setParameter("id", adId).executeUpdate());
        return changed != null && changed > 0 ? findStored(adId) : Optional.empty();
    }

    @Override
    public List<AdStats.Day> dailyEvents(UUID adId, LocalDate from, LocalDate to) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT CAST(day AS text) AS day,
                       count(*) FILTER (WHERE event='impression') AS impressions,
                       count(*) FILTER (WHERE event='click') AS clicks
                FROM ad_events
                WHERE ad_id=:id AND day BETWEEN :from AND :to
                GROUP BY day
                ORDER BY day
                """, Tuple.class)
                .setParameter("id", adId)
                .setParameter("from", from)
                .setParameter("to", to)).stream()
                .map(row -> new AdStats.Day(LocalDate.parse(row.get("day", String.class)),
                        ((Number) row.get("impressions")).longValue(), ((Number) row.get("clicks")).longValue()))
                .toList();
    }

    private static jakarta.persistence.Query bind(jakarta.persistence.Query query, AdDraft draft, Instant now) {
        return query
                .setParameter("kind", draft.kind())
                .setParameter("status", draft.status())
                .setParameter("slots", "{" + String.join(",", draft.slots()) + "}")
                .setParameter("audience", draft.audience())
                .setParameter("priority", draft.priority())
                .setParameter("advertiserName", draft.advertiserName())
                .setParameter("headline", draft.headline())
                .setParameter("body", draft.body())
                .setParameter("imageLarge", draft.imageLargeBanner())
                .setParameter("imageBanner", draft.imageBanner())
                .setParameter("imageMedium", draft.imageMediumRectangle())
                .setParameter("linkUrl", draft.linkUrl())
                .setParameter("appPath", draft.appPath())
                .setParameter("startsAt", draft.startsAt() == null ? null : draft.startsAt().atOffset(ZoneOffset.UTC))
                .setParameter("endsAt", draft.endsAt() == null ? null : draft.endsAt().atOffset(ZoneOffset.UTC))
                .setParameter("now", now.atOffset(ZoneOffset.UTC));
    }

    private static AdStats.Stored stored(Tuple row) {
        String slots = row.get("slots", String.class);
        AdDraft draft = new AdDraft(
                row.get("kind", String.class),
                row.get("status", String.class),
                slots == null || slots.isEmpty() ? List.of() : Arrays.asList(slots.split(",")),
                row.get("audience", String.class),
                row.get("priority", Integer.class),
                row.get("advertiser_name", String.class),
                row.get("headline", String.class),
                row.get("body", String.class),
                row.get("image_large_banner", String.class),
                row.get("image_banner", String.class),
                row.get("image_medium_rectangle", String.class),
                row.get("link_url", String.class),
                row.get("app_path", String.class),
                instant(row.get("starts_at")),
                instant(row.get("ends_at")));
        return new AdStats.Stored(row.get("id", UUID.class), draft, instant(row.get("created_at")),
                instant(row.get("updated_at")), ((Number) row.get("impressions")).longValue(),
                ((Number) row.get("clicks")).longValue());
    }

    private static Instant instant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Instant instant) {
            return instant;
        }
        if (value instanceof java.time.OffsetDateTime offset) {
            return offset.toInstant();
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toInstant();
        }
        throw new IllegalStateException("unexpected timestamp type " + value.getClass());
    }

    private static Ad ad(Tuple row) {
        String slots = row.get("slots", String.class);
        return new Ad(
                row.get("id", UUID.class),
                row.get("kind", String.class),
                slots == null || slots.isEmpty() ? List.of() : Arrays.asList(slots.split(",")),
                row.get("audience", String.class),
                row.get("priority", Integer.class),
                row.get("advertiser_name", String.class),
                row.get("headline", String.class),
                row.get("body", String.class),
                row.get("image_large_banner", String.class),
                row.get("image_banner", String.class),
                row.get("image_medium_rectangle", String.class),
                row.get("link_url", String.class),
                row.get("app_path", String.class));
    }
}
