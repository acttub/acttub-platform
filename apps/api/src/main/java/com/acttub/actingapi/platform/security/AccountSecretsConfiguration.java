package com.acttub.actingapi.platform.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 신원 해시 키와 토큰 암호화 키. 전용 환경변수가 비어 있어도 뜬다 — 그때는 {@code JWT_SECRET} 에서
 * 파생한 키로 쓰고 경고를 남긴다. 배포 설정이 늦어도 탈퇴가 멈추지 않게 하기 위해서다.
 */
@Configuration
class AccountSecretsConfiguration {
    private static final Logger LOG = LoggerFactory.getLogger(AccountSecretsConfiguration.class);

    @Bean
    AccountSecrets accountSecrets(
            @Value("${JWT_SECRET:}") String jwtSecret,
            @Value("${ACCOUNT_IDENTITY_HASH_KEY:}") String identityHashKey,
            @Value("${ACCOUNT_TOKEN_ENCRYPTION_KEY:}") String tokenEncryptionKey) {
        AccountSecrets secrets = new AccountSecrets(jwtSecret, identityHashKey, tokenEncryptionKey);
        if (secrets.usesDerivedKey()) {
            LOG.warn("ACCOUNT_IDENTITY_HASH_KEY or ACCOUNT_TOKEN_ENCRYPTION_KEY is not set;"
                    + " account secrets fall back to a key derived from JWT_SECRET");
        }
        return secrets;
    }
}
