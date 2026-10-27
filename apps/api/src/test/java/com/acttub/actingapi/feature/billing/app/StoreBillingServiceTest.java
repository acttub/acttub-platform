package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.BillingRepository.StoreState;
import com.acttub.actingapi.feature.billing.app.BillingRules.Status;
import com.acttub.actingapi.feature.billing.app.StoreBillingService.NotificationResult;
import com.acttub.actingapi.feature.billing.app.StoreGateways.RevenueCatGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreSubscription;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 스토어 구독(RevenueCat) 동기화·웹훅(SOMA-818 2단계). 네트워크 없이 가짜 RevenueCat 값으로 규칙만 본다. */
class StoreBillingServiceTest {
    static final Instant T0 = Instant.parse("2026-11-03T01:00:00Z");
    static final ObjectMapper JSON = new ObjectMapper();

    final MutableClock clock = new MutableClock(T0);
    final InMemoryBillingRepository repository = new InMemoryBillingRepository();
    final UUID user = UUID.randomUUID();
    final FakeRevenueCat revenueCat = new FakeRevenueCat();
    final BillingSettings settings = new BillingSettings(false, true, true, "", "", "", "");
    final SubscriptionService subscriptions = new SubscriptionService(settings, repository, new FakeGateway(), new BillingKeyCipher() {
        @Override
        public String seal(String billingKey) {
            return billingKey;
        }

        @Override
        public String open(String sealed) {
            return sealed;
        }
    }, clock);
    final StoreBillingService service = new StoreBillingService(settings, repository, subscriptions, revenueCat, clock);

    /** 사람별 RevenueCat entitlement. 없으면 비어 있다. */
    static class FakeRevenueCat implements RevenueCatGateway {
        final Map<String, StoreSubscription> customers = new HashMap<>();
        StoreException failure;
        int calls;

        @Override
        public boolean configured() {
            return true;
        }

        @Override
        public Optional<StoreSubscription> entitlement(String appUserId) {
            calls++;
            if (failure != null) {
                throw failure;
            }
            return Optional.ofNullable(customers.get(appUserId));
        }
    }

    static StoreSubscription active(String store, String product, Instant expires) {
        return new StoreSubscription(store, product, T0.minus(Duration.ofDays(1)), expires, null, null, null, null, false, "tx-1");
    }

    static StoreSubscription with(StoreSubscription s, Instant grace, Instant unsubscribed, Instant billingIssue, Instant refunded) {
        return new StoreSubscription(s.store(), s.productId(), s.purchaseDate(), s.expiresDate(), grace, unsubscribed, billingIssue,
                refunded, s.sandbox(), s.storeTransactionId());
    }

    void owns(UUID who, StoreSubscription sub) {
        revenueCat.customers.put(who.toString(), sub);
    }

    static JsonNode event(String type, UUID appUserId, String... extra) throws Exception {
        String aliases = String.join(",", java.util.Arrays.stream(extra).map(a -> "\"" + a + "\"").toList());
        return JSON.readTree("{\"api_version\":\"1.0\",\"event\":{\"id\":\"evt-1\",\"type\":\"" + type + "\",\"app_user_id\":\""
                + appUserId + "\",\"original_app_user_id\":\"" + appUserId + "\",\"aliases\":[" + aliases + "],"
                + "\"store\":\"APP_STORE\",\"expiration_at_ms\":1,\"entitlement_ids\":[\"pro\"]}}");
    }

    // ── 동기화 ────────────────────────────────────────────────────

    @Test
    @DisplayName("App Store 구독이 있으면 동기화가 apple 출처로 기록하고 Pro 를 켠다")
    void syncAppleTurnsProOn() {
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        SubscriptionService.View view = service.sync(user, false);
        assertThat(view.pro()).isTrue();
        assertThat(view.provider()).isEqualTo("apple");
        assertThat(view.status()).isEqualTo("active");
        assertThat(view.periodEnd()).isEqualTo(T0.plus(Duration.ofDays(30)));
        assertThat(view.amount()).isEqualTo(3900L);
        assertThat(subscriptions.pro(user)).isTrue();
    }

