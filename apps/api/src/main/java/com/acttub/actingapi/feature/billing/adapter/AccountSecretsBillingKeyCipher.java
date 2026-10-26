package com.acttub.actingapi.feature.billing.adapter;

import com.acttub.actingapi.feature.billing.app.BillingKeyCipher;
import com.acttub.actingapi.platform.security.AccountSecrets;

/**
 * 빌링키 잠금. 계정의 오래 사는 비밀 값과 같은 {@link AccountSecrets}(AES-256-GCM, 값마다 새 nonce, 키 버전 접두사)를
 * 쓴다 — 전용 키({@code ACCOUNT_TOKEN_ENCRYPTION_KEY})를 넣으면 그 키로, 없으면 {@code JWT_SECRET} 파생 키로 잠근다.
 */
class AccountSecretsBillingKeyCipher implements BillingKeyCipher {
    private final AccountSecrets secrets;

    AccountSecretsBillingKeyCipher(AccountSecrets secrets) {
        this.secrets = secrets;
    }

    @Override
    public String seal(String billingKey) {
        return secrets.encrypt(billingKey);
    }

    @Override
    public String open(String sealed) {
        return secrets.decrypt(sealed);
    }
}
