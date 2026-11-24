package com.acttub.actingapi.feature.portfolio.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.function.Function;

import com.acttub.actingapi.feature.portfolio.app.PortfolioPhotoCleanup;
import com.acttub.actingapi.feature.portfolio.app.PortfolioRepository;
import com.acttub.actingapi.feature.portfolio.domain.Portfolio;
import com.acttub.actingapi.feature.portfolio.schema.PortfolioCreditEntity;
import com.acttub.actingapi.feature.portfolio.schema.PortfolioEntity;
import com.acttub.actingapi.feature.portfolio.schema.PortfolioPhotoEntity;
import com.acttub.actingapi.platform.schema.PortfolioCreditKind;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 상한과 순서를 다루는 연산은 <b>포트폴리오 행을 잠근 채</b> 센다 — 두 기기가 동시에 더해 상한을 넘기거나, 한쪽이
 * 더하는 사이 다른 쪽의 순서 바꾸기가 그것을 빠뜨리지 못한다. {@code sort_order} 에는 UNIQUE 가 없어 여러 행을 한
 * 문장씩 고쳐도 된다(V7).
 *
 * <p>SOMA-1112 표본: 네이티브 SQL 을 Spring Data 메서드·JPQL·HQL 로 옮겼다. 남은 네이티브는 다른 기능({@code auth})의
 * {@code users} 행 잠금 하나다.
 */
@Repository
class PostgresPortfolioRepository implements PortfolioRepository {
    private final EntityManager entityManager;
    private final PortfolioJpaRepository portfolios;
    private final PortfolioCreditJpaRepository credits;
    private final PortfolioPhotoJpaRepository photos;
    private final TransactionTemplate transaction;
    private final PortfolioPhotoCleanup cleanup;

    PostgresPortfolioRepository(
            EntityManager entityManager,
            PortfolioJpaRepository portfolios,
            PortfolioCreditJpaRepository credits,
            PortfolioPhotoJpaRepository photos,
            PlatformTransactionManager transactionManager,
            PortfolioPhotoCleanup cleanup) {
        this.entityManager = entityManager;
        this.portfolios = portfolios;
        this.credits = credits;
        this.photos = photos;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanup = cleanup;
    }

    @Override
    public Portfolio find(UUID userId) {
        return portfolios.findById(userId)
                .map(row -> new Portfolio(
                        row.getIntro(),
                        credits.findByUserIdOrderBySortOrderAscCreatedAtAscIdAsc(userId).stream()
                                .map(PostgresPortfolioRepository::credit).toList(),
                        photos.findByUserIdAndUploadedAtIsNotNullOrderBySortOrderAscUploadedAtAscIdAsc(userId).stream()
                                .map(photo -> new Portfolio.Photo(photo.getId(), photo.getObjectKey())).toList(),
                        new Portfolio.Share(row.isShareEnabled(), row.getShareSlug())))
                .orElse(Portfolio.EMPTY);
    }

    @Override
    public void saveIntro(UUID userId, String intro) {
        transaction.executeWithoutResult(status -> {
            lockOrCreate(userId);
            portfolios.updateIntro(userId, intro);
        });
    }

    @Override
    public Portfolio.Credit addCredit(UUID userId, String title, String role, int year, String kind, int limit) {
        return transaction.execute(status -> {
            lockOrCreate(userId);
            if (credits.countByUserId(userId) >= limit) {
                return null;
            }
            UUID id = UUID.randomUUID();
            credits.append(id, userId, title, role, year, kind(kind));
            return new Portfolio.Credit(id, title, role, year, kind);
        });
    }

    /** RETURNING 이 없어 고친 뒤 다시 읽는다. 고친 행은 이 트랜잭션이 잡고 있어 사이에 바뀌지 않는다. */
    @Override
    public Portfolio.Credit updateCredit(
            UUID userId, UUID creditId, String title, String role, Integer year, String kind) {
        return transaction.execute(status -> {
            if (credits.patch(creditId, userId, title, role, year, kind == null ? null : kind(kind)) == 0) {
                return null;
            }
            return credits.findByIdAndUserId(creditId, userId).map(PostgresPortfolioRepository::credit).orElseThrow();
        });
    }

    @Override
    public boolean deleteCredit(UUID userId, UUID creditId) {
        return Boolean.TRUE.equals(transaction.execute(status -> credits.deleteOwned(creditId, userId) > 0));
    }

    @Override
    public boolean orderCredits(UUID userId, List<UUID> ids) {
        return reorder(userId, ids, owner -> credits.findByUserId(owner).stream().map(PortfolioCreditEntity::getId).toList(),
                (id, index) -> credits.moveTo(id, userId, index));
    }

    @Override
    public PhotoSlot beginPhoto(UUID userId, PendingPhoto photo, int limit, Instant now) {
        return transaction.execute(status -> {
            lockOrCreate(userId);
            // RETURNING 대신 잡은 행을 그대로 지운다 — 읽은 키와 지운 행이 같다.
            List<PortfolioPhotoEntity> expired = photos.findByUserIdAndUploadedAtIsNullAndExpiresAtLessThanEqual(userId, now);
            photos.deleteAllInBatch(expired);
            List<String> abandoned = expired.stream().map(PortfolioPhotoEntity::getObjectKey).toList();
            // 행을 지운 트랜잭션에서 객체 삭제를 장부에 남긴다 — 커밋 뒤에 저장소가 실패해도 키를 잃지 않는다.
            // 시한이 지난 올리기라 주소는 이미 죽었고, 바로 지워도 된다.
            List<UUID> cleanups = abandoned.isEmpty()
                    ? List.of()
                    : List.of(cleanup.schedule(userId, abandoned, now, now));
            if (photos.countByUserId(userId) >= limit) {
                // 거절해도 치운 찌꺼기는 그대로 커밋된다.
                return new PhotoSlot(false, cleanups);
            }
            photos.save(new PortfolioPhotoEntity(
                    photo.id(), userId, photo.objectKey(), photo.mimeType(), photo.sizeBytes(), photo.expiresAt()));
            return new PhotoSlot(true, cleanups);
        });
    }

