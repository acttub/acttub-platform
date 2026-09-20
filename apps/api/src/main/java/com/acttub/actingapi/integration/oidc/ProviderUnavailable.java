package com.acttub.actingapi.integration.oidc;

import com.acttub.actingapi.platform.observability.ExternalFailure;

/**
 * 서버가 제공자에 물어야 하는데 제공자가 답하지 않는다(시간 초과·5xx·알 수 없는 응답). 로그인에서는
 * 부르는 쪽이 502 로 옮기고, 탈퇴 뒤 정리에서는 다시 시도할 사유다.
 *
 * <p>메시지에 코드·토큰·제공자 ID 를 싣지 않는다.
 */
public class ProviderUnavailable extends RuntimeException implements ExternalFailure {
    public ProviderUnavailable(String message) {
        super(message);
    }

    public ProviderUnavailable(String message, Throwable cause) {
        super(message, cause);
    }
}
