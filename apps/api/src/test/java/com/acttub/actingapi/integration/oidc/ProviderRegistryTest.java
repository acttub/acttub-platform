package com.acttub.actingapi.integration.oidc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ProviderRegistryTest {

    @Test
    @DisplayName("account.login: 켜 둔 제공자만 목록에 나오고, 꺼 둔 제공자는 모르는 제공자와 같이 거절된다")
    void onlyEnabledProvidersAreListedAndVerified() {
        ProviderRegistry registry = new ProviderRegistry(
                List.of(stub("google"), stub("apple"), stub("kakao"), stub("naver"), stub("development")),
                " Google ,apple");

        assertThat(registry.enabledProviders()).containsExactly("google", "apple");
        assertThat(registry.verify("GOOGLE", "token").providerUid()).isEqualTo("google-uid");
        assertThatThrownBy(() -> registry.verify("kakao", "token")).isInstanceOf(UnsupportedProviderError.class);
        assertThatThrownBy(() -> registry.requireEnabled("naver")).isInstanceOf(UnsupportedProviderError.class);
        assertThatThrownBy(() -> registry.verify("facebook", "token")).isInstanceOf(UnsupportedProviderError.class);
    }

    @Test
    @DisplayName("account.login: 개발용 제공자는 켜고 끄는 목록과 무관하고 로그인 버튼 목록에 나오지 않는다")
    void theDevelopmentProviderIsNeitherSwitchedNorListed() {
        ProviderRegistry registry = new ProviderRegistry(List.of(stub("google"), stub("development")), "google");

        assertThat(registry.enabledProviders()).containsExactly("google");
        assertThat(registry.verify("development", "token").providerUid()).isEqualTo("development-uid");
    }

    @Test
    @DisplayName("account.login: 목록의 순서는 설정의 순서가 아니라 늘 구글·애플·카카오·네이버다")
    void theListKeepsAFixedOrder() {
        ProviderRegistry registry = new ProviderRegistry(
                List.of(stub("naver"), stub("kakao"), stub("apple"), stub("google")), "naver,kakao,google,apple");

        assertThat(registry.enabledProviders()).containsExactly("google", "apple", "kakao", "naver");
    }

    private static ProviderVerifier stub(String provider) {
        return new ProviderVerifier() {
            @Override
            public String provider() {
                return provider;
            }

            @Override
            public ProviderIdentity verify(String idToken) {
                return new ProviderIdentity(provider + "-uid", null, false);
            }
        };
    }
}
