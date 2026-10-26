package com.acttub.actingapi.feature.billing.app;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.BillingRepository.StoreRow;
import com.acttub.actingapi.feature.billing.app.BillingRepository.StoreSave;
import com.acttub.actingapi.feature.billing.app.BillingRepository.StoreState;
import com.acttub.actingapi.feature.billing.app.BillingRepository.Subscription;
import com.acttub.actingapi.feature.billing.app.BillingRules.Status;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleNotification;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleStoreGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleTransaction;
import com.acttub.actingapi.feature.billing.app.StoreGateways.GoogleStoreGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.GoogleSubscription;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 앱 스토어 구독(App Store·Google Play) 검증과 알림 반영(SOMA-818 2단계, billing.store).
 *
 * <p>앱이 구매 뒤 거래 JWS(Apple)·구매 토큰(Google)을 보내면 서버가 스토어 쪽 서명·조회로 검증하고, 구매자가 요청 사용자와
 * 같은지(appAccountToken·obfuscatedAccountId = 우리 user id) 확인한 뒤 {@code billing_subscriptions} 에 기록한다. 이후 갱신·만료·
 * 환불은 Apple 서버 알림 V2 와 Google RTDN 이 같은 줄을 바꾼다. 알림은 <b>현재 상태를 덮어쓰는</b> 방식이라 같은 알림이
 * 여러 번 와도 결과가 같고, 늦게 온 옛 알림은 더 새로운 상태를 되돌리지 못한다.
 *
 * <p>구독은 사람당 한 줄이다. 토스로 이용 중이거나 다른 스토어 구독이 아직 유효한 사람의 새 스토어 구독은 거부한다.
 */
