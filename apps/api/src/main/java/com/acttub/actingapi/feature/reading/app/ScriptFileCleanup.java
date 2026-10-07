package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 지운 원본 파일의 객체를 정리 장부에 올린다 (reading.script 「원본 파일」 · account.withdraw). 녹음과 달리 기기가 서명한 주소로
 * 직접 올린 객체라, 주소가 살아 있는 동안 지우면 그 뒤에 다시 올린 객체가 장부 밖에 남는다 — 그래서 주소 시한 뒤에 지운다
 * (영상의 {@code VideoObjectCleanup} 과 같다). 구현은 장부의 주인인 {@code profile} 이 한다.
 */
public interface ScriptFileCleanup {

    /**
     * 객체 삭제를 장부에 올린다. <b>자기 트랜잭션을 열지 않는다.</b>
     *
     * @param notBefore 올리기 주소의 시한. 그 전에는 지우지 않는다
     * @return 장부의 id
     */
    UUID schedule(UUID userId, List<String> objectKeys, Instant now, Instant notBefore);

    /** 방금 올린 것을 커밋 뒤에 바로 한 번 시도한다(시한 전이면 집지 않는다). 어떤 실패도 밖으로 나가지 않는다. */
    void attempt(List<UUID> operationIds);
}
