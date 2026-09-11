"""KYC provider factory."""

from __future__ import annotations

from app.integrations.kyc.base import (
    KycDecision,
    KycDocumentRef,
    KycProvider,
    KycSubmission,
)
from app.integrations.kyc.manual import ManualKyc

__all__ = [
    "KycDecision",
    "KycDocumentRef",
    "KycProvider",
    "KycSubmission",
    "ManualKyc",
    "get_kyc",
]

_PROVIDERS: dict[str, type[KycProvider]] = {"manual": ManualKyc}


def get_kyc(provider: str | None = None) -> KycProvider:
    """The configured provider.

    Not `lru_cache`d, for the same reason `get_tts` is not: the provider is
    chosen per call from a database setting an admin can change without a
    deploy.

    An unknown name degrades to manual review rather than raising. A typo in a
    settings row should mean "a person reads it", never "nobody can apply".
    """
    return _PROVIDERS.get((provider or "manual").lower(), ManualKyc)()
