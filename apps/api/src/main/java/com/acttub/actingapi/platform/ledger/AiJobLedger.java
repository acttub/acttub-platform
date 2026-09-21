package com.acttub.actingapi.platform.ledger;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * 비동기 AI 요청의 장부({@code ai_jobs}, V14) — 종류는 {@code analyze}·{@code memory_update} 둘이다
 * (practice.analyze, practice.memory). 리딩·설문 전송·정리 장부는 AI 요청이 아니라 여기 들지 않는다.
 *
 * <p><b>lease 규칙은 {@code external_operations} 와 같다</b>(CONTRACT §5-7, 고정 계약):
 *
 * <ul>
 *   <li>lease 가 만료됐어도 <b>다른 워커가 재선점하기 전이면 완료를 받는다</b>.</li>
 *   <li>토큰이 이미 바뀌었으면 완료를 거절하고 전체를 되돌린다({@link LeaseOwnershipException}).</li>
 *   <li>{@code release}(일시적 사유)는 {@code attempt_count} 를 <b>되돌리지 않는다</b>.</li>
 *   <li>timeout·parse·unsupported 는 즉시 실패, 그 밖의 바깥 실패는 재큐이고 <b>3회</b> 뒤 sweep 이 닫는다.</li>
 * </ul>
 *
 * <p>이 장부가 옛 원장과 다른 점은 범위다 — 코치 시작·답·리포트의 <b>완료 응답 재생</b>은 재전송 호환이 끝날
 * 때까지 {@code external_operations} 에 남는다(02-practice 「1.0.0 스키마 전환」).
 */
public interface AiJobLedger {

    /** 최대 시도 횟수. 소진하면 sweep 이 실패로 닫는다. */
    int MAX_ATTEMPTS = 3;

    /**
     * 대기 중인 작업 하나를 선점한다. 집을 게 없으면 {@code null}.
     *
     * @param kind {@code analyze}·{@code memory_update}
     */
    Claimed claimNext(String kind, UUID leaseToken, Duration lease, Instant now);

    /**
     * @param targetId 분석은 회차 id, 기억 갱신은 그 갱신을 부른 회차 id
     * @param memoryEpoch 기억 갱신이 예약한 시점의 세대. 분석이면 {@code null}
     */
    record Claimed(UUID id, UUID userId, UUID targetId, int attemptCount, Integer memoryEpoch) {
    }

    /**
     * 성공으로 닫는다.
     *
     * @return 그런 작업이 없으면 거짓
     * @throws LeaseOwnershipException 다른 워커가 이미 재선점했다
     */
    boolean succeed(UUID jobId, UUID leaseToken, Instant now);

    /**
     * 실패로 닫는다 — 되돌아오지 않는다.
     *
     * @param reason 실패 분류(timeout·parse·unsupported·cancelled·account_deactivated 등)
     * @throws LeaseOwnershipException 다른 워커가 이미 재선점했다
     */
    boolean fail(UUID jobId, UUID leaseToken, String reason, Instant now);

    /**
     * 선점을 놓아 다시 대기로 돌린다. <b>시도 횟수는 그대로다</b> — 되돌리면 같은 작업이 영원히 돈다.
     *
     * @throws LeaseOwnershipException 다른 워커가 이미 재선점했다
     */
    void release(UUID jobId, UUID leaseToken, String reason, Instant now);

    /**
     * 시도 횟수를 소진한 작업을 실패로 쓸어 담는다.
     *
     * @return 쓸어 담은 수
     */
    int sweepMaxAttempts(Instant now);
}
