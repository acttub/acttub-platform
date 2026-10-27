package com.acttub.actingapi.feature.challenge.app;

import java.time.Clock;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.stereotype.Service;

/**
 * 공개 참여작을 올라간 직후 뒤에서 검사한다 (SOMA-907). 참여작은 검사 전에도 보인다 — 검사는 공개를 막지 않고, 숨김
 * 판정만 참여작을 숨긴다.
 *
 * <p>한 번은 <b>집기(시도 수를 올려 커밋) · 판정 받기(모델) · 붙이기</b>다. 모델 호출은 트랜잭션 밖이다. 실패는 보고하고
 * 다음 주기에 다시 집히며, {@link ChallengeRules#MODERATION_MAX_ATTEMPTS} 번째 실패에서 운영 확인으로 닫는다.
 */
@Service
public class EntryModerationWorker {
    private final EntryModerationRepository moderations;
    private final EntryModerationModel model;
    private final FailureReporter failures;
    private final Clock clock;

    public EntryModerationWorker(EntryModerationRepository moderations, EntryModerationModel model, FailureReporter failures,
                                 Clock clock) {
        this.moderations = moderations; this.model = model; this.failures = failures; this.clock = clock;
    }

    /** @return 참여작을 집었으면 {@code true}(성공·실패와 무관). 할 일이 없거나 검사할 수 없는 기동이면 {@code false} */
    public boolean runOnce() {
        if (!model.available()) return false;
        var job = moderations.claim(ChallengeRules.MODERATION_MAX_ATTEMPTS, clock.instant());
        if (job == null) return false;
        try {
            var output = model.judge(job.video(), EntryModerationPrompt.instruction(job.line(), job.caption()));
            moderations.judged(job, EntryModerationParser.parse(output.text()), output.model(), clock.instant());
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("EntryModerationWorker.judge", job.entryId()));
            if (job.attempts() >= ChallengeRules.MODERATION_MAX_ATTEMPTS) moderations.fail(job, clock.instant());
        }
        return true;
    }
}
