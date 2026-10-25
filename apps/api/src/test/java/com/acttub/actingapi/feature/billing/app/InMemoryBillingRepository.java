package com.acttub.actingapi.feature.billing.app;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.BillingRules.Status;

/** 단위 테스트용 장부. 저장소 SQL 의 조건부 갱신을 같은 조건으로 흉내 낸다. */
class InMemoryBillingRepository implements BillingRepository {
    final Map<UUID, Subscription> subscriptions = new LinkedHashMap<>();
    final Map<String, Checkout> checkouts = new LinkedHashMap<>();
    final Map<String, String> checkoutStatus = new LinkedHashMap<>();
    final Map<String, Payment> payments = new LinkedHashMap<>();
    final Map<UUID, Instant> leases = new LinkedHashMap<>();
    final Map<UUID, java.util.List<Instant[]>> grants = new LinkedHashMap<>();
    int sessionsToday;
    int scripts;

    @Override
    public Optional<Subscription> find(UUID userId) {
        return subscriptions.values().stream().filter(s -> s.userId().equals(userId)).findFirst();
    }

    @Override
    public Optional<Subscription> findById(UUID subscriptionId) {
        return Optional.ofNullable(subscriptions.get(subscriptionId));
    }

    @Override
    public int coachingSessionsSince(UUID userId, Instant since) {
        return sessionsToday;
    }

    /** 테스트용 스토어(apple·google) 구독 한 줄. */
    UUID storeSubscription(UUID userId, String provider, Status status, Instant periodEnd) {
        UUID id = UUID.randomUUID();
        subscriptions.put(id, new Subscription(id, userId, status, null, null, null, null, BillingRules.AMOUNT,
                periodEnd == null ? null : periodEnd.minusSeconds(86400L * 30), periodEnd, null, 0, null, provider));
        return id;
    }

    /** 테스트용 Pro 기간 부여. */
    void grant(UUID userId, Instant from, Instant to) {
        grants.computeIfAbsent(userId, k -> new java.util.ArrayList<>()).add(new Instant[] {from, to});
    }

    @Override
    public Optional<Instant> grantEnd(UUID userId, Instant now) {
        return grants.getOrDefault(userId, java.util.List.of()).stream()
                .filter(g -> !g[0].isAfter(now) && g[1].isAfter(now)).map(g -> g[1]).max(Instant::compareTo);
    }

    @Override
    public int scriptCount(UUID userId) {
        return scripts;
    }

    @Override
    public void openCheckout(Checkout checkout) {
        checkouts.put(checkout.stateHash(), checkout);
        checkoutStatus.put(checkout.stateHash(), "open");
    }

    @Override
    public Optional<Checkout> claimCheckout(String stateHash, Instant now) {
        Optional<Checkout> open = findOpenCheckout(stateHash, now);
        open.ifPresent(c -> checkoutStatus.put(stateHash, "processing"));
        return open;
    }

    @Override
    public Optional<Checkout> findOpenCheckout(String stateHash, Instant now) {
        Checkout checkout = checkouts.get(stateHash);
        if (checkout == null || !"open".equals(checkoutStatus.get(stateHash)) || !checkout.expiresAt().isAfter(now)) {
            return Optional.empty();
        }
        return Optional.of(checkout);
    }

    @Override
    public void finishCheckout(UUID checkoutId, String status, String resultCode, Instant now) {
        checkouts.values().stream().filter(c -> c.id().equals(checkoutId)).findFirst()
                .ifPresent(c -> checkoutStatus.put(c.stateHash(), status));
    }