    @Test
    @DisplayName("Play 연 구독은 google 출처·연 금액(32,500원)으로 기록된다")
    void syncGoogleYearly() {
        owns(user, active("play_store", "acttub_pro_yearly", T0.plus(Duration.ofDays(365))));
        SubscriptionService.View view = service.sync(user, false);
        assertThat(view.provider()).isEqualTo("google");
        assertThat(view.amount()).isEqualTo(32500L);
        assertThat(view.pro()).isTrue();
    }

    @Test
    @DisplayName("같은 동기화를 여러 번 해도 줄은 하나이고 결과가 같다(멱등)")
    void syncIsIdempotent() {
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        SubscriptionService.View first = service.sync(user, false);
        SubscriptionService.View second = service.sync(user, false);
        assertThat(repository.subscriptions).hasSize(1);
        assertThat(second).isEqualTo(first);
    }

    @Test
    @DisplayName("RevenueCat 에 entitlement 가 없으면 아무 줄도 만들지 않고 Pro 가 아니다")
    void syncWithoutEntitlement() {
        SubscriptionService.View view = service.sync(user, false);
        assertThat(view.pro()).isFalse();
        assertThat(repository.subscriptions).isEmpty();
    }

    @Test
    @DisplayName("끝난 옛 구매만 있으면 새 줄을 만들지 않는다")
    void expiredOnlyCreatesNothing() {
        owns(user, active("app_store", "acttub_pro_monthly", T0.minus(Duration.ofDays(3))));
        assertThat(service.sync(user, false).pro()).isFalse();
        assertThat(repository.subscriptions).isEmpty();
    }

    @Test
    @DisplayName("우리 상품이 아니거나 App Store·Play 가 아닌 출처(프로모션 등)는 받지 않는다")
    void unknownProductOrStoreIgnored() {
        owns(user, active("app_store", "acttub_pro_weekly", T0.plus(Duration.ofDays(30))));
        assertThat(service.sync(user, false).pro()).isFalse();
        owns(user, active("promotional", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        assertThat(service.sync(user, false).pro()).isFalse();
        owns(user, active(null, "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        assertThat(service.sync(user, false).pro()).isFalse();
        assertThat(repository.subscriptions).isEmpty();
    }

    @Test
    @DisplayName("게스트는 403, 앱 결제가 꺼져 있으면 404, RevenueCat 장애는 502, 설정 없음은 503 이고 아무것도 기록하지 않는다")
    void syncErrors() {
        assertThatThrownBy(() -> service.sync(user, true)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.status()).isEqualTo(403));
        StoreBillingService closed = new StoreBillingService(new BillingSettings(false, false, false, "", "", "", ""), repository,
                subscriptions, revenueCat, clock);
        assertThatThrownBy(() -> closed.sync(user, false)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.status()).isEqualTo(404));
        revenueCat.failure = new StoreException(StoreException.Kind.UPSTREAM, "x");
        assertThatThrownBy(() -> service.sync(user, false)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.status()).isEqualTo(502));
        StoreBillingService off = new StoreBillingService(settings, repository, subscriptions, StoreGateways.revenueCatDisabled(), clock);
        assertThatThrownBy(() -> off.sync(user, false)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.status()).isEqualTo(503));
        assertThat(repository.subscriptions).isEmpty();
    }

    @Test
    @DisplayName("토스로 이용 중인 사람은 스토어 구독이 유효해도 409 already_subscribed 이고 토스 줄은 그대로다")
    void tossBlocksStore() {
        UUID id = repository.storeSubscription(user, "toss", Status.ACTIVE, T0.plus(Duration.ofDays(10)));
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        assertThatThrownBy(() -> service.sync(user, false)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("already_subscribed"));
        assertThat(repository.subscriptions.get(id).provider()).isEqualTo("toss");
        assertThat(repository.storeWrites).isZero();
    }

