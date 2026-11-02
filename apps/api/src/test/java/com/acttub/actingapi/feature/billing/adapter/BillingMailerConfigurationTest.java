package com.acttub.actingapi.feature.billing.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.billing.adapter.mail.ResendBillingMailer;
import com.acttub.actingapi.feature.billing.app.BillingMailer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class BillingMailerConfigurationTest {
    private final BillingConfiguration configuration = new BillingConfiguration();

    @Test
    @DisplayName("구독 메일은 스위치가 켜지고 Resend 키가 있을 때만 실제로 보낸다")
    void sendsOnlyWhenEnabledWithAKey() {
        assertThat(configuration.billingMailer(false, "re_key", "ACTTUB <no-reply@acttub.com>")).isSameAs(BillingMailer.NONE);
        assertThat(configuration.billingMailer(true, " ", "ACTTUB <no-reply@acttub.com>")).isSameAs(BillingMailer.NONE);
        assertThat(configuration.billingMailer(true, "re_key", "ACTTUB <no-reply@acttub.com>"))
                .isInstanceOf(ResendBillingMailer.class);
    }
}
