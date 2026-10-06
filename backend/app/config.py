"""Settings, read once from the environment at start-up.

The app refuses to start if a required setting is missing or malformed.
Secret values are SecretStr so they never show up in logs or reprs.
"""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Literal["development", "test", "production"] = "development"

    # Supabase pooler in session mode (port 5432), e.g.
    # postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
    database_url: SecretStr
    supabase_url: AnyHttpUrl
    # Legacy HS256 signing secret. Leave unset on projects that use signing keys (JWKS).
    supabase_jwt_secret: SecretStr | None = None
    # Only used to sign photo upload links. Never sent to the browser.
    supabase_service_role_key: SecretStr | None = None

    allowed_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:5173"])

    db_pool_min: int = Field(default=1, ge=0, le=20)
    db_pool_max: int = Field(default=5, ge=1, le=50)
    statement_timeout_ms: int = Field(default=8000, ge=100, le=60000)
    max_body_bytes: int = Field(default=64 * 1024, ge=1024)

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, v: object) -> object:
        # ALLOWED_ORIGINS="https://yuktara.netlify.app,http://localhost:5173"
        if isinstance(v, str):
            return [o.strip().rstrip("/") for o in v.split(",") if o.strip()]
        return v

    @field_validator("allowed_origins")
    @classmethod
    def no_wildcards(cls, v: list[str]) -> list[str]:
        if any("*" in o for o in v):
            raise ValueError("ALLOWED_ORIGINS must list exact origins, not wildcards")
        return v

    @property
    def supabase_base(self) -> str:
        return str(self.supabase_url).rstrip("/")

    @property
    def jwt_issuer(self) -> str:
        return f"{self.supabase_base}/auth/v1"

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_base}/auth/v1/.well-known/jwks.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
