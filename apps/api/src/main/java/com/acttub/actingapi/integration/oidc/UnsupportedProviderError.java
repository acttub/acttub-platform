package com.acttub.actingapi.integration.oidc;

/** 레지스트리에 없는 프로바이더다. 부르는 쪽이 400 으로 옮긴다. */
public class UnsupportedProviderError extends RuntimeException {
    public UnsupportedProviderError(String message) {
        super(message);
    }
}
