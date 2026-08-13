package com.acttub.actingapi.auth;
public interface ProviderVerifier {String provider();ProviderIdentity verify(String idToken);}
