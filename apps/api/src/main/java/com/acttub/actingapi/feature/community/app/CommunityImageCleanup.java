package com.acttub.actingapi.feature.community.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 뗀 사진의 객체 삭제를 정리 장부({@code account_cleanup_operations})에 올린다. 포트폴리오 사진
 * ({@code PortfolioPhotoCleanup})과 같은 장부·같은 문장이고 구현은 장부의 주인인 {@code profile} 이 한다(ADR-017).
 * 간선은 {@code profile → community.app} 한 방향이다.
 */
public interface CommunityImageCleanup {

    /**
     * 객체 삭제를 장부에 올린다. <b>자기 트랜잭션을 열지 않는다</b> — 행을 지우는 트랜잭션에 참여한다.
     *
     * @param notBefore 이 시각 전에는 지우지 않는다(올리기 주소가 아직 살아 있으면 그 시한 뒤)
     * @return 장부의 id
     */
    UUID schedule(UUID userId, List<String> objectKeys, Instant now, Instant notBefore);

    /** 방금 올린 것을 커밋 뒤에 바로 한 번 시도한다. 어떤 실패도 밖으로 나가지 않는다. */
    void attempt(List<UUID> operationIds);
}
