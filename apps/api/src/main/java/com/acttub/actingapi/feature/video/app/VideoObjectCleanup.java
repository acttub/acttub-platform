package com.acttub.actingapi.feature.video.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 지운 영상의 객체를 정리 장부에 올린다 (practice.library · account.withdraw).
 *
 * <p>영상 삭제·파일만 파기·만료된 미확정 업로드가 모두 여기를 거친다. 행을 지우거나 키를 잃는 트랜잭션이
 * <b>같은 트랜잭션에서</b> 장부({@code account_cleanup_operations}, 종류 {@code object_delete})에 남기고 커밋 뒤에
 * 시도한다 — 저장소가 실패해도 요청은 끝나고 장부가 성공할 때까지 다시 시도한다(CONTRACT §6-8).
 *
 * <p>선언은 쓰는 쪽(여기)에 있고 구현은 장부의 주인인 {@code profile} 이 한다 (ADR-017,
 * {@code reading/app/ReadingRecordingCleanup} 과 같은 형태).
 */
public interface VideoObjectCleanup {

    /**
     * 객체 삭제를 장부에 올린다. <b>자기 트랜잭션을 열지 않는다.</b>
     *
     * @param notBefore 올리기 주소가 아직 살아 있는 객체는 그 시한 뒤에 지운다 — 먼저 지우면 그 뒤에 올라온
     *        객체가 남는다
     * @return 장부의 id
     */
    UUID scheduleObjectDelete(UUID userId, List<String> objectKeys, Instant now, Instant notBefore);

    /** 방금 올린 것을 커밋 뒤에 바로 한 번 시도한다. 어떤 실패도 밖으로 나가지 않는다. */
    void attemptObjectDelete(List<UUID> operationIds);
}
