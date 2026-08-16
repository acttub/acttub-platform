package com.acttub.actingapi.oidc;

/**
 * id_token 이 서명·발급자·청중·필수 클레임 중 하나라도 어긋난다. 부르는 쪽이 401 로 옮긴다.
 *
 * <p>셋(이것·{@link ProviderConfigurationError}·{@link UnsupportedProviderError})이 {@code public}
 * 인 이유는 <b>상태코드가 여기서 갈리기 때문이다</b> — 검증 실패를 한 종류로 뭉치면 그 구분이
 * 사라진다.
 */
public class InvalidIdentityToken extends RuntimeException {
    public InvalidIdentityToken(String message) {
        super(message);
    }

    public InvalidIdentityToken(String message, Throwable cause) {
        super(message, cause);
    }
}
