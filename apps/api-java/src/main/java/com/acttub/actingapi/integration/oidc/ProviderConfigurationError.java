package com.acttub.actingapi.integration.oidc;

/** 프로바이더는 알지만 client id 가 없어 검증을 시작할 수 없다. 부르는 쪽이 503 으로 옮긴다. */
public class ProviderConfigurationError extends RuntimeException {
    public ProviderConfigurationError(String message) {
        super(message);
    }
}
