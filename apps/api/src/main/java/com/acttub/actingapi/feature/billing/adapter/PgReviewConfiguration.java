package com.acttub.actingapi.feature.billing.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.billing.adapter.toss.TossBillingGateway;
import com.acttub.actingapi.feature.billing.app.PgReviewGateway;
import com.acttub.actingapi.feature.billing.app.PgReviewService;
import com.acttub.actingapi.feature.billing.app.PgReviewSessions;
import com.acttub.actingapi.feature.billing.app.PgReviewSettings;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * PG 심사 전용 테스트 결제(SOMA-620). {@code ACTTUB_PG_REVIEW_ENABLED=true} 일 때만 서고, 기본은 꺼짐이라
 * 빈도 경로도 없다(404). 켜져 있어도 설정(테스트 키·origin·로그인 정보)이 틀리면 기능은 닫힌 채로 부팅한다 —
 * 심사용 설정 실수로 API 전체가 못 뜨는 일은 없게 한다. 닫힌 이유는 비밀 값 없이 한 줄 남긴다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "ACTTUB_PG_REVIEW_ENABLED", havingValue = "true")
public class PgReviewConfiguration {
    private static final Logger LOG = LoggerFactory.getLogger(PgReviewConfiguration.class);

    @Bean
    PgReviewSettings pgReviewSettings(
            @Value("${ACTTUB_PG_REVIEW_ORIGIN:}") String origin,
            @Value("${ACTTUB_PG_REVIEW_USERNAME:}") String username,
            @Value("${ACTTUB_PG_REVIEW_PASSWORD_SHA256:}") String passwordSha256,
            @Value("${ACTTUB_PG_REVIEW_TOSS_CLIENT_KEY:}") String clientKey,
            @Value("${ACTTUB_PG_REVIEW_TOSS_SECRET_KEY:}") String secretKey) {
        PgReviewSettings settings = new PgReviewSettings(origin, username, passwordSha256, clientKey, secretKey);
        String reason = settings.invalidReason();
        if (reason == null) {
            LOG.info("pg review test payment enabled origin={}", settings.origin());
        } else {
            LOG.error("pg review test payment enabled but closed reason={}", reason);
        }
        return settings;
    }

    @Bean
    @ConditionalOnMissingBean(PgReviewGateway.class)
    PgReviewGateway pgReviewGateway(PgReviewSettings settings) {
        return new TossBillingGateway(settings::secretKey);
    }

    @Bean
    PgReviewSessions pgReviewSessions(Clock clock) {
        return new PgReviewSessions(clock);
    }

    @Bean
    PgReviewService pgReviewService(
            PgReviewSettings settings, PgReviewSessions sessions, PgReviewGateway gateway, Clock clock) {
        return new PgReviewService(settings, sessions, gateway, clock);
    }
}
