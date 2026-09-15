"""Shared pytest fixtures."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

# Must be set before app.core.config is imported anywhere.
os.environ.setdefault("APP_ENV", "test")

# Settings read the developer's own .env, so a machine with real provider
# credentials exported would make the suite call a paid API for real: the AI
# tests would spend money, take 25s each to time out, and fail depending on
# whose laptop ran them. Blanking the keys here forces every provider to report
# itself unavailable, which is the keyless path the tests are written against.
# A test that wants a provider monkeypatches one in explicitly.
for _credential in (
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AIMLAPI_API_KEY",
    "GOOGLE_TTS_API_KEY",
    "BHASHINI_API_KEY",
):
    os.environ[_credential] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c