    @Override
    public UUID saveCard(UUID userId, String customerKey, String sealedBillingKey, String cardCompany, String cardNumber,
            Instant now) {
        Optional<Subscription> existing = find(userId);
        if (existing.isEmpty()) {
            UUID id = UUID.randomUUID();
            subscriptions.put(id, new Subscription(id, userId, Status.EXPIRED, customerKey, sealedBillingKey, cardCompany,
                    cardNumber, BillingRules.AMOUNT, null, null, null, 0, null, "toss"));
            return id;
        }
        Subscription s = existing.get();
        put(new Subscription(s.id(), userId, s.status(), customerKey, sealedBillingKey, cardCompany, cardNumber,
                s.amount(), s.periodStart(), s.periodEnd(), s.canceledAt(), s.retryCount(), s.nextRetryAt(), s.provider()));
        return s.id();
    }

    @Override
    public void activate(UUID id, Instant periodStart, Instant periodEnd, Instant now) {
        Subscription s = subscriptions.get(id);
        put(new Subscription(id, s.userId(), Status.ACTIVE, s.customerKey(), s.sealedBillingKey(), s.cardCompany(),
                s.cardNumber(), s.amount(), periodStart, periodEnd, null, 0, null, s.provider()));
    }

    @Override
    public void advance(UUID id, Instant periodStart, Instant periodEnd, Instant now) {
        Subscription s = subscriptions.get(id);
        if (s.status() == Status.EXPIRED || !periodStart.equals(s.periodEnd())) {
            return;
        }
        Status next = s.status() == Status.CANCELED ? Status.CANCELED : Status.ACTIVE;
        put(new Subscription(id, s.userId(), next, s.customerKey(), s.sealedBillingKey(), s.cardCompany(),
                s.cardNumber(), s.amount(), periodStart, periodEnd, s.canceledAt(), 0, null, s.provider()));
    }

    @Override
    public void markPastDue(UUID id, int retryCount, Instant nextRetryAt, Instant now) {
        Subscription s = subscriptions.get(id);
        if (s.status() != Status.ACTIVE && s.status() != Status.PAST_DUE) {
            return;
        }
        put(new Subscription(id, s.userId(), Status.PAST_DUE, s.customerKey(), s.sealedBillingKey(), s.cardCompany(),
                s.cardNumber(), s.amount(), s.periodStart(), s.periodEnd(), s.canceledAt(), retryCount, nextRetryAt, s.provider()));
    }

    @Override
    public void expire(UUID id, Instant now) {
        Subscription s = subscriptions.get(id);
        put(new Subscription(id, s.userId(), Status.EXPIRED, s.customerKey(), null, s.cardCompany(), s.cardNumber(),
                s.amount(), s.periodStart(), s.periodEnd(), s.canceledAt(), s.retryCount(), null, s.provider()));
    }

    @Override
    public boolean cancel(UUID id, Instant now) {
        Subscription s = subscriptions.get(id);
        if (s.status() != Status.ACTIVE) {
            return false;
        }
        put(new Subscription(id, s.userId(), Status.CANCELED, s.customerKey(), s.sealedBillingKey(), s.cardCompany(),
                s.cardNumber(), s.amount(), s.periodStart(), s.periodEnd(), now, s.retryCount(), s.nextRetryAt(), s.provider()));
        return true;
    }

    @Override
    public Optional<UUID> claimDue(Instant now, Duration lease) {
        return subscriptions.values().stream()
                .filter(s -> s.toss() && (((s.status() == Status.ACTIVE || s.status() == Status.CANCELED)
                        && s.periodEnd() != null && !s.periodEnd().isAfter(now))
                        || (s.status() == Status.PAST_DUE && s.nextRetryAt() != null && !s.nextRetryAt().isAfter(now))))
                .filter(s -> leases.get(s.id()) == null || leases.get(s.id()).isBefore(now))
                .filter(s -> payments.values().stream().noneMatch(p -> p.subscriptionId().equals(s.id())
                        && ("pending".equals(p.status()) || "unknown".equals(p.status()))))
                .findFirst()
                .map(s -> {
                    leases.put(s.id(), now.plus(lease));
                    return s.id();
                });
    }

    @Override
    public void release(UUID id) {
        leases.remove(id);
    }

