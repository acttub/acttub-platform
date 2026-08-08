package com.acttub.actingapi.auth;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("!contract")
public class ProviderRegistry {
    private final Map<String, ProviderVerifier> verifiers = new HashMap<>();

    public ProviderRegistry(List<ProviderVerifier> values) {
        values.forEach(verifier -> verifiers.put(verifier.provider(), verifier));
    }

    public ProviderIdentity verify(String provider, String token) {
        ProviderVerifier verifier = verifiers.get(provider.toLowerCase());
        if (verifier == null) {
            throw new UnsupportedProviderError("unsupported provider: " + provider);
        }
        return verifier.verify(token);
    }

    public Set<String> providers() {
        return Set.copyOf(verifiers.keySet());
    }
}
