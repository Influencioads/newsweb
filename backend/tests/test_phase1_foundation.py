"""Phase 1 foundation tests.

These lock down the contracts that every later phase depends on: the error
envelope shape, the security headers, and the Telugu-safe database settings.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import Settings, settings
from app.core.errors import ArticleNotApprovedError, SelfApprovalDeniedError


class TestHealth:
    def test_liveness_needs_no_dependency(self, client: TestClient) -> None:
        r = client.get("/health/live")
        assert r.status_code == 200
        assert r.json() == {"status": "alive"}

    def test_readiness_reports_each_dependency(self, client: TestClient) -> None:
        r = client.get("/health")
        body = r.json()
        assert r.status_code in (200, 503)
        assert set(body["dependencies"]) == {"mysql", "redis"}
        assert body["status"] in ("ok", "degraded")
        # A degraded dependency must surface as 503 so a load balancer reacts.
        assert (body["status"] == "ok") == (r.status_code == 200)


class TestErrorEnvelope:
    """§13 / brief §29 fix this shape exactly. Clients depend on it."""

    def test_unknown_route_uses_the_envelope(self, client: TestClient) -> None:
        r = client.get("/definitely-not-a-route")
        assert r.status_code == 404
        err = r.json()["error"]
        assert err["code"] == "NOT_FOUND"
        assert err["message_en"]
        assert err["message_te"]
        assert isinstance(err["details"], dict)

    def test_every_error_carries_a_telugu_message(self) -> None:
        # A Telugu-first product must not surface English-only errors (§49).
        for cls in (ArticleNotApprovedError, SelfApprovalDeniedError):
            err = cls()
            assert err.message_te.strip(), f"{cls.__name__} has no Telugu message"
            assert err.message_en.strip()
            # Telugu block is U+0C00-U+0C7F.
            assert any("ఀ" <= ch <= "౿" for ch in err.message_te)

    def test_approval_error_matches_the_documented_example(self) -> None:
        # Brief §29 quotes this payload verbatim; the code must not drift from it.
        payload = ArticleNotApprovedError().to_payload()["error"]
        assert payload["code"] == "ARTICLE_NOT_APPROVED"
        assert payload["message_en"] == "Article cannot be published before approval."
        assert payload["message_te"] == "ఆమోదం లేకుండా కథనాన్ని ప్రచురించలేరు."


class TestSecurityHeaders:
    """§12.1."""

    def test_baseline_headers_present(self, client: TestClient) -> None:
        h = client.get("/health").headers
        assert h["X-Content-Type-Options"] == "nosniff"
        assert h["X-Frame-Options"] == "SAMEORIGIN"
        assert h["Referrer-Policy"] == "strict-origin-when-cross-origin"
        assert "Content-Security-Policy" in h

    def test_request_id_is_returned(self, client: TestClient) -> None:
        assert client.get("/health").headers.get("X-Request-ID")

    def test_upstream_request_id_is_preserved(self, client: TestClient) -> None:
        r = client.get("/health", headers={"X-Request-ID": "trace-me-123"})
        assert r.headers["X-Request-ID"] == "trace-me-123"


class TestDatabaseConfig:
    def test_connection_forces_utf8mb4(self) -> None:
        # MySQL's legacy 3-byte `utf8` mangles Telugu; utf8mb4 is mandatory (§4.1).
        assert "charset=utf8mb4" in settings.sqlalchemy_url

    def test_explicit_url_wins_over_parts(self) -> None:
        s = Settings(DATABASE_URL="mysql+pymysql://u:p@db:3306/x?charset=utf8mb4")
        assert s.sqlalchemy_url.endswith("/x?charset=utf8mb4")


class TestProductionGuards:
    """The app must refuse to boot with dev-only settings in production."""

    def test_dev_settings_are_rejected_in_production(self) -> None:
        s = Settings(
            APP_ENV="production",
            OTP_DEV_ECHO=True,
            SECURE_COOKIES=False,
            HSTS_ENABLED=False,
            ENCRYPTION_KEY="",
            MYSQL_PASSWORD="",
        )
        problems = s.assert_production_safe()
        joined = " ".join(problems)
        assert "OTP_DEV_ECHO" in joined
        assert "SECURE_COOKIES" in joined
        assert "HSTS_ENABLED" in joined
        assert "ENCRYPTION_KEY" in joined

    def test_identical_jwt_secrets_are_rejected(self) -> None:
        same = "x" * 40
        s = Settings(
            APP_ENV="production",
            OTP_DEV_ECHO=False,
            SECURE_COOKIES=True,
            HSTS_ENABLED=True,
            ENCRYPTION_KEY="k" * 44,
            MYSQL_PASSWORD="pw",
            JWT_SECRET=same,
            JWT_REFRESH_SECRET=same,
        )
        assert any("must differ" in p for p in s.assert_production_safe())

    def test_development_has_no_such_constraints(self) -> None:
        assert Settings(APP_ENV="development", OTP_DEV_ECHO=True).assert_production_safe() == []


class TestOpenApi:
    def test_openapi_document_builds(self, client: TestClient) -> None:
        r = client.get(f"{settings.API_V1_PREFIX}/openapi.json")
        assert r.status_code == 200
        doc = r.json()
        assert doc["info"]["title"] == settings.APP_NAME
        # Every declared tag must have a description (brief §42).
        assert all(t.get("description") for t in doc.get("tags", []))
