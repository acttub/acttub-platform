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
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 광고의 Postgres 구현 — {@code ads}·{@code ad_events} (V65). 첫 연습 판정은 코칭·리딩·챌린지 표를 읽기만 한다. */
@Repository
class PostgresAdRepository implements AdRepository {
    private static final String COLUMNS = """
            id,kind,array_to_string(slots,',') AS slots,audience,priority,advertiser_name,academy_registration_no,
            course_name,tuition,headline,body,image_large_banner,image_banner,image_medium_rectangle,link_url,app_path
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

    private static Ad ad(Tuple row) {
        String slots = row.get("slots", String.class);
        return new Ad(
                row.get("id", UUID.class),
                row.get("kind", String.class),
                slots == null || slots.isEmpty() ? List.of() : Arrays.asList(slots.split(",")),
                row.get("audience", String.class),
                row.get("priority", Integer.class),
                row.get("advertiser_name", String.class),
                row.get("academy_registration_no", String.class),
                row.get("course_name", String.class),
                row.get("tuition", String.class),
                row.get("headline", String.class),
                row.get("body", String.class),
                row.get("image_large_banner", String.class),
                row.get("image_banner", String.class),
                row.get("image_medium_rectangle", String.class),
                row.get("link_url", String.class),
                row.get("app_path", String.class));
    }
}
