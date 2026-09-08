"""Transactional email (updated doc §4 — verification and password reset).

One setting drives it: `SMTP_URL`, in the shape
`smtp://user:pass@host:587` or `smtps://user:pass@host:465`. Unset means the
sender is in *echo* mode — it logs the message and reports success — which is
exactly how OTP already behaves in development, so the whole registration flow
is testable before anyone buys an SMTP plan.

Echo mode is refused in production by `assert_production_safe`, so a real
deployment cannot silently swallow verification mail.
"""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from urllib.parse import unquote, urlparse

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def configured() -> bool:
    return bool(settings.SMTP_URL)


def send(to: str, *, subject: str, body_text: str, body_html: str | None = None) -> bool:
    """Deliver one message. Returns False on failure — callers must not fail a
    registration because mail was slow; the user can request a new link."""
    if not configured():
        logger.info("email_echo", to=to, subject=subject, body=body_text[:400])
        return True

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{settings.MAIL_FROM_NAME} <{settings.MAIL_FROM}>"
    message["To"] = to
    message.set_content(body_text)
    if body_html:
        message.add_alternative(body_html, subtype="html")

    parsed = urlparse(settings.SMTP_URL)
    host = parsed.hostname or "localhost"
    port = parsed.port or (465 if parsed.scheme == "smtps" else 587)
    username = unquote(parsed.username) if parsed.username else None
    password = unquote(parsed.password) if parsed.password else None

    try:
        if parsed.scheme == "smtps":
            client: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            client = smtplib.SMTP(host, port, timeout=15)
            client.starttls()
        with client:
            if username and password:
                client.login(username, password)
            client.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        logger.error("email_send_failed", to=to, error=str(exc)[:200])
        return False
    logger.info("email_sent", to=to, subject=subject)
    return True
