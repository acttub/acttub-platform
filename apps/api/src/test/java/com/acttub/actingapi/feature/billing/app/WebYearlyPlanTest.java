package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.BillingRepository.Payment;
import com.acttub.actingapi.feature.billing.app.BillingRepository.Subscription;
import com.acttub.actingapi.feature.billing.app.BillingRules.Plan;
import com.acttub.actingapi.feature.billing.app.BillingRules.Status;
import com.acttub.actingapi.feature.billing.app.SubscriptionService.Result;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 웹(토스) 연 구독(SOMA-1068) — 요금제별 첫 결제·자동결제·환불액과 BILLING_WEB_YEARLY_ENABLED 스위치. */
class WebYearlyPlanTest {
    static final String CLIENT = "test_ck_abcdefgh12345678";
    static final String SECRET = "test_sk_abcdefgh12345678";
    static final Instant T0 = Instant.parse("2026-10-23T01:00:00Z"); // 10월 23일 10시(KST)

    final MutableClock clock = new MutableClock(T0);
    final InMemoryBillingRepository repository = new InMemoryBillingRepository();
    final FakeGateway gateway = new FakeGateway();
    final BillingKeyCipher cipher = new BillingKeyCipher() {
        @Override
        public String seal(String billingKey) {
            return "sealed:" + billingKey;
        }

        @Override
        public String open(String sealed) {
            return sealed.substring("sealed:".length());
        }
    };
    final java.util.List<BillingMailer.PaidMail> mails = new java.util.ArrayList<>();
    final UUID user = UUID.randomUUID();

    final BillingSettings base = new BillingSettings(true, false, false, "https://dev.acttub.com",
            "https://acttub.com/pricing/result", CLIENT, SECRET);
    final SubscriptionService yearlyOn = service(base.withWebYearly(true));
    final SubscriptionService yearlyOff = service(base);

    SubscriptionService service(BillingSettings settings) {
        return new SubscriptionService(settings, repository, gateway, cipher, clock, mails::add);
    }

    private static String stateOf(SubscriptionService.StartedCheckout started) {
        return started.checkoutUrl().substring(started.checkoutUrl().lastIndexOf('/') + 1);
    }

    private Subscription subscribe(SubscriptionService service, String plan) {
        String state = stateOf(service.startCheckout(user, false, "subscribe", plan));
        String customerKey = service.page(state).orElseThrow().customerKey();
        assertThat(service.complete(state, customerKey, "auth_1")).isEqualTo(Result.DONE);
        return repository.find(user).orElseThrow();
    }

    // ── 체크아웃 ───────────────────────────────────────────────────

    @Test
    @DisplayName("plan 을 생략하면 지금과 같은 월 구독 — 3,900원·「ACTTUB Pro 월 구독」·한 달 기간")
    void omittedPlanIsMonthly() {
        Subscription sub = subscribe(yearlyOff, null);

        assertThat(sub.plan()).isEqualTo(Plan.MONTHLY);
        assertThat(sub.amount()).isEqualTo(3900L);
        assertThat(sub.periodEnd()).isEqualTo(Instant.parse("2026-11-23T01:00:00Z"));
        assertThat(gateway.amounts).containsExactly(3900L);
        assertThat(gateway.orderNames).containsExactly("ACTTUB Pro 월 구독");
        SubscriptionService.View view = yearlyOff.view(user);
        assertThat(view.plan()).isEqualTo("monthly");
        assertThat(view.amount()).isEqualTo(3900L);
    }

    @Test
    @DisplayName("plan=monthly 는 연 구독 스위치와 상관없이 월 구독이다")
    void explicitMonthly() {
        Subscription sub = subscribe(yearlyOn, "monthly");

        assertThat(sub.plan()).isEqualTo(Plan.MONTHLY);
        assertThat(gateway.amounts).containsExactly(3900L);
        assertThat(gateway.orderNames).containsExactly("ACTTUB Pro 월 구독");
        assertThat(sub.periodEnd()).isEqualTo(Instant.parse("2026-11-23T01:00:00Z"));
    }

