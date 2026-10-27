package com.acttub.actingapi.feature.billing.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.BillingRepository.Payment;
import com.acttub.actingapi.feature.billing.app.BillingRepository.Subscription;
import com.acttub.actingapi.feature.billing.app.BillingRules.Status;
import com.acttub.actingapi.feature.billing.app.SubscriptionService.Charge;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 매월 자동결제(SOMA-818). 스케줄러가 {@link #runOnce()} 를 할 일이 없을 때까지 부른다. 한 번에 구독 하나를
 * {@code FOR UPDATE SKIP LOCKED} 로 점유하므로 서버가 둘 떠 있어도(무중단 배포) 같은 구독을 함께 결제하지 않고,
 * 점유가 풀리지 않은 채 죽어도 {@link #LEASE} 뒤에 다시 집힌다. 그때도 주문 ID 가 같아 두 번 결제되지 않는다.
 *
 * <ul>
 *   <li>active·기간 끝남 → 다음 기간 결제. 성공하면 기간을 넘기고, 거절되면 past_due(재시도 1회째)다.</li>
 *   <li>past_due·재시도 시각 → 다시 결제. {@link BillingRules#MAX_RETRIES} 번 더 실패하면 expired.</li>
 *   <li>canceled·기간 끝남 → expired(빌링키 삭제). 결제하지 않는다.</li>
 *   <li>결과를 모르는 결제 → 같은 주문 ID 로 다시 묻고, 성공이면 그 결제의 효과(첫 결제면 active, 자동결제면 다음 기간)를 낸다.</li>
 * </ul>
 */
public class RenewalWorker {
    private static final Logger LOG = LoggerFactory.getLogger(RenewalWorker.class);
    static final Duration LEASE = Duration.ofMinutes(5);
    /** 결과를 모르는 결제는 마지막으로 물은 뒤 이만큼 지나서 다시 묻는다. */
    static final Duration UNKNOWN_QUIET = Duration.ofMinutes(10);

    private final SubscriptionService service;
    private final BillingRepository repository;
    private final Clock clock;

    public RenewalWorker(SubscriptionService service, BillingRepository repository, Clock clock) {
        this.service = service;
        this.repository = repository;
        this.clock = clock;
    }

    /** 일 하나를 했으면 true. 결제 기능이 닫혀 있으면 아무것도 하지 않는다. */
    public boolean runOnce() {
        if (!service.webOpen()) {
            // 토스 자동결제는 웹 결제가 열려 있을 때만 돈다. 닫혀 있으면 결제 요청이 나가지 않는다.
            return false;
        }
        Instant now = clock.instant();
        Optional<UUID> due = repository.claimDue(now, LEASE);
        if (due.isPresent()) {
            try {
                process(due.get(), now);
            } finally {
                repository.release(due.get());
            }
            return true;
        }
        Optional<Payment> unknown = repository.claimUnknownPayment(now, UNKNOWN_QUIET, BillingRules.MAX_UNKNOWN_CHECKS);
        if (unknown.isPresent()) {
            reconcile(unknown.get(), now);
            return true;
        }
        return false;
    }

    void process(UUID subscriptionId, Instant now) {
        Optional<Subscription> found = repository.findById(subscriptionId);
        if (found.isEmpty()) {
            return;
        }
        Subscription sub = found.get();
        if (!sub.toss()) {
            // 스토어 구독은 스토어 알림이 갱신한다 — 스케줄러가 건드리지 않는다.
            return;
        }
        switch (sub.status()) {
            case CANCELED -> {
                if (sub.periodEnd() == null || !now.isBefore(sub.periodEnd())) {
                    repository.expire(sub.id(), now);
                }
            }
            case ACTIVE -> {
                if (sub.periodEnd() != null && !now.isBefore(sub.periodEnd())) {
                    Charge charge = service.renew(sub, now);
                    LOG.info("billing renewal subscription={} result={}", sub.id(), charge);
                }
            }
            case PAST_DUE -> {
                if (sub.nextRetryAt() == null || !now.isBefore(sub.nextRetryAt())) {
                    Charge charge = service.renew(sub, now);
                    LOG.info("billing retry subscription={} attempt={} result={}", sub.id(), sub.retryCount() + 1, charge);
                }
            }
            case EXPIRED -> { }
        }
    }

    void reconcile(Payment payment, Instant now) {
        Optional<Subscription> found = repository.findById(payment.subscriptionId());
        if (found.isEmpty()) {
            return;
        }
        Subscription sub = found.get();
        Charge charge = service.ask(sub, payment.orderId(), now);
        LOG.info("billing unknown payment rechecked order={} result={}", payment.orderId(), charge);
        if ("first".equals(payment.kind())) {
            if (charge == Charge.DONE && sub.status() == Status.EXPIRED) {
                repository.activate(sub.id(), payment.periodStart(), payment.periodEnd(), now);
            }
            return;
        }
        // 자동결제: 이 결제가 지금 기간의 다음 기간 것일 때만 효과를 낸다.
        if (payment.periodStart().equals(sub.periodEnd())) {
            service.applyRenewal(sub, charge, payment.periodStart(), payment.periodEnd(), now);
        }
    }
}
