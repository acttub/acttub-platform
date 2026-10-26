package com.acttub.actingapi.feature.billing.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.billing.adapter.store.RevenueCatGatewayImpl;
import com.acttub.actingapi.feature.billing.adapter.store.RevenueCatWebhookAuth;
import com.acttub.actingapi.feature.billing.app.BillingRepository;
import com.acttub.actingapi.feature.billing.app.BillingSettings;
import com.acttub.actingapi.feature.billing.app.StoreBillingService;
import com.acttub.actingapi.feature.billing.app.StoreGateways;
import com.acttub.actingapi.feature.billing.app.StoreGateways.RevenueCatGateway;
import com.acttub.actingapi.feature.billing.app.SubscriptionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 앱 스토어 구독 결제(SOMA-818 2단계, RevenueCat) 조립. 기본은 꺼짐이다 — {@code BILLING_REVENUECAT_ENABLED} 가 true 이고 비밀 키가
 * 있을 때만 RevenueCat 조회가 열린다. 값이 틀리면 부팅은 하되 닫고(503 {@code store_unavailable}) 이유 한 줄만 남긴다(비밀 값 없음).
 * 앱 화면 노출은 따로 {@code BILLING_APP_ENABLED} 가 정한다. 샌드박스 구매는 {@code BILLING_REVENUECAT_ALLOW_SANDBOX}(기본 false, dev 만 true)일 때만 Pro 를 연다.
 */
@Configuration(proxyBeanMethods = false)
class StoreBillingConfiguration {
    private static final Logger LOG = LoggerFactory.getLogger(StoreBillingConfiguration.class);

    @Bean
    @ConditionalOnMissingBean(RevenueCatGateway.class)
    RevenueCatGateway revenueCatGateway(
            @Value("${BILLING_REVENUECAT_ENABLED:false}") boolean enabled,
            @Value("${REVENUECAT_SECRET_API_KEY:}") String secretKey,
            @Value("${REVENUECAT_ENTITLEMENT_ID:pro}") String entitlementId) {
        if (!enabled) {
            return StoreGateways.revenueCatDisabled();
        }
        try {
            return new RevenueCatGatewayImpl(secretKey, entitlementId);
        } catch (RuntimeException invalid) {
            LOG.error("revenuecat billing enabled but closed reason=config_invalid");
            return StoreGateways.revenueCatDisabled();
        }
    }

    @Bean
    RevenueCatWebhookAuth revenueCatWebhookAuth(@Value("${REVENUECAT_WEBHOOK_AUTH:}") String secret) {
        return new RevenueCatWebhookAuth(secret);
    }

    @Bean
    StoreBillingService storeBillingService(BillingSettings settings, BillingRepository repository,
            SubscriptionService subscriptions, RevenueCatGateway revenueCat, Clock clock,
            @Value("${BILLING_REVENUECAT_ALLOW_SANDBOX:false}") boolean allowSandbox) {
        return new StoreBillingService(settings, repository, subscriptions, revenueCat, clock, allowSandbox);
    }
}
