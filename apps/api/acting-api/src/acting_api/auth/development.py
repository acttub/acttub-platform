from __future__ import annotations

from acting_api.auth.providers import InvalidIdentityToken, ProviderIdentity


class DevelopmentProviderVerifier:
    provider = "development"

    def verify(self, id_token: str) -> ProviderIdentity:
        token = id_token.strip()
        if not token:
            raise InvalidIdentityToken("development id_token is empty")

        if ":" not in token:
            return ProviderIdentity(
                provider_uid=token,
                email=None,
                email_verified=False,
            )

        provider_uid, email = token.split(":", 1)
        return ProviderIdentity(
            provider_uid=provider_uid,
            email=email,
            email_verified=False,
        )
