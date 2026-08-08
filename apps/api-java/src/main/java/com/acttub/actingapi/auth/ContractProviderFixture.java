package com.acttub.actingapi.auth;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;

final class ContractProviderFixture {
    private final Document document;

    private ContractProviderFixture(Document document) {
        this.document = document;
    }

    static ContractProviderFixture load(ObjectMapper mapper, Path path) {
        try {
            return new ContractProviderFixture(mapper.readValue(path.toFile(), Document.class));
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "cannot read contract auth provider fixture: " + path.toAbsolutePath(),
                    exception);
        }
    }

    List<ProviderVerifier> verifiers() {
        return document.providers().stream()
                .<ProviderVerifier>map(provider -> new FixtureVerifier(provider, document))
                .toList();
    }

    String unsupportedProvider() {
        return document.unsupportedProvider();
    }

    private record FixtureVerifier(String provider, Document document)
            implements ProviderVerifier {
        @Override
        public ProviderIdentity verify(String idToken) {
            if (document.unconfiguredProviders().contains(provider)) {
                throw new ProviderConfigurationError(provider + " is not configured");
            }
            TokenIdentity token = document.tokens().get(idToken);
            if (document.invalidTokens().contains(idToken) || token == null) {
                throw new InvalidIdentityToken("unknown harness id_token: " + idToken);
            }
            return new ProviderIdentity(
                    token.providerUid(),
                    token.email(),
                    token.emailVerified());
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record Document(
            List<String> providers,
            Map<String, TokenIdentity> tokens,
            @JsonProperty("invalid_tokens") Set<String> invalidTokens,
            @JsonProperty("unconfigured_providers") Set<String> unconfiguredProviders,
            @JsonProperty("unsupported_provider") String unsupportedProvider) {
    }

    private record TokenIdentity(
            @JsonProperty("provider_uid") String providerUid,
            String email,
            @JsonProperty("email_verified") boolean emailVerified) {
    }
}
