package com.acttub.actingapi.feature.invite.adapter;

import java.time.Clock;
import java.time.Duration;

import com.acttub.actingapi.feature.invite.app.InviteRepository;
import com.acttub.actingapi.feature.invite.app.InviteRewardListener;
import com.acttub.actingapi.feature.invite.app.InviteService;
import com.acttub.actingapi.feature.invite.app.InviteSettings;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 친구 초대(SOMA-865) 조립. 빈은 늘 서지만 {@code INVITE_ENABLED=true} 일 때만 경로가 열리고 연습 완료를 듣는다 — 꺼져 있으면
 * 경로는 404 {@code invite_unavailable}, 완료 알림은 DB 를 읽지 않고 돌아간다.
 */
@Configuration(proxyBeanMethods = false)
class InviteConfiguration {
    private static final Logger LOG = LoggerFactory.getLogger(InviteConfiguration.class);

    @Bean
    InviteSettings inviteSettings(
            @Value("${INVITE_ENABLED:false}") boolean enabled,
            @Value("${INVITE_INVITER_MONTHLY_CAP:5}") int inviterMonthlyCap,
            @Value("${INVITE_REDEEM_WINDOW_DAYS:7}") int redeemWindowDays) {
        InviteSettings settings = new InviteSettings(enabled, inviterMonthlyCap, Duration.ofDays(redeemWindowDays));
        if (enabled) {
            LOG.info("friend invite enabled inviterMonthlyCap={} redeemWindowDays={}", inviterMonthlyCap, redeemWindowDays);
        }
        return settings;
    }

    /** 지급 알림은 선택이다 — push 가 구현을 내지만, 없어도 지급은 된다. */
    @Bean
    InviteService inviteService(InviteSettings settings, InviteRepository repository,
            ObjectProvider<InviteRewardListener> rewards, FailureReporter failures, Clock clock) {
        return new InviteService(settings, repository, rewards.getIfAvailable(), failures, clock);
    }
}
