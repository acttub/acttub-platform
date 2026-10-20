package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** PG 심사 결제 설정은 하나라도 어긋나면 닫힌다 — 어긋난 자리마다 이유 코드가 다르다 (billing.pg-review). */
class PgReviewSettingsTest {
    private static final String HASH = "a".repeat(64);
    private static final String CLIENT = "test_ck_abcdefgh12";
    private static final String SECRET = "test_sk_abcdefgh12";

    private static String reason(String origin, String username, String hash, String client, String secret) {
        return new PgReviewSettings(origin, username, hash, client, secret).invalidReason();
    }

    @Test
    void httpsDomainOrLoopbackHttpIsAnAcceptedOrigin() {
        assertThat(reason(" https://review.acttub.com ", "reviewer", HASH, CLIENT, SECRET)).isNull();
        assertThat(reason("http://localhost:3000", "reviewer", HASH, CLIENT, SECRET)).isNull();
        assertThat(reason("http://127.0.0.1", "reviewer", HASH, CLIENT, SECRET)).isNull();
        assertThat(new PgReviewSettings("https://review.acttub.com", "r", HASH, CLIENT, SECRET).secureCookie()).isTrue();
        assertThat(new PgReviewSettings("http://localhost", "r", HASH, CLIENT, SECRET).secureCookie()).isFalse();
    }

    @Test
    void originWithAPathQueryFragmentUserOrPlainHttpOrGarbageIsRejected() {
        for (String origin : new String[] {
                "https://review.acttub.com/pay", "https://review.acttub.com?x=1", "https://review.acttub.com#a",
                "https://user@review.acttub.com", "http://review.acttub.com", "ftp://localhost", "https://",
                "not a uri", null}) {
            assertThat(reason(origin, "reviewer", HASH, CLIENT, SECRET)).as(String.valueOf(origin))
                    .isEqualTo("origin_invalid");
        }
    }

    @Test
    void eachCredentialHasItsOwnReason() {
        assertThat(reason("https://r.acttub.com", "", HASH, CLIENT, SECRET)).isEqualTo("username_invalid");
        assertThat(reason("https://r.acttub.com", "u".repeat(65), HASH, CLIENT, SECRET)).isEqualTo("username_invalid");
        assertThat(reason("https://r.acttub.com", "reviewer", "abc", CLIENT, SECRET)).isEqualTo("password_hash_invalid");
        assertThat(reason("https://r.acttub.com", "reviewer", HASH, "live_ck_abcdefgh12", SECRET))
                .isEqualTo("client_key_not_test");
        assertThat(reason("https://r.acttub.com", "reviewer", HASH, "test_ck_short", SECRET))
                .isEqualTo("client_key_not_test");
        assertThat(reason("https://r.acttub.com", "reviewer", HASH, CLIENT, "live_sk_abcdefgh12"))
                .isEqualTo("secret_key_not_test");
        assertThat(PgReviewSettings.isTestClientKey(null)).isFalse();
        assertThat(PgReviewSettings.isTestSecretKey(null)).isFalse();
    }

    @Test
    void textFormNeverCarriesTheSecrets() {
        PgReviewSettings settings = new PgReviewSettings("https://r.acttub.com", "reviewer", HASH, CLIENT, SECRET);

        assertThat(settings.usable()).isTrue();
        assertThat(settings.toString())
                .isEqualTo("PgReviewSettings[origin=https://r.acttub.com, username=reviewer, secrets=redacted]");
    }
}
