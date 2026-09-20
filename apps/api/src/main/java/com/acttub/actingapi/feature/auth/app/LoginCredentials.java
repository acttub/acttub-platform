package com.acttub.actingapi.feature.auth.app;

/**
 * 로그인 요청이 실어 온 제공자별 자격 값.
 *
 * <p>제공자마다 내는 것이 다르다. 구글·카카오는 앱이 받은 ID 토큰을, 애플은 ID 토큰과
 * authorization code 를 함께 낸다(코드는 탈퇴 때 폐기에 쓸 애플 토큰으로 바꾼다). 네이버는 ID 토큰
 * 없이 authorization code·code verifier·redirect URI·state 를 내고 서버가 교환한다 — 앱에 client
 * secret 을 두지 않기 위해서다. 안 쓰는 칸은 {@code null} 이다.
 *
 * <p>⚠ {@code toString()} 을 로그에 남기지 않는다 — 코드와 토큰이 들어 있다.
 */
public record LoginCredentials(
        String idToken,
        String authorizationCode,
        String codeVerifier,
        String redirectUri,
        String state) {

    public LoginCredentials(String idToken, String authorizationCode, String codeVerifier, String redirectUri) {
        this(idToken, authorizationCode, codeVerifier, redirectUri, null);
    }

    @Override
    public String toString() {
        return "LoginCredentials[redacted]";
    }
}
