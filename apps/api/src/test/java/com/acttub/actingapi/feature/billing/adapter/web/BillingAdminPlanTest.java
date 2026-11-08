package com.acttub.actingapi.feature.billing.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.billing.app.BillingAdminReader.SubscriptionRow;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class BillingAdminPlanTest {
    private static SubscriptionRow row(String provider, String productId, String plan) {
        return new SubscriptionRow("abcd1234", null, null, false, null, provider, productId, plan, 0, "active",
                null, null, null, null, 0, 0);
    }

    @Test
    @DisplayName("ops 화면의 plan — 웹 연 구독은 장부의 plan 으로 yearly, 스토어는 상품 ID 로 정한다")
    void planFollowsTheLedger() {
        assertThat(BillingAdminController.plan(row("toss", null, "yearly"))).isEqualTo("yearly");
        assertThat(BillingAdminController.plan(row("toss", null, "monthly"))).isEqualTo("monthly");
        assertThat(BillingAdminController.plan(row("apple", "acttub_pro_yearly", "monthly"))).isEqualTo("yearly");
        assertThat(BillingAdminController.plan(row("google", "acttub_pro_monthly", "monthly"))).isEqualTo("monthly");
    }
}
