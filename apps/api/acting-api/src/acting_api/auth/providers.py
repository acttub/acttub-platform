from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class InvalidIdentityToken(ValueError):
    pass


class ProviderConfigurationError(RuntimeError):
    pass


class UnsupportedProviderError(ValueError):
    pass


@dataclass(frozen=True)
class ProviderIdentity:
    provider_uid: str
    email: str | None
    email_verified: bool


class ProviderVerifier(Protocol):
    provider: str

    def verify(self, id_token: str) -> ProviderIdentity: ...


class ProviderRegistry:
    def __init__(self, verifiers: list[ProviderVerifier] | None = None):
        self._verifiers: dict[str, ProviderVerifier] = {}
        for verifier in verifiers or []:
            self.register(verifier)

    def register(self, verifier: ProviderVerifier) -> None:
        self._verifiers[verifier.provider] = verifier

    def verify(self, provider: str, id_token: str) -> ProviderIdentity:
        verifier = self._verifiers.get(provider.lower())
        if verifier is None:
            raise UnsupportedProviderError(f"unsupported provider: {provider}")
        return verifier.verify(id_token)
