package com.acttub.actingapi.feature.billing.app;

/** 빌링키를 저장 전에 잠그고 결제 직전에만 푼다. 구현은 AccountSecrets(AES-256-GCM)를 쓴다. */
public interface BillingKeyCipher {
    String seal(String billingKey);

    String open(String sealed);
}