    @Override
    public boolean insertPayment(Payment payment) {
        if (payments.containsKey(payment.orderId())) {
            return false;
        }
        payments.put(payment.orderId(), payment);
        return true;
    }

    @Override
    public Optional<Payment> findPayment(String orderId) {
        return Optional.ofNullable(payments.get(orderId));
    }

    @Override
    public boolean hasUnresolvedPayment(UUID userId) {
        return payments.values().stream()
                .anyMatch(p -> p.userId().equals(userId) && ("pending".equals(p.status()) || "unknown".equals(p.status())));
    }

    @Override
    public Optional<Payment> lastPayment(UUID subscriptionId, Instant periodStart) {
        return payments.values().stream()
                .filter(p -> p.subscriptionId().equals(subscriptionId) && p.periodStart().equals(periodStart))
                .max(Comparator.comparingInt(Payment::attempt));
    }

    @Override
    public void finishPayment(String orderId, String status, String approvedAt, String failureCode, Instant now) {
        Payment p = payments.get(orderId);
        if (p == null || "done".equals(p.status())) {
            return;
        }
        payments.put(orderId, new Payment(p.id(), p.subscriptionId(), p.userId(), p.orderId(), p.kind(), p.amount(),
                status, p.periodStart(), p.periodEnd(), p.attempt()));
    }

    @Override
    public Optional<Payment> claimUnknownPayment(Instant now, Duration quietFor, int maxChecks) {
        List<Payment> unknown = new ArrayList<>(payments.values().stream()
                .filter(p -> "unknown".equals(p.status())).toList());
        return unknown.isEmpty() ? Optional.empty() : Optional.of(unknown.get(0));
    }

    // ── 스토어 구독 ────────────────────────────────────────────────
    final Map<UUID, String> storeKeys = new LinkedHashMap<>();
    final Map<UUID, Instant> storeUpdatedAt = new LinkedHashMap<>();
    /** 다른 계정이 이미 쓰는 키처럼 유니크 위반을 흉내 내려면 true. */
    boolean uniqueViolation;

    @Override
    public Optional<StoreRow> findStore(String provider, String key) {
        return subscriptions.values().stream()
                .filter(s -> provider.equals(s.provider()) && key.equals(storeKeys.get(s.id())))
                .findFirst()
                .map(s -> new StoreRow(s.id(), s.userId(), s.provider(), s.status(), s.periodEnd(), storeUpdatedAt.get(s.id())));
    }

    @Override
    public StoreSave saveStore(UUID userId, StoreState state, Instant now) {
        if (uniqueViolation) {
            return StoreSave.TAKEN;
        }
        Optional<Subscription> existing = find(userId);
        UUID id = existing.map(Subscription::id).orElseGet(UUID::randomUUID);
        if (existing.isPresent() && existing.get().toss() && existing.get().status() != Status.EXPIRED) {
            return StoreSave.BLOCKED;
        }
        put(new Subscription(id, userId, state.status(), null, null, null, null, BillingRules.AMOUNT, state.periodStart(),
                state.periodEnd(), state.canceledAt(), 0, null, state.provider()));
        storeKeys.put(id, state.key());
        storeUpdatedAt.put(id, now);
        return StoreSave.SAVED;
    }

    @Override
    public boolean updateStore(String provider, String key, StoreState state, Instant now) {
        Optional<StoreRow> row = findStore(provider, key);
        if (row.isEmpty()) {
            return false;
        }
        Subscription s = subscriptions.get(row.get().subscriptionId());
        put(new Subscription(s.id(), s.userId(), state.status(), null, null, null, null, s.amount(),
                state.periodStart() == null ? s.periodStart() : state.periodStart(), state.periodEnd(),
                state.status() == Status.CANCELED ? now : null, 0, null, s.provider()));
        storeUpdatedAt.put(s.id(), now);
        return true;
    }

    private void put(Subscription s) {
        subscriptions.put(s.id(), s);
    }
}
