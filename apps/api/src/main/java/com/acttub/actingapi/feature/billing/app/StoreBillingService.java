package com.acttub.actingapi.feature.billing.app;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.BillingRepository.StoreSave;
import com.acttub.actingapi.feature.billing.app.BillingRepository.StoreState;
import com.acttub.actingapi.feature.billing.app.BillingRepository.Subscription;
import com.acttub.actingapi.feature.billing.app.BillingRules.Status;
import com.acttub.actingapi.feature.billing.app.StoreGateways.RevenueCatGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreSubscription;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 앱 스토어 구독(App Store·Google Play)을 RevenueCat 으로 받는다(SOMA-818 2단계, billing.store).
 *
 * <p>앱은 RevenueCat SDK 로 사고 {@code Purchases.logIn(우리 user id)} 로 구매자를 묶는다. 서버는 영수증을 직접 보지 않고, 앱의 동기화
 * 요청과 RevenueCat 웹훅이 올 때마다 RevenueCat REST API 로 그 사람의 entitlement 현재 상태를 <b>다시 읽어</b>
 * {@code billing_subscriptions} 한 줄을 덮어쓴다. 웹훅 본문의 상태 값은 믿지 않고 사람(app_user_id)만 고른다 — 그래서 같은 웹훅이
 * 여러 번 오거나 순서가 바뀌어 와도 결과가 같다(멱등).
 *
 * <p>구독은 사람당 한 줄이다. 토스로 이용 중인 줄은 스토어 상태로 덮지 않는다. 출처(provider)는 RevenueCat 의 store 로 apple·google 을
 * 고른다. 같은 스토어 계정의 구매를 여러 우리 계정이 복원할 때 누구에게 줄지는 RevenueCat 의 복원 규칙(transfer)이 정하고, 옮겨지면
 * TRANSFER 웹훅으로 양쪽을 다시 읽는다.
 */
public class StoreBillingService {
    private static final Logger LOG = LoggerFactory.getLogger(StoreBillingService.class);
    /** 웹훅 하나가 다시 읽게 하는 사람 수의 상한(별칭·이전 대상 포함). */
    static final int MAX_USERS_PER_EVENT = 10;

    private final BillingSettings settings;
    private final BillingRepository repository;
    private final SubscriptionService subscriptions;
    private final RevenueCatGateway revenueCat;
    private final Clock clock;
    private final boolean allowSandbox;

    /** 샌드박스 구매는 받지 않는다(운영 기본). */
    public StoreBillingService(BillingSettings settings, BillingRepository repository, SubscriptionService subscriptions,
            RevenueCatGateway revenueCat, Clock clock) {
        this(settings, repository, subscriptions, revenueCat, clock, false);
    }

    /** @param allowSandbox 샌드박스 구매(is_sandbox)로도 Pro 를 여는가. dev 서버만 true({@code BILLING_REVENUECAT_ALLOW_SANDBOX}). */
    public StoreBillingService(BillingSettings settings, BillingRepository repository, SubscriptionService subscriptions,
            RevenueCatGateway revenueCat, Clock clock, boolean allowSandbox) {
        this.settings = settings;
        this.repository = repository;
        this.subscriptions = subscriptions;
        this.revenueCat = revenueCat;
        this.clock = clock;
        this.allowSandbox = allowSandbox;
    }

    public enum NotificationResult { APPLIED, IGNORED }

    /** 한 사람을 다시 읽은 결과. BLOCKED 는 토스로 이용 중이라 스토어 구독을 쓰지 않은 경우다. */
    enum Outcome { APPLIED, UNCHANGED, BLOCKED }

    // ── 앱의 동기화 ────────────────────────────────────────────────

