"""Application settings.

Every value is sourced from the environment (Build Instructions §14, brief §35).
Nothing here may hold a real credential default — placeholders only, so a missing
env var fails loudly in staging/production instead of silently using a dev value.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "production", "test"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- core ---------------------------------------------------------------
    APP_ENV: Environment = "development"
    APP_NAME: str = "Telugu News Platform"
    APP_URL: str = "http://localhost:5174"
    CMS_URL: str = "http://localhost:5174/admin"
    API_URL: str = "http://localhost:8000"
    API_V1_PREFIX: str = "/api/v1"
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = False

    # --- database -----------------------------------------------------------
    MYSQL_HOST: str = "127.0.0.1"
    MYSQL_PORT: int = 3307
    MYSQL_DATABASE: str = "telugu_news"
    MYSQL_USER: str = "news"
    MYSQL_PASSWORD: str = ""
    DATABASE_URL: str = ""

    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_RECYCLE: int = 1800
    DB_ECHO: bool = False

    # --- redis / celery -----------------------------------------------------
    REDIS_URL: str = "redis://127.0.0.1:6381/0"
    CELERY_BROKER_URL: str = "redis://127.0.0.1:6381/1"
    CELERY_RESULT_BACKEND: str = "redis://127.0.0.1:6381/2"

    # --- search -------------------------------------------------------------
    MEILISEARCH_URL: str = "http://127.0.0.1:7701"
    MEILISEARCH_KEY: str = ""
    MEILISEARCH_ARTICLES_INDEX: str = "articles"

    # --- auth (§6.2) --------------------------------------------------------
    JWT_SECRET: str = Field(default_factory=lambda: secrets.token_hex(32))
    JWT_REFRESH_SECRET: str = Field(default_factory=lambda: secrets.token_hex(32))
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TTL_MINUTES: int = 15
    JWT_REFRESH_TTL_DAYS: int = 30
    PASSWORD_HASH_SCHEME: Literal["argon2", "bcrypt"] = "argon2"
    BCRYPT_ROUNDS: int = 12
    MAX_CONCURRENT_STAFF_SESSIONS: int = 3
    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_ATTEMPT_WINDOW_MINUTES: int = 15
    LOGIN_LOCKOUT_MINUTES: int = 30
    OTP_TTL_SECONDS: int = 300
    OTP_LENGTH: int = 6
    PASSWORD_RESET_TTL_MINUTES: int = 15
    ENCRYPTION_KEY: str = ""

    # --- storage ------------------------------------------------------------
    STORAGE_PROVIDER: Literal["local", "zata", "bunny", "s3"] = "local"
    STORAGE_LOCAL_PATH: str = "./var/storage"
    STORAGE_LOCAL_PUBLIC_URL: str = "http://localhost:8000/media"
    ZATA_ENDPOINT: str = ""
    ZATA_ACCESS_KEY: str = ""
    ZATA_SECRET_KEY: str = ""
    ZATA_BUCKET: str = ""
    ZATA_REGION: str = "idr01"
    BUNNY_STORAGE_ZONE: str = ""
    BUNNY_STORAGE_KEY: str = ""
    BUNNY_CDN_URL: str = ""
    BUNNY_PULL_ZONE: str = ""
    BUNNY_STREAM_LIBRARY_ID: str = ""
    BUNNY_STREAM_KEY: str = ""
    BUNNY_STREAM_TOKEN_KEY: str = ""
    UPLOAD_MAX_BYTES: int = 524_288_000
    UPLOAD_IMAGE_MAX_BYTES: int = 15_728_640

    # --- AI (§7.1) ----------------------------------------------------------
    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    REPLICATE_API_TOKEN: str = ""
    AI_DEFAULT_PROVIDER: str = "gemini"
    AI_DEFAULT_TIMEOUT_MS: int = 25_000
    AI_MONTHLY_BUDGET_INR: float = 15_000.0
    AI_BUDGET_ALERT_PERCENT: int = 80
    AI_QUOTA_STRINGER_PER_DAY: int = 20
    AI_QUOTA_REPORTER_PER_DAY: int = 50
    AI_SIMILARITY_BLOCK_PERCENT: int = 85
    AI_ENABLED: bool = False

    # --- messaging ----------------------------------------------------------
    MSG91_AUTH_KEY: str = ""
    MSG91_SENDER_ID: str = ""
    MSG91_TEMPLATE_ID: str = ""
    OTP_DEV_ECHO: bool = True
    FCM_SERVICE_ACCOUNT_JSON: str = ""
    APNS_KEY_ID: str = ""
    SMTP_URL: str = ""

    # --- licensed image sourcing --------------------------------------------
    IMAGE_SOURCE_PROVIDER: str = "wikimedia"
    #: Wikimedia's API policy requires a descriptive User-Agent naming a REAL
    #: contact. They actively 403 requests whose UA contains placeholder domains
    #: such as example.com, so this must be set to the publication's own site or
    #: editorial address before the importer will work.
    IMAGE_SOURCE_CONTACT: str = "https://topten.news"

    # --- video --------------------------------------------------------------
    YOUTUBE_API_KEY: str = ""
    VIDEO_DEFAULT_PROVIDER: str = "bunny"
    FFMPEG_BIN: str = "ffmpeg"

    # --- e-paper (§8.1) -----------------------------------------------------
    EPAPER_VIEW_DPI: int = 150
    EPAPER_TILE_DPI: int = 300
    EPAPER_THUMB_WIDTH: int = 400
    EPAPER_TILE_SIZE: int = 256
    EPAPER_OCR_LANG: str = "tel"
    TESSERACT_BIN: str = "tesseract"
    PDFTOPPM_BIN: str = "pdftoppm"

    # --- security (§12.1) ---------------------------------------------------
    CORS_ORIGINS: str = "http://localhost:5174,http://127.0.0.1:5174"
    RATE_LIMIT_GLOBAL_PER_MIN: int = 100
    RATE_LIMIT_UPLOAD_PER_HOUR: int = 10
    SECURE_COOKIES: bool = False
    HSTS_ENABLED: bool = False
    CSP_ENABLED: bool = True

    # --- observability ------------------------------------------------------
    SENTRY_DSN: str = ""
    GA4_MEASUREMENT_ID: str = ""

    # --- public cache (§10.1) -----------------------------------------------
    PUBLIC_CACHE_TTL_SECONDS: int = 60
    PUBLIC_CACHE_SWR_SECONDS: int = 300
    BREAKING_CACHE_TTL_SECONDS: int = 20

    # ------------------------------------------------------------------ utils
    @field_validator("CORS_ORIGINS")
    @classmethod
    def _strip_origins(cls, v: str) -> str:
        return v.strip()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sqlalchemy_url(self) -> str:
        """Full SQLAlchemy URL.

        DATABASE_URL wins when set; otherwise it is assembled from the parts so a
        developer only has to change MYSQL_* in one place. utf8mb4 is mandatory —
        Telugu is outside the BMP-adjacent range MySQL's legacy `utf8` covers.
        """
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return (
            f"mysql+pymysql://{quote_plus(self.MYSQL_USER)}:{quote_plus(self.MYSQL_PASSWORD)}"
            f"@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}"
            f"?charset=utf8mb4"
        )

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def is_development(self) -> bool:
        return self.APP_ENV == "development"

    def assert_production_safe(self) -> list[str]:
        """Return a list of settings that must not ship to production as-is.

        Called at startup; in production a non-empty result aborts the boot.
        """
        problems: list[str] = []
        if not self.is_production:
            return problems
        if self.OTP_DEV_ECHO:
            problems.append("OTP_DEV_ECHO must be false in production (leaks OTP in API response)")
        if not self.SECURE_COOKIES:
            problems.append("SECURE_COOKIES must be true in production")
        if not self.HSTS_ENABLED:
            problems.append("HSTS_ENABLED must be true in production (§12.1)")
        if len(self.JWT_SECRET) < 32 or len(self.JWT_REFRESH_SECRET) < 32:
            problems.append("JWT secrets must be at least 32 chars")
        if self.JWT_SECRET == self.JWT_REFRESH_SECRET:
            problems.append("JWT_SECRET and JWT_REFRESH_SECRET must differ")
        if not self.ENCRYPTION_KEY:
            problems.append("ENCRYPTION_KEY is required to encrypt AI provider keys at rest (§7.1)")
        if not self.MYSQL_PASSWORD:
            problems.append("MYSQL_PASSWORD is required")
        return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
