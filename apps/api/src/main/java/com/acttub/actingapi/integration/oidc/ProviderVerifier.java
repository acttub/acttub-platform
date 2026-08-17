package com.acttub.actingapi.integration.oidc;
public interface ProviderVerifier {String provider();ProviderIdentity verify(String idToken);}
