package com.acttub.actingapi.feature.memory.adapter.db;

import java.time.Clock;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.ConversationClosedListener;
import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdates;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.stereotype.Component;

/**
 * 대화가 닫히면 그 회차를 확인 연습으로 세어 기억 갱신을 예약한다 (practice.memory).
 *
 * <p>{@code coach} 가 내는 알림({@link ConversationClosedListener})을 {@code memory} 가 받는 자리다 —
 * 간선은 {@code memory → coach/app} 한 방향 그대로다(ADR-019).
 *
 * <p><b>여기서 난 실패는 대화를 되돌리지 않는다.</b> 예약이 빠지면 다음 확인 연습에서 다시 기회가 온다.
 */
@Component
class ActorMemoryUpdateScheduling implements ConversationClosedListener {

    private final ActorMemoryUpdates updates;
    private final Clock clock;
    private final FailureReporter failureReporter;

    ActorMemoryUpdateScheduling(ActorMemoryUpdates updates, Clock clock, FailureReporter failureReporter) {
        this.updates = updates;
        this.clock = clock;
        this.failureReporter = failureReporter;
    }

    @Override
    public void onConversationClosed(UUID userId, UUID practiceId) {
        try {
            updates.schedule(userId, practiceId, clock.instant());
        } catch (RuntimeException failure) {
            failureReporter.report(
                    failure, new FailureContext("ActorMemoryUpdateScheduling.schedule", practiceId));
        }
    }
}
