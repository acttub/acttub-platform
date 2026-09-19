package com.acttub.actingapi.support;

import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.integration.oidc.AppleTokenClient;
import com.acttub.actingapi.integration.oidc.InvalidIdentityToken;
import com.acttub.actingapi.integration.oidc.KakaoUserClient;
import com.acttub.actingapi.integration.oidc.NaverTokenClient;
import com.acttub.actingapi.integration.oidc.ProviderIdentity;
import com.acttub.actingapi.integration.oidc.ProviderRegistry;
import com.acttub.actingapi.integration.oidc.ProviderUnavailable;
import com.acttub.actingapi.integration.oidc.ProviderVerifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * 실제 제공자를 부르지 않는 로그인과 탈퇴. 제공자 넷의 검증기와 바깥 호출 셋(애플 토큰 API, 카카오
 * 사용자 API, 네이버 토큰 API)을 통째로 스텁으로 바꾼다.
 *
 * <p>ID 토큰의 모양은 {@code 제공자ID|이메일|verified} 다. 이메일과 검증 표시는 생략할 수 있다 —
 * {@code kakao-1} 은 이메일 없는 신원, {@code g-1|a@b.com|verified} 는 제공자가 검증한 이메일,
 * {@code n-1|a@b.com} 은 검증되지 않은 이메일이다. {@code invalid} 는 위조된 토큰이다.
 *
 * <p>네이버는 앱이 ID 토큰을 내지 않는다. 스텁의 코드 교환은 <b>받은 authorization code 를 그대로 ID
 * 토큰으로</b> 돌려주므로, 테스트는 위 모양의 문자열을 {@code authorization_code} 로 보낸다. 카카오의
 * 이메일 검증 여부는 ID 토큰의 표시가 아니라 {@link StubKakaoUsers#verifiedEmails} 가 정한다 — 실물도
 * ID 토큰이 아니라 사용자 정보 API 에 묻는다.
 *
 * <p>스텁은 컨텍스트에 하나씩이라 상태가 테스트 사이에 남는다. {@code @BeforeEach} 에서
 * {@code reset()} 한다.
 *
 * <p>레지스트리를 {@code @Primary} 로 갈아 끼우는 것은 실물 검증기와 이름이 겹치기 때문이다 — 같은
 * 이름의 검증기가 둘이면 어느 쪽이 이길지 빈 등록 순서에 달린다. 켜 둔 제공자는 실물과 같은 설정
 * ({@code AUTH_ENABLED_PROVIDERS})을 따르되, 테스트의 기본은 넷 다 켜짐이다.
 */
@TestConfiguration(proxyBeanMethods = false)
public class StubProviders {

    @Bean
    @Primary
    ProviderRegistry stubProviderRegistry(
            @Value("${AUTH_ENABLED_PROVIDERS:google,apple,kakao,naver}") String enabled) {
        return new ProviderRegistry(
                List.of(stub("google"), stub("apple"), stub("kakao"), stub("naver")), enabled);
    }

    @Bean
    @Primary
    StubAppleTokens stubAppleTokens() {
        return new StubAppleTokens();
    }

    @Bean
    @Primary
    StubKakaoUsers stubKakaoUsers() {
        return new StubKakaoUsers();
    }

    @Bean
    @Primary
    StubNaverTokens stubNaverTokens() {
        return new StubNaverTokens();
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
                        parts.length > 2 && "verified".equals(parts[2]),
                        "stub-client-id");
            }
        };
    }

    /** 애플 토큰 API. 바꿔 온 값은 {@code apple-grant:<코드>} 다. {@code used-code} 는 이미 쓰인 코드다. */
    public static class StubAppleTokens implements AppleTokenClient {
        public volatile boolean unavailable;
        public final List<String> exchangedCodes = new CopyOnWriteArrayList<>();
        public final List<String> revokedGrants = new CopyOnWriteArrayList<>();

        public void reset() {
            unavailable = false;
            exchangedCodes.clear();
            revokedGrants.clear();
        }

        @Override
        public String exchange(String authorizationCode, String clientId) {
            if (unavailable) {
                throw new ProviderUnavailable("stub apple is down");
            }
            if ("used-code".equals(authorizationCode)) {
                throw new InvalidIdentityToken("stub apple rejected the code");
            }
            exchangedCodes.add(authorizationCode);
            return "apple-grant:" + authorizationCode;
        }

        @Override
        public void revoke(String grant) {
            if (unavailable) {
                throw new ProviderUnavailable("stub apple is down");
            }
            revokedGrants.add(grant);
        }
    }

    /** 카카오 사용자 API. 인증된 이메일은 {@link #verifiedEmails} 에 넣어 둔 것뿐이다. */
    public static class StubKakaoUsers implements KakaoUserClient {
        public volatile boolean unavailable;
        public final Set<String> verifiedEmails = ConcurrentHashMap.newKeySet();
        public final List<String> askedUserIds = new CopyOnWriteArrayList<>();
        public final List<String> unlinkedUserIds = new CopyOnWriteArrayList<>();

        public void reset() {
            unavailable = false;
            verifiedEmails.clear();
            askedUserIds.clear();
            unlinkedUserIds.clear();
        }

        @Override
        public boolean emailVerified(String kakaoUserId, String email) {
            askedUserIds.add(kakaoUserId);
            if (unavailable) {
                throw new ProviderUnavailable("stub kakao is down");
            }
            return verifiedEmails.contains(email);
        }

        @Override
        public void unlink(String kakaoUserId) {
            if (unavailable) {
                throw new ProviderUnavailable("stub kakao is down");
            }
            unlinkedUserIds.add(kakaoUserId);
        }
    }

    /**
     * 네이버 토큰 API. 받은 코드를 그대로 ID 토큰으로 돌려주고 refresh token 은
     * {@code naver-refresh:<코드>} 다. {@code used-code} 는 이미 쓰인 코드다.
     */
    public static class StubNaverTokens implements NaverTokenClient {
        public volatile boolean unavailable;
        public final List<Exchange> exchanges = new CopyOnWriteArrayList<>();
        public final List<String> revokedTokens = new CopyOnWriteArrayList<>();

        public void reset() {
            unavailable = false;
            exchanges.clear();
            revokedTokens.clear();
        }

        @Override
        public NaverGrant exchange(String authorizationCode, String codeVerifier, String redirectUri, String state) {
            if (unavailable) {
                throw new ProviderUnavailable("stub naver is down");
            }
            if ("used-code".equals(authorizationCode)) {
                throw new InvalidIdentityToken("stub naver rejected the code");
            }
            exchanges.add(new Exchange(authorizationCode, codeVerifier, redirectUri, state));
            return new NaverGrant(authorizationCode, "naver-refresh:" + authorizationCode);
        }

        @Override
        public void revoke(String refreshToken) {
            if (unavailable) {
                throw new ProviderUnavailable("stub naver is down");
            }
            revokedTokens.add(refreshToken);
        }

        public record Exchange(String authorizationCode, String codeVerifier, String redirectUri, String state) {
        }
    }
}
