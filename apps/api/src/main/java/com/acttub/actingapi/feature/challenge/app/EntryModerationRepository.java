package com.acttub.actingapi.feature.challenge.app;

import java.time.Instant;
import java.util.UUID;

/** 공개 참여작 AI 검사의 장부 (SOMA-907). 집기·판정 붙이기·실패 닫기는 각자 짧은 트랜잭션이다. */
public interface EntryModerationRepository {
    /**
     * 검사 차례인 참여작 하나를 오래된 순으로 집어 시도 수를 올려 커밋한다. 상한에 닿은 채 남은 것(시도 도중 프로세스가
     * 죽었다)은 먼저 실패로 닫는다.
     *
     * @return 없으면 {@code null}
     */
    Job claim(int maxAttempts, Instant now);

    /** 판정을 붙인다. 그 사이 참여작이 바뀌었거나(캡션·삭제) 다른 시도가 앞섰으면 아무것도 하지 않는다. */
    void judged(Job job, EntryModerationVerdict verdict, String model, Instant now);

    /** 마지막 시도까지 실패했다 — 영상은 보이게 두고 운영 확인으로 올린다. */
    void fail(Job job, Instant now);

    record Job(UUID entryId, int attempts, int contentVersion, AiReportRepository.Video video, String line, String caption) { }
}
