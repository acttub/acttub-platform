package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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

/** 웹(토스) 연 구독(SOMA-1068) — 요금제별 첫 결제·자동결제와 BILLING_WEB_YEARLY_ENABLED 스위치. */
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
    final SubscriptionService yearlyOn = service(withWebYearly(base));
    final SubscriptionService yearlyOff = service(base);

    SubscriptionService service(BillingSettings settings) {
        return new SubscriptionService(settings, repository, gateway, cipher, clock, mails::add, RefundNotifier.NONE);
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
        assertThat(new BillingSettings(false, false, false, "", "", "", "").webYearlyUsable()).isFalse();
        assertThat(withWebYearly(base).webYearlyUsable()).isTrue();
        BillingSettings webClosed = withWebYearly(new BillingSettings(false, true, false, "https://dev.acttub.com",
                "https://acttub.com/pricing/result", CLIENT, SECRET));
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
    @DisplayName("연 구독 자동결제가 거절돼 past_due 가 된 뒤 자동으로 다시 결제해도 같은 금액·1년 기간이다")
    void yearlyRetryKeepsThePlan() {
        Subscription sub = subscribe(yearlyOn, "yearly");
        RenewalWorker worker = new RenewalWorker(yearlyOn, repository, clock);
        clock.set(sub.periodEnd().plusSeconds(60));
        gateway.nextFailures.push(FakeGateway.rejected());
        worker.runOnce();
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.PAST_DUE);

        clock.advance(BillingRules.RETRY_DELAY);
        worker.runOnce();
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

    /** 같은 설정에서 웹 연 구독 스위치만 켠 것. */
    private static BillingSettings withWebYearly(BillingSettings s) {
        return new BillingSettings(s.enabled(), s.appEnabled(), s.freeLimitsEnabled(), s.origin(), s.returnUrl(), s.clientKey(),
                s.secretKey(), s.legacySignupBefore(), s.legacyLimitsFrom(), true);
    }
}
