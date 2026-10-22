package com.acttub.actingapi.feature.billing.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.billing.app.BillingRules;
import com.acttub.actingapi.feature.billing.app.SubscriptionService.CheckoutPage;
import com.acttub.actingapi.feature.billing.app.SubscriptionService.Result;
import org.junit.jupiter.api.Test;

class BillingCheckoutPageTest {
    @Test
    void pageOpensTossBillingAuthWithValuesAsJsonOnly() {
        String html = BillingCheckoutPageController.checkoutHtml(new CheckoutPage("test_ck_x", "acttub_</script><b>",
                BillingRules.Purpose.SUBSCRIBE, "https://dev.acttub.com/v2/billing/web/checkout/s/success",
                "https://dev.acttub.com/v2/billing/web/checkout/s/fail", "actingapp://billing-result"));
        assertThat(html).contains(BillingCheckoutPageController.TOSS_SDK_URL)
                .contains("requestBillingAuth")
                .contains("월 3,900원")
                .contains("actingapp://billing-result?status=canceled")
                .doesNotContain("</script><b>");
    }

    @Test
    void returnUrlCarriesOnlyTheResult() {
        assertThat(BillingCheckoutPageController.returnUrl("actingapp://billing-result", Result.DONE))
                .isEqualTo("actingapp://billing-result?status=done");
    }
}
