package com.acttub.actingapi.feature.billing.adapter;

import java.net.URI;
import java.time.Clock;

import com.acttub.actingapi.feature.billing.adapter.store.AppleStoreGatewayImpl;
import com.acttub.actingapi.feature.billing.adapter.store.GooglePushAuth;
import com.acttub.actingapi.feature.billing.adapter.store.GoogleStoreGatewayImpl;
import com.acttub.actingapi.feature.billing.app.BillingRepository;
import com.acttub.actingapi.feature.billing.app.BillingSettings;
import com.acttub.actingapi.feature.billing.app.StoreBillingService;
import com.acttub.actingapi.feature.billing.app.StoreGateways;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleStoreGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.GoogleStoreGateway;
import com.acttub.actingapi.feature.billing.app.SubscriptionService;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 앱 스토어 구독 결제(SOMA-818 2단계) 조립. 모든 값은 기본이 꺼짐이다 — {@code BILLING_APPLE_ENABLED}·
 * {@code BILLING_GOOGLE_ENABLED} 가 true 이고 필요한 값이 맞을 때만 각 스토어 검증이 열린다. 값이 틀리면 부팅은 하되 그 스토어를
 * 닫고(503 {@code store_unavailable}) 이유 한 줄만 남긴다(비밀 값 없음). 앱 화면 노출은 따로 {@code BILLING_APP_ENABLED} 가 정한다.
 */
@Configuration(proxyBeanMethods = false)
class StoreBillingConfiguration {
    private static final Logger LOG = LoggerFactory.getLogger(StoreBillingConfiguration.class);

    @Bean
    @ConditionalOnMissingBean(AppleStoreGateway.class)
    AppleStoreGateway appleStoreGateway(
            @Value("${BILLING_APPLE_ENABLED:false}") boolean enabled,
            @Value("${BILLING_APPLE_BUNDLE_ID:com.acttub.app}") String bundleId,
            @Value("${BILLING_APPLE_APP_ID:}") String appAppleId,
            @Value("${BILLING_APPLE_ONLINE_CHECKS:false}") boolean onlineChecks,
            @Value("${BILLING_APPLE_API_PRIVATE_KEY:}") String privateKey,
            @Value("${BILLING_APPLE_API_KEY_ID:}") String keyId,
            @Value("${BILLING_APPLE_API_ISSUER_ID:}") String issuerId) {
        if (!enabled) {
            return StoreGateways.appleDisabled();
        }
        try {
            Long appId = appAppleId.isBlank() ? null : Long.valueOf(appAppleId.strip());
            // 운영 환경 검증은 앱 Apple ID 가 있어야 한다. 없으면 샌드박스만 받는다(운영 구매는 거부된다).
            if (appId == null) {
                LOG.warn("apple store billing enabled without BILLING_APPLE_APP_ID - only sandbox purchases verify");
            }
            // 환경변수 한 줄에 넣은 .p8 은 줄바꿈이 \\n 으로 들어올 수 있다.
            return new AppleStoreGatewayImpl(bundleId.strip(), appId, onlineChecks, privateKey.replace("\\n", "\n"), keyId, issuerId);
        } catch (RuntimeException invalid) {
            LOG.error("apple store billing enabled but closed reason=config_invalid");
            return StoreGateways.appleDisabled();
        }
    }

    @Bean
    @ConditionalOnMissingBean(GoogleStoreGateway.class)
    GoogleStoreGateway googleStoreGateway(
            @Value("${BILLING_GOOGLE_ENABLED:false}") boolean enabled,
            @Value("${BILLING_GOOGLE_PACKAGE_NAME:com.acttub.app}") String packageName,
            @Value("${BILLING_GOOGLE_SERVICE_ACCOUNT_JSON:}") String serviceAccountJson,
            Clock clock) {
        if (!enabled) {
            return StoreGateways.googleDisabled();
        }
        try {
            return new GoogleStoreGatewayImpl(packageName.strip(), serviceAccountJson, clock);
        } catch (RuntimeException invalid) {
            LOG.error("google store billing enabled but closed reason=config_invalid");
            return StoreGateways.googleDisabled();
        }
    }

    @Bean
    GooglePushAuth googlePushAuth(
            @Value("${BILLING_GOOGLE_PUSH_AUTH:}") String mode,
            @Value("${BILLING_GOOGLE_PUSH_TOKEN:}") String token,
            @Value("${BILLING_GOOGLE_PUSH_AUDIENCE:}") String audience,
            @Value("${BILLING_GOOGLE_PUSH_SERVICE_ACCOUNT:}") String serviceAccount) {
        try {
            return new GooglePushAuth(mode, token, audience, serviceAccount,
                    JWKSourceBuilder.create(URI.create("https://www.googleapis.com/oauth2/v3/certs").toURL()).build());
        } catch (java.net.MalformedURLException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    @Bean
    StoreBillingService storeBillingService(BillingSettings settings, BillingRepository repository,
            SubscriptionService subscriptions, AppleStoreGateway apple, GoogleStoreGateway google, Clock clock) {
        return new StoreBillingService(settings, repository, subscriptions, apple, google, clock);
    }
}