    /**
     * 앱이 구매·복원 뒤(그리고 앱을 켤 때) 부른다. RevenueCat 에서 이 사람의 상태를 읽어 반영하고 {@code GET /v2/billing/me} 와 같은
     * 모양을 돌려준다. 같은 요청을 여러 번 보내도 결과가 같다.
     *
     * @throws ApiException 404 {@code billing_unavailable}(앱 결제 꺼짐), 403 {@code billing_member_required}, 409
     *     {@code already_subscribed}(토스로 이용 중인데 스토어 구독도 유효), 503 {@code store_unavailable}, 502 {@code store_upstream_error}
     */
    public SubscriptionService.View sync(UUID userId, boolean guest) {
        if (!settings.appEnabled()) {
            throw new ApiException(404, "billing_unavailable");
        }
        if (guest) {
            throw new ApiException(403, "billing_member_required");
        }
        Outcome outcome;
        try {
            outcome = apply(userId, clock.instant());
        } catch (StoreException failure) {
            throw translate(failure);
        }
        if (outcome == Outcome.BLOCKED) {
            throw new ApiException(409, "already_subscribed");
        }
        return subscriptions.view(userId);
    }

    private static ApiException translate(StoreException failure) {
        return switch (failure.kind()) {
            case INVALID, UPSTREAM -> ApiException.external(502, "store_upstream_error", failure);
            case UNAVAILABLE -> ApiException.external(503, "store_unavailable", failure);
        };
    }

    // ── RevenueCat 웹훅 ────────────────────────────────────────────

    /**
     * 인증(Authorization 헤더)은 컨트롤러가 먼저 본다. 본문에서는 사람만 고르고(app_user_id·original_app_user_id·aliases·
     * transferred_from·transferred_to 중 우리 user id 꼴인 것) 각자를 RevenueCat 에서 다시 읽는다. 우리 사람이 없거나(익명 ID·TEST)
     * 기능이 꺼져 있으면 무시하고 성공으로 돌려준다. RevenueCat 조회가 실패하면 {@link StoreException}(UPSTREAM)이 나가고 컨트롤러가
     * 5xx 로 바꿔 RevenueCat 이 다시 보내게 한다.
     */
    public NotificationResult handleRevenueCatEvent(JsonNode body) {
        JsonNode event = body == null ? null : body.get("event");
        if (event == null || !event.isObject()) {
            throw new StoreException(StoreException.Kind.INVALID, "invalid_notification");
        }
        if (!settings.appEnabled() || !revenueCat.configured()) {
            return NotificationResult.IGNORED;
        }
        String type = event.path("type").asText("");
        if ("TEST".equals(type)) {
            return NotificationResult.IGNORED;
        }
        Set<UUID> users = users(event);
        if (users.isEmpty()) {
            return NotificationResult.IGNORED;
        }
        Instant now = clock.instant();
        boolean applied = false;
        for (UUID user : users) {
            Outcome outcome = apply(user, now);
            if (outcome == Outcome.BLOCKED) {
                LOG.warn("revenuecat event skipped: user already pays on the web type={}", type);
            }
            applied |= outcome == Outcome.APPLIED;
        }
        return applied ? NotificationResult.APPLIED : NotificationResult.IGNORED;
    }

    /** 웹훅이 가리키는 우리 사람들(중복 없이, 최대 {@link #MAX_USERS_PER_EVENT}). user id 꼴(UUID)이 아닌 값은 버린다. */
    static Set<UUID> users(JsonNode event) {
        Set<UUID> users = new LinkedHashSet<>();
        for (String field : new String[] {"app_user_id", "original_app_user_id", "aliases", "transferred_from", "transferred_to"}) {
            JsonNode value = event.get(field);
            if (value == null) {
                continue;
            }
            if (value.isArray()) {
                value.forEach(item -> addUser(users, item));
            } else {
                addUser(users, value);
            }
        }
        return users;
    }

    private static void addUser(Set<UUID> users, JsonNode value) {
        if (!value.isTextual() || users.size() >= MAX_USERS_PER_EVENT) {
            return;
        }
        String text = value.asText();
        if (text.length() != 36) {
            return;
        }
        try {
            users.add(UUID.fromString(text));
        } catch (IllegalArgumentException notOurs) {
            // RevenueCat 익명 ID 등 — 우리 사람이 아니다.
        }
    }

    // ── 한 사람 다시 읽기(동기화·웹훅 공통) ─────────────────────────

