package com.acttub.actingapi.feature.billing.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.billing.adapter.toss.TossBillingGateway;
import com.acttub.actingapi.feature.billing.app.AppBillingGateway;
import com.acttub.actingapi.feature.billing.app.BillingKeyCipher;
import com.acttub.actingapi.feature.billing.app.BillingRepository;
import com.acttub.actingapi.feature.billing.app.BillingSettings;
import com.acttub.actingapi.feature.billing.app.PgReviewGateway;
import com.acttub.actingapi.feature.billing.app.RenewalWorker;
import com.acttub.actingapi.feature.billing.app.SubscriptionService;
import com.acttub.actingapi.platform.security.AccountSecrets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 앱 Pro 정기결제(SOMA-818) 조립. 빈은 늘 서지만 기능은 {@code BILLING_APP_ENABLED=true} 이고 설정(테스트 키·공개 주소·
 * 앱 복귀 주소)이 맞을 때만 열린다 — 닫혀 있으면 앱 API 가 404 {@code billing_unavailable} 이고 앱은 Pro 진입점을
 * 숨긴다. 무료 한도({@code BILLING_FREE_LIMITS_ENABLED})도 기본 꺼짐이다. 닫힌 이유는 비밀 값 없이 한 줄 남긴다.
 *
 * <p>PG 심사 전용 결제({@code PgReviewConfiguration})와 같은 토스 게이트웨이 구현을 쓰지만 빈은 따로 만든다 — 둘의 키와
 * 켜는 스위치가 다르다.
 */
@Configuration(proxyBeanMethods = false)
class BillingConfiguration {
    private static final Logger LOG = LoggerFactory.getLogger(BillingConfiguration.class);

    @Bean
    BillingSettings billingSettings(
            @Value("${BILLING_APP_ENABLED:false}") boolean enabled,
            @Value("${BILLING_FREE_LIMITS_ENABLED:false}") boolean freeLimits,
            @Value("${BILLING_PUBLIC_ORIGIN:}") String origin,
            @Value("${BILLING_APP_RETURN_URL:actingapp://billing-result}") String returnUrl,
            @Value("${BILLING_TOSS_CLIENT_KEY:}") String clientKey,
            @Value("${BILLING_TOSS_SECRET_KEY:}") String secretKey) {
        BillingSettings settings = new BillingSettings(enabled, freeLimits, origin, returnUrl, clientKey, secretKey);
        if (enabled) {
            String reason = settings.invalidReason();
            if (reason == null) {
                LOG.info("app billing enabled origin={} freeLimits={}", settings.origin(), settings.limitsEnforced());
            } else {
                LOG.error("app billing enabled but closed reason={}", reason);
            }
        }
        return settings;
    }

    @Bean
    BillingKeyCipher billingKeyCipher(AccountSecrets secrets) {
        return new AccountSecretsBillingKeyCipher(secrets);
    }

    /** 토스 테스트 키로만 부르는 실물. 테스트는 이 빈을 가짜로 바꾼다. */
    @Bean
    @ConditionalOnMissingBean(AppBillingGateway.class)
    AppBillingGateway appBillingGateway(BillingSettings settings) {
        TossBillingGateway toss = new TossBillingGateway(settings::secretKey);
        return new AppBillingGateway() {
            @Override
            public PgReviewGateway.IssuedKey issue(String authKey, String customerKey) {
                return toss.issue(authKey, customerKey);
            }

            @Override
            public PgReviewGateway.Approval approve(String billingKey, String customerKey, String orderId, long amount,
                    String orderName, String idempotencyKey) {
                return toss.approve(billingKey, customerKey, orderId, amount, orderName, idempotencyKey);
            }
        };
    }

    @Bean
    SubscriptionService subscriptionService(BillingSettings settings, BillingRepository repository,
            AppBillingGateway gateway, BillingKeyCipher cipher, Clock clock) {
        return new SubscriptionService(settings, repository, gateway, cipher, clock);
    }

    @Bean
    RenewalWorker renewalWorker(SubscriptionService service, BillingRepository repository, Clock clock) {
        return new RenewalWorker(service, repository, clock);
    }
}
