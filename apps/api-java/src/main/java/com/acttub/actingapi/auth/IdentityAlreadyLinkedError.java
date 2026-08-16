package com.acttub.actingapi.auth;

/**
 * 같은 프로바이더 신원이 이미 다른 계정에 물려 있다. <b>저장소가 내는 것이라 여기 남는다</b> —
 * 프로바이더 검증이 내는 셋({@code InvalidIdentityToken} 외)은 7단계에서 {@code oidc} 로 갔다.
 */
class IdentityAlreadyLinkedError extends RuntimeException {
    IdentityAlreadyLinkedError(String message) {
        super(message);
    }
}
