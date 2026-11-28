package com.acttub.actingapi.feature.billing.adapter.db;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import com.acttub.actingapi.feature.billing.app.RevenueCatCustomerCleanup;
import com.acttub.actingapi.integration.revenuecat.RevenueCatCustomerClient;
import com.acttub.actingapi.platform.security.AccountSecrets;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 결제에서 하는 일 (account.withdraw, SOMA-818).
 *
 * <ul>
 *   <li>앱 Pro 구독(V64)은 더 결제하지 않게 끝내고 빌링키를 지운다. Pro 지급은 지우고 열린 결제창은 닫는다. 결제 기록
 *       ({@code billing_payments})은 거래 기록이라 남긴다 — 카드 번호는 토스가 가린 값뿐이다.</li>
 *   <li>RevenueCat 고객 정보(V65)의 삭제를 장부에 올린다. 앱이 RevenueCat SDK 에 우리 user id 로 붙으므로 app_user_id 가 곧
 *       user id 다. 꺼진 서버({@code BILLING_REVENUECAT_ENABLED=false}·비밀 키 없음)는 올리지 않는다. 이미 없는 고객(404)은
 *       성공이다.</li>
 * </ul>
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresBillingAccountErasure implements AccountErasure {

    private final EntityManager entityManager;
    private final RevenueCatCustomerClient revenueCat;
    private final RevenueCatCustomerCleanup cleanups;
    private final AccountSecrets secrets;

    PostgresBillingAccountErasure(
            EntityManager entityManager,
            RevenueCatCustomerClient revenueCat,
            RevenueCatCustomerCleanup cleanups,
            AccountSecrets secrets) {
        this.entityManager = entityManager;
        this.revenueCat = revenueCat;
        this.cleanups = cleanups;
        this.secrets = secrets;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.BILLING, AccountErasureStep.BILLING_CUSTOMER);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        return switch (step) {
            case BILLING -> {
                endBilling(account.userId());
                yield List.of();
            }
            case BILLING_CUSTOMER -> revenueCat.enabled()
                    ? List.of(cleanups.enqueueCustomerDeletion(
                            account.userId(), secrets.encrypt(account.userId().toString()), account.now()))
                    : List.of();
            default -> throw new IllegalArgumentException("not a billing step: " + step);
        };
    }

    private void endBilling(UUID userId) {
        entityManager.createQuery("""
                        update BillingSubscriptionEntity s
                        set s.status = 'expired', s.billingKey = null, s.nextRetryAt = null, s.updatedAt = instant
                        where s.userId = :userId
                        """)
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery("delete from BillingProGrantEntity g where g.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery(
                        "update BillingCheckoutEntity c set c.status = 'failed' where c.userId = :userId and c.status = 'open'")
                .setParameter("userId", userId)
                .executeUpdate();
    }
}
