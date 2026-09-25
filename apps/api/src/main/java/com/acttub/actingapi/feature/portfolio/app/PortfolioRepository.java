package com.acttub.actingapi.feature.portfolio.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.domain.Portfolio;

/**
 * portfolio 가 저장소에 요구하는 것.
 *
 * <p>없음을 {@code null} 이나 {@code false} 로 알린다(ADR-018). "없는 것"과 "남의 것"을 가르지 않는다 —
 * 모든 연산이 회원의 것만 본다. 포트폴리오 행은 <b>처음 저장할 때</b> 생긴다: 무엇을 저장하든 행이 없으면
 * 같은 트랜잭션에서 만든다.
 *
 * <p>상한(경력 50개, 사진 10장)과 순서 바꾸기는 포트폴리오 행을 잠근 채 센다 — 두 기기가 동시에 더해
 * 상한을 넘기거나 순서를 뒤섞지 못한다.
 */
public interface PortfolioRepository {

    /** 한 번도 편집하지 않았으면 {@link Portfolio#EMPTY}. */
    Portfolio find(UUID userId);

    void saveIntro(UUID userId, String intro);

    /** 맨 끝에 붙인다. 이미 {@code limit} 개면 아무것도 하지 않고 {@code null}. */
    Portfolio.Credit addCredit(UUID userId, String title, String role, int year, String kind, int limit);

    /** {@code null} 인 항목은 그대로 둔다. 없으면 {@code null}. */
    Portfolio.Credit updateCredit(UUID userId, UUID creditId, String title, String role, Integer year, String kind);

    boolean deleteCredit(UUID userId, UUID creditId);

    /** {@code ids} 가 지금 있는 경력의 집합과 다르면(빠짐·중복·모르는 id) 아무것도 바꾸지 않고 {@code false}. */
    boolean orderCredits(UUID userId, List<UUID> ids);

    /**
     * 올릴 자리를 적는다. 장수는 올리기가 끝난 사진과 <b>아직 끝나지 않은 올리기</b>를 합쳐 센다 — 동시에 여러
     * 장을 올려 상한을 넘기지 못한다. 시한이 지난 올리기는 세지 않고 이참에 지운다.
     *
     */
    PhotoSlot beginPhoto(UUID userId, PendingPhoto photo, int limit, Instant now);

    /**
     * @param accepted 이미 {@code limit} 장이면 {@code false}(자리를 적지 않았다)
     * @param cleanupOperationIds 이참에 지운, 시한이 지난 올리기의 객체 삭제. 같은 트랜잭션에서 정리 장부에
     *        올렸고({@link PortfolioPhotoCleanup}) 부르는 쪽이 트랜잭션 밖에서 시도한다
     */
    record PhotoSlot(boolean accepted, List<UUID> cleanupOperationIds) {
    }

    /** 없으면 {@code null}. 이미 끝난 사진도 돌려준다({@link PendingPhoto#uploaded}). */
    PendingPhoto photo(UUID userId, UUID photoId);

    /** 올리기를 끝낸 것으로 적고 목록 맨 끝에 붙인다. */
    void completePhoto(UUID userId, UUID photoId, Instant now);

    /**
     * 행을 지우면서 그 객체의 삭제를 같은 트랜잭션에서 정리 장부에 올린다({@link PortfolioPhotoCleanup}).
     * 아직 올리는 중이던 사진은 그 주소의 시한 뒤에 지운다.
     *
     * @return 장부에 올린 객체 삭제. 부르는 쪽이 트랜잭션 밖에서 시도한다. 그런 사진이 없으면 {@code null}
     */
    List<UUID> deletePhoto(UUID userId, UUID photoId, Instant now);

    /**
     * 포트폴리오를 쓰는 트랜잭션이 {@code users} 행을 잡아 보니 계정이 활성이 아니었다 — 게이트를 지난 뒤에
     * 다른 기기의 탈퇴가 끝났다. 아무것도 쓰지 않았다. 탈퇴는 포트폴리오를 행째 지우는데, 이 확인이 없으면
     * 뒤늦은 쓰기가 그 행을 다시 만든다.
     */
    final class OwnerNotActive extends RuntimeException {
        public OwnerNotActive() {
            super("the portfolio owner is not an active account");
        }
    }

    /** {@link #orderCredits} 와 같다. 올리기가 끝난 사진만 센다. */
    boolean orderPhotos(UUID userId, List<UUID> ids);

    /**
     * 공유를 켜거나 끈다. 처음 켤 때만 {@code newSlug} 를 쓴다 — 이미 slug 가 있으면 그대로 둔다.
     *
     * @throws org.springframework.dao.DataIntegrityViolationException slug 가 다른 포트폴리오와 겹쳤을 때
     */
    Portfolio.Share share(UUID userId, boolean enabled, String newSlug);

    /** 이 slug 의 공유가 <b>켜져 있는</b> 포트폴리오의 주인. 없거나 꺼져 있으면 {@code null}. */
    UUID sharedOwner(String slug);

    record PendingPhoto(
            UUID id, String objectKey, String mimeType, long sizeBytes, Instant expiresAt, boolean uploaded) {
    }
}
