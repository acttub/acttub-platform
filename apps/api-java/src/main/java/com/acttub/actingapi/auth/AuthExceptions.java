package com.acttub.actingapi.auth;
final class AuthExceptions {private AuthExceptions(){}}
// 프로바이더 검증이 내는 셋(InvalidIdentityToken·ProviderConfigurationError·
// UnsupportedProviderError)은 oidc 가 소유한다. 여기 남은 것은 신원 연결이 이미 다른
// 계정에 물려 있을 때 **저장소**가 내는 것이라 auth 의 것이다.
class IdentityAlreadyLinkedError extends RuntimeException{IdentityAlreadyLinkedError(String m){super(m);}}
