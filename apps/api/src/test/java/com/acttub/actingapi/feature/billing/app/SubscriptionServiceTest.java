package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.BillingRepository.Subscription;
import com.acttub.actingapi.feature.billing.app.BillingRules.Status;
import com.acttub.actingapi.feature.billing.app.SubscriptionService.Result;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class SubscriptionServiceTest {
    static final String CLIENT = "test_ck_abcdefgh12345678";
    static final String SECRET = "test_sk_abcdefgh12345678";
    static final Instant T0 = Instant.parse("2026-10-23T01:00:00Z"); // 10월 23일 10시(KST)

    final MutableClock clock = new MutableClock(T0);
    final InMemoryBillingRepository repository = new InMemoryBillingRepository();
    final FakeGateway gateway = new FakeGateway();
    final BillingKeyCipher cipher = new BillingKeyCipher() {
        @Override
        public String seal(String billingKey) {
            return "sealed:" + new StringBuilder(billingKey).reverse();
        }

        @Override
        public String open(String sealed) {
            return new StringBuilder(sealed.substring("sealed:".length())).reverse().toString();
        }
    };
    final UUID user = UUID.randomUUID();

    SubscriptionService service(boolean enabled, boolean limits) {
        return new SubscriptionService(new BillingSettings(enabled, limits, "https://dev.acttub.com",
                "actingapp://billing-result", CLIENT, SECRET), repository, gateway, cipher, clock);
    }

    final SubscriptionService service = service(true, false);
    final RenewalWorker worker = new RenewalWorker(service, repository, clock);

    private String stateOf(SubscriptionService.StartedCheckout started) {
        return started.checkoutUrl().substring(started.checkoutUrl().lastIndexOf('/') + 1);
    }

    private Subscription subscribe() {
        String state = stateOf(service.startCheckout(user, false, "subscribe"));
        String customerKey = service.page(state).orElseThrow().customerKey();
        assertThat(service.complete(state, customerKey, "auth_1")).isEqualTo(Result.DONE);
        return repository.find(user).orElseThrow();
    }

    @Test
    @DisplayName("꺼져 있으면 404 billing_unavailable 이고 아무도 Pro 가 아니며 무료 한도도 걸리지 않는다")
    void closedWhenDisabled() {
        SubscriptionService off = service(false, true);
        assertThatThrownBy(() -> off.view(user)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("billing_unavailable"));
        assertThat(off.pro(user)).isFalse();
        assertThat(off.settings().limitsEnforced()).isFalse();
    }

    @Test
    @DisplayName("라이브 키로는 열리지 않는다")
    void liveKeysStayClosed() {
        BillingSettings live = new BillingSettings(true, false, "https://acttub.com", "actingapp://billing-result",
                "live_ck_abcdefgh12345678", "live_sk_abcdefgh12345678");
        assertThat(live.usable()).isFalse();
        assertThat(live.toString()).doesNotContain("live_sk");
    }

    @Test
    @DisplayName("카드 등록 → 빌링키(암호문) → 3,900원 첫 결제 → active, 다음 결제일은 한 달 뒤")
    void firstSubscription() {
        Subscription sub = subscribe();

        assertThat(sub.status()).isEqualTo(Status.ACTIVE);
        assertThat(sub.sealedBillingKey()).startsWith("sealed:").doesNotContain("bk_secret_1");
        assertThat(sub.periodEnd()).isEqualTo(Instant.parse("2026-11-23T01:00:00Z"));
        assertThat(gateway.approvedOrders).hasSize(1);
        assertThat(gateway.idempotencyKeys).containsExactlyElementsOf(gateway.approvedOrders);
        SubscriptionService.View view = service.view(user);
        assertThat(view.status()).isEqualTo("active");
        assertThat(view.pro()).isTrue();
        assertThat(view.cardLast4()).isEqualTo("123*");
        assertThat(view.nextBillingAt()).isEqualTo(sub.periodEnd());
    }

    @Test
    @DisplayName("같은 콜백이 두 번 와도 한 번만 결제한다 — 창은 한 번만 집힌다")
    void callbackIsSingleUse() {
        String state = stateOf(service.startCheckout(user, false, "subscribe"));
        String customerKey = service.page(state).orElseThrow().customerKey();

        assertThat(service.complete(state, customerKey, "auth_1")).isEqualTo(Result.DONE);
        assertThat(service.complete(state, customerKey, "auth_1")).isEqualTo(Result.INVALID);
        assertThat(service.page(state)).isEmpty();
        assertThat(gateway.approvedOrders).hasSize(1);
    }

    @Test
    @DisplayName("이미 Pro 이면 새 구독 창을 열지 않고, 게스트는 결제할 수 없다")
    void startGuards() {
        subscribe();
        assertThatThrownBy(() -> service.startCheckout(user, false, "subscribe"))
                .hasMessageContaining("already_subscribed");
        assertThatThrownBy(() -> service.startCheckout(UUID.randomUUID(), true, "subscribe"))
                .hasMessageContaining("billing_member_required");
        assertThatThrownBy(() -> service.startCheckout(UUID.randomUUID(), false, "change_card"))
                .hasMessageContaining("no_subscription");
        assertThatThrownBy(() -> service.startCheckout(UUID.randomUUID(), false, "refund"))
                .hasMessageContaining("invalid_purpose");
        assertThatThrownBy(() -> service.cancel(UUID.randomUUID())).hasMessageContaining("no_subscription");
    }

    @Test
    @DisplayName("첫 결제가 거절되면 Pro 가 아니고 다시 창을 열 수 있다. 결과를 모르면 새 구독 결제를 막는다")
    void firstPaymentFailures() {
        gateway.nextFailures.push(FakeGateway.rejected());
        String state = stateOf(service.startCheckout(user, false, "subscribe"));
        assertThat(service.complete(state, service.page(state).orElseThrow().customerKey(), "a")).isEqualTo(Result.FAILED);
        assertThat(service.pro(user)).isFalse();
        assertThat(service.view(user).status()).isEqualTo("none");

        gateway.nextFailures.push(FakeGateway.unknown());
        String second = stateOf(service.startCheckout(user, false, "subscribe"));
        assertThat(service.complete(second, service.page(second).orElseThrow().customerKey(), "b")).isEqualTo(Result.UNKNOWN);
        assertThatThrownBy(() -> service.startCheckout(user, false, "subscribe")).hasMessageContaining("payment_pending");

        // 스케줄러가 같은 주문 ID 로 다시 물어 성공을 확인하면 그때 active 가 된다.
        clock.advance(Duration.ofMinutes(15));
        assertThat(worker.runOnce()).isTrue();
        assertThat(service.view(user).status()).isEqualTo("active");
        String firstOrder = repository.payments.values().stream().filter(p -> "done".equals(p.status())).findFirst()
                .orElseThrow().orderId();
        assertThat(gateway.idempotencyKeys).filteredOn(firstOrder::equals).hasSize(2);
        assertThat(gateway.approvedOrders).containsExactly(firstOrder);
    }

    @Test
    @DisplayName("카드 등록 자체가 실패하면 승인을 시도하지 않는다")
    void issueFailureNeverCharges() {
        gateway.issueFailure = FakeGateway.rejected();
        String state = stateOf(service.startCheckout(user, false, "subscribe"));
        assertThat(service.complete(state, service.page(state).orElseThrow().customerKey(), "a")).isEqualTo(Result.FAILED);
        assertThat(gateway.idempotencyKeys).isEmpty();
        assertThat(repository.payments).isEmpty();
    }

    @Test
    @DisplayName("customerKey 가 창과 다르면 등록하지 않는다")
    void customerKeyMustMatch() {
        String state = stateOf(service.startCheckout(user, false, "subscribe"));
        assertThat(service.complete(state, "someone_else", "a")).isEqualTo(Result.FAILED);
        assertThat(gateway.issued).isZero();
    }

    @Test
    @DisplayName("토스 실패 콜백 — 사용자가 닫으면 canceled, 그 밖은 failed")
    void failCallback() {
        String state = stateOf(service.startCheckout(user, false, "subscribe"));
        assertThat(service.fail(state, "PAY_PROCESS_CANCELED")).isEqualTo(Result.CANCELED);
        assertThat(service.fail(state, "PAY_PROCESS_CANCELED")).isEqualTo(Result.INVALID);
        String other = stateOf(service.startCheckout(user, false, "subscribe"));
        assertThat(service.fail(other, "<script>")).isEqualTo(Result.FAILED);
    }

    @Test
    @DisplayName("만료된 창은 열리지 않는다")
    void expiredCheckout() {
        String state = stateOf(service.startCheckout(user, false, "subscribe"));
        clock.advance(BillingRules.CHECKOUT_TTL.plusSeconds(1));
        assertThat(service.page(state)).isEmpty();
        assertThat(service.complete(state, "x", "a")).isEqualTo(Result.INVALID);
    }

    @Test
    @DisplayName("자동결제 해지 — 이번 기간 끝까지 Pro, 기간이 끝나면 결제 없이 expired 이고 빌링키를 지운다")
    void cancelKeepsPeriod() {
        Subscription sub = subscribe();
        SubscriptionService.View canceled = service.cancel(user);
        assertThat(canceled.status()).isEqualTo("canceled");
        assertThat(canceled.pro()).isTrue();
        assertThat(canceled.nextBillingAt()).isNull();
        assertThat(service.cancel(user).status()).isEqualTo("canceled");

        clock.set(sub.periodEnd().minusSeconds(1));
        assertThat(worker.runOnce()).isFalse();
        assertThat(service.pro(user)).isTrue();

        clock.set(sub.periodEnd());
        assertThat(service.pro(user)).isFalse();
        assertThat(worker.runOnce()).isTrue();
        Subscription after = repository.find(user).orElseThrow();
        assertThat(after.status()).isEqualTo(Status.EXPIRED);
        assertThat(after.sealedBillingKey()).isNull();
        assertThat(gateway.approvedOrders).hasSize(1);
        assertThat(service.view(user).status()).isEqualTo("expired");
    }

    @Test
    @DisplayName("매월 자동결제 — 기간이 끝나면 3,900원을 결제하고 다음 기간으로 넘긴다")
    void monthlyRenewal() {
        Subscription sub = subscribe();
        clock.set(sub.periodEnd().plusSeconds(60));
        assertThat(worker.runOnce()).isTrue();
        Subscription renewed = repository.find(user).orElseThrow();
        assertThat(renewed.status()).isEqualTo(Status.ACTIVE);
        assertThat(renewed.periodStart()).isEqualTo(sub.periodEnd());
        assertThat(renewed.periodEnd()).isEqualTo(Instant.parse("2026-12-23T01:00:00Z"));
        assertThat(gateway.approvedOrders).hasSize(2);
        assertThat(worker.runOnce()).isFalse();
    }

    @Test
    @DisplayName("자동결제 실패 — past_due 와 재시도 횟수, 하루 뒤 다시, 세 번 더 실패하면 expired")
    void renewalRetries() {
        Subscription sub = subscribe();
        clock.set(sub.periodEnd());
        for (int i = 0; i < 4; i++) {
            gateway.nextFailures.push(FakeGateway.rejected());
        }

        assertThat(worker.runOnce()).isTrue();
        Subscription pastDue = repository.find(user).orElseThrow();
        assertThat(pastDue.status()).isEqualTo(Status.PAST_DUE);
        assertThat(pastDue.retryCount()).isEqualTo(1);
        assertThat(pastDue.nextRetryAt()).isEqualTo(sub.periodEnd().plus(BillingRules.RETRY_DELAY));
        assertThat(service.pro(user)).isFalse();
        assertThat(worker.runOnce()).isFalse(); // 재시도 시각 전

        for (int retry = 2; retry <= 3; retry++) {
            clock.advance(BillingRules.RETRY_DELAY);
            assertThat(worker.runOnce()).isTrue();
            assertThat(repository.find(user).orElseThrow().retryCount()).isEqualTo(retry);
        }
        clock.advance(BillingRules.RETRY_DELAY);
        assertThat(worker.runOnce()).isTrue();
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.EXPIRED);
        // 시도마다 다른 주문 ID — 실패한 주문을 다시 쓰지 않는다.
        assertThat(repository.payments.values().stream().filter(p -> "renewal".equals(p.kind())).map(p -> p.orderId()).distinct())
                .hasSize(4);
    }

    @Test
    @DisplayName("past_due 에서 「다시 시도」가 성공하면 active 로 돌아가고, 두 번 눌러도 두 번 결제되지 않는다")
    void manualRetry() {
        Subscription sub = subscribe();
        clock.set(sub.periodEnd());
        gateway.nextFailures.push(FakeGateway.rejected());
        worker.runOnce();
        assertThat(service.view(user).status()).isEqualTo("past_due");

        SubscriptionService.View retried = service.retry(user);
        assertThat(retried.status()).isEqualTo("active");
        assertThat(retried.pro()).isTrue();
        assertThatThrownBy(() -> service.retry(user)).hasMessageContaining("not_past_due");
        assertThat(gateway.approvedOrders).hasSize(2);
    }

    @Test
    @DisplayName("같은 주문 ID 의 결제가 이미 성공했으면 다시 승인하지 않고 기간만 넘긴다(멱등)")
    void renewalIdempotent() {
        Subscription sub = subscribe();
        clock.set(sub.periodEnd());
        String orderId = BillingRules.renewalOrderId(sub.id(), sub.periodEnd(), 1);
        assertThat(service.charge(sub, orderId, "renewal", sub.periodEnd(),
                BillingRules.nextPeriodEnd(sub.periodEnd()), 1)).isEqualTo(SubscriptionService.Charge.DONE);
        assertThat(service.charge(sub, orderId, "renewal", sub.periodEnd(),
                BillingRules.nextPeriodEnd(sub.periodEnd()), 1)).isEqualTo(SubscriptionService.Charge.DONE);
        assertThat(gateway.approvedOrders).filteredOn(orderId::equals).hasSize(1);

        // 기간을 넘기기 전에 서버가 죽었다면 — 스케줄러가 성공한 기록을 보고 결제 없이 넘긴다.
        assertThat(worker.runOnce()).isTrue();
        assertThat(repository.find(user).orElseThrow().periodStart()).isEqualTo(sub.periodEnd());
        assertThat(gateway.approvedOrders).hasSize(2);
    }

    @Test
    @DisplayName("자동결제 결과를 모르면 상태를 바꾸지 않고 같은 키로 다시 묻는다")
    void renewalUnknown() {
        Subscription sub = subscribe();
        clock.set(sub.periodEnd());
        gateway.nextFailures.push(FakeGateway.unknown());
        assertThat(worker.runOnce()).isTrue();
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.ACTIVE);
        assertThat(repository.find(user).orElseThrow().periodEnd()).isEqualTo(sub.periodEnd());

        clock.advance(Duration.ofMinutes(15));
        // 기간이 끝난 구독이지만 결과 모르는 시도가 있어 새로 결제하지 않고, 그 결제를 같은 키로 다시 묻는다.
        assertThat(worker.runOnce()).isTrue();
        Subscription after = repository.find(user).orElseThrow();
        assertThat(after.periodStart()).isEqualTo(sub.periodEnd());
        String orderId = BillingRules.renewalOrderId(sub.id(), sub.periodEnd(), 1);
        assertThat(gateway.idempotencyKeys).filteredOn(orderId::equals).hasSize(2);
        assertThat(gateway.approvedOrders).filteredOn(orderId::equals).hasSize(1);
    }

    @Test
    @DisplayName("결제 수단 바꾸기 — 결제 없이 카드만 바뀌고, past_due 였으면 새 카드로 바로 결제한다")
    void changeCard() {
        Subscription sub = subscribe();
        String state = stateOf(service.startCheckout(user, false, "change_card"));
        assertThat(service.complete(state, sub.customerKey(), "auth_2")).isEqualTo(Result.DONE);
        assertThat(gateway.approvedOrders).hasSize(1);
        assertThat(repository.find(user).orElseThrow().sealedBillingKey()).isNotEqualTo(sub.sealedBillingKey());

        clock.set(sub.periodEnd());
        gateway.nextFailures.push(FakeGateway.rejected());
        worker.runOnce();
        String again = stateOf(service.startCheckout(user, false, "change_card"));
        assertThat(service.complete(again, sub.customerKey(), "auth_3")).isEqualTo(Result.DONE);
        assertThat(service.view(user).status()).isEqualTo("active");
        assertThat(gateway.approvedOrders).hasSize(2);
    }

    @Test
    @DisplayName("past_due 를 해지하면 더 시도하지 않고 바로 끝난다")
    void cancelPastDue() {
        Subscription sub = subscribe();
        clock.set(sub.periodEnd());
        gateway.nextFailures.push(FakeGateway.rejected());
        worker.runOnce();
        assertThat(service.cancel(user).status()).isEqualTo("expired");
        clock.advance(Duration.ofDays(2));
        assertThat(worker.runOnce()).isFalse();
    }

    @Test
    @DisplayName("31일에 시작한 기간은 다음 달 말일에 끝난다(한국 시간)")
    void monthEnd() {
        Instant jan31 = Instant.parse("2027-01-31T03:00:00Z");
        assertThat(BillingRules.nextPeriodEnd(jan31)).isEqualTo(Instant.parse("2027-02-28T03:00:00Z"));
    }

    @Test
    @DisplayName("Pro 권한 — active 와 기간 안의 canceled 만")
    void proRule() {
        Instant end = T0.plusSeconds(10);
        assertThat(BillingRules.pro(Status.ACTIVE, T0.minusSeconds(1), T0)).isTrue();
        assertThat(BillingRules.pro(Status.CANCELED, end, T0)).isTrue();
        assertThat(BillingRules.pro(Status.CANCELED, T0, T0)).isFalse();
        assertThat(BillingRules.pro(Status.PAST_DUE, end, T0)).isFalse();
        assertThat(BillingRules.pro(Status.EXPIRED, end, T0)).isFalse();
    }
}
