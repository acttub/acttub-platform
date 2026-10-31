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
 * 하루 조회 요약 푸시(SOMA-958). 저녁에 한 번, 지난 24시간에 내 참여작을 본 사람 수를 "오늘 내 연기를 N명이 봤어요"로 알린다.
 * 알림함 행은 만들지 않는다 — 지금 스토어 앱은 모르는 알림 종류를 엉뚱한 문구로 보이기 때문이다. 선점(같은 날 한 번)이
 * 커밋된 뒤 보내고, 실패해도 운영에 보고만 한다.
 */
@Service
public class EntryViewDigestWorker {
    static final int RECIPIENTS_PER_RUN = 5_000;
    private final NotificationRepository notifications;
    private final PushSender sender;
    private final Clock clock;
    private final FailureReporter failures;

    public EntryViewDigestWorker(NotificationRepository notifications, PushSender sender, Clock clock, FailureReporter failures) {
        this.notifications = notifications; this.sender = sender; this.clock = clock; this.failures = failures;
    }

    public int runOnce() { return runOnce(clock.instant()); }

    /** @return 보낸 메시지 수 */
    public int runOnce(Instant now) {
        var outgoing = notifications.viewDigest(now, RECIPIENTS_PER_RUN);
        if (outgoing.isEmpty()) return 0;
        try {
            var gone = sender.send(outgoing.stream().map(item -> new PushMessage(item.token(), item.title(), item.body(), item.data())).toList());
            notifications.forgetTokens(gone);
        } catch (RuntimeException failure) {
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("EntryViewDigestWorker.send"));
        }
        return outgoing.size();
    }
}