public class StoreBillingService {
    private static final Logger LOG = LoggerFactory.getLogger(StoreBillingService.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final BillingSettings settings;
    private final BillingRepository repository;
    private final SubscriptionService subscriptions;
    private final AppleStoreGateway apple;
    private final GoogleStoreGateway google;
    private final Clock clock;

    public StoreBillingService(BillingSettings settings, BillingRepository repository, SubscriptionService subscriptions,
            AppleStoreGateway apple, GoogleStoreGateway google, Clock clock) {
        this.settings = settings;
        this.repository = repository;
        this.subscriptions = subscriptions;
        this.apple = apple;
        this.google = google;
        this.clock = clock;
    }

    // ── 앱이 보낸 구매 검증 ─────────────────────────────────────────

    /**
     * @param platform ios·android
     * @param signedTransaction iOS 의 거래 JWS
     * @param purchaseToken Android 의 구매 토큰
     * @throws ApiException 404 {@code billing_unavailable}(앱 결제 꺼짐), 403 {@code billing_member_required}, 422
     *     {@code invalid_platform}·{@code invalid_product}·{@code invalid_store_receipt}, 403 {@code store_account_mismatch}, 409
     *     {@code store_account_conflict}·{@code already_subscribed}·{@code payment_pending}, 503 {@code store_unavailable}, 502
     *     {@code store_upstream_error}
     */
    public SubscriptionService.View verify(UUID userId, boolean guest, String platform, String productId,
            String signedTransaction, String purchaseToken) {
        if (!settings.appEnabled()) {
            throw new ApiException(404, "billing_unavailable");
        }
        if (guest) {
            throw new ApiException(403, "billing_member_required");
        }
        if (productId != null && !BillingRules.storeProduct(productId)) {
            throw new ApiException(422, "invalid_product");
        }
        Instant now = clock.instant();
        try {
            if ("ios".equals(platform)) {
                verifyApple(userId, signedTransaction, now);
            } else if ("android".equals(platform)) {
                verifyGoogle(userId, purchaseToken, now);
            } else {
                throw new ApiException(422, "invalid_platform");
            }
        } catch (StoreException failure) {
            throw translate(failure);
        }
        return subscriptions.view(userId);
    }

    private void verifyApple(UUID userId, String signedTransaction, Instant now) {
        if (signedTransaction == null || signedTransaction.isBlank()) {
            throw new ApiException(422, "invalid_store_receipt");
        }
        AppleTransaction verified = apple.verifyTransaction(signedTransaction.strip());
        if (!BillingRules.storeProduct(verified.productId())) {
            throw new ApiException(422, "invalid_product");
        }
        if (verified.appAccountToken() == null || !verified.appAccountToken().equals(userId)) {
            throw new ApiException(403, "store_account_mismatch");
        }
        // 키가 있으면 갱신 정보(자동갱신 끔·유예·결제 재시도)까지 담긴 최신 상태로 바꾼다. 없거나 실패하면 거래 JWS 만으로 판단한다.
        AppleTransaction tx = apple.latest(verified.originalTransactionId(), verified.environment())
                .filter(latest -> verified.originalTransactionId().equals(latest.originalTransactionId()))
                .orElse(verified);
        StoreState state = appleState(tx, null, now);
        save(userId, state, now);
    }

    private void verifyGoogle(UUID userId, String purchaseToken, Instant now) {
        if (purchaseToken == null || purchaseToken.isBlank() || purchaseToken.length() > 4096) {
            throw new ApiException(422, "invalid_store_receipt");
        }
        String token = purchaseToken.strip();
        GoogleSubscription sub = google.get(token);
        if (!BillingRules.storeProduct(sub.productId())) {
            throw new ApiException(422, "invalid_product");
        }
        if (sub.obfuscatedAccountId() == null || !sub.obfuscatedAccountId().equals(userId.toString())) {
            throw new ApiException(403, "store_account_mismatch");
        }
        if ("SUBSCRIPTION_STATE_PENDING".equals(sub.state())) {
            // 결제가 아직 끝나지 않았다(느린 결제 수단). 끝나면 RTDN 이 알려 주고 앱이 다시 검증한다.
            throw new ApiException(409, "payment_pending");
        }
        StoreState state = googleState(token, sub, now);
        save(userId, state, now);
        // 서버가 승인한다. 승인에 실패하면 502 를 돌려줘 앱이 다시 시도하게 한다(Pro 는 이미 켜져 있고, 3일 안에 승인되면 환불되지 않는다).
        acknowledgeIfNeeded(sub, token);
    }

    private void save(UUID userId, StoreState state, Instant now) {
        Optional<StoreRow> sameKey = repository.findStore(state.provider(), state.key());
        if (sameKey.isPresent() && !sameKey.get().userId().equals(userId)) {
            // 같은 스토어 구독을 다른 계정이 이미 쓰고 있다.
            throw new ApiException(409, "store_account_conflict");
        }
        Optional<Subscription> existing = repository.find(userId);
        boolean mine = sameKey.isPresent();
        if (existing.isPresent() && !mine) {
            Subscription current = existing.get();
            if (!BillingRules.pro(state.status(), state.periodEnd(), now, state.provider())) {
                // 이미 끝난 옛 구매를 복원하는 경우 — 지금 줄을 건드리지 않는다.
                return;
            }
            boolean currentPro = BillingRules.pro(current.status(), current.periodEnd(), now, current.provider());
            if (currentPro || (current.toss() && current.status() != Status.EXPIRED)) {
                // 사용자당 활성 구독은 하나다 — 토스든 다른 스토어든 이미 Pro 를 이용 중이면 새 구독을 받지 않는다.
                throw new ApiException(409, "already_subscribed");
            }
        }
        StoreSave result;
        try {
            result = repository.saveStore(userId, state, now);
        } catch (RuntimeException conflict) {
            if (isUniqueViolation(conflict)) {
                throw new ApiException(409, "store_account_conflict");
            }
            throw conflict;
        }
        switch (result) {
            case TAKEN -> throw new ApiException(409, "store_account_conflict");
            case BLOCKED -> throw new ApiException(409, "already_subscribed");
            case SAVED -> { }
        }
    }

    private static boolean isUniqueViolation(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            String message = cause.getMessage();
            if (message != null && message.contains("uq_billing_subscriptions")) {
                return true;
            }
        }
        return false;
    }

