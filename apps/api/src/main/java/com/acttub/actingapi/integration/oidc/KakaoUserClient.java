package com.acttub.actingapi.integration.oidc;

/**
 * 카카오 사용자 API — 어드민 키로 부른다. 요청 형식은 카카오 공식 문서 「사용자 정보 조회」·「연결 해제」의
 * 어드민 키 방식이다({@code target_id_type=user_id}). 회원번호는 ID 토큰의 {@code sub} 와 같다.
 */
public interface KakaoUserClient {

    /**
     * 이 회원의 카카오계정 이메일이 {@code email} 이고 카카오가 그것을 인증했는가
     * ({@code is_email_valid} 와 {@code is_email_verified} 가 둘 다 참).
     *
     * @throws ProviderConfigurationError 어드민 키가 없거나 카카오가 그 키를 거절했다
     * @throws ProviderUnavailable 카카오가 답하지 않는다
     */
    boolean emailVerified(String kakaoUserId, String email);

    /**
     * 연결을 끊는다(카카오 정책 필수).
     *
     * @throws ProviderConfigurationError 어드민 키가 없다
     * @throws ProviderUnavailable 카카오가 답하지 않거나 거절했다 — 다시 시도한다
     */
    void unlink(String kakaoUserId);
}
