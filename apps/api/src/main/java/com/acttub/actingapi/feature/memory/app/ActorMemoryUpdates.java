package com.acttub.actingapi.feature.memory.app;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 기억 갱신 작업({@code ai_jobs}, 종류 {@code memory_update})이 쓰는 저장소 (practice.memory).
 *
 * <p><b>바깥 호출(LLM)은 이 포트 밖이다</b>(CONTRACT §5-4). 워커가 {@link #claim} 으로 하나 집고, 재료를 읽어
 * 모델을 부른 다음, {@link #complete} 한 트랜잭션 안에서 세대와 계정 상태를 다시 보고 쓴다.
 *
 * <p>예약은 {@link #schedule} 하나다 — 같은 회차로 두 번 들어와도 작업은 하나다({@code (user_id, request_id)}
 * 유일이고 요청 id 를 회차에서 만든다).
 */
public interface ActorMemoryUpdates {

    /**
     * 그 회차가 확인 연습으로 세어 갱신할 때가 됐으면 작업을 예약한다.
     *
     * <p>세는 것은 <b>노트가 남은 회차</b>다 — 기존 갈래의 analysis·expression 과 신형의 action·observation
     * 이고 {@code record_only} 는 세지 않는다(practice.memory 규칙). 첫 회차와 그 뒤 3의 배수(1·3·6·9…)에만
     * 예약한다.
     *
     * @return 이번에 작업을 만들었으면 참. 때가 아니거나 이미 있으면 거짓
     */
    boolean schedule(UUID userId, UUID practiceId, Instant now);

    /** 대기 중인 갱신 하나를 선점한다. 집을 게 없으면 {@code null}. */
    Claimed claim(UUID leaseToken, Duration lease, Instant now);

    /**
     * @param memoryEpoch 예약한 시점의 기억 세대. 완료 때 사용자의 세대와 다르면 반영하지 않는다
     */
    record Claimed(UUID jobId, UUID userId, UUID practiceId, Integer memoryEpoch) {
    }

    /** 모델에 넘길 연습 한 회차치 재료. 회차가 없거나 숨겨졌으면 {@code null}. */
    MemoryUpdateMaterial material(UUID practiceId);

    /** 지금 채워져 있는 칸들 — 모델이 "새로 알게 된 것"만 적게 하는 입력이다. */
    Map<String, String> current(UUID userId);

    /**
     * 갱신을 저장하고 작업을 닫는다. <b>한 트랜잭션이다.</b>
     *
     * <p>사용자 행을 잡고 계정 상태와 기억 세대를 다시 본다. 탈퇴했으면 {@code account_deactivated},
     * 세대가 다르면 {@code memory_epoch_stale} 로 작업만 닫고 <b>아무것도 쓰지 않는다</b>. 배우가 손댄 칸도
     * 건너뛴다.
     *
     * @return 실제로 쓴 칸 이름. 원장 응답은 모델이 낸 순서를 보존한다
     */
    List<String> complete(Claimed claimed, UUID leaseToken, Map<String, String> updates, Instant now);

    /**
     * 선점을 놓아 다시 대기로 돌린다 — 재시도 규칙은 분석과 같다(CONTRACT §5-7). <b>시도 횟수는 그대로다</b>
     * 이고 소진하면 분석 워커의 sweep 이 같은 장부에서 닫는다.
     *
     * <p><b>회차 상태는 건드리지 않는다</b> — 기억이 없다고 연습이 망가질 것은 아니다.
     */
    void release(UUID jobId, UUID leaseToken, String reason, Instant now);
}