    @Override
    public PendingPhoto photo(UUID userId, UUID photoId) {
        return photos.findByIdAndUserId(photoId, userId)
                .map(row -> new PendingPhoto(row.getId(), row.getObjectKey(), row.getMimeType(), row.getSizeBytes(),
                        row.getExpiresAt(), row.getUploadedAt() != null))
                .orElse(null);
    }

    @Override
    public void completePhoto(UUID userId, UUID photoId, Instant now) {
        transaction.executeWithoutResult(status -> {
            lockOrCreate(userId);
            photos.complete(photoId, userId, now);
        });
    }

    /** RETURNING 대신 행을 잡아 읽고 지운다. */
    @Override
    public List<UUID> deletePhoto(UUID userId, UUID photoId, Instant now) {
        return transaction.execute(status -> {
            PortfolioPhotoEntity removed = photos.lockOwned(photoId, userId).orElse(null);
            if (removed == null) {
                return null;
            }
            photos.deleteAllInBatch(List.of(removed));
            // 올리는 중이던 사진의 주소는 시한까지 살아 있다. 그 전에 지우면 뒤에 올라온 객체가 다시 남는다.
            Instant notBefore = removed.getUploadedAt() == null ? removed.getExpiresAt() : now;
            return List.of(cleanup.schedule(userId, List.of(removed.getObjectKey()), now, notBefore));
        });
    }

    @Override
    public boolean orderPhotos(UUID userId, List<UUID> ids) {
        return reorder(userId, ids,
                owner -> photos.findByUserIdAndUploadedAtIsNotNull(owner).stream().map(PortfolioPhotoEntity::getId).toList(),
                (id, index) -> photos.moveTo(id, userId, index));
    }

    /** RETURNING 이 없어 고친 뒤 다시 읽는다. 고치는 문장이 영속성 컨텍스트를 비워 잠글 때 읽은 낡은 엔티티를 돌려주지 않는다. */
    @Override
    public Portfolio.Share share(UUID userId, boolean enabled, String newSlug) {
        return transaction.execute(status -> {
            lockOrCreate(userId);
            portfolios.updateShare(userId, enabled, newSlug);
            PortfolioEntity row = portfolios.findById(userId).orElseThrow();
            return new Portfolio.Share(row.isShareEnabled(), row.getShareSlug());
        });
    }

    @Override
    public UUID sharedOwner(String slug) {
        return portfolios.findByShareSlugAndShareEnabledTrue(slug).map(PortfolioEntity::getUserId).orElse(null);
    }

    /**
     * 행이 없으면 만들고, 있든 없든 잠근다. 같은 회원의 상한·순서 연산이 여기서 줄을 선다.
     *
     * <p>그보다 먼저 <b>탈퇴와 같은 {@code users} 행</b>을 잡고 활성인지 본다. 탈퇴는 포트폴리오를 행째
     * 지우는데, 게이트를 지난 뒤에 탈퇴가 끝난 요청이 여기서 그 행을 다시 만들면 파기한 자료가 되살아난다.
     * ⚠ {@code users} 의 주인은 {@code auth} 라 Schema Entity 를 import 하지 않고 native SQL 로 잠금만 잡는다.
     * 이 잠금은 원본대로 FOR UPDATE 다(JPA 로 옮기면 FOR NO KEY UPDATE 가 된다, SOMA-1112 P37).
     */
    private void lockOrCreate(UUID userId) {
        boolean active = !list(entityManager.createNativeQuery("""
                SELECT id
                FROM users
                WHERE id=:userId
                  AND status='active'
                FOR UPDATE
                """, Tuple.class)
                .setParameter("userId", userId)).isEmpty();
        if (!active) {
            throw new OwnerNotActive();
        }
        portfolios.createIfAbsent(userId);
        portfolios.lock(userId);
    }

    private boolean reorder(UUID userId, List<UUID> ids, Function<UUID, List<UUID>> current, Move move) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            lockOrCreate(userId);
            List<UUID> now = current.apply(userId);
            if (ids.size() != now.size() || !new HashSet<>(ids).equals(new HashSet<>(now))) {
                return false;
            }
            for (int index = 0; index < ids.size(); index++) {
                move.to(ids.get(index), index);
            }
            return true;
        }));
    }

    private interface Move {
        void to(UUID id, int index);
    }

    private static PortfolioCreditKind kind(String kind) {
        return PortfolioCreditKind.valueOf(kind.toUpperCase(Locale.ROOT));
    }

    private static Portfolio.Credit credit(PortfolioCreditEntity row) {
        return new Portfolio.Credit(row.getId(), row.getTitle(), row.getRole(), row.getYear(), row.getKind().dbValue());
    }
}
