package com.acttub.actingapi.auth;
final class AuthExceptions {private AuthExceptions(){}}
class InvalidIdentityToken extends RuntimeException{InvalidIdentityToken(String m){super(m);} InvalidIdentityToken(String m,Throwable c){super(m,c);}}
class ProviderConfigurationError extends RuntimeException{ProviderConfigurationError(String m){super(m);}}
class UnsupportedProviderError extends RuntimeException{UnsupportedProviderError(String m){super(m);}}
class IdentityAlreadyLinkedError extends RuntimeException{IdentityAlreadyLinkedError(String m){super(m);}}
