package com.acttub.actingapi.feature.challenge.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.domain.ChallengeReportRules;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.stereotype.Service;

/**
 * 챌린지 AI 리포트를 뒤에서 만든다 ({@code ai_jobs} 종류 {@code challenge_report}, challenge.ai-report).
 *
 * <p>한 생성 안에서 자동 재시도와 금지 어휘 재생성을 합쳐 최대 3번 실행한다 — 실행마다 장부의 시도 수가 하나 오르고,
 * 세 번째 실행이 실패하면 작업과 리포트를 failed 로 닫는다. 그 뒤 "다시 시도"는 새 생성이다.
 */
@Service
public class ChallengeReportWorker {
    static final String KIND = com.acttub.actingapi.platform.schema.AiJobKind.CHALLENGE_REPORT.dbValue();
    static final Duration LEASE = Duration.ofMinutes(10);
    private final AiJobLedger ledger;
    private final AiReportRepository reports;
    private final ChallengeReportModel model;
    private final Clock clock;
    private final FailureReporter failures;

    public ChallengeReportWorker(AiJobLedger ledger, AiReportRepository reports, ChallengeReportModel model, Clock clock,
                                 FailureReporter failures) {
        this.ledger = ledger; this.reports = reports; this.model = model; this.clock = clock; this.failures = failures;
    }

    public boolean runOnce() { return runOnce(clock.instant()); }

    /** 큐에서 하나 집어 처리한다. 집을 게 없으면 거짓. */
    public boolean runOnce(Instant now) {
        UUID token = UUID.randomUUID();
        AiJobLedger.Claimed claimed = ledger.claimNext(KIND, token, LEASE, now);
        if (claimed == null) return false;
        try {
            var material = reports.material(claimed.id(), claimed.targetId());
            if (material == null) {
                // 참여작이 지워졌거나 계정이 닫혔다 — 만들 것이 없다.
                ledger.fail(claimed.id(), token, "cancelled", now);
                return true;
            }
            var labels = new LinkedHashMap<String, UUID>();
            var samples = new ArrayList<ChallengeReportModel.Labeled>();
            for (var sample : material.samples()) {
                String label = "S" + (samples.size() + 1);
                labels.put(label, sample.entryId());
                samples.add(new ChallengeReportModel.Labeled(label, sample.video()));
            }
            boolean compare = samples.size() >= ChallengeReportRules.MIN_SAMPLES;
            var output = model.generate(material.mine(), compare ? samples : java.util.List.of(),
                    ChallengeReportPrompt.instruction(material.line(), compare ? samples.size() : 0));
            var result = ChallengeReportParser.parse(output.text(), compare ? labels : new LinkedHashMap<>());
            reports.complete(claimed.id(), token, claimed.targetId(), result, output.model(), clock.instant());
        } catch (LeaseOwnershipException lost) {
            failures.report(lost, new FailureContext("ChallengeReportWorker.complete", claimed.id()));
        } catch (RuntimeException failure) {
            String reason = failure instanceof ChallengeReportParser.Rejected rejected ? rejected.reason() : "model_failed";
            // 모델 호출 실패와 쓸 수 없는 출력(모양·금지 어휘)은 모두 바깥 의존의 실패다.
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("ChallengeReportWorker.run", claimed.id()));
            try {
                reports.attemptFailed(claimed.id(), token, claimed.targetId(), claimed.attemptCount(),
                        claimed.attemptCount() >= ChallengeReportRules.MAX_RUNS, reason, clock.instant());
            } catch (LeaseOwnershipException lostWhileFailing) {
                failures.report(lostWhileFailing, new FailureContext("ChallengeReportWorker.release", claimed.id()));
            }
        }
        return true;
    }
}
