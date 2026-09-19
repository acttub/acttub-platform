package com.acttub.actingapi.support;

import java.util.List;

import com.acttub.actingapi.integration.oidc.InvalidIdentityToken;
import com.acttub.actingapi.integration.oidc.ProviderIdentity;
import com.acttub.actingapi.integration.oidc.ProviderRegistry;
import com.acttub.actingapi.integration.oidc.ProviderVerifier;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * 실제 제공자를 부르지 않는 로그인. 제공자 넷의 검증기를 통째로 스텁으로 바꾼다.
 *
 * <p>ID 토큰의 모양은 {@code 제공자ID|이메일|verified} 다. 이메일과 검증 표시는 생략할 수 있다 —
 * {@code kakao-1} 은 이메일 없는 신원, {@code g-1|a@b.com|verified} 는 제공자가 검증한 이메일,
 * {@code n-1|a@b.com} 은 검증되지 않은 이메일이다. {@code invalid} 는 위조된 토큰이다.
 *
 * <p>레지스트리를 {@code @Primary} 로 갈아 끼우는 것은 실물 검증기와 이름이 겹치기 때문이다 — 같은
 * 이름의 검증기가 둘이면 어느 쪽이 이길지 빈 등록 순서에 달린다.
 */
@TestConfiguration(proxyBeanMethods = false)
public class StubProviders {

    @Bean
    @Primary
    ProviderRegistry stubProviderRegistry() {
        return new ProviderRegistry(List.of(
                stub("google"), stub("apple"), stub("kakao"), stub("naver")));
    }

    private static ProviderVerifier stub(String provider) {
        return new ProviderVerifier() {
            @Override
            public String provider() {
                return provider;
            }

            @Override
            public ProviderIdentity verify(String idToken) {
                if (idToken == null || idToken.isBlank() || "invalid".equals(idToken)) {
                    throw new InvalidIdentityToken("stub rejected the token");
                }
                String[] parts = idToken.split("\\|", -1);
                return new ProviderIdentity(
                        parts[0],
                        parts.length > 1 && !parts[1].isEmpty() ? parts[1] : null,
                        parts.length > 2 && "verified".equals(parts[2]));
            }
        };
    }
}