    private static ApiException translate(StoreException failure) {
        return switch (failure.kind()) {
            case INVALID -> new ApiException(422, "invalid_store_receipt");
            case UNAVAILABLE -> ApiException.external(503, "store_unavailable", failure);
            case UPSTREAM -> ApiException.external(502, "store_upstream_error", failure);
        };
    }

    // ── Apple 서버 알림 V2 ──────────────────────────────────────────

    public enum NotificationResult { APPLIED, IGNORED }

    /**
     * 서명된 알림 하나를 반영한다. 서명이 틀리면 {@link StoreException}(INVALID)이 나가고 컨트롤러가 4xx 로 바꾼다. 우리 구독이
     * 아닌 알림(아직 앱이 검증하지 않은 구매, 다른 상품)은 무시하고 성공으로 돌려준다 — Apple 이 다시 보내지 않게.
     */
    public NotificationResult handleAppleNotification(String signedPayload) {
        if (!settings.appEnabled()) {
            return NotificationResult.IGNORED;
        }
        AppleNotification notification = apple.verifyNotification(signedPayload);
        AppleTransaction tx = notification.transaction();
        if (tx == null || !BillingRules.storeProduct(tx.productId())) {
            return NotificationResult.IGNORED;
        }
        Optional<StoreRow> row = repository.findStore(BillingRules.PROVIDER_APPLE, tx.originalTransactionId());
        if (row.isEmpty()) {
            return NotificationResult.IGNORED;
        }
        if (tx.appAccountToken() != null && !tx.appAccountToken().equals(row.get().userId())) {
            LOG.warn("apple notification account mismatch type={}", notification.type());
            return NotificationResult.IGNORED;
        }
        Instant now = clock.instant();
        StoreState state = appleState(tx, notification.type(), now);
        boolean forward = row.get().periodEnd() == null
                || (state.periodEnd() != null && state.periodEnd().isAfter(row.get().periodEnd()));
        Instant signed = notification.signedDate();
        if (!forward && signed != null && row.get().updatedAt() != null && signed.isBefore(row.get().updatedAt())) {
            // 이미 더 나중에 기록한 상태가 있다 — 늦게 도착한 옛 알림이 되돌리지 못한다.
            return NotificationResult.IGNORED;
        }
        return repository.updateStore(BillingRules.PROVIDER_APPLE, tx.originalTransactionId(), state, now)
                ? NotificationResult.APPLIED : NotificationResult.IGNORED;
    }

    /** 거래·갱신 정보를 우리 상태로 옮긴다(순수 함수). notificationType 은 알림이 아니면 null. */
    static StoreState appleState(AppleTransaction tx, String notificationType, Instant now) {
        Instant end = tx.expiresDate();
        Status status;
        boolean revoked = tx.revocationDate() != null || "REFUND".equals(notificationType) || "REVOKE".equals(notificationType);
        if (revoked) {
            status = Status.EXPIRED;
        } else if (end == null) {
            status = Status.EXPIRED;
        } else if (end.isAfter(now)) {
            status = Boolean.FALSE.equals(tx.autoRenew()) ? Status.CANCELED : Status.ACTIVE;
        } else if (tx.gracePeriodExpiresDate() != null && tx.gracePeriodExpiresDate().isAfter(now)) {
            status = Status.ACTIVE;
            end = tx.gracePeriodExpiresDate();
        } else if (tx.billingRetry()) {
            status = Status.PAST_DUE;
        } else {
            status = Status.EXPIRED;
        }
        Instant canceledAt = status == Status.CANCELED ? tx.revocationDate() : null;
        return new StoreState(BillingRules.PROVIDER_APPLE, tx.productId(), tx.originalTransactionId(), status,
                tx.purchaseDate(), end, canceledAt);
    }

