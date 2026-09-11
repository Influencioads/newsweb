"""Transactional SMS via MSG91 (updated doc §4).

Same contract as the email sender: unconfigured means echo mode, so the OTP
flow that already works in development keeps working, and turning on real SMS
is three settings rather than a code change.

MSG91's flow API takes a template id plus variables; the OTP itself is a
variable, never part of a free-text body, because Indian DLT rules require the
template to be pre-registered.
"""

from __future__ import annotations

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_ENDPOINT = "https://control.msg91.com/api/v5/flow/"


def configured() -> bool:
    return bool(settings.MSG91_AUTH_KEY and settings.MSG91_TEMPLATE_ID)


def send_otp(phone: str, otp: str) -> bool:
    """`phone` is E.164 without '+', matching `auth_service.normalise_phone`."""
    if not configured():
        logger.info("sms_echo", phone_suffix=phone[-4:], otp_len=len(otp))
        return True
    try:
        response = httpx.post(
            _ENDPOINT,
            headers={
                "authkey": settings.MSG91_AUTH_KEY,
                "Content-Type": "application/json",
            },
            json={
                "template_id": settings.MSG91_TEMPLATE_ID,
                "short_url": "0",
                "recipients": [{"mobiles": phone, "otp": otp}],
            },
            timeout=15,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error("sms_send_failed", phone_suffix=phone[-4:], error=str(exc)[:200])
        return False
    logger.info("sms_sent", phone_suffix=phone[-4:])
    return True
