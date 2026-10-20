package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** 전용 키가 둘 다 있어야 파생 키 경고가 꺼지고, JWT 비밀값이 없으면 기동하지 않는다. */
class AccountSecretsKeyChoiceTest {

    @Test
    void derivedKeyWarningIsOffOnlyWhenBothDedicatedKeysAreSet() {
        assertThat(new AccountSecrets("jwt", "hash-key", "encryption-key").usesDerivedKey()).isFalse();
        assertThat(new AccountSecrets("jwt", "hash-key", " ").usesDerivedKey()).isTrue();
        assertThat(new AccountSecrets("jwt", null, "encryption-key").usesDerivedKey()).isTrue();
    }

    @Test
    void missingJwtSecretFailsFast() {
        assertThatThrownBy(() -> new AccountSecrets(null, "hash-key", "encryption-key"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("account secrets need a non-empty JWT secret");
        assertThatThrownBy(() -> new AccountSecrets("", null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
