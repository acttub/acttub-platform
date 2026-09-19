package com.acttub.actingapi.feature.portfolio.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.app.PortfolioRepository;
import com.acttub.actingapi.feature.portfolio.domain.Portfolio;
import com.acttub.actingapi.platform.schema.PortfolioCreditKind;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 상한과 순서를 다루는 연산은 <b>포트폴리오 행을 {@code FOR UPDATE} 로 잡은 채</b> 센다 — 두 기기가 동시에
 * 더해 상한을 넘기거나, 한쪽이 더하는 사이 다른 쪽의 순서 바꾸기가 그것을 빠뜨리지 못한다
 * (apps/api/CONTRACT.md §5-2). {@code sort_order} 에는 UNIQUE 가 없어 여러 행을 한 문장씩 고쳐도 된다(V7).
 */
@Repository
class PostgresPortfolioRepository implements PortfolioRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresPortfolioRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Portfolio find(UUID userId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT intro,share_enabled,share_slug
                FROM portfolios
                WHERE user_id=:userId
                """, Tuple.class)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return Portfolio.EMPTY;
        }
        Tuple row = rows.getFirst();
        return new Portfolio(
                row.get("intro", String.class),
                credits(userId),
                photos(userId),
                new Portfolio.Share(row.get("share_enabled", Boolean.class), row.get("share_slug", String.class)));
    }

    @Override
    public void saveIntro(UUID userId, String intro) {
        transaction.executeWithoutResult(status -> {
            lockOrCreate(userId);
            entityManager.createNativeQuery("""
                    UPDATE portfolios
                    SET intro=CAST(:intro AS text),updated_at=now()
                    WHERE user_id=:userId
                    """)
                    .setParameter("intro", intro)
                    .setParameter("userId", userId)
                    .executeUpdate();
        });
    }

    @Override
    public Portfolio.Credit addCredit(UUID userId, String title, String role, int year, String kind, int limit) {
        return transaction.execute(status -> {
            lockOrCreate(userId);
            if (count("portfolio_credits", userId) >= limit) {
                return null;
            }
            UUID id = UUID.randomUUID();
            entityManager.createNativeQuery("""
                    INSERT INTO portfolio_credits(id,user_id,title,role,year,kind,sort_order)
                    SELECT :id,:userId,:title,:role,:year,:kind,COALESCE(MAX(sort_order),-1)+1
                    FROM portfolio_credits
                    WHERE user_id=:userId
                    """)
                    .setParameter("id", id)
                    .setParameter("userId", userId)
                    .setParameter("title", title)
                    .setParameter("role", role)
                    .setParameter("year", year)
                    .setParameter("kind", kind)
                    .executeUpdate();
            return new Portfolio.Credit(id, title, role, year, kind);
        });
    }

    @Override
    public Portfolio.Credit updateCredit(
            UUID userId, UUID creditId, String title, String role, Integer year, String kind) {
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    WITH changed AS (
                        UPDATE portfolio_credits
                        SET title=COALESCE(CAST(:title AS text),title),
                            role=COALESCE(CAST(:role AS text),role),
                            year=COALESCE(CAST(:year AS integer),year),
                            kind=COALESCE(CAST(:kind AS text),kind),
                            updated_at=now()
                        WHERE id=:creditId
                          AND user_id=:userId
                        RETURNING id,title,role,year,kind
                    )
                    SELECT id,title,role,year,kind FROM changed
                    """, Tuple.class)
                    .setParameter("title", title)
                    .setParameter("role", role)
                    .setParameter("year", year)
                    .setParameter("kind", kind)
                    .setParameter("creditId", creditId)
                    .setParameter("userId", userId));
            return rows.isEmpty() ? null : credit(rows.getFirst());
        });
    }

    @Override
    public boolean deleteCredit(UUID userId, UUID creditId) {
        return Boolean.TRUE.equals(transaction.execute(status -> entityManager.createNativeQuery("""
                DELETE FROM portfolio_credits
                WHERE id=:creditId
                  AND user_id=:userId
                """)
                .setParameter("creditId", creditId)
                .setParameter("userId", userId)
                .executeUpdate() > 0));
    }

    @Override
    public boolean orderCredits(UUID userId, List<UUID> ids) {
        return reorder("portfolio_credits", "", userId, ids);
    }

    @Override
    public PhotoSlot beginPhoto(UUID userId, PendingPhoto photo, int limit, Instant now) {
        return transaction.execute(status -> {
            lockOrCreate(userId);
            List<String> abandoned = list(entityManager.createNativeQuery("""
                    WITH removed AS (
                        DELETE FROM portfolio_photos
                        WHERE user_id=:userId
                          AND uploaded_at IS NULL
                          AND expires_at<=:now
                        RETURNING object_key
                    )
                    SELECT object_key FROM removed
                    """, Tuple.class)
                    .setParameter("userId", userId)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))).stream()
                    .map(row -> row.get("object_key", String.class))
                    .toList();
            if (count("portfolio_photos", userId) >= limit) {
                // 거절해도 치운 찌꺼기는 그대로 커밋된다. 그 객체는 부르는 쪽이 지운다.
                return new PhotoSlot(false, abandoned);
            }
            entityManager.createNativeQuery("""
                    INSERT INTO portfolio_photos(id,user_id,object_key,mime_type,size_bytes,expires_at)
                    VALUES (:id,:userId,:objectKey,:mimeType,:sizeBytes,:expiresAt)
                    """)
                    .setParameter("id", photo.id())
                    .setParameter("userId", userId)
                    .setParameter("objectKey", photo.objectKey())
                    .setParameter("mimeType", photo.mimeType())
                    .setParameter("sizeBytes", photo.sizeBytes())
                    .setParameter("expiresAt", photo.expiresAt().atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            return new PhotoSlot(true, abandoned);
        });
    }

    @Override
    public PendingPhoto photo(UUID userId, UUID photoId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT id,object_key,mime_type,size_bytes,expires_at,uploaded_at IS NOT NULL AS uploaded
                FROM portfolio_photos
                WHERE id=:photoId
                  AND user_id=:userId
                """, Tuple.class)
                .setParameter("photoId", photoId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new PendingPhoto(
                row.get("id", UUID.class),
                row.get("object_key", String.class),
                row.get("mime_type", String.class),
                row.get("size_bytes", Long.class),
                row.get("expires_at", Instant.class),
                row.get("uploaded", Boolean.class));
    }

    @Override
    public void completePhoto(UUID userId, UUID photoId, Instant now) {
        transaction.executeWithoutResult(status -> {
            lockOrCreate(userId);
            entityManager.createNativeQuery("""
                    UPDATE portfolio_photos
                    SET uploaded_at=:now,
                        sort_order=(SELECT COALESCE(MAX(sort_order),-1)+1
                                    FROM portfolio_photos
                                    WHERE user_id=:userId
                                      AND uploaded_at IS NOT NULL)
                    WHERE id=:photoId
                      AND user_id=:userId
                      AND uploaded_at IS NULL
                    """)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("userId", userId)
                    .setParameter("photoId", photoId)
                    .executeUpdate();
        });
    }

    @Override
    public String deletePhoto(UUID userId, UUID photoId) {
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    WITH removed AS (
                        DELETE FROM portfolio_photos
                        WHERE id=:photoId
                          AND user_id=:userId
                        RETURNING object_key
                    )
                    SELECT object_key FROM removed
                    """, Tuple.class)
                    .setParameter("photoId", photoId)
                    .setParameter("userId", userId));
            return rows.isEmpty() ? null : rows.getFirst().get("object_key", String.class);
        });
    }

    @Override
    public boolean orderPhotos(UUID userId, List<UUID> ids) {
        return reorder("portfolio_photos", " AND uploaded_at IS NOT NULL", userId, ids);
    }

    @Override
    public Portfolio.Share share(UUID userId, boolean enabled, String newSlug) {
        return transaction.execute(status -> {
            lockOrCreate(userId);
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    WITH changed AS (
                        UPDATE portfolios
                        SET share_slug=COALESCE(share_slug,CASE WHEN :enabled THEN :newSlug END),
                            share_enabled=:enabled,
                            updated_at=now()
                        WHERE user_id=:userId
                        RETURNING share_enabled,share_slug
                    )
                    SELECT share_enabled,share_slug FROM changed
                    """, Tuple.class)
                    .setParameter("enabled", enabled)
                    .setParameter("newSlug", newSlug)
                    .setParameter("userId", userId));
            Tuple row = rows.getFirst();
            return new Portfolio.Share(row.get("share_enabled", Boolean.class), row.get("share_slug", String.class));
        });
    }

    @Override
    public UUID sharedOwner(String slug) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT user_id
                FROM portfolios
                WHERE share_slug=:slug
                  AND share_enabled
                """, Tuple.class)
                .setParameter("slug", slug));
        return rows.isEmpty() ? null : rows.getFirst().get("user_id", UUID.class);
    }

    /** 행이 없으면 만들고, 있든 없든 잠근다. 같은 회원의 상한·순서 연산이 여기서 줄을 선다. */
    private void lockOrCreate(UUID userId) {
        entityManager.createNativeQuery("""
                INSERT INTO portfolios(user_id)
                VALUES (:userId)
                ON CONFLICT (user_id) DO NOTHING
                """)
                .setParameter("userId", userId)
                .executeUpdate();
        list(entityManager.createNativeQuery("""
                SELECT user_id
                FROM portfolios
                WHERE user_id=:userId
                FOR UPDATE
                """, Tuple.class)
                .setParameter("userId", userId));
    }

    /** 올리기가 끝난 사진과 아직 끝나지 않은 올리기를 합쳐 센다(시한이 지난 것은 부르기 전에 지웠다). */
    private int count(String table, UUID userId) {
        Number count = (Number) entityManager.createNativeQuery(
                "SELECT count(*) FROM " + table + " WHERE user_id=:userId")
                .setParameter("userId", userId)
                .getSingleResult();
        return count.intValue();
    }

    /** {@code table} 과 {@code filter} 는 코드의 상수라 SQL 에 이어 붙여도 된다. */
    private boolean reorder(String table, String filter, UUID userId, List<UUID> ids) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            lockOrCreate(userId);
            List<UUID> current = list(entityManager.createNativeQuery(
                    "SELECT id FROM " + table + " WHERE user_id=:userId" + filter, Tuple.class)
                    .setParameter("userId", userId)).stream()
                    .map(row -> row.get("id", UUID.class))
                    .toList();
            if (ids.size() != current.size() || !new HashSet<>(ids).equals(new HashSet<>(current))) {
                return false;
            }
            for (int index = 0; index < ids.size(); index++) {
                entityManager.createNativeQuery(
                        "UPDATE " + table + " SET sort_order=:sortOrder WHERE id=:id AND user_id=:userId")
                        .setParameter("sortOrder", index)
                        .setParameter("id", ids.get(index))
                        .setParameter("userId", userId)
                        .executeUpdate();
            }
            return true;
        }));
    }

    private List<Portfolio.Credit> credits(UUID userId) {
        return list(entityManager.createNativeQuery("""
                SELECT id,title,role,year,kind
                FROM portfolio_credits
                WHERE user_id=:userId
                ORDER BY sort_order,created_at,id
                """, Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(PostgresPortfolioRepository::credit)
                .toList();
    }

    private List<Portfolio.Photo> photos(UUID userId) {
        return list(entityManager.createNativeQuery("""
                SELECT id,object_key
                FROM portfolio_photos
                WHERE user_id=:userId
                  AND uploaded_at IS NOT NULL
                ORDER BY sort_order,uploaded_at,id
                """, Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> new Portfolio.Photo(row.get("id", UUID.class), row.get("object_key", String.class)))
                .toList();
    }

    /** 아는 어휘인지 확인하고 DB 값을 그대로 돌려준다({@code PostgresProfileRepository#known} 과 같은 판단). */
    private static Portfolio.Credit credit(Tuple row) {
        return new Portfolio.Credit(
                row.get("id", UUID.class),
                row.get("title", String.class),
                row.get("role", String.class),
                row.get("year", Integer.class),
                PortfolioCreditKind.valueOf(row.get("kind", String.class).toUpperCase(Locale.ROOT)).dbValue());
    }
}