    @Test
    @DisplayName("만료된 토스 줄이 있으면 스토어 구독으로 바뀐다")
    void expiredTossBecomesStore() {
        repository.storeSubscription(user, "toss", Status.EXPIRED, T0.minus(Duration.ofDays(3)));
        owns(user, active("play_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        SubscriptionService.View view = service.sync(user, false);
        assertThat(view.provider()).isEqualTo("google");
        assertThat(view.pro()).isTrue();
        assertThat(repository.subscriptions).hasSize(1);
    }

    @Test
    @DisplayName("스토어 구독은 active 여도 기간(여유 포함)이 지나면 Pro 가 아니다")
    void storeProExpiresWithPeriod() {
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        service.sync(user, false);
        clock.set(T0.plus(Duration.ofDays(30)).plus(BillingRules.STORE_RENEWAL_SKEW).minusSeconds(1));
        assertThat(subscriptions.pro(user)).isTrue();
        clock.set(T0.plus(Duration.ofDays(30)).plus(BillingRules.STORE_RENEWAL_SKEW).plusSeconds(1));
        assertThat(subscriptions.pro(user)).isFalse();
        assertThat(BillingRules.pro(Status.CANCELED, T0, T0, "apple")).isFalse();
        assertThat(BillingRules.pro(Status.CANCELED, T0.plusSeconds(1), T0, "google")).isTrue();
        assertThat(BillingRules.pro(Status.PAST_DUE, T0.plusSeconds(1), T0, "google")).isFalse();
        // 토스는 기존 규칙 그대로 — active 는 기간과 상관없이 Pro.
        assertThat(BillingRules.pro(Status.ACTIVE, T0.minus(Duration.ofDays(9)), T0, "toss")).isTrue();
    }

    @Test
    @DisplayName("스토어 상품은 월·연 둘만 받고, 장부 금액은 월 3,900원·연 32,500원이다")
    void storeProductsAndAmounts() {
        assertThat(BillingRules.storeProduct("acttub_pro_monthly")).isTrue();
        assertThat(BillingRules.storeProduct("acttub_pro_yearly")).isTrue();
        assertThat(BillingRules.storeProduct("acttub_pro_weekly")).isFalse();
        assertThat(BillingRules.storeProduct(null)).isFalse();
        assertThat(BillingRules.storeAmount("acttub_pro_monthly")).isEqualTo(3900L);
        assertThat(BillingRules.storeAmount("acttub_pro_yearly")).isEqualTo(32500L);
    }

    @Test
    @DisplayName("스토어 구독은 서버에서 해지·재시도할 수 없다(스토어에서 해지)")
    void storeSubscriptionIsNotServerCancelable() {
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        service.sync(user, false);
        assertThatThrownBy(() -> subscriptions.cancel(user)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("managed_by_store"));
    }

    // ── 상태 매핑 ──────────────────────────────────────────────────

    StoreState map(StoreSubscription sub) {
        return StoreBillingService.storeState(sub, T0, false).orElseThrow();
    }

    static StoreSubscription sandbox(StoreSubscription s) {
        return new StoreSubscription(s.store(), s.productId(), s.purchaseDate(), s.expiresDate(), s.gracePeriodExpiresDate(),
                s.unsubscribeDetectedAt(), s.billingIssuesDetectedAt(), s.refundedAt(), true, s.storeTransactionId());
    }

    @Test
    @DisplayName("샌드박스 구매는 BILLING_REVENUECAT_ALLOW_SANDBOX 가 켜진 서버(dev)에서만 Pro 를 연다")
    void sandboxOnlyWhenAllowed() {
        owns(user, sandbox(active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30)))));
        assertThat(service.sync(user, false).pro()).isFalse();
        assertThat(repository.subscriptions).isEmpty();
        StoreBillingService dev = new StoreBillingService(settings, repository, subscriptions, revenueCat, clock, true);
        assertThat(dev.sync(user, false).pro()).isTrue();
        // 운영 설정으로 다시 읽으면 샌드박스 줄은 끝낸다.
        assertThat(service.sync(user, false).pro()).isFalse();
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.EXPIRED);
    }

    @Test
    @DisplayName("상태 매핑: 기간 안 active, 자동 갱신 끔 canceled(끈 시각 기록), 환불 expired, 기간 지남 expired")
    void mapsLifecycle() {
        StoreSubscription base = active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(10)));
        assertThat(map(base).status()).isEqualTo(Status.ACTIVE);
        assertThat(map(base).provider()).isEqualTo("apple");
        assertThat(map(base).storeTransactionId()).isEqualTo("tx-1");

        Instant off = T0.minus(Duration.ofHours(2));
        StoreState canceled = map(with(base, null, off, null, null));
        assertThat(canceled.status()).isEqualTo(Status.CANCELED);
        assertThat(canceled.canceledAt()).isEqualTo(off);
        assertThat(canceled.periodEnd()).isEqualTo(T0.plus(Duration.ofDays(10)));

        // 이번 기간 시작 뒤에 알아챈 환불은 기간이 남아 있어도 끝이다.
        assertThat(map(with(base, null, null, null, T0.minus(Duration.ofHours(1)))).status()).isEqualTo(Status.EXPIRED);
        // 지난 기간의 환불(이번 기간 시작 전)은 지금 구독에 영향이 없다.
        assertThat(map(with(base, null, null, null, T0.minus(Duration.ofDays(40)))).status()).isEqualTo(Status.ACTIVE);

        StoreSubscription over = active("play_store", "acttub_pro_monthly", T0.minus(Duration.ofHours(1)));
        assertThat(map(over).status()).isEqualTo(Status.EXPIRED);
        assertThat(map(over).provider()).isEqualTo("google");
        assertThat(map(active("app_store", "acttub_pro_monthly", null)).status()).isEqualTo(Status.EXPIRED);
    }

    @Test
    @DisplayName("결제 문제(billing issue): 기간 안이면 active, 유예 안이면 active(유예 끝까지), 유예도 끝나면 past_due(Pro 아님)")
    void mapsBillingIssues() {
        Instant issue = T0.minus(Duration.ofDays(1));
        StoreSubscription inPeriod = with(active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(2))), null, null, issue, null);
        assertThat(map(inPeriod).status()).isEqualTo(Status.ACTIVE);

        Instant graceEnd = T0.plus(Duration.ofDays(3));
        StoreSubscription inGrace = with(active("play_store", "acttub_pro_monthly", T0.minus(Duration.ofDays(1))), graceEnd, null, issue,
                null);
        StoreState grace = map(inGrace);
        assertThat(grace.status()).isEqualTo(Status.ACTIVE);
        assertThat(grace.periodEnd()).isEqualTo(graceEnd);

        StoreSubscription retrying = with(active("app_store", "acttub_pro_monthly", T0.minus(Duration.ofDays(1))),
                T0.minus(Duration.ofHours(1)), null, issue, null);
        StoreState pastDue = map(retrying);
        assertThat(pastDue.status()).isEqualTo(Status.PAST_DUE);
        assertThat(BillingRules.pro(pastDue.status(), pastDue.periodEnd(), T0, pastDue.provider())).isFalse();
    }

    @Test
    @DisplayName("결제 문제로 past_due 가 된 줄은 동기화로 기록되고 Pro 가 꺼진다. 해결되면 다시 active")
    void billingIssueRoundTrip() {
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        service.sync(user, false);
        clock.set(T0.plus(Duration.ofDays(31)));
        owns(user, with(active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))), null, null,
                T0.plus(Duration.ofDays(30)), null));
        SubscriptionService.View view = service.sync(user, false);
        assertThat(view.status()).isEqualTo("past_due");
        assertThat(view.pro()).isFalse();
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(61))));
        assertThat(service.sync(user, false).pro()).isTrue();
    }

    // ── 웹훅 ──────────────────────────────────────────────────────

    @Test
    @DisplayName("웹훅은 본문 상태를 믿지 않고 RevenueCat 을 다시 읽어 쓰며, 같은 이벤트를 여러 번 받아도 결과가 같다(멱등)")
    void webhookRereadsAndIsIdempotent() throws Exception {
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        // 본문은 EXPIRATION 이라고 하지만 RevenueCat 의 현재 상태는 active 다 — 현재 상태가 이긴다.
        JsonNode body = event("EXPIRATION", user);
        for (int i = 0; i < 3; i++) {
            assertThat(service.handleRevenueCatEvent(body)).isEqualTo(NotificationResult.APPLIED);
        }
        assertThat(repository.subscriptions).hasSize(1);
        assertThat(subscriptions.view(user).status()).isEqualTo("active");
        assertThat(revenueCat.calls).isEqualTo(3);
    }

    @Test
    @DisplayName("만료·환불 웹훅 뒤 RevenueCat 이 끝났다고 하면 expired 가 되고 Pro 가 꺼진다")
    void webhookExpiresAndRefunds() throws Exception {
        owns(user, active("play_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        service.sync(user, false);
        owns(user, with(active("play_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))), null, null, null,
                T0.plus(Duration.ofMinutes(5))));
        clock.set(T0.plus(Duration.ofMinutes(10)));
        service.handleRevenueCatEvent(event("CANCELLATION", user));
        assertThat(subscriptions.view(user).status()).isNotEqualTo("active");
        assertThat(subscriptions.pro(user)).isFalse();

        UUID other = UUID.randomUUID();
        owns(other, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(1))));
        service.sync(other, false);
        clock.set(T0.plus(Duration.ofDays(2)));
        service.handleRevenueCatEvent(event("EXPIRATION", other));
        assertThat(subscriptions.pro(other)).isFalse();
        assertThat(repository.find(other).orElseThrow().status()).isEqualTo(Status.EXPIRED);
    }

    @Test
    @DisplayName("다른 계정으로 옮겨지면(TRANSFER) 양쪽을 다시 읽어 옛 계정은 expired, 새 계정은 active")
    void transferMovesBothSides() throws Exception {
        UUID from = UUID.randomUUID();
        owns(from, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        service.sync(from, false);
        revenueCat.customers.remove(from.toString());
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        JsonNode transfer = JSON.readTree("{\"api_version\":\"1.0\",\"event\":{\"id\":\"e\",\"type\":\"TRANSFER\","
                + "\"transferred_from\":[\"" + from + "\"],\"transferred_to\":[\"" + user + "\"]}}");
        assertThat(service.handleRevenueCatEvent(transfer)).isEqualTo(NotificationResult.APPLIED);
        assertThat(repository.find(from).orElseThrow().status()).isEqualTo(Status.EXPIRED);
        assertThat(subscriptions.pro(user)).isTrue();
        // 다시 와도 같다.
        service.handleRevenueCatEvent(transfer);
        assertThat(repository.find(from).orElseThrow().status()).isEqualTo(Status.EXPIRED);
        assertThat(subscriptions.pro(user)).isTrue();
    }

    @Test
    @DisplayName("웹훅: TEST·익명 ID·기능 꺼짐은 무시하고, 본문 꼴이 틀리면 INVALID, RevenueCat 장애는 UPSTREAM 으로 다시 보내게 한다")
    void webhookIgnoresAndFails() throws Exception {
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        assertThat(service.handleRevenueCatEvent(event("TEST", user))).isEqualTo(NotificationResult.IGNORED);
        JsonNode anonymous = JSON.readTree("{\"event\":{\"type\":\"INITIAL_PURCHASE\",\"app_user_id\":\"$RCAnonymousID:abc\","
                + "\"aliases\":[\"$RCAnonymousID:abc\"]}}");
        assertThat(service.handleRevenueCatEvent(anonymous)).isEqualTo(NotificationResult.IGNORED);
        assertThat(revenueCat.calls).isZero();

        StoreBillingService closed = new StoreBillingService(new BillingSettings(false, false, false, "", "", "", ""), repository,
                subscriptions, revenueCat, clock);
        assertThat(closed.handleRevenueCatEvent(event("RENEWAL", user))).isEqualTo(NotificationResult.IGNORED);
        StoreBillingService off = new StoreBillingService(settings, repository, subscriptions, StoreGateways.revenueCatDisabled(), clock);
        assertThat(off.handleRevenueCatEvent(event("RENEWAL", user))).isEqualTo(NotificationResult.IGNORED);

        assertThatThrownBy(() -> service.handleRevenueCatEvent(JSON.readTree("{\"nope\":1}")))
                .isInstanceOfSatisfying(StoreException.class, e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.INVALID));
        assertThatThrownBy(() -> service.handleRevenueCatEvent(null))
                .isInstanceOfSatisfying(StoreException.class, e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.INVALID));

        revenueCat.failure = new StoreException(StoreException.Kind.UPSTREAM, "x");
        assertThatThrownBy(() -> service.handleRevenueCatEvent(event("RENEWAL", user)))
                .isInstanceOfSatisfying(StoreException.class, e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.UPSTREAM));
        assertThat(repository.subscriptions).isEmpty();
    }

    @Test
    @DisplayName("웹훅: 토스로 이용 중인 사람·탈퇴한 사람의 줄은 쓰지 않는다")
    void webhookRespectsTossAndInactiveUsers() throws Exception {
        UUID id = repository.storeSubscription(user, "toss", Status.ACTIVE, T0.plus(Duration.ofDays(10)));
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        assertThat(service.handleRevenueCatEvent(event("INITIAL_PURCHASE", user))).isEqualTo(NotificationResult.IGNORED);
        assertThat(repository.subscriptions.get(id).provider()).isEqualTo("toss");

        UUID gone = UUID.randomUUID();
        repository.inactiveUsers.add(gone);
        owns(gone, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        assertThat(service.handleRevenueCatEvent(event("RENEWAL", gone))).isEqualTo(NotificationResult.IGNORED);
        assertThat(repository.find(gone)).isEmpty();
    }

    @Test
    @DisplayName("웹훅이 고르는 사람: app_user_id·original·aliases·이전 대상 중 UUID 꼴만, 중복 없이 최대 10명")
    void webhookUserSelection() throws Exception {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        JsonNode e = JSON.readTree("{\"app_user_id\":\"" + a + "\",\"original_app_user_id\":\"" + a + "\",\"aliases\":[\"" + b
                + "\",\"$RCAnonymousID:1\",3]}");
        assertThat(StoreBillingService.users(e)).containsExactly(a, b);
        StringBuilder many = new StringBuilder("{\"aliases\":[");
        for (int i = 0; i < 15; i++) {
            many.append(i == 0 ? "" : ",").append('"').append(UUID.randomUUID()).append('"');
        }
        assertThat(StoreBillingService.users(JSON.readTree(many.append("]}").toString()))).hasSize(StoreBillingService.MAX_USERS_PER_EVENT);
    }

    // ── 창립 멤버(SOMA-861) ──────────────────────────────────────

    @Test
    @DisplayName("스토어 유료 구독이 처음 열리면 창립 번호 1번을 받고, 다시 동기화해도 그대로다")
    void foundingNumberOnFirstPaidStorePurchase() {
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        SubscriptionService.View first = service.sync(user, false);
        assertThat(first.foundingNumber()).isEqualTo(1);
        assertThat(first.foundingRemaining()).isEqualTo(99);
        assertThat(service.sync(user, false).foundingNumber()).isEqualTo(1);
        assertThat(repository.foundingRemaining()).isEqualTo(99);
    }

    @Test
    @DisplayName("샌드박스 구매와 끝난 옛 구매는 창립 번호를 받지 않는다")
    void sandboxAndExpiredAreNotFounding() {
        UUID sandboxUser = UUID.randomUUID();
        StoreBillingService sandboxAllowed = new StoreBillingService(settings, repository, subscriptions, revenueCat, clock, true);
        StoreSubscription base = active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30)));
        owns(sandboxUser, new StoreSubscription(base.store(), base.productId(), base.purchaseDate(), base.expiresDate(), null, null,
                null, null, true, "tx-sb"));
        assertThat(sandboxAllowed.sync(sandboxUser, false).foundingNumber()).isNull();
        owns(user, active("app_store", "acttub_pro_monthly", T0.minus(Duration.ofDays(1))));
        assertThat(service.sync(user, false).foundingNumber()).isNull();
        assertThat(repository.foundingRemaining()).isEqualTo(100);
    }

    @Test
    @DisplayName("해지(canceled)해도 번호가 남고, 100명이 차면 101번째는 받지 않는다")
    void keepsNumberAfterCancelAndStopsAtLimit() {
        owns(user, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        service.sync(user, false);
        owns(user, with(active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))), null, T0, null, null));
        assertThat(service.sync(user, false).foundingNumber()).isEqualTo(1);
        for (int i = 0; i < 99; i++) {
            UUID other = UUID.randomUUID();
            owns(other, active("play_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
            service.sync(other, false);
        }
        assertThat(repository.foundingRemaining()).isZero();
        UUID late = UUID.randomUUID();
        owns(late, active("app_store", "acttub_pro_monthly", T0.plus(Duration.ofDays(30))));
        SubscriptionService.View view = service.sync(late, false);
        assertThat(view.pro()).isTrue();
        assertThat(view.foundingNumber()).isNull();
        assertThat(view.foundingRemaining()).isZero();
    }
}