    @Test
    @DisplayName("스위치가 켜져 있으면 plan=yearly 로 32,500원·「ACTTUB Pro 연 구독」을 결제하고 이용기간은 결제일부터 1년이다")
    void yearlyCheckout() {
        repository.emails.put(user, "actor@example.com");
        Subscription sub = subscribe(yearlyOn, "yearly");

        assertThat(sub.status()).isEqualTo(Status.ACTIVE);
        assertThat(sub.plan()).isEqualTo(Plan.YEARLY);
        assertThat(sub.amount()).isEqualTo(32500L);
        assertThat(sub.periodStart()).isEqualTo(T0);
        assertThat(sub.periodEnd()).isEqualTo(Instant.parse("2027-10-23T01:00:00Z"));
        assertThat(gateway.amounts).containsExactly(32500L);
        assertThat(gateway.orderNames).containsExactly("ACTTUB Pro 연 구독");
        Payment first = repository.payments.values().iterator().next();
        assertThat(first.amount()).isEqualTo(32500L);
        assertThat(first.kind()).isEqualTo("first");

        SubscriptionService.View view = yearlyOn.view(user);
        assertThat(view.plan()).isEqualTo("yearly");
        assertThat(view.amount()).isEqualTo(32500L);
        assertThat(view.nextBillingAt()).isEqualTo(Instant.parse("2027-10-23T01:00:00Z"));

        assertThat(mails).hasSize(1);
        assertThat(mails.get(0).plan()).isEqualTo(Plan.YEARLY);
        assertThat(mails.get(0).amount()).isEqualTo(32500L);
    }

    @Test
    @DisplayName("연 구독 첫 결제가 거절된 뒤 월 구독을 고르면 3,900원으로 결제한다 — 앞서 고른 요금제가 남지 않는다")
    void failedYearlyThenMonthly() {
        gateway.nextFailures.push(FakeGateway.rejected());
        String state = stateOf(yearlyOn.startCheckout(user, false, "subscribe", "yearly"));
        assertThat(yearlyOn.complete(state, yearlyOn.page(state).orElseThrow().customerKey(), "a")).isEqualTo(Result.FAILED);

        Subscription sub = subscribe(yearlyOn, "monthly");
        assertThat(sub.plan()).isEqualTo(Plan.MONTHLY);
        assertThat(sub.amount()).isEqualTo(3900L);
        assertThat(gateway.amounts).containsExactly(32500L, 3900L);
    }

    // ── 스위치 꺼짐 ─────────────────────────────────────────────────

    @Test
    @DisplayName("BILLING_WEB_YEARLY_ENABLED 는 기본 꺼짐이고, 웹 결제가 닫혀 있으면 켜도 연 구독은 열리지 않는다")
    void yearlySwitchDefaultsOff() {
        assertThat(base.webYearlyEnabled()).isFalse();
        assertThat(base.webYearlyUsable()).isFalse();
        assertThat(BillingSettings.disabled().webYearlyUsable()).isFalse();
        assertThat(base.withWebYearly(true).webYearlyUsable()).isTrue();
        BillingSettings webClosed = new BillingSettings(false, true, false, "https://dev.acttub.com",
                "https://acttub.com/pricing/result", CLIENT, SECRET).withWebYearly(true);
        assertThat(webClosed.webYearlyUsable()).isFalse();
    }

