package com.acttub.actingapi.oidc;
public interface ProviderVerifier {String provider();ProviderIdentity verify(String idToken);}
