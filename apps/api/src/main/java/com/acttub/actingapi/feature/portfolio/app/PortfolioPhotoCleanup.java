package com.acttub.actingapi.feature.portfolio.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 지운 사진의 객체를 정리 장부에 올린다 (account.portfolio · account.withdraw).
 *
 * <p>행을 먼저 지우고 객체를 나중에 지우면, 그 사이에 저장소가 실패했을 때 객체 키를 아는 곳이 없어진다 —
 * 다시 지우라는 요청은 404 이고 탈퇴의 파기도 그 객체를 찾지 못한다. 그래서 <b>행을 지우는 트랜잭션에서</b>
 * 객체 삭제를 장부({@code account_cleanup_operations})에 함께 남기고, 커밋 뒤에 시도한다. 실패하면 장부가
 * 7일 동안 다시 시도하고 실패마다 보고한다(apps/api/CONTRACT.md §6-8).
 *
 * <p>선언은 쓰는 쪽(여기)에 있고 구현은 장부의 주인인 {@code profile} 이 한다 (ADR-017). 간선은
 * {@code profile → portfolio.app} 한 방향이다({@link PortfolioOwners} 와 같다).
 */
public interface PortfolioPhotoCleanup {

    /**
     * 객체 삭제를 장부에 올린다. <b>자기 트랜잭션을 열지 않는다</b> — 부르는 쪽(행을 지우는 트랜잭션)에
     * 참여해야 "행은 지워졌는데 장부에는 없는" 상태가 생기지 않는다.
     *
     * @param notBefore 이 시각 전에는 지우지 않는다. 올리기 주소가 아직 살아 있는 객체는 그 시한 뒤에 지워야
     *        한다 — 먼저 지우면 그 뒤에 올라온 객체가 다시 남는다
     * @return 장부의 id
     */
    UUID schedule(UUID userId, List<String> objectKeys, Instant now, Instant notBefore);

    /** 방금 올린 것을 커밋 뒤에 바로 한 번 시도한다. 어떤 실패도 밖으로 나가지 않는다. */
    void attempt(List<UUID> operationIds);
}