    @Test
    @DisplayName("스위치가 꺼져 있으면 yearly 창 요청은 422 plan_unavailable 이고 창도 결제도 생기지 않는다")
    void yearlyRejectedWhenSwitchOff() {
        assertThatThrownBy(() -> yearlyOff.startCheckout(user, false, "subscribe", "yearly"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.status()).isEqualTo(422);
                    assertThat(e.getMessage()).contains("plan_unavailable");
                });
        assertThatThrownBy(() -> yearlyOff.startCheckout(user, false, "change_card", "yearly"))
                .hasMessageContaining("plan_unavailable");
        assertThat(repository.checkouts).isEmpty();
        assertThat(gateway.idempotencyKeys).isEmpty();
    }

    @Test
    @DisplayName("모르는 요금제는 422 invalid_plan")
    void unknownPlanRejected() {
        assertThatThrownBy(() -> yearlyOn.startCheckout(user, false, "subscribe", "weekly"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.status()).isEqualTo(422);
                    assertThat(e.getMessage()).contains("invalid_plan");
                });
    }

    @Test
    @DisplayName("연 구독 창을 연 뒤 스위치가 꺼지면 콜백은 카드를 등록하지 않고 결제하지 않는다")
    void yearlyWindowClosedAfterSwitchOff() {
        String state = stateOf(yearlyOn.startCheckout(user, false, "subscribe", "yearly"));
        String customerKey = yearlyOn.page(state).orElseThrow().customerKey();

        assertThat(yearlyOff.complete(state, customerKey, "auth_1")).isEqualTo(Result.FAILED);
        assertThat(gateway.issued).isZero();
        assertThat(gateway.idempotencyKeys).isEmpty();
        assertThat(repository.find(user)).isEmpty();
    }

    // ── 자동결제 ───────────────────────────────────────────────────

    @Test
    @DisplayName("연 구독 자동결제는 32,500원·「ACTTUB Pro 연 구독」으로 청구하고 기간을 1년 연장한다 — 스위치를 꺼도 기존 연 구독은 갱신된다")
    void yearlyRenewal() {
        Subscription sub = subscribe(yearlyOn, "yearly");
        RenewalWorker worker = new RenewalWorker(yearlyOff, repository, clock);

        clock.set(sub.periodEnd().minusSeconds(1));
        assertThat(worker.runOnce()).isFalse();

        clock.set(sub.periodEnd().plusSeconds(60));
        assertThat(worker.runOnce()).isTrue();

        Subscription renewed = repository.find(user).orElseThrow();
        assertThat(renewed.status()).isEqualTo(Status.ACTIVE);
        assertThat(renewed.plan()).isEqualTo(Plan.YEARLY);
        assertThat(renewed.periodStart()).isEqualTo(Instant.parse("2027-10-23T01:00:00Z"));
        assertThat(renewed.periodEnd()).isEqualTo(Instant.parse("2028-10-23T01:00:00Z"));
        assertThat(gateway.amounts).containsExactly(32500L, 32500L);
        assertThat(gateway.orderNames).containsExactly("ACTTUB Pro 연 구독", "ACTTUB Pro 연 구독");
        Payment renewal = repository.payments.values().stream().filter(p -> "renewal".equals(p.kind())).findFirst().orElseThrow();
        assertThat(renewal.amount()).isEqualTo(32500L);
        assertThat(renewal.periodStart()).isEqualTo(Instant.parse("2027-10-23T01:00:00Z"));
        assertThat(renewal.periodEnd()).isEqualTo(Instant.parse("2028-10-23T01:00:00Z"));
    }

    @Test
    @DisplayName("연 구독 자동결제가 거절돼 past_due 가 된 뒤 다시 시도해도 같은 금액·1년 기간이다")
    void yearlyRetryKeepsThePlan() {
        Subscription sub = subscribe(yearlyOn, "yearly");
        RenewalWorker worker = new RenewalWorker(yearlyOn, repository, clock);
        clock.set(sub.periodEnd().plusSeconds(60));
        gateway.nextFailures.push(FakeGateway.rejected());
        worker.runOnce();
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.PAST_DUE);

        yearlyOn.retry(user);
        Subscription after = repository.find(user).orElseThrow();
        assertThat(after.status()).isEqualTo(Status.ACTIVE);
        assertThat(after.periodEnd()).isEqualTo(Instant.parse("2028-10-23T01:00:00Z"));
        assertThat(gateway.amounts).containsExactly(32500L, 32500L, 32500L);
    }

    @Test
    @DisplayName("월 구독 자동결제는 지금과 같다 — 3,900원·「ACTTUB Pro 월 구독」·한 달 연장")
    void monthlyRenewalUnchanged() {
        Subscription sub = subscribe(yearlyOn, null);
        RenewalWorker worker = new RenewalWorker(yearlyOn, repository, clock);
        clock.set(sub.periodEnd().plusSeconds(60));
        assertThat(worker.runOnce()).isTrue();

        Subscription renewed = repository.find(user).orElseThrow();
        assertThat(renewed.periodEnd()).isEqualTo(Instant.parse("2026-12-23T01:00:00Z"));
        assertThat(gateway.amounts).containsExactly(3900L, 3900L);
        assertThat(gateway.orderNames).containsExactly("ACTTUB Pro 월 구독", "ACTTUB Pro 월 구독");
    }

    @Test
    @DisplayName("연 구독을 해지해도 1년 기간이 끝날 때까지 Pro 이고, 끝나면 결제 없이 expired")
    void yearlyCancelKeepsTheYear() {
        Subscription sub = subscribe(yearlyOn, "yearly");
        RenewalWorker worker = new RenewalWorker(yearlyOn, repository, clock);
        assertThat(yearlyOn.cancel(user).status()).isEqualTo("canceled");

        clock.set(Instant.parse("2027-10-23T00:59:59Z"));
        assertThat(yearlyOn.pro(user)).isTrue();
        clock.set(sub.periodEnd());
        assertThat(worker.runOnce()).isTrue();
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.EXPIRED);
        assertThat(gateway.amounts).containsExactly(32500L);
    }

    @Test
    @DisplayName("연 기간은 한국 시간 같은 날의 다음 해 — 2월 29일은 다음 해 2월 28일")
    void yearlyPeriodEnd() {
        assertThat(Plan.YEARLY.nextPeriodEnd(Instant.parse("2026-10-23T01:00:00Z")))
                .isEqualTo(Instant.parse("2027-10-23T01:00:00Z"));
        assertThat(Plan.YEARLY.nextPeriodEnd(Instant.parse("2028-02-29T03:00:00Z")))
                .isEqualTo(Instant.parse("2029-02-28T03:00:00Z"));
        assertThat(Plan.MONTHLY.nextPeriodEnd(Instant.parse("2027-01-31T03:00:00Z")))
                .isEqualTo(Instant.parse("2027-02-28T03:00:00Z"));
    }

    // ── 환불액(약관 제14조) ─────────────────────────────────────────

    static final Instant START = Instant.parse("2026-11-08T01:00:00Z");
    static final Instant YEAR_END = Plan.YEARLY.nextPeriodEnd(START); // 365일
    static final Instant MONTH_START = Instant.parse("2026-11-23T01:00:00Z");
    static final Instant MONTH_END = Plan.MONTHLY.nextPeriodEnd(MONTH_START); // 30일

    @Test
    @DisplayName("환불 — 7일 이내이고 안 썼으면 연 구독도 전액")
    void yearlyRefundFullWithinSevenDays() {
        assertThat(Duration.between(START, YEAR_END).toDays()).isEqualTo(365);
        assertThat(BillingRules.refundAmount(32500, START, YEAR_END, START.plus(Duration.ofDays(3)), false)).isEqualTo(32500);
        assertThat(BillingRules.refundAmount(32500, START, YEAR_END, START.plus(Duration.ofDays(7)), false)).isEqualTo(32500);
    }

    @Test
    @DisplayName("환불 — 7일 이내에 썼으면 이용 일수만큼(결제금액 ÷ 365일 × 일수) 빼고, 1원 미만은 올린다")
    void yearlyRefundUsedWithinSevenDays() {
        // 32,500 × 362 / 365 = 32,232.87… → 32,233
        assertThat(BillingRules.refundAmount(32500, START, YEAR_END, START.plus(Duration.ofDays(3)), true)).isEqualTo(32233);
        // 1시간도 1일이다: 32,500 × 364 / 365 = 32,410.95… → 32,411
        assertThat(BillingRules.refundAmount(32500, START, YEAR_END, START.plus(Duration.ofHours(1)), true)).isEqualTo(32411);
    }

    @Test
    @DisplayName("환불 — 7일이 지나면 쓰지 않았어도 이용 일수만큼 빼고 남은 금액의 10%를 더 뺀다")
    void yearlyRefundAfterSevenDays() {
        // 30일 1시간 → 31일 사용, 남은 334일: 32,500 × 334 / 365 × 0.9 = 26,765.75… → 26,766
        assertThat(BillingRules.refundAmount(32500, START, YEAR_END, START.plus(Duration.ofDays(30).plusHours(1)), false))
                .isEqualTo(26766);
        // 7일 1초 → 8일 사용, 남은 357일: 32,500 × 357 / 365 × 0.9 = 28,608.90… → 28,609
        assertThat(BillingRules.refundAmount(32500, START, YEAR_END, START.plus(Duration.ofDays(7).plusSeconds(1)), true))
                .isEqualTo(28609);
    }

    @Test
    @DisplayName("환불 — 윤년이 낀 연 기간은 366일로 나눈다")
    void yearlyRefundLeapYear() {
        Instant start = Instant.parse("2027-03-01T01:00:00Z");
        Instant end = Plan.YEARLY.nextPeriodEnd(start);
        assertThat(Duration.between(start, end).toDays()).isEqualTo(366);
        // 100일 사용, 남은 266일: 32,500 × 266 / 366 × 0.9 = 21,258.19… → 21,259
        assertThat(BillingRules.refundAmount(32500, start, end, start.plus(Duration.ofDays(100)), true)).isEqualTo(21259);
    }

    @Test
    @DisplayName("환불 — 월 구독도 같은 규칙(그 달의 일수로 나눔)이고 기간이 끝났으면 0원")
    void monthlyRefundSameRule() {
        assertThat(Duration.between(MONTH_START, MONTH_END).toDays()).isEqualTo(30);
        assertThat(BillingRules.refundAmount(3900, MONTH_START, MONTH_END, MONTH_START.plus(Duration.ofDays(2)), false))
                .isEqualTo(3900);
        // 1시간 → 1일: 3,900 × 29 / 30 = 3,770
        assertThat(BillingRules.refundAmount(3900, MONTH_START, MONTH_END, MONTH_START.plus(Duration.ofHours(1)), true))
                .isEqualTo(3770);
        // 10일: 3,900 × 20 / 30 × 0.9 = 2,340
        assertThat(BillingRules.refundAmount(3900, MONTH_START, MONTH_END, MONTH_START.plus(Duration.ofDays(10)), false))
                .isEqualTo(2340);
        assertThat(BillingRules.refundAmount(3900, MONTH_START, MONTH_END, MONTH_END.plusSeconds(1), true)).isZero();
    }
}
