package com.acttub.actingapi.oidc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ContractProviderFixtureTest {
    private final ContractProviderFixture fixture = ContractProviderFixture.load(
            new ObjectMapper(),
            Path.of("../../tools/contract-harness/contract_harness/fixtures/auth_providers.json"));
    private final ProviderRegistry registry = new ProviderRegistry(fixture.verifiers());

    @Test
    void tokenReturnsProviderIdentityFromSharedFixture() {
        assertThat(registry.verify("google", "harness-token-new-actor"))
                .isEqualTo(new ProviderIdentity(
                        "harness-new-actor",
                        "new-actor@harness.test",
                        true));
        assertThat(registry.verify("development", "harness-token-no-email"))
                .isEqualTo(new ProviderIdentity("harness-no-email", null, false));
    }

    @Test
    void invalidAndUnknownTokensRaiseInvalidIdentityToken() {
        assertThatThrownBy(() -> registry.verify("google", "harness-token-invalid"))
                .isInstanceOf(InvalidIdentityToken.class);
        assertThatThrownBy(() -> registry.verify("google", "not-in-the-fixture"))
                .isInstanceOf(InvalidIdentityToken.class);
    }

    @Test
    void unconfiguredProviderTakesPrecedenceOverTokenLookup() {
        assertThatThrownBy(() -> registry.verify("apple", "harness-token-new-actor"))
                .isInstanceOf(ProviderConfigurationError.class);
    }

    @Test
    void unsupportedProviderRaisesUnsupportedProviderError() {
        assertThatThrownBy(() -> registry.verify(
                        fixture.unsupportedProvider(),
                        "harness-token-new-actor"))
                .isInstanceOf(UnsupportedProviderError.class);
    }
}
