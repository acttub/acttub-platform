package com.acttub.actingapi.integration.oidc;

/**
 * 애플 토큰 API. 로그인 때 authorization code 를 토큰으로 바꾸고, 탈퇴 때 그 토큰을 폐기한다
 * (App Store 필수). 요청 형식은 애플 공식 문서 「Generate and validate tokens」·「Revoke tokens」다.
 */
public interface AppleTokenClient {

    /**
     * authorization code 를 바꿔 온다. 코드는 5분 동안 한 번만 쓸 수 있다.
     *
     * @param clientId 그 코드를 받은 앱의 Client ID — ID 토큰의 {@code aud} 와 같은 값이어야 한다
     * @return 폐기에 쓸 값. {@link #revoke} 에 그대로 넘기는 불투명한 문자열이고 비밀이다
     * @throws InvalidIdentityToken 코드가 잘못됐거나 이미 쓰였다
     * @throws ProviderConfigurationError 애플 키 설정이 없거나 애플이 우리 자격을 거절했다
     * @throws ProviderUnavailable 애플이 답하지 않는다
     */
    String exchange(String authorizationCode, String clientId);

    /**
     * 이미 폐기된 값이어도 성공이다(애플이 200 을 준다).
     *
     * @throws ProviderConfigurationError 애플 키 설정이 없다
     * @throws ProviderUnavailable 애플이 답하지 않거나 거절했다 — 다시 시도한다
     */
    void revoke(String grant);
}
