package com.acttub.actingapi.feature.billing.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class BillingCoachProTest {
    @Test
    void 값이_없으면_dev_만_켜지고_값이_있으면_그것을_따른다() {
        assertThat(BillingCoachPro.enabled("", "https://dev.acttub.com")).isTrue();
        assertThat(BillingCoachPro.enabled("", "https://acttub.com")).isFalse();
        assertThat(BillingCoachPro.enabled(null, "")).isFalse();
        assertThat(BillingCoachPro.enabled("true", "https://acttub.com")).isTrue();
        assertThat(BillingCoachPro.enabled("false", "https://dev.acttub.com")).isFalse();
    }
}
