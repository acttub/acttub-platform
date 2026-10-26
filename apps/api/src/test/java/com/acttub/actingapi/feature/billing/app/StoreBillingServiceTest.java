package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.BillingRepository.Subscription;
import com.acttub.actingapi.feature.billing.app.BillingRules.Status;
import com.acttub.actingapi.feature.billing.app.StoreBillingService.NotificationResult;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleNotification;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleStoreGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleTransaction;
import com.acttub.actingapi.feature.billing.app.StoreGateways.GoogleStoreGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.GoogleSubscription;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 스토어 구독 검증·알림(SOMA-818 2단계). 서명·네트워크 없이 가짜 스토어 값으로 규칙만 본다. */
class StoreBillingServiceTest {
    static final Instant T0 = Instant.parse("2026-11-03T01:00:00Z");
    static final String ORIGINAL = "2000000111";
    static final String TOKEN = "google-token-1";

    final MutableClock clock = new MutableClock(T0);
    final InMemoryBillingRepository repository = new InMemoryBillingRepository();
    final UUID user = UUID.randomUUID();
    final FakeApple apple = new FakeApple();
    final FakeGoogle google = new FakeGoogle();
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
    final StoreBillingService service = new StoreBillingService(settings, repository, subscriptions, apple, google, clock);

    static class FakeApple implements AppleStoreGateway {
        AppleTransaction transaction;
        AppleTransaction latest;
        AppleNotification notification;
        StoreException failure;

        @Override
        public boolean configured() {
            return true;
        }

        @Override
        public AppleTransaction verifyTransaction(String signedTransaction) {
            if (failure != null) {
                throw failure;
            }
            if (!"jws".equals(signedTransaction)) {
                throw new StoreException(StoreException.Kind.INVALID, "invalid_store_receipt");
            }
            return transaction;
        }

        @Override
        public AppleNotification verifyNotification(String signedPayload) {
            if (!"payload".equals(signedPayload)) {
                throw new StoreException(StoreException.Kind.INVALID, "invalid_store_receipt");
            }
            return notification;
        }

        @Override
        public Optional<AppleTransaction> latest(String originalTransactionId, String environment) {
            return Optional.ofNullable(latest);
        }
    }

    static class FakeGoogle implements GoogleStoreGateway {
        GoogleSubscription subscription;
        final List<String> acknowledged = new ArrayList<>();
        StoreException failure;

        @Override
        public boolean configured() {
            return true;
        }

        @Override
        public String packageName() {
            return "com.acttub.app";
        }

        @Override
        public GoogleSubscription get(String purchaseToken) {
            if (failure != null) {
                throw failure;
            }
            return subscription;
        }

        @Override
        public void acknowledge(String productId, String purchaseToken) {
            acknowledged.add(purchaseToken);
        }
    }

    AppleTransaction appleTx(UUID account, Instant expires, Boolean autoRenew) {
        return new AppleTransaction(ORIGINAL, "t1", BillingRules.STORE_PRODUCT_ID, account, T0.minus(Duration.ofDays(1)),
                expires, null, autoRenew, null, false, "Sandbox");
    }

    AppleNotification notice(String type, Instant signed, AppleTransaction tx) {
        return new AppleNotification("n-" + type, type, null, signed, tx);
    }

    GoogleSubscription googleSub(String state, UUID account, Instant expiry, boolean autoRenew, boolean acknowledged) {
        return new GoogleSubscription(state, BillingRules.STORE_PRODUCT_ID, T0.minus(Duration.ofDays(1)), expiry, autoRenew,
                account == null ? null : account.toString(), null, acknowledged);
    }

    static String rtdn(String token) {
        String json = "{\"version\":\"1.0\",\"packageName\":\"com.acttub.app\",\"eventTimeMillis\":\"1\","
                + "\"subscriptionNotification\":{\"version\":\"1.0\",\"notificationType\":2,\"purchaseToken\":\"" + token
                + "\",\"subscriptionId\":\"acttub_pro_monthly\"}}";
        return Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }

