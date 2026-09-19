package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 저장하는 값마다 어느 키로 만들었는지를 접두사로 붙인다(SOMA-528 결정 I-11). 신원 해시는 3년을 가므로
 * 나중에 전용 키를 넣어도 그 전에 쓴 값이 어긋나면 안 된다.
 */
class AccountSecretsTest {
    private static final String JWT_SECRET = "test-secret";

    @Test
    @DisplayName("account.withdraw: 전용 키가 없으면 JWT_SECRET 에서 파생한 키로 쓰고 d1: 을 붙인다")
    void withoutDedicatedKeysValuesCarryTheDerivedPrefix() {
        AccountSecrets secrets = new AccountSecrets(JWT_SECRET, "", null);

        assertThat(secrets.usesDerivedKey()).isTrue();
        assertThat(secrets.identityHash("kakao", "12345")).matches("d1:[0-9a-f]{64}");
        assertThat(secrets.encrypt("apple-refresh-token")).startsWith("d1:");
    }

    @Test
    @DisplayName("account.withdraw: 전용 키가 있으면 그것으로 쓰고 k1: 을 붙인다")
    void withDedicatedKeysValuesCarryTheDedicatedPrefix() {
        AccountSecrets secrets = new AccountSecrets(JWT_SECRET, "hash-key", "encryption-key");

        assertThat(secrets.usesDerivedKey()).isFalse();
        assertThat(secrets.identityHash("kakao", "12345")).matches("k1:[0-9a-f]{64}");
        assertThat(secrets.encrypt("apple-refresh-token")).startsWith("k1:");
    }

    @Test
    @DisplayName("account.withdraw: 전용 키를 나중에 넣어도 그 전에 쓴 암호문이 풀리고 옛 해시를 다시 계산할 수 있다")
    void valuesWrittenBeforeTheDedicatedKeyStayReadable() {
        AccountSecrets before = new AccountSecrets(JWT_SECRET, "", "");
        String oldCiphertext = before.encrypt("naver-refresh-token");
        String oldHash = before.identityHash("naver", "uid-1");

        AccountSecrets after = new AccountSecrets(JWT_SECRET, "hash-key", "encryption-key");

        assertThat(after.decrypt(oldCiphertext)).isEqualTo("naver-refresh-token");
        assertThat(after.identityHash("naver", "uid-1")).isNotEqualTo(oldHash);
        assertThat(after.identityHashCandidates("naver", "uid-1"))
                .as("운영자는 어느 키로 만든 해시든 대조할 수 있다")
                .contains(oldHash, after.identityHash("naver", "uid-1"));
    }

    @Test
    @DisplayName("account.withdraw: 해시는 제공자와 제공자 ID 가 같으면 같고, 어느 하나가 다르면 다르다")
    void theHashIdentifiesTheProviderAccountAndNothingElse() {
        AccountSecrets secrets = new AccountSecrets(JWT_SECRET, "hash-key", "");

        assertThat(secrets.identityHash("google", "uid-1")).isEqualTo(secrets.identityHash("google", "uid-1"));
        assertThat(secrets.identityHash("google", "uid-1")).isNotEqualTo(secrets.identityHash("apple", "uid-1"));
        assertThat(secrets.identityHash("google", "uid-1")).isNotEqualTo(secrets.identityHash("google", "uid-2"));
        assertThat(secrets.identityHash("google", "uid-1")).doesNotContain("uid-1");
    }

    @Test
    @DisplayName("account.login: 같은 값을 두 번 암호화해도 암호문이 다르고, 변조된 암호문은 풀리지 않는다")
    void encryptionIsAuthenticatedAndUsesAFreshNonce() {
        AccountSecrets secrets = new AccountSecrets(JWT_SECRET, "", "encryption-key");
        String first = secrets.encrypt("apple-refresh-token");
        String second = secrets.encrypt("apple-refresh-token");

        assertThat(first).isNotEqualTo(second).doesNotContain("apple-refresh-token");
        assertThat(secrets.decrypt(first)).isEqualTo("apple-refresh-token");

        char last = first.charAt(first.length() - 1);
        String tampered = first.substring(0, first.length() - 1) + (last == 'A' ? 'B' : 'A');
        assertThatThrownBy(() -> secrets.decrypt(tampered)).isInstanceOf(AccountSecrets.UnreadableSecret.class);
    }

    @Test
    @DisplayName("account.withdraw: 접두사가 없거나 모르는 키를 가리키는 값은 풀지 않는다")
    void valuesWithoutAKnownPrefixAreRejected() {
        AccountSecrets derivedOnly = new AccountSecrets(JWT_SECRET, "", "");
        String dedicated = new AccountSecrets(JWT_SECRET, "", "encryption-key").encrypt("token");

        assertThatThrownBy(() -> derivedOnly.decrypt(dedicated)).isInstanceOf(AccountSecrets.UnreadableSecret.class);
        assertThatThrownBy(() -> derivedOnly.decrypt("no-prefix")).isInstanceOf(AccountSecrets.UnreadableSecret.class);
        assertThatThrownBy(() -> derivedOnly.decrypt(null)).isInstanceOf(AccountSecrets.UnreadableSecret.class);
    }

    @Test
    @org.junit.jupiter.api.DisplayName("account.withdraw: 운영 문서(docs/deploy/RETENTION-REVOCATION.md)의 셸 절차로 계산한 해시와 같은 값이다 — 두 키 판 모두")
    void identityHashesMatchTheOperatorsProcedure() {
        // 문서의 절차: 키 = HMAC-SHA256(비밀, "acttub/identity-hash/v1"), 해시 = HMAC-SHA256(키, provider + "\n" + uid).
        // 아래 값은 그 셸 절차(openssl)로 JWT_SECRET=test-secret, ACCOUNT_IDENTITY_HASH_KEY=dedicated-test-key 에서
        // 계산한 것이다. 이 테스트가 깨지면 문서의 절차도 함께 고친다 — 해시는 3년을 간다.
        AccountSecrets secrets = new AccountSecrets("test-secret", "dedicated-test-key", null);

        assertThat(secrets.identityHashCandidates("kakao", "1234567890")).containsExactly(
                "d1:498754e2271558afd047c29e4f174c83a3b4720f3a37d26238d94ab1aac4a570",
                "k1:5cc94028c71558d34579fa6dd026a9742b6cfa12afd1d0f41496c70ef5d8ce2d");
    }
}
