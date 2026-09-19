package com.acttub.actingapi.integration.oidc;

/**
 * 연결 끊기 알림이 제공자가 보낸 것임을 확인할 수 없다. 부르는 쪽이 401 로 옮기고 <b>아무것도 지우지
 * 않는다.</b> 어느 검사에서 걸렸는지는 알리지 않는다.
 */
public class InvalidProviderNotice extends RuntimeException {
    public InvalidProviderNotice() {
        super("the provider notice could not be verified");
    }
}