    SubscriptionService.View verifyApple() {
        return service.verify(user, false, "ios", BillingRules.STORE_PRODUCT_ID, "jws", null);
    }

    SubscriptionService.View verifyGoogle() {
        return service.verify(user, false, "android", BillingRules.STORE_PRODUCT_ID, null, TOKEN);
    }

    @Test
    @DisplayName("Apple 구매를 검증하면 구독이 apple 출처로 기록되고 Pro 가 켜진다")
    void appleVerifyTurnsProOn() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        SubscriptionService.View view = verifyApple();
        assertThat(view.pro()).isTrue();
        assertThat(view.provider()).isEqualTo("apple");
        assertThat(view.status()).isEqualTo("active");
        assertThat(view.periodEnd()).isEqualTo(T0.plus(Duration.ofDays(30)));
        assertThat(subscriptions.pro(user)).isTrue();
    }

    @Test
    @DisplayName("연 구독(acttub_pro_yearly)도 Apple·Google 모두 검증하면 Pro 가 켜지고 상품 ID 가 남는다")
    void yearlyProductTurnsProOn() {
        apple.transaction = new AppleTransaction(ORIGINAL, "t1", BillingRules.STORE_PRODUCT_YEARLY_ID, user,
                T0.minus(Duration.ofDays(1)), T0.plus(Duration.ofDays(365)), null, null, null, false, "Sandbox");
        SubscriptionService.View view = service.verify(user, false, "ios", BillingRules.STORE_PRODUCT_YEARLY_ID, "jws", null);
        assertThat(view.pro()).isTrue();
        assertThat(view.periodEnd()).isEqualTo(T0.plus(Duration.ofDays(365)));

        UUID other = UUID.randomUUID();
        google.subscription = new GoogleSubscription("SUBSCRIPTION_STATE_ACTIVE", BillingRules.STORE_PRODUCT_YEARLY_ID,
                T0.minus(Duration.ofDays(1)), T0.plus(Duration.ofDays(365)), true, other.toString(), null, false);
        assertThat(service.verify(other, false, "android", BillingRules.STORE_PRODUCT_YEARLY_ID, null, TOKEN).pro()).isTrue();
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
    @DisplayName("같은 거래를 다시 검증해도 줄은 하나이고 결과가 같다")
    void appleVerifyTwiceIsIdempotent() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        verifyApple();
        verifyApple();
        assertThat(repository.subscriptions).hasSize(1);
    }

    @Test
    @DisplayName("App Store Server API 최신 상태가 있으면 자동갱신 끔을 반영해 canceled 가 된다")
    void appleLatestStatusShowsCanceled() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        apple.latest = appleTx(user, T0.plus(Duration.ofDays(30)), false);
        SubscriptionService.View view = verifyApple();
        assertThat(view.status()).isEqualTo("canceled");
        assertThat(view.pro()).isTrue();
    }

    @Test
    @DisplayName("거래의 appAccountToken 이 요청 사용자와 다르거나 없으면 403 store_account_mismatch")
    void appleAccountMismatchRejected() {
        apple.transaction = appleTx(UUID.randomUUID(), T0.plus(Duration.ofDays(30)), null);
        assertThatThrownBy(this::verifyApple).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("store_account_mismatch"));
        apple.transaction = appleTx(null, T0.plus(Duration.ofDays(30)), null);
        assertThatThrownBy(this::verifyApple).isInstanceOf(ApiException.class);
        assertThat(repository.subscriptions).isEmpty();
    }

    @Test
    @DisplayName("같은 원거래를 다른 사용자가 이미 쓰고 있으면 409 store_account_conflict")
    void sameTransactionOtherUserRejected() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        verifyApple();
        UUID other = UUID.randomUUID();
        apple.transaction = appleTx(other, T0.plus(Duration.ofDays(30)), null);
        assertThatThrownBy(() -> service.verify(other, false, "ios", null, "jws", null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("store_account_conflict"));
        assertThat(repository.find(other)).isEmpty();
    }

    @Test
    @DisplayName("저장소 유니크 위반(경합)도 store_account_conflict 로 거부한다")
    void uniqueViolationBecomesConflict() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        repository.uniqueViolation = true;
        assertThatThrownBy(this::verifyApple).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("store_account_conflict"));
    }

    @Test
    @DisplayName("상품이 다르면 422, 게스트는 403, 앱 결제가 꺼져 있으면 404")
    void guardRails() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        assertThatThrownBy(() -> service.verify(user, false, "ios", "other_product", "jws", null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.verify(user, true, "ios", null, "jws", null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.verify(user, false, "web", null, "jws", null)).isInstanceOf(ApiException.class);
        StoreBillingService off = new StoreBillingService(BillingSettings.disabled(), repository, subscriptions, apple, google, clock);
        assertThatThrownBy(() -> off.verify(user, false, "ios", null, "jws", null)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("billing_unavailable"));
        assertThat(repository.subscriptions).isEmpty();
    }

    @Test
    @DisplayName("가짜 서명(검증 실패)은 422, 스토어 장애는 502, 설정 없음은 503 이고 아무것도 기록하지 않는다")
    void verificationFailures() {
        assertThatThrownBy(() -> service.verify(user, false, "ios", null, "forged", null)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("invalid_store_receipt"));
        apple.failure = new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        assertThatThrownBy(this::verifyApple).isInstanceOf(ApiException.class);
        apple.failure = new StoreException(StoreException.Kind.UNAVAILABLE, "store_unavailable");
        assertThatThrownBy(this::verifyApple).isInstanceOf(ApiException.class);
        assertThat(repository.subscriptions).isEmpty();
    }

    @Test
    @DisplayName("토스로 이용 중인 사람의 스토어 구독은 409 already_subscribed 이고 토스 줄은 그대로다")
    void tossBlocksStore() {
        UUID id = repository.storeSubscription(user, "toss", Status.ACTIVE, T0.plus(Duration.ofDays(10)));
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        assertThatThrownBy(this::verifyApple).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("already_subscribed"));
        assertThat(repository.subscriptions.get(id).provider()).isEqualTo("toss");
    }

    @Test
    @DisplayName("다른 스토어 구독이 유효하면 새 스토어 구독을 받지 않는다(사용자당 하나)")
    void otherStoreActiveBlocks() {
        google.subscription = googleSub("SUBSCRIPTION_STATE_ACTIVE", user, T0.plus(Duration.ofDays(20)), true, true);
        verifyGoogle();
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        assertThatThrownBy(this::verifyApple).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("already_subscribed"));
        assertThat(repository.find(user).orElseThrow().provider()).isEqualTo("google");
    }

    @Test
    @DisplayName("이미 끝난 옛 구매를 복원해도 유효한 구독 줄을 덮지 않는다")
    void restoringExpiredPurchaseKeepsCurrent() {
        google.subscription = googleSub("SUBSCRIPTION_STATE_ACTIVE", user, T0.plus(Duration.ofDays(20)), true, true);
        verifyGoogle();
        apple.transaction = appleTx(user, T0.minus(Duration.ofDays(40)), null);
        SubscriptionService.View view = verifyApple();
        assertThat(view.provider()).isEqualTo("google");
        assertThat(view.pro()).isTrue();
    }

    @Test
    @DisplayName("만료된 토스 줄이 있으면 스토어 구독으로 바뀌고 카드 정보는 지워진다")
    void expiredTossReplacedByStore() {
        repository.storeSubscription(user, "toss", Status.EXPIRED, T0.minus(Duration.ofDays(3)));
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        SubscriptionService.View view = verifyApple();
        assertThat(view.provider()).isEqualTo("apple");
        assertThat(view.pro()).isTrue();
        assertThat(view.cardLast4()).isNull();
    }

    @Test
    @DisplayName("스토어 구독은 active 여도 기간(여유 포함)이 지나면 Pro 가 아니다")
    void storeProExpiresWithPeriod() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        verifyApple();
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
    @DisplayName("Apple 갱신 알림은 기간을 늘리고, 같은 알림을 또 받아도 결과가 같다(멱등)")
    void appleRenewalNotificationIdempotent() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        verifyApple();
        Instant renewed = T0.plus(Duration.ofDays(60));
        clock.set(T0.plus(Duration.ofDays(29)));
        apple.notification = notice("DID_RENEW", clock.instant(), appleTx(user, renewed, true));
        assertThat(service.handleAppleNotification("payload")).isEqualTo(NotificationResult.APPLIED);
        Subscription first = repository.find(user).orElseThrow();
        assertThat(first.periodEnd()).isEqualTo(renewed);
        assertThat(service.handleAppleNotification("payload")).isIn(NotificationResult.APPLIED, NotificationResult.IGNORED);
        Subscription second = repository.find(user).orElseThrow();
        assertThat(second.periodEnd()).isEqualTo(renewed);
        assertThat(second.status()).isEqualTo(Status.ACTIVE);
        assertThat(repository.subscriptions).hasSize(1);
    }

    @Test
    @DisplayName("늦게 도착한 옛 알림이 더 새로운 상태를 되돌리지 못한다")
    void staleAppleNotificationIgnored() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        verifyApple();
        clock.set(T0.plus(Duration.ofDays(1)));
        apple.notification = notice("DID_CHANGE_RENEWAL_STATUS", clock.instant(), appleTx(user, T0.plus(Duration.ofDays(30)), false));
        service.handleAppleNotification("payload");
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.CANCELED);
        // 자동갱신을 다시 켠 알림(더 나중)을 반영한 뒤, 그보다 먼저 서명된 '끔' 알림이 뒤늦게 도착한다.
        clock.set(T0.plus(Duration.ofDays(2)));
        apple.notification = notice("DID_CHANGE_RENEWAL_STATUS", clock.instant(), appleTx(user, T0.plus(Duration.ofDays(30)), true));
        service.handleAppleNotification("payload");
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.ACTIVE);
        apple.notification = notice("DID_CHANGE_RENEWAL_STATUS", T0.plus(Duration.ofDays(1)), appleTx(user, T0.plus(Duration.ofDays(30)), false));
        assertThat(service.handleAppleNotification("payload")).isEqualTo(NotificationResult.IGNORED);
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.ACTIVE);
    }

    @Test
    @DisplayName("환불·만료·결제 재시도 알림이 상태를 바꾼다")
    void appleRefundExpireAndRetry() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        verifyApple();
        clock.set(T0.plus(Duration.ofDays(5)));
        apple.notification = notice("REFUND", clock.instant(), appleTx(user, T0.plus(Duration.ofDays(30)), true));
        service.handleAppleNotification("payload");
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.EXPIRED);
        assertThat(subscriptions.pro(user)).isFalse();
        // 만료 뒤 결제 재시도 중이면 past_due, 유예기간이면 그 끝까지 active.
        clock.set(T0.plus(Duration.ofDays(31)));
        AppleTransaction retry = new AppleTransaction(ORIGINAL, "t1", BillingRules.STORE_PRODUCT_ID, user, T0, T0.plus(Duration.ofDays(30)),
                null, true, null, true, "Sandbox");
        apple.notification = notice("DID_FAIL_TO_RENEW", clock.instant(), retry);
        service.handleAppleNotification("payload");
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.PAST_DUE);
        AppleTransaction grace = new AppleTransaction(ORIGINAL, "t1", BillingRules.STORE_PRODUCT_ID, user, T0, T0.plus(Duration.ofDays(30)),
                null, true, T0.plus(Duration.ofDays(40)), true, "Sandbox");
        clock.set(T0.plus(Duration.ofDays(32)));
        apple.notification = notice("DID_FAIL_TO_RENEW", clock.instant(), grace);
        service.handleAppleNotification("payload");
        assertThat(subscriptions.pro(user)).isTrue();
    }

    @Test
    @DisplayName("아직 앱이 검증하지 않은 구매·다른 사용자 토큰의 알림은 무시하고, 서명이 틀리면 예외")
    void appleUnknownNotificationIgnored() {
        apple.notification = notice("DID_RENEW", T0, appleTx(user, T0.plus(Duration.ofDays(30)), true));
        assertThat(service.handleAppleNotification("payload")).isEqualTo(NotificationResult.IGNORED);
        assertThat(repository.subscriptions).isEmpty();
        apple.notification = notice("TEST", T0, null);
        assertThat(service.handleAppleNotification("payload")).isEqualTo(NotificationResult.IGNORED);
        assertThatThrownBy(() -> service.handleAppleNotification("forged")).isInstanceOf(StoreException.class);
        // 기록된 줄이 있어도 다른 사용자의 토큰이 실린 알림은 반영하지 않는다.
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        verifyApple();
        apple.notification = notice("EXPIRED", T0.plusSeconds(60), appleTx(UUID.randomUUID(), T0.minus(Duration.ofDays(1)), true));
        assertThat(service.handleAppleNotification("payload")).isEqualTo(NotificationResult.IGNORED);
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.ACTIVE);
    }

    @Test
    @DisplayName("Google 구매를 검증하면 Pro 가 켜지고 서버가 승인한다(이미 승인된 건 다시 승인하지 않는다)")
    void googleVerifyAcknowledges() {
        google.subscription = googleSub("SUBSCRIPTION_STATE_ACTIVE", user, T0.plus(Duration.ofDays(30)), true, false);
        SubscriptionService.View view = verifyGoogle();
        assertThat(view.pro()).isTrue();
        assertThat(view.provider()).isEqualTo("google");
        assertThat(google.acknowledged).containsExactly(TOKEN);
        google.subscription = googleSub("SUBSCRIPTION_STATE_ACTIVE", user, T0.plus(Duration.ofDays(30)), true, true);
        verifyGoogle();
        assertThat(google.acknowledged).hasSize(1);
        assertThat(repository.subscriptions).hasSize(1);
    }

    @Test
    @DisplayName("Google obfuscatedAccountId 가 다르거나 없으면 403, 결제 대기면 409, 기록하지 않는다")
    void googleRejections() {
        google.subscription = googleSub("SUBSCRIPTION_STATE_ACTIVE", UUID.randomUUID(), T0.plus(Duration.ofDays(30)), true, false);
        assertThatThrownBy(this::verifyGoogle).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("store_account_mismatch"));
        google.subscription = googleSub("SUBSCRIPTION_STATE_ACTIVE", null, T0.plus(Duration.ofDays(30)), true, false);
        assertThatThrownBy(this::verifyGoogle).isInstanceOf(ApiException.class);
        google.subscription = googleSub("SUBSCRIPTION_STATE_PENDING", user, T0.plus(Duration.ofDays(30)), true, false);
        assertThatThrownBy(this::verifyGoogle).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("payment_pending"));
        assertThat(repository.subscriptions).isEmpty();
        assertThat(google.acknowledged).isEmpty();
    }

    @Test
    @DisplayName("Google 상태 매핑: 자동갱신 끔 canceled, 유예 active(+7일), 보류 past_due, 만료 expired")
    void googleStateMapping() {
        Instant end = T0.plus(Duration.ofDays(3));
        assertThat(StoreBillingService.googleState("t", googleSub("SUBSCRIPTION_STATE_ACTIVE", user, end, false, true), T0).status())
                .isEqualTo(Status.CANCELED);
        assertThat(StoreBillingService.googleState("t", googleSub("SUBSCRIPTION_STATE_CANCELED", user, end, false, true), T0).status())
                .isEqualTo(Status.CANCELED);
        var grace = StoreBillingService.googleState("t", googleSub("SUBSCRIPTION_STATE_IN_GRACE_PERIOD", user, end, true, true), T0);
        assertThat(grace.status()).isEqualTo(Status.ACTIVE);
        assertThat(grace.periodEnd()).isEqualTo(end.plus(BillingRules.GOOGLE_GRACE));
        assertThat(StoreBillingService.googleState("t", googleSub("SUBSCRIPTION_STATE_ON_HOLD", user, end, true, true), T0).status())
                .isEqualTo(Status.PAST_DUE);
        assertThat(StoreBillingService.googleState("t", googleSub("SUBSCRIPTION_STATE_EXPIRED", user, end, false, true), T0).status())
                .isEqualTo(Status.EXPIRED);
    }

    @Test
    @DisplayName("RTDN 은 구독을 다시 조회해 상태를 쓰고, 같은 알림을 여러 번 받아도 결과가 같다")
    void googleNotificationRequeriesAndIsIdempotent() {
        google.subscription = googleSub("SUBSCRIPTION_STATE_ACTIVE", user, T0.plus(Duration.ofDays(30)), true, true);
        verifyGoogle();
        clock.set(T0.plus(Duration.ofDays(10)));
        google.subscription = googleSub("SUBSCRIPTION_STATE_CANCELED", user, T0.plus(Duration.ofDays(30)), false, true);
        assertThat(service.handleGoogleNotification(rtdn(TOKEN))).isEqualTo(NotificationResult.APPLIED);
        service.handleGoogleNotification(rtdn(TOKEN));
        service.handleGoogleNotification(rtdn(TOKEN));
        assertThat(repository.find(user).orElseThrow().status()).isEqualTo(Status.CANCELED);
        assertThat(subscriptions.pro(user)).isTrue();
        clock.set(T0.plus(Duration.ofDays(31)));
        google.subscription = googleSub("SUBSCRIPTION_STATE_EXPIRED", user, T0.plus(Duration.ofDays(30)), false, true);
        service.handleGoogleNotification(rtdn(TOKEN));
        assertThat(subscriptions.pro(user)).isFalse();
        assertThat(repository.subscriptions).hasSize(1);
    }

    @Test
    @DisplayName("RTDN: 모르는 토큰·다른 패키지·테스트 알림은 무시하고, 스토어 조회 실패는 예외로 다시 보내게 한다")
    void googleNotificationEdgeCases() {
        google.subscription = googleSub("SUBSCRIPTION_STATE_ACTIVE", user, T0.plus(Duration.ofDays(30)), true, true);
        assertThat(service.handleGoogleNotification(rtdn("unknown"))).isEqualTo(NotificationResult.IGNORED);
        String wrongPackage = Base64.getEncoder().encodeToString(
                "{\"packageName\":\"com.other\",\"subscriptionNotification\":{\"purchaseToken\":\"x\"}}".getBytes(StandardCharsets.UTF_8));
        assertThat(service.handleGoogleNotification(wrongPackage)).isEqualTo(NotificationResult.IGNORED);
        String test = Base64.getEncoder().encodeToString(
                "{\"packageName\":\"com.acttub.app\",\"testNotification\":{\"version\":\"1.0\"}}".getBytes(StandardCharsets.UTF_8));
        assertThat(service.handleGoogleNotification(test)).isEqualTo(NotificationResult.IGNORED);
        assertThatThrownBy(() -> service.handleGoogleNotification("%%%")).isInstanceOf(StoreException.class);
        verifyGoogle();
        google.failure = new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        assertThatThrownBy(() -> service.handleGoogleNotification(rtdn(TOKEN))).isInstanceOf(StoreException.class);
    }

    @Test
    @DisplayName("스토어 구독은 서버에서 해지·재시도할 수 없다(스토어에서 해지)")
    void storeSubscriptionIsNotServerCancelable() {
        apple.transaction = appleTx(user, T0.plus(Duration.ofDays(30)), null);
        verifyApple();
        assertThatThrownBy(() -> subscriptions.cancel(user)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getMessage()).contains("managed_by_store"));
    }
}
