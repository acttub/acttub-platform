package com.acttub.actingapi.feature.billing.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.billing.app.BillingRepository.Checkout;
import com.acttub.actingapi.feature.billing.app.BillingRepository.Payment;
import com.acttub.actingapi.feature.billing.app.BillingRepository.Subscription;
import com.acttub.actingapi.feature.billing.app.BillingRules.Purpose;
import com.acttub.actingapi.feature.billing.app.BillingRules.Status;
import com.acttub.actingapi.feature.billing.app.PgReviewGateway.GatewayException;
import com.acttub.actingapi.platform.web.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 앱 ACTTUB Pro 정기결제의 규칙(SOMA-818, billing.subscription).
 *
 * <p>흐름: 앱이 {@link #startCheckout} 으로 일회용 카드 등록 창을 받아 브라우저로 연다 → 토스 카드 등록이 끝나면 토스가
 * 브라우저를 성공·실패 콜백으로 보낸다 → {@link #complete} 가 빌링키를 받아 암호문으로 저장하고(첫 구독이면) 3,900원을
 * 승인한다 → 브라우저는 앱 스킴으로 돌아가고 앱은 {@link #view} 로 결과를 다시 읽는다. 다음 달부터는
 * {@link RenewalWorker} 가 자동결제한다.
 *
 * <p><b>두 번 결제되지 않는다</b>: 결제 하나는 주문 ID 하나이고 그 주문 ID 가 토스 멱등 키다. 같은 주문 ID 의 기록이
 * 이미 있으면 새로 승인하지 않고 같은 키로 결과만 다시 묻는다. 결과를 모르면(시간 초과 등) 실패로 단정하지 않는다.
 *
 * <p>빌링키·authKey 는 로그·예외·응답 어디에도 싣지 않는다.
 */
public class SubscriptionService {
    private static final Logger LOG = LoggerFactory.getLogger(SubscriptionService.class);
    private static final Pattern GATEWAY_CODE = Pattern.compile("[A-Z0-9_]{1,64}");
    private static final Pattern STATE = Pattern.compile("[A-Za-z0-9_-]{43}");

    private final BillingSettings settings;
    private final BillingRepository repository;
    private final AppBillingGateway gateway;
    private final BillingKeyCipher cipher;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public SubscriptionService(BillingSettings settings, BillingRepository repository, AppBillingGateway gateway,
            BillingKeyCipher cipher, Clock clock) {
        this.settings = settings;
        this.repository = repository;
        this.gateway = gateway;
        this.cipher = cipher;
        this.clock = clock;
    }

    public BillingSettings settings() {
        return settings;
    }

    public boolean available() {
        return settings.usable();
    }

    // ── 조회 ───────────────────────────────────────────────────────

    public View view(UUID userId) {
        requireAvailable();
        Instant now = clock.instant();
        Optional<Subscription> found = repository.find(userId);
        if (found.isEmpty()) {
            return View.none(settings.limitsEnforced());
        }
        Subscription sub = found.get();
        boolean pro = BillingRules.pro(sub.status(), sub.periodEnd(), now);
        // expired 인데 기간이 한 번도 없으면 카드만 등록하고 첫 결제가 안 된 것이다 — 앱에는 아직 구독이 없는 것으로 보인다.
        String status = sub.status() == Status.EXPIRED && sub.periodEnd() == null ? "none" : sub.status().db();
        Instant nextBilling = switch (sub.status()) {
            case ACTIVE -> sub.periodEnd();
            case PAST_DUE -> sub.nextRetryAt();
            case CANCELED, EXPIRED -> null;
        };
        return new View(status, pro, sub.amount(), sub.periodEnd(), nextBilling, sub.cardCompany(),
                last4(sub.cardNumber()), sub.retryCount(), settings.limitsEnforced());
    }

    /** Pro 인가 — 결제 기능이 꺼져 있으면 아무도 Pro 가 아니다(그때는 무료 한도도 걸리지 않는다). */
    public boolean pro(UUID userId) {
        if (!available()) {
            return false;
        }
        return repository.find(userId)
                .map(sub -> BillingRules.pro(sub.status(), sub.periodEnd(), clock.instant()))
                .orElse(false);
    }

    // ── 카드 등록 창 ────────────────────────────────────────────────

    /**
     * 일회용 카드 등록 창을 연다. state 원문은 돌려주는 주소에만 있고 DB 에는 해시만 남는다.
     *
     * @throws ApiException 403 {@code billing_member_required}(게스트), 409 {@code already_subscribed}(Pro 이용 중이거나
     *     자동결제 실패 중에 새 구독), 409 {@code no_subscription}(구독 없이 카드 바꾸기), 409
     *     {@code payment_pending}(앞선 결제의 결과를 아직 모름), 422 {@code invalid_purpose}
     */
    public StartedCheckout startCheckout(UUID userId, boolean guest, String purposeValue) {
        requireAvailable();
        if (guest) {
            throw new ApiException(403, "billing_member_required");
        }
        Purpose purpose = Purpose.of(purposeValue == null ? "subscribe" : purposeValue);
        if (purpose == null) {
            throw new ApiException(422, "invalid_purpose");
        }
        Optional<Subscription> existing = repository.find(userId);
        Status status = existing.map(Subscription::status).orElse(Status.EXPIRED);
        if (purpose == Purpose.SUBSCRIBE && status != Status.EXPIRED) {
            throw new ApiException(409, "already_subscribed");
        }
        if (purpose == Purpose.CHANGE_CARD && status == Status.EXPIRED) {
            throw new ApiException(409, "no_subscription");
        }
        if (purpose == Purpose.SUBSCRIBE && repository.hasUnresolvedPayment(userId)) {
            // 앞선 결제의 결과를 아직 모른다. 새 주문을 만들면 두 번 결제될 수 있다.
            throw new ApiException(409, "payment_pending");
        }
        Instant now = clock.instant();
        String state = newState();
        UUID checkoutId = UUID.randomUUID();
        String customerKey = existing.map(Subscription::customerKey).orElseGet(SubscriptionService::newCustomerKey);
        Instant expiresAt = now.plus(BillingRules.CHECKOUT_TTL);
        repository.openCheckout(new Checkout(checkoutId, userId, hash(state), purpose, customerKey,
                BillingRules.firstOrderId(checkoutId), expiresAt));
        return new StartedCheckout(settings.origin() + "/v2/billing/web/checkout/" + state, settings.returnUrl(),
                expiresAt);
    }

    /** 결제 창 페이지가 쓸 값. 열린 창이 아니면 비어 있다. */
    public Optional<CheckoutPage> page(String state) {
        if (!available() || state == null || !STATE.matcher(state).matches()) {
            return Optional.empty();
        }
        return repository.findOpenCheckout(hash(state), clock.instant())
                .map(checkout -> new CheckoutPage(
                        settings.clientKey(),
                        checkout.customerKey(),
                        checkout.purpose(),
                        settings.origin() + "/v2/billing/web/checkout/" + state + "/success",
                        settings.origin() + "/v2/billing/web/checkout/" + state + "/fail",
                        settings.returnUrl()));
    }

    /**
     * 토스 성공 콜백. 예외를 던지지 않는다 — 부르는 쪽은 결과를 앱 주소에 실어 돌려보낸다. 창은 한 번만 집히므로
     * 같은 콜백이 두 번 와도 두 번째는 {@link Result#INVALID} 이고 결제는 한 번이다.
     */
    public Result complete(String state, String customerKey, String authKey) {
        if (!available() || state == null || !STATE.matcher(state).matches()) {
            return Result.INVALID;
        }
        Instant now = clock.instant();
        Optional<Checkout> claimed = repository.claimCheckout(hash(state), now);
        if (claimed.isEmpty()) {
            return Result.INVALID;
        }
        Checkout checkout = claimed.get();
        Result result;
        try {
            result = register(checkout, customerKey, authKey, now);
        } catch (RuntimeException unexpected) {
            LOG.error("billing checkout failed unexpectedly checkout={} type={}", checkout.id(),
                    unexpected.getClass().getSimpleName());
            result = Result.UNKNOWN;
        }
        repository.finishCheckout(checkout.id(), result.db(), null, clock.instant());
        LOG.info("billing checkout finished checkout={} purpose={} result={}", checkout.id(), checkout.purpose().db(),
                result.db());
        return result;
    }

    /** 토스 실패 콜백(사용자 취소 포함). 창을 닫는다. */
    public Result fail(String state, String gatewayCode) {
        if (!available() || state == null || !STATE.matcher(state).matches()) {
            return Result.INVALID;
        }
        Optional<Checkout> claimed = repository.claimCheckout(hash(state), clock.instant());
        if (claimed.isEmpty()) {
            return Result.INVALID;
        }
        String code = gatewayCode != null && GATEWAY_CODE.matcher(gatewayCode).matches() ? gatewayCode : "registration_failed";
        Result result = "PAY_PROCESS_CANCELED".equals(code) || "USER_CANCEL".equals(code) ? Result.CANCELED : Result.FAILED;
        repository.finishCheckout(claimed.get().id(), result.db(), code, clock.instant());
        return result;
    }

    private Result register(Checkout checkout, String customerKey, String authKey, Instant now) {
        if (authKey == null || authKey.isBlank() || authKey.length() > 300
                || !checkout.customerKey().equals(customerKey)) {
            return Result.FAILED;
        }
        PgReviewGateway.IssuedKey issued;
        try {
            issued = gateway.issue(authKey, checkout.customerKey());
        } catch (GatewayException e) {
            // 빌링키를 못 받았으니 승인은 시도하지 않았다 — 돈이 움직일 수 없다.
            return Result.FAILED;
        }
        UUID subscriptionId = repository.saveCard(checkout.userId(), checkout.customerKey(),
                cipher.seal(issued.billingKey()), issued.cardCompany(), issued.cardNumber(), now);
        Subscription sub = repository.findById(subscriptionId).orElseThrow();
        if (checkout.purpose() == Purpose.CHANGE_CARD) {
            // 카드만 바꾼다. 자동결제가 실패해 있던 구독이면 새 카드로 바로 한 번 더 시도한다.
            if (sub.status() == Status.PAST_DUE) {
                return renew(sub, now) == Charge.DONE ? Result.DONE : Result.FAILED;
            }
            return Result.DONE;
        }
        if (sub.status() != Status.EXPIRED) {
            // 창을 연 뒤 다른 창으로 이미 구독했다. 카드만 새것으로 바뀌었고 결제는 하지 않는다.
            return Result.DONE;
        }
        Instant end = BillingRules.nextPeriodEnd(now);
        Charge charge = charge(sub, checkout.orderId(), "first", now, end, 1);
        return switch (charge) {
            case DONE -> {
                repository.activate(sub.id(), now, end, clock.instant());
                yield Result.DONE;
            }
            case FAILED -> Result.FAILED;
            case UNKNOWN -> Result.UNKNOWN;
        };
    }

    // ── 해지·다시 시도 ──────────────────────────────────────────────

    /** 자동결제만 해지한다 — 이번 결제기간이 끝날 때까지 Pro 다. 이미 해지했으면 그대로 돌려준다. */
    public View cancel(UUID userId) {
        requireAvailable();
        Subscription sub = repository.find(userId).orElseThrow(() -> new ApiException(409, "no_subscription"));
        switch (sub.status()) {
            case ACTIVE -> repository.cancel(sub.id(), clock.instant());
            // 자동결제가 실패해 있는 구독은 더 시도하지 않고 바로 끝낸다(Pro 기간이 이미 지났다).
            case PAST_DUE -> repository.expire(sub.id(), clock.instant());
            case CANCELED -> { }
            case EXPIRED -> throw new ApiException(409, "no_subscription");
        }
        return view(userId);
    }

    /** 「결제하지 못했어요 → 다시 시도」. past_due 일 때만 지금 한 번 더 결제한다. 같은 시도는 두 번 결제되지 않는다. */
    public View retry(UUID userId) {
        requireAvailable();
        Subscription sub = repository.find(userId).orElseThrow(() -> new ApiException(409, "no_subscription"));
        if (sub.status() != Status.PAST_DUE) {
            throw new ApiException(409, "not_past_due");
        }
        renew(sub, clock.instant());
        return view(userId);
    }

    // ── 결제(스케줄러와 함께 쓴다) ──────────────────────────────────

    /**
     * 다음 기간을 결제한다. 이 기간의 앞선 시도가 이미 성공했으면 결제 없이 기간만 넘기고, 결과를 모르는 시도가 있으면
     * 새로 결제하지 않는다(그 시도는 {@link RenewalWorker} 가 같은 키로 다시 묻는다).
     */
    Charge renew(Subscription sub, Instant now) {
        Instant start = sub.periodEnd();
        if (start == null) {
            return Charge.FAILED;
        }
        Instant end = BillingRules.nextPeriodEnd(start);
        Optional<Payment> last = repository.lastPayment(sub.id(), start);
        if (last.isPresent() && "done".equals(last.get().status())) {
            repository.advance(sub.id(), start, end, now);
            return Charge.DONE;
        }
        if (last.isPresent() && ("unknown".equals(last.get().status()) || "pending".equals(last.get().status()))) {
            return Charge.UNKNOWN;
        }
        int attempt = last.map(payment -> payment.attempt() + 1).orElse(1);
        Charge charge = charge(sub, BillingRules.renewalOrderId(sub.id(), start, attempt), "renewal", start, end, attempt);
        applyRenewal(sub, charge, start, end, now);
        return charge;
    }

    void applyRenewal(Subscription sub, Charge charge, Instant start, Instant end, Instant now) {
        switch (charge) {
            case DONE -> repository.advance(sub.id(), start, end, now);
            case FAILED -> {
                int failures = sub.retryCount() + 1;
                if (failures > BillingRules.MAX_RETRIES) {
                    repository.expire(sub.id(), now);
                    LOG.info("billing subscription expired after retries subscription={}", sub.id());
                } else {
                    repository.markPastDue(sub.id(), failures, now.plus(BillingRules.RETRY_DELAY), now);
                }
            }
            case UNKNOWN -> { }
        }
    }

    /**
     * 주문 하나를 승인한다. 주문 ID 의 기록을 먼저 남기고(이미 있으면 그 기록의 결과를 따른다) 그 주문 ID 를 멱등 키로
     * 승인한다.
     */
    Charge charge(Subscription sub, String orderId, String kind, Instant start, Instant end, int attempt) {
        Instant now = clock.instant();
        boolean inserted = repository.insertPayment(new Payment(UUID.randomUUID(), sub.id(), sub.userId(), orderId, kind,
                sub.amount(), "pending", start, end, attempt));
        if (!inserted) {
            Payment existing = repository.findPayment(orderId).orElseThrow();
            if ("done".equals(existing.status())) {
                return Charge.DONE;
            }
            if ("failed".equals(existing.status())) {
                return Charge.FAILED;
            }
            // pending·unknown: 같은 키로 다시 묻는다 — 토스가 같은 결제로 본다.
        }
        return ask(sub, orderId, now);
    }

    /** 같은 주문 ID(=멱등 키)로 승인을 요청하고 결과를 기록한다. */
    Charge ask(Subscription sub, String orderId, Instant now) {
        if (sub.sealedBillingKey() == null) {
            repository.finishPayment(orderId, "failed", null, "billing_key_missing", now);
            return Charge.FAILED;
        }
        PgReviewGateway.Approval approval;
        try {
            approval = gateway.approve(cipher.open(sub.sealedBillingKey()), sub.customerKey(), orderId, sub.amount(),
                    BillingRules.ORDER_NAME, orderId);
        } catch (GatewayException e) {
            String code = e.code() != null && GATEWAY_CODE.matcher(e.code()).matches() ? e.code() : "gateway_error";
            if (e.outcome() == GatewayException.Outcome.UNKNOWN) {
                repository.finishPayment(orderId, "unknown", null, code, now);
                return Charge.UNKNOWN;
            }
            repository.finishPayment(orderId, "failed", null, code, now);
            return Charge.FAILED;
        }
        if (approval == null || !"DONE".equals(approval.status()) || !orderId.equals(approval.orderId())
                || approval.amount() != sub.amount()) {
            repository.finishPayment(orderId, "unknown", null, "verification_mismatch", now);
            return Charge.UNKNOWN;
        }
        repository.finishPayment(orderId, "done", approval.approvedAt(), null, now);
        return Charge.DONE;
    }

    private void requireAvailable() {
        if (!available()) {
            throw new ApiException(404, "billing_unavailable");
        }
    }

    private String newState() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String newCustomerKey() {
        return "acttub_" + UUID.randomUUID().toString().replace("-", "");
    }

    static String hash(String state) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(state.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    static String last4(String cardNumber) {
        if (cardNumber == null) {
            return null;
        }
        String trimmed = cardNumber.replace("-", "").replace(" ", "");
        return trimmed.length() < 4 ? null : trimmed.substring(trimmed.length() - 4);
    }

    enum Charge {
        DONE,
        FAILED,
        UNKNOWN
    }

    /** 콜백의 결과. 앱으로 돌아가는 주소의 {@code status} 값이기도 하다. */
    public enum Result {
        DONE("done"),
        FAILED("failed"),
        UNKNOWN("unknown"),
        CANCELED("canceled"),
        /** 없는·지난·이미 쓴 창. */
        INVALID("invalid");

        private final String db;

        Result(String db) {
            this.db = db;
        }

        public String db() {
            return db;
        }
    }

    public record StartedCheckout(String checkoutUrl, String returnUrl, Instant expiresAt) {
    }

    public record CheckoutPage(String clientKey, String customerKey, Purpose purpose, String successUrl, String failUrl,
            String returnUrl) {
        @Override
        public String toString() {
            return "CheckoutPage[purpose=" + purpose + ", redacted]";
        }
    }

    /**
     * 앱이 화면을 가르는 값. status 는 none(구독 없음)·active·canceled·past_due·expired.
     *
     * @param nextBillingAt active 면 다음 결제일, past_due 면 다음 재시도, 그 밖에는 {@code null}
     */
    public record View(
            String status,
            boolean pro,
            long amount,
            Instant periodEnd,
            Instant nextBillingAt,
            String cardCompany,
            String cardLast4,
            int retryCount,
            boolean limitsEnforced) {

        static View none(boolean limitsEnforced) {
            return new View("none", false, BillingRules.AMOUNT, null, null, null, null, 0, limitsEnforced);
        }
    }
}
