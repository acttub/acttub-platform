package com.acttub.actingapi.integration.oidc;

/**
 * ID 토큰에서 확인한 신원.
 *
 * @param audience 토큰의 {@code aud} 가운데 첫 값 — 그 토큰을 받은 앱의 Client ID. 애플은 같은 값을
 *        authorization code 교환과 토큰 폐기에 써야 한다. 모르면 {@code null}
 */
public record ProviderIdentity(String providerUid, String email, boolean emailVerified, String audience) {
    public ProviderIdentity(String providerUid, String email, boolean emailVerified) {
        this(providerUid, email, emailVerified, null);
    }
}