    // ── Google RTDN ────────────────────────────────────────────────

    /**
     * Pub/Sub 푸시 본문의 {@code message.data}(base64)를 받아 반영한다. 알림 내용은 믿지 않고 구매 토큰으로 구독을 다시 조회해
     * 현재 상태를 쓴다. 스토어 조회가 실패하면 {@link StoreException}(UPSTREAM)이 나가고 컨트롤러가 5xx 로 바꿔 Pub/Sub 이
     * 다시 보내게 한다.
     */
    public NotificationResult handleGoogleNotification(String base64Data) {
        if (!settings.appEnabled() || !google.configured()) {
            return NotificationResult.IGNORED;
        }
        JsonNode body;
        try {
            body = JSON.readTree(new String(Base64.getDecoder().decode(base64Data), StandardCharsets.UTF_8));
        } catch (Exception malformed) {
            throw new StoreException(StoreException.Kind.INVALID, "invalid_notification");
        }
        if (!google.packageName().equals(body.path("packageName").asText(""))) {
            return NotificationResult.IGNORED;
        }
        JsonNode notice = body.path("subscriptionNotification");
        String token = notice.path("purchaseToken").asText("");
        if (token.isBlank()) {
            return NotificationResult.IGNORED;
        }
        Optional<StoreRow> row = repository.findStore(BillingRules.PROVIDER_GOOGLE, token);
        if (row.isEmpty()) {
            return NotificationResult.IGNORED;
        }
        GoogleSubscription sub = google.get(token);
        if (!BillingRules.storeProduct(sub.productId())
                || !row.get().userId().toString().equals(sub.obfuscatedAccountId())) {
            LOG.warn("google notification does not match the stored subscription");
            return NotificationResult.IGNORED;
        }
        if ("SUBSCRIPTION_STATE_PENDING".equals(sub.state())) {
            return NotificationResult.IGNORED;
        }
        Instant now = clock.instant();
        boolean applied = repository.updateStore(BillingRules.PROVIDER_GOOGLE, token, googleState(token, sub, now), now);
        acknowledgeIfNeeded(sub, token);
        return applied ? NotificationResult.APPLIED : NotificationResult.IGNORED;
    }

    static StoreState googleState(String token, GoogleSubscription sub, Instant now) {
        Instant end = sub.expiryTime();
        Status status = switch (sub.state() == null ? "" : sub.state()) {
            case "SUBSCRIPTION_STATE_ACTIVE" -> sub.autoRenewing() ? Status.ACTIVE : Status.CANCELED;
            case "SUBSCRIPTION_STATE_CANCELED" -> Status.CANCELED;
            case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" -> Status.ACTIVE;
            case "SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PAUSED" -> Status.PAST_DUE;
            default -> Status.EXPIRED;
        };
        if (end == null) {
            status = Status.EXPIRED;
        } else if ("SUBSCRIPTION_STATE_IN_GRACE_PERIOD".equals(sub.state())) {
            end = end.plus(BillingRules.GOOGLE_GRACE);
        }
        Instant canceledAt = status == Status.CANCELED ? now : null;
        return new StoreState(BillingRules.PROVIDER_GOOGLE, sub.productId(), token, status, sub.startTime(), end, canceledAt);
    }

    private void acknowledgeIfNeeded(GoogleSubscription sub, String token) {
        if (sub.acknowledged()) {
            return;
        }
        String state = sub.state();
        if ("SUBSCRIPTION_STATE_ACTIVE".equals(state) || "SUBSCRIPTION_STATE_CANCELED".equals(state)
                || "SUBSCRIPTION_STATE_IN_GRACE_PERIOD".equals(state)) {
            google.acknowledge(sub.productId(), token);
        }
    }
}
