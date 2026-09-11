"""The identity-verification contract.

Manual review is the working implementation and a vendor is a future
possibility, so this exists on day one rather than being retrofitted. The seam
is narrow on purpose: `kyc_service` calls `submit()` and writes whatever
`KycDecision` comes back through one function. It never asks which provider
answered, which is what makes swapping one in a configuration change rather
than a rewrite of the review queue.

Mirrors `integrations/storage` and `integrations/tts`: plain dataclasses in,
plain dataclasses out, no vendor types anywhere near the service layer.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.models.enums import KycStatus


@dataclass(slots=True)
class KycDocumentRef:
    """A document the applicant supplied, by reference.

    Bytes are deliberately absent: a vendor adapter that needs them fetches
    them itself from the private store, so nothing that does not need an
    identity document ever holds one in memory.
    """

    kind: str
    mime: str
    sha256: str
    storage_key: str


@dataclass(slots=True)
class KycSubmission:
    profile_id: int
    contributor_type: str
    full_name: str
    phone: str | None = None
    email: str | None = None
    documents: list[KycDocumentRef] = field(default_factory=list)
    #: Masked numbers, organisation, course year — what the applicant told us,
    #: never the full document numbers.
    declared: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class KycDecision:
    status: KycStatus
    provider: str
    provider_ref: str | None = None
    reason_te: str | None = None
    reason_en: str | None = None
    #: What a vendor read back off the documents, for a reviewer to compare.
    extracted: dict[str, str] = field(default_factory=dict)
    #: True when the provider decided by itself. False means a person must.
    automated: bool = False


class KycProvider(ABC):
    key: str = "base"

    #: False means this provider cannot reach a verdict on its own, so the
    #: application waits in the admin queue. Manual review sets this False and
    #: that is the whole difference between it and a vendor.
    can_decide: bool = False

    def available(self) -> bool:
        return True

    @abstractmethod
    def submit(self, submission: KycSubmission) -> KycDecision:
        """Hand an application to whoever decides it."""

    def poll(self, provider_ref: str) -> KycDecision | None:
        """Ask a vendor whether an async check has finished. None = not yet."""
        return None

    def webhook_secret(self) -> str | None:
        """HMAC secret for this provider's callbacks, when it has any."""
        return None
