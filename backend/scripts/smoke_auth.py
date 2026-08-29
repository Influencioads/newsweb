"""Live end-to-end smoke test for the auth stack.

Exercises the real HTTP API against the real MySQL and Redis — not mocks — so
what it proves is what actually ships. Run after `alembic upgrade head` and
`python -m app.db.seed --demo`.

    python -m scripts.smoke_auth
"""

from __future__ import annotations

import sys

import httpx

from app.core.security import hash_password
from app.db.session import session_scope
from app.models.user import User
from sqlalchemy import select

BASE = "http://127.0.0.1:8000/api/v1"
KNOWN_PASSWORD = "SmokeTest!Password9"

PASS = "  PASS"
FAIL = "  FAIL"
failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"{PASS if condition else FAIL}  {label}" + (f"  ({detail})" if detail else ""))
    if not condition:
        failures.append(label)


def set_known_password(email: str) -> None:
    with session_scope() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        user.password_hash = hash_password(KNOWN_PASSWORD)


def main() -> int:
    email = "lakshmi@seed.example.com"
    set_known_password(email)
    c = httpx.Client(base_url=BASE, timeout=15)

    print("\n--- password login ---")
    r = c.post("/auth/login", json={"email": email, "password": "definitely-wrong-password"})
    check("wrong password is rejected", r.status_code == 401, r.json()["error"]["code"])
    check(
        "error carries a Telugu message",
        bool(r.json()["error"]["message_te"]),
        r.json()["error"]["message_te"],
    )

    r = c.post("/auth/login", json={"email": email, "password": KNOWN_PASSWORD})
    check("correct password signs in", r.status_code == 200, str(r.status_code))
    if r.status_code != 200:
        print(r.text)
        return 1
    body = r.json()
    access = body["tokens"]["access_token"]
    refresh = body["tokens"]["refresh_token"]
    me = body["me"]
    check("role resolved", any(x["role_key"] == "desk_editor" for x in me["roles"]), str(me["roles"]))
    check("level is 60 for desk_editor", me["level"] == 60, str(me["level"]))
    check("has article.publish", "article.publish" in me["permissions"])
    check("scoped to a district, not global", not me["is_global_scope"] and me["district_ids"] != [])
    check(
        "no publish-without-review permission exists",
        not any("without_review" in p or "auto_publish" in p for p in me["permissions"]),
    )

    print("\n--- identity ---")
    auth = {"Authorization": f"Bearer {access}"}
    r = c.get("/auth/me", headers=auth)
    check("GET /auth/me works with the access token", r.status_code == 200)
    check("password hash is never returned", "password_hash" not in r.text)
    check("2FA secret is never returned", "two_factor_secret" not in r.text)

    r = c.get("/auth/me")
    check("GET /auth/me without a token is 401", r.status_code == 401, r.json()["error"]["code"])

    r = c.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    check("a forged token is rejected", r.status_code == 401, r.json()["error"]["code"])

    print("\n--- sessions ---")
    r = c.get("/auth/sessions", headers=auth)
    check("sessions list returns the current device", r.status_code == 200 and len(r.json()) >= 1)
    check("current session is flagged", any(s["is_current"] for s in r.json()))

    print("\n--- refresh rotation (§1) ---")
    r = c.post("/auth/refresh", json={"refresh_token": refresh})
    check("refresh returns a new pair", r.status_code == 200)
    rotated = r.json()
    check("refresh token actually rotated", rotated["refresh_token"] != refresh)
    check("access token is new", rotated["access_token"] != access)

    r = c.post("/auth/refresh", json={"refresh_token": refresh})
    check(
        "replaying the OLD refresh token fails",
        r.status_code == 401,
        r.json()["error"]["code"],
    )
    # Reuse detection revokes every session for the account, so the token we
    # just rotated into must now be dead too.
    r = c.post("/auth/refresh", json={"refresh_token": rotated["refresh_token"]})
    check(
        "token reuse kills the whole session family",
        r.status_code == 401,
        r.json().get("error", {}).get("code", f"got {r.status_code}"),
    )

    print("\n--- force logout / session registry ---")
    r = c.post("/auth/login", json={"email": email, "password": KNOWN_PASSWORD})
    access2 = r.json()["tokens"]["access_token"]
    auth2 = {"Authorization": f"Bearer {access2}"}
    check("re-login works", r.status_code == 200)
    check("token valid before logout", c.get("/auth/me", headers=auth2).status_code == 200)

    c.post("/auth/logout", json={"all_devices": True}, headers=auth2)
    r = c.get("/auth/me", headers=auth2)
    check(
        "access token is dead immediately after force-logout",
        r.status_code == 401,
        r.json()["error"]["code"],
    )

    print("\n--- OTP login for field staff (§6.2) ---")
    r = c.post("/auth/otp/request", json={"phone": "9848000003"})  # anusha, stringer
    check("OTP request accepted", r.status_code == 200)
    otp = r.json().get("dev_otp")
    check("dev echo returned an OTP", bool(otp), "OTP_DEV_ECHO")

    r = c.post("/auth/otp/request", json={"phone": "9999999999"})  # not registered
    check(
        "unknown number gets an identical response (no enumeration)",
        r.status_code == 200 and r.json()["sent"] is True,
    )

    if otp:
        r = c.post("/auth/otp/verify", json={"phone": "9848000003", "otp": "000000"})
        check("wrong OTP rejected", r.status_code == 401, r.json()["error"]["code"])

        r = c.post("/auth/otp/verify", json={"phone": "9848000003", "otp": otp})
        check("correct OTP signs in", r.status_code == 200, str(r.status_code))
        if r.status_code == 200:
            stringer = r.json()["me"]
            check("stringer level is 30", stringer["level"] == 30, str(stringer["level"]))
            check(
                "stringer CANNOT publish",
                "article.publish" not in stringer["permissions"],
            )
            check(
                "stringer CANNOT approve",
                "article.approve" not in stringer["permissions"],
            )
            check(
                "stringer is mandal-scoped, not global",
                not stringer["is_global_scope"] and stringer["mandal_ids"] != [],
                f"mandals={stringer['mandal_ids']}",
            )

        r = c.post("/auth/otp/verify", json={"phone": "9848000003", "otp": otp})
        check("OTP is single-use", r.status_code == 401, r.json()["error"]["code"])

    print("\n--- login rate limiting (§6.2: 5 per 15 min) ---")
    codes = []
    for _ in range(7):
        rr = c.post(
            "/auth/login", json={"email": "ravi@seed.example.com", "password": "wrong-password-here"}
        )
        codes.append(rr.status_code)
    check("lockout engages after repeated failures", 429 in codes, f"codes={codes}")

    print()
    if failures:
        print(f"{len(failures)} CHECK(S) FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("All auth smoke checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
