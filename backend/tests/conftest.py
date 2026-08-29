"""Shared pytest fixtures."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

# Must be set before app.core.config is imported anywhere.
os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c
