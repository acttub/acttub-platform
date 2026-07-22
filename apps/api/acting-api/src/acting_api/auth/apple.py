from __future__ import annotations

import jwt
from jwt import InvalidTokenError, PyJWKClient, PyJWKClientError

from acting_api.auth.providers import (
    InvalidIdentityToken,
    ProviderConfigurationError,
    ProviderIdentity,
)

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"


class AppleProviderVerifier:
    """Verifies Apple "Sign in with Apple" identity tokens.

    네이티브 iOS 로그인의 identityToken은 Apple이 RS256으로 서명한 JWT다.
    Apple의 공개키(JWKS)로 서명을 검증하고 iss/aud/exp를 확인한 뒤 sub/email을 추출한다.
    aud는 네이티브 앱의 번들 ID(com.acttub.app)와 일치해야 한다.
    """

    provider = "apple"

    def __init__(
        self,
        client_id: str | None,
        *,
        jwks_client: PyJWKClient | None = None,
    ):
        # 콤마 구분으로 복수 audience(번들 ID + 향후 Services ID) 허용.
        self._audiences = [
            value.strip() for value in (client_id or "").split(",") if value.strip()
        ]
        if jwks_client is not None:
            self._jwks_client: PyJWKClient | None = jwks_client
        elif self._audiences:
            self._jwks_client = PyJWKClient(APPLE_JWKS_URL)
        else:
            self._jwks_client = None

    def verify(self, id_token: str) -> ProviderIdentity:
        if not self._audiences or self._jwks_client is None:
            raise ProviderConfigurationError("APPLE_OAUTH_CLIENT_ID not configured")
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(id_token)
            claims = jwt.decode(
                id_token,
                signing_key.key,
                algorithms=["RS256"],
                audience=self._audiences,
                issuer=APPLE_ISSUER,
            )
        except (InvalidTokenError, PyJWKClientError, ValueError) as exc:
            raise InvalidIdentityToken("invalid apple id_token") from exc
        provider_uid = claims.get("sub")
        if not isinstance(provider_uid, str) or not provider_uid:
            raise InvalidIdentityToken("apple id_token is missing sub")
        email = claims.get("email")
        if not isinstance(email, str) or not email:
            email = None
        verified_claim = claims.get("email_verified", False)
        email_verified = verified_claim is True or (
            isinstance(verified_claim, str) and verified_claim.lower() == "true"
        )
        return ProviderIdentity(
            provider_uid=provider_uid,
            email=email,
            email_verified=email_verified,
        )
