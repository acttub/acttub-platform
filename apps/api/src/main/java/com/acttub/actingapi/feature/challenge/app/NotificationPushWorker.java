package com.acttub.actingapi.feature.challenge.app;

import java.time.Clock;
import java.time.Instant;
import com.acttub.actingapi.feature.push.app.PushMessage;
import com.acttub.actingapi.feature.push.app.PushSender;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.stereotype.Service;

/**
 * 챌린지 알림의 푸시 발송 (challenge.notification). 원래 행동과 알림함 기록이 커밋된 뒤 따로 돈다 — 때가 된 묶음을
 * 선점해 상태를 확정하고, 그 커밋 뒤에 한 번 보낸다. 실패해도 원래 행동은 이미 성공이고 운영에 보고만 한다.
 */
@Service
public class NotificationPushWorker {
    static final int GROUPS_PER_RUN = 100;
    private final NotificationRepository notifications;
    private final PushSender sender;
    private final Clock clock;
    private final FailureReporter failures;

    public NotificationPushWorker(NotificationRepository notifications, PushSender sender, Clock clock, FailureReporter failures) {
        this.notifications = notifications; this.sender = sender; this.clock = clock; this.failures = failures;
    }

    public int runOnce() { return runOnce(clock.instant()); }

    /** @return 보낸 메시지 수 */
    public int runOnce(Instant now) {
        var outgoing = notifications.dispatch(now, GROUPS_PER_RUN);
        if (outgoing.isEmpty()) return 0;
        try {
            var gone = sender.send(outgoing.stream().map(item -> new PushMessage(item.token(), "액트텁", item.body(), item.data())).toList());
            notifications.forgetTokens(gone);
        } catch (RuntimeException failure) {
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("NotificationPushWorker.send"));
        }
        return outgoing.size();
    }
}
