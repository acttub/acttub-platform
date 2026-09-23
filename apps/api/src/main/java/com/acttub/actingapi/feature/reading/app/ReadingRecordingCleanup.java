package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 지운 녹음의 객체를 정리 장부에 올린다 (reading.recording · account.withdraw).
 *
 * <p>대본·회차를 지우는 트랜잭션은 녹음 행을 함께 지우고, 그 객체의 삭제를 <b>같은 트랜잭션에서</b> 장부
 * ({@code account_cleanup_operations}, 종류 {@code reading_recording_delete})에 남긴 뒤 커밋 뒤에 시도한다.
 * 저장소가 실패해도 요청은 끝나고 장부가 다시 시도한다. 객체 삭제 작업은 성공할 때까지 대상 키를 지우지
 * 않는다(03-reading 「리딩 자료의 이관·삭제·탈퇴」).
 *
 * <p>선언은 쓰는 쪽(여기)에 있고 구현은 장부의 주인인 {@code profile} 이 한다 (ADR-017,
 * {@code portfolio/app/PortfolioPhotoCleanup} 과 같은 형태). 간선은 {@code profile → reading.app} 한 방향이다.
 */
public interface ReadingRecordingCleanup {

    /**
     * 객체 삭제를 장부에 올린다. <b>자기 트랜잭션을 열지 않는다</b> — 행을 지우는 트랜잭션에 참여해야 "행은
     * 지워졌는데 장부에는 없는" 객체가 생기지 않는다.
     *
     * @return 장부의 id
     */
    UUID schedule(UUID userId, List<String> objectKeys, Instant now);

    /** 방금 올린 것을 커밋 뒤에 바로 한 번 시도한다. 어떤 실패도 밖으로 나가지 않는다. */
    void attempt(List<UUID> operationIds);
}
