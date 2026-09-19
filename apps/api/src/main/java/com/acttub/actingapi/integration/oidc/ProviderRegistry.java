package com.acttub.actingapi.integration.oidc;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 제공자 이름으로 검증기를 고른다. <b>운영에서 켜 둔 제공자만</b> 고른다.
 *
 * <p>카카오·네이버는 검수 승인 뒤에만 운영에서 켠다 — {@code AUTH_ENABLED_PROVIDERS} 에 이름을 더하면
 * 되고 앱을 다시 배포하지 않는다(앱은 {@link #enabledProviders 목록}으로 버튼을 그린다). 꺼 둔 제공자는
 * 모르는 제공자와 같은 {@link UnsupportedProviderError}(400)다. 켜 두었는데 설정이 빠진 것은
 * 검증기가 {@link ProviderConfigurationError}(503)로 알린다 — 앞은 의도한 상태이고 뒤는 운영 사고다.
 *
 * <p>개발용 제공자는 이 스위치와 무관하다. 그것은 {@code DEVELOPMENT_AUTH_PROVIDER} 로 빈 자체가
 * 생기고 사라지며, 로그인 버튼 목록에는 나오지 않는다.
 */
@Component
public class ProviderRegistry {
    /** 버튼 목록의 순서. 앱은 순서를 스스로 정하지만 응답은 늘 같은 순서로 준다. */
    private static final List<String> SOCIAL = List.of("google", "apple", "kakao", "naver");

    private final Map<String, ProviderVerifier> verifiers = new HashMap<>();
    private final Set<String> enabled;

    @Autowired
    public ProviderRegistry(
            List<ProviderVerifier> values,
            @Value("${AUTH_ENABLED_PROVIDERS:google,apple}") String enabled) {
        values.forEach(verifier -> verifiers.put(verifier.provider(), verifier));
        this.enabled = Arrays.stream(enabled.split(","))
                .map(name -> name.strip().toLowerCase(Locale.ROOT))
                .filter(name -> !name.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    /** 가진 검증기를 전부 켠다. */
    public ProviderRegistry(List<ProviderVerifier> values) {
        this(values, String.join(",", SOCIAL));
    }

    public ProviderIdentity verify(String provider, String token) {
        return verifier(provider).verify(token);
    }

    /**
     * 꺼 두었거나 모르는 제공자면 던진다. 자격 값을 확인하기 <b>전에</b> 부른다 — 꺼 둔 제공자에는
     * 코드 교환 같은 바깥 호출을 하지 않는다.
     */
    public void requireEnabled(String provider) {
        verifier(provider);
    }

    /** 켜져 있는 간편 로그인 제공자. 앱이 이 목록으로 로그인 버튼을 그린다. */
    public List<String> enabledProviders() {
        return SOCIAL.stream()
                .filter(name -> enabled.contains(name) && verifiers.containsKey(name))
                .toList();
    }

    public Set<String> providers() {
        return Set.copyOf(verifiers.keySet());
    }

    private ProviderVerifier verifier(String provider) {
        String name = provider.toLowerCase(Locale.ROOT);
        ProviderVerifier verifier = verifiers.get(name);
        if (verifier == null || (SOCIAL.contains(name) && !enabled.contains(name))) {
            throw new UnsupportedProviderError("unsupported provider: " + provider);
        }
        return verifier;
    }
}
