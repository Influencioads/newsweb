"""A person reads the documents and decides.

The default, and the one that ships. It makes no external call and reaches no
verdict — `submit()` simply marks the application as awaiting review, and the
admin queue does the rest.

That is not a stub. Manual review is the correct answer for a newsroom taking
on a few contributors a week: it costs nothing, needs no vendor onboarding, and
an editor recognising a local reporter's name is better evidence than an API
response.
"""

from __future__ import annotations

from app.integrations.kyc.base import KycDecision, KycProvider, KycSubmission
from app.models.enums import KycStatus


class ManualKyc(KycProvider):
    key = "manual"
    can_decide = False

    def submit(self, submission: KycSubmission) -> KycDecision:
        return KycDecision(
            status=KycStatus.SUBMITTED,
            provider=self.key,
            automated=False,
        )
