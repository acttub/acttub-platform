package com.acttub.actingapi.feature.profile.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 계정 일(프로필 사진, 탈퇴, 매일 정리)이 정리 장부({@code account_cleanup_operations})에 요구하는 것.
 *
 * <p>사진을 바꾸거나 지우는 트랜잭션이 옛 객체의 삭제를 <b>같은 트랜잭션에서</b> 장부에 올리고, 커밋 뒤에 시도한다. 탈퇴와 3년
 * 파기는 각 기능이 올린 정리의 id 를 모아 커밋 뒤에 한 번 시도한다(apps/api/CONTRACT.md §6-8).
 *
 * <p>선언은 쓰는 쪽(여기)에 있고 구현은 장부의 주인인 배관({@code platform/operation})이 한다(ADR-017,
 * {@code portfolio/app/PortfolioPhotoCleanup} 과 같은 형태).
 */
public interface AccountCleanupLedger {

    /**
     * 객체 삭제를 장부에 올린다. <b>자기 트랜잭션을 열지 않는다</b> — 키를 덮거나 행을 지우는 트랜잭션에 참여한다.
     *
     * @param notBefore 이 시각 전에는 지우지 않는다(올리기 주소가 아직 살아 있으면 그 시한 뒤)
     * @return 장부의 id
     */
    UUID schedule(UUID userId, List<String> objectKeys, Instant now, Instant notBefore);

    /** 방금 올린 것을 커밋 뒤에 바로 한 번 시도한다. 어떤 실패도 밖으로 나가지 않는다. */
    void attempt(List<UUID> operationIds);

    /**
     * 때가 된 정리를 다시 시도하고 기한이 지난 것을 치운다. 5분마다 도는 예약 작업과 같은 일이다.
     *
     * @return 이번에 시도한 정리의 수
     */
    int runDue();
}
