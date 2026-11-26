package com.acttub.actingapi.feature.portfolio.adapter.db;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.function.BiConsumer;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.feature.portfolio.app.PortfolioPhotoCleanup;
import com.acttub.actingapi.feature.portfolio.app.PortfolioRepository;
import com.acttub.actingapi.feature.portfolio.domain.Portfolio;
import com.acttub.actingapi.feature.portfolio.schema.PortfolioCreditEntity;
import com.acttub.actingapi.feature.portfolio.schema.PortfolioPhotoEntity;
import com.acttub.actingapi.platform.schema.PortfolioCreditKind;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 상한과 순서를 다루는 연산은 <b>포트폴리오 행을 {@code FOR UPDATE} 로 잡은 채</b> 센다 — 두 기기가 동시에
 * 더해 상한을 넘기거나, 한쪽이 더하는 사이 다른 쪽의 순서 바꾸기가 그것을 빠뜨리지 못한다
 * (apps/api/CONTRACT.md §5-2). {@code sort_order} 에는 UNIQUE 가 없어 여러 행을 한 문장씩 고쳐도 된다(V7).
 *
 * <p>문장은 JPQL·HQL 이다(§5-9). 네이티브로 남은 것은 다른 기능의 {@code users} 행을 잡는 {@link #lockOrCreate} 의
 * 첫 문장 하나다.
 */
@Repository
class PostgresPortfolioRepository implements PortfolioRepository {
    private final EntityManager entityManager;
    private final PortfolioJpaRepository portfolios;
    private final PortfolioCreditJpaRepository credits;
    private final PortfolioPhotoJpaRepository photos;
    private final TransactionTemplate transaction;
    private final PortfolioPhotoCleanup cleanup;

    private final AccountRowLock accountRows;

    PostgresPortfolioRepository(
            EntityManager entityManager,
            PortfolioJpaRepository portfolios,
            PortfolioCreditJpaRepository credits,
            PortfolioPhotoJpaRepository photos,
            PlatformTransactionManager transactionManager,
            PortfolioPhotoCleanup cleanup,
            AccountRowLock accountRows) {
        this.accountRows = accountRows;
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
                        credits.listOf(userId).stream().map(PostgresPortfolioRepository::credit).toList(),
                        photos.uploadedOf(userId).stream()
                                .map(photo -> new Portfolio.Photo(photo.getId(), photo.getObjectKey()))
                                .toList(),
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

    /**
     * {@code RETURNING} 이 없어 고친 뒤 같은 트랜잭션에서 다시 읽는다(문장이 하나 는다). 고친 행은 이 트랜잭션이 잡고
     * 있어 그 사이에 바뀌지 않는다. 고친 행이 없으면 다시 읽지 않는다.
     */
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
        return reorder(userId, ids, () -> credits.idsOf(userId), (id, index) -> credits.moveTo(id, userId, index));
    }

    /**
     * 시한이 지난 올리기를 잡아 읽고 <b>그 행을 id 로</b> 지운다({@code DELETE … RETURNING} 대신, 치울 것이 있을 때만
     * 문장이 하나 는다). 앞서 잡은 포트폴리오 행이 그 회원의 사진 행이 새로 들어오는 것을 막고(FK 가 거는 잠금이
     * {@code FOR UPDATE} 뒤에서 기다린다), 잡은 행은 다른 트랜잭션이 지우지 못하니 읽은 키와 지운 행이 같다.
     */
    @Override
    public PhotoSlot beginPhoto(UUID userId, PendingPhoto photo, int limit, Instant now) {
        return transaction.execute(status -> {
            lockOrCreate(userId);
            List<PortfolioPhotoEntity> expired = photos.lockExpired(userId, now);
            if (!expired.isEmpty()) {
                photos.deleteRows(expired.stream().map(PortfolioPhotoEntity::getId).toList());
            }
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
                .map(row -> new PendingPhoto(
                        row.getId(),
                        row.getObjectKey(),
                        row.getMimeType(),
                        row.getSizeBytes(),
                        row.getExpiresAt(),
                        row.getUploadedAt() != null))
                .orElse(null);
    }

    @Override
    public void completePhoto(UUID userId, UUID photoId, Instant now) {
        transaction.executeWithoutResult(status -> {
            lockOrCreate(userId);
            photos.complete(photoId, userId, now);
        });
    }

    /** 사진 행을 잡아 읽고 그 행을 id 로 지운다({@code DELETE … RETURNING} 대신, 찾았을 때 문장이 하나 는다). */
    @Override
    public List<UUID> deletePhoto(UUID userId, UUID photoId, Instant now) {
        return transaction.execute(status -> {
            PortfolioPhotoEntity removed = photos.lockOwned(photoId, userId).orElse(null);
            if (removed == null) {
                return null;
            }
            photos.deleteRows(List.of(removed.getId()));
            // 올리는 중이던 사진의 주소는 시한까지 살아 있다. 그 전에 지우면 뒤에 올라온 객체가 다시 남는다.
            Instant notBefore = removed.getUploadedAt() == null ? removed.getExpiresAt() : now;
            return List.of(cleanup.schedule(userId, List.of(removed.getObjectKey()), now, notBefore));
        });
    }

    @Override
    public boolean orderPhotos(UUID userId, List<UUID> ids) {
        return reorder(userId, ids, () -> photos.uploadedIdsOf(userId), (id, index) -> photos.moveTo(id, userId, index));
    }

    /** {@code RETURNING} 이 없어 고친 뒤 같은 트랜잭션에서 다시 읽는다(문장이 하나 는다). 행은 이 트랜잭션이 잡고 있다. */
    @Override
    public Portfolio.Share share(UUID userId, boolean enabled, String newSlug) {
        return transaction.execute(status -> {
            lockOrCreate(userId);
            portfolios.updateShare(userId, enabled, newSlug);
            return portfolios.share(userId).orElseThrow();
        });
    }

    @Override
    public UUID sharedOwner(String slug) {
        return portfolios.sharedOwner(slug).orElse(null);
    }

    /**
     * 행이 없으면 만들고, 있든 없든 잠근다. 같은 회원의 상한·순서 연산이 여기서 줄을 선다.
     *
     * <p>그보다 먼저 <b>탈퇴와 같은 {@code users} 행</b>을 잡고 활성인지 본다. 탈퇴는 포트폴리오를 행째
     * 지우는데, 게이트를 지난 뒤에 탈퇴가 끝난 요청이 여기서 그 행을 다시 만들면 파기한 자료가 되살아난다.
     * {@code users} 는 {@code auth} 의 테이블이라 잠금은 {@code AccountRowLock} 이 잡는다. 이 확인은 쓰는 트랜잭션 안에
     * 있어야 뜻이 있다.
     */
    private void lockOrCreate(UUID userId) {
        boolean active = accountRows.lockActive(userId);
        if (!active) {
            throw new OwnerNotActive();
        }
        portfolios.createIfAbsent(userId);
        portfolios.lock(userId);
    }

    private boolean reorder(UUID userId, List<UUID> ids, Supplier<List<UUID>> current, BiConsumer<UUID, Integer> move) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            lockOrCreate(userId);
            List<UUID> present = current.get();
            if (ids.size() != present.size() || !new HashSet<>(ids).equals(new HashSet<>(present))) {
                return false;
            }
            for (int index = 0; index < ids.size(); index++) {
                move.accept(ids.get(index), index);
            }
            return true;
        }));
    }

    private static PortfolioCreditKind kind(String kind) {
        return PortfolioCreditKind.valueOf(kind.toUpperCase(Locale.ROOT));
    }

    private static Portfolio.Credit credit(PortfolioCreditEntity row) {
        return new Portfolio.Credit(row.getId(), row.getTitle(), row.getRole(), row.getYear(), row.getKind().dbValue());
    }
}
