package com.acttub.actingapi.feature.billing.adapter.web;

import java.time.Instant;

import com.acttub.actingapi.feature.billing.app.SubscriptionService.View;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Size;

/** 앱 Pro 정기결제(SOMA-818) 요청·응답. 카드는 카드사 이름과 끝 네 자리만 싣는다. */
final class BillingDtos {
    private BillingDtos() {
    }

    record CheckoutRequest(@Size(max = 32) String purpose) {
    }

    record CheckoutResponse(
            @JsonProperty("checkout_url") String checkoutUrl,
            @JsonProperty("return_url") String returnUrl,
            @JsonProperty("expires_at") Instant expiresAt) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    record MeResponse(
            String status,
            boolean pro,
            long amount,
            @JsonProperty("period_end") Instant periodEnd,
            @JsonProperty("next_billing_at") Instant nextBillingAt,
            @JsonProperty("card_company") String cardCompany,
            @JsonProperty("card_last4") String cardLast4,
            @JsonProperty("retry_count") int retryCount,
            @JsonProperty("limits_enforced") boolean limitsEnforced,
            String provider,
            @JsonProperty("grant_ends_at") Instant grantEndsAt) {

        static MeResponse of(View view) {
            return new MeResponse(view.status(), view.pro(), view.amount(), view.periodEnd(), view.nextBillingAt(),
                    view.cardCompany(), view.cardLast4(), view.retryCount(), view.limitsEnforced(), view.provider(),
                    view.grantEndsAt());
        }
    }
}