    /** RevenueCat 의 현재 상태를 이 사람의 구독 줄에 쓴다. 같은 상태를 여러 번 써도 결과가 같다. */
    Outcome apply(UUID userId, Instant now) {
        Optional<StoreState> state = revenueCat.entitlement(userId.toString()).flatMap(sub -> storeState(sub, now, allowSandbox));
        Optional<Subscription> existing = repository.find(userId);
        boolean webActive = existing.isPresent() && existing.get().toss() && existing.get().status() != Status.EXPIRED;
        if (state.isEmpty()) {
            // RevenueCat 에 이 사람의 스토어 entitlement 가 없다(산 적 없음, 다른 계정으로 옮겨짐). 스토어 줄이 남아 있으면 끝낸다.
            if (existing.isPresent() && !existing.get().toss() && existing.get().status() != Status.EXPIRED) {
                return repository.expireStore(userId, now) ? Outcome.APPLIED : Outcome.UNCHANGED;
            }
            return Outcome.UNCHANGED;
        }
        StoreState next = state.get();
        boolean nextPro = BillingRules.pro(next.status(), next.periodEnd(), now, next.provider());
        if (webActive) {
            // 토스로 이용 중인 줄은 덮지 않는다(사람당 한 줄).
            return nextPro ? Outcome.BLOCKED : Outcome.UNCHANGED;
        }
        if (existing.isEmpty() && next.status() == Status.EXPIRED) {
            // 끝난 옛 구매만 있다 — 빈 줄을 새로 만들지 않는다.
            return Outcome.UNCHANGED;
        }
        StoreSave saved = repository.saveStore(userId, next, now);
        if (saved == StoreSave.BLOCKED) {
            // 그사이 토스 결제가 들어왔거나 사람이 없다(탈퇴).
            return nextPro && existing.isPresent() ? Outcome.BLOCKED : Outcome.UNCHANGED;
        }
        return Outcome.APPLIED;
    }

    /**
     * RevenueCat 구독 값을 우리 상태로 옮긴다(순수 함수). 우리 상품이 아니거나 App Store·Play 가 아닌 출처(프로모션·웹 등)이거나,
     * 샌드박스를 받지 않는데 샌드박스 구매면 비어 있다(운영 서버가 테스트 결제로 Pro 를 열지 않게).
     *
     * <ul>
     *   <li>환불(이번 기간 시작 뒤에 알아챈 refunded_at) → expired</li>
     *   <li>기간 안: 자동 갱신 끔 → canceled(기간 끝까지 Pro), 아니면 active(결제 문제가 있어도 기간 안이면 active)</li>
     *   <li>기간 지남: 결제 유예 안 → active(유예 끝까지), 결제 문제(billing issue) → past_due(Pro 아님), 그 밖 → expired</li>
     * </ul>
     */
    static Optional<StoreState> storeState(StoreSubscription sub, Instant now, boolean allowSandbox) {
        String provider = provider(sub.store());
        if (provider == null || !BillingRules.storeProduct(sub.productId()) || (sub.sandbox() && !allowSandbox)) {
            return Optional.empty();
        }
        Instant end = sub.expiresDate();
        boolean refunded = sub.refundedAt() != null
                && (sub.purchaseDate() == null || !sub.refundedAt().isBefore(sub.purchaseDate()));
        Status status;
        if (refunded || end == null) {
            status = Status.EXPIRED;
        } else if (end.isAfter(now)) {
            status = sub.unsubscribeDetectedAt() != null ? Status.CANCELED : Status.ACTIVE;
        } else if (sub.gracePeriodExpiresDate() != null && sub.gracePeriodExpiresDate().isAfter(now)) {
            status = Status.ACTIVE;
            end = sub.gracePeriodExpiresDate();
        } else if (sub.billingIssuesDetectedAt() != null) {
            status = Status.PAST_DUE;
        } else {
            status = Status.EXPIRED;
        }
        Instant canceledAt = status == Status.CANCELED ? sub.unsubscribeDetectedAt() : null;
        return Optional.of(new StoreState(provider, sub.productId(), sub.storeTransactionId(), status, sub.purchaseDate(), end,
                canceledAt));
    }

    /** RevenueCat store → 우리 출처. App Store·Mac App Store 는 apple, Play 는 google, 나머지는 받지 않는다. */
    static String provider(String store) {
        if (store == null) {
            return null;
        }
        return switch (store.toLowerCase(java.util.Locale.ROOT)) {
            case "app_store", "mac_app_store" -> BillingRules.PROVIDER_APPLE;
            case "play_store" -> BillingRules.PROVIDER_GOOGLE;
            default -> null;
        };
    }
}
