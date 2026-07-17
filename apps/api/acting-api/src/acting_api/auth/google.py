from __future__ import annotations

from google.auth import exceptions as google_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from acting_api.auth.providers import (
    InvalidIdentityToken,
    ProviderConfigurationError,
    ProviderIdentity,
)


class GoogleProviderVerifier:
    provider = "google"

    def __init__(self, client_id: str | None):
        self._client_id = client_id

    def verify(self, id_token: str) -> ProviderIdentity:
        if not self._client_id:
            raise ProviderConfigurationError("GOOGLE_OAUTH_CLIENT_ID not configured")
        try:
            claims = google_id_token.verify_oauth2_token(
                id_token,
                google_requests.Request(),
                self._client_id,
            )
        except (ValueError, google_exceptions.GoogleAuthError) as exc:
            raise InvalidIdentityToken("invalid google id_token") from exc
        provider_uid = claims.get("sub")
        if not isinstance(provider_uid, str) or not provider_uid:
            raise InvalidIdentityToken("google id_token is missing sub")
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
