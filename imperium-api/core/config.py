from functools import lru_cache
from typing import List, Literal, Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ENVIRONMENT: Literal["development", "testing", "staging", "production"] = (
        "development"
    )
    DEBUG: bool = False
    PROJECT_NAME: str = "Project Imperium - AEGIS Core"
    API_V1_STR: str = "/api/v1"

    SECRET_KEY: str
    ALLOWED_ORIGINS: str = "http://localhost:3000"
    ALLOWED_HOSTS: str = "localhost,127.0.0.1"
    RENDER: bool = False
    RENDER_EXTERNAL_HOSTNAME: Optional[str] = None
    RENDER_EXTERNAL_URL: Optional[str] = None
    FRONTEND_HOSTNAME: Optional[str] = None

    DATABASE_URL: str
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_KEY: str

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None
    REDIS_URL: str = "redis://redis:6379/0"
    BACKGROUND_JOBS_ENABLED: bool = False
    WORKER_QUEUE_NAME: str = "aegis:jobs"
    WORKER_JOB_TIMEOUT_SECONDS: int = Field(default=300, ge=1)
    WORKER_JOB_MAX_TRIES: int = Field(default=3, ge=1)

    AUTH_TOKEN_ISSUER: str = "supabase"
    AUTH_TOKEN_AUDIENCE: str = "authenticated"
    JWT_ISSUER: str = "aegis-auth"
    JWT_AUDIENCE: str = "authenticated"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60, ge=1)
    REFRESH_TOKEN_EXPIRE_DAYS: int = Field(default=14, ge=1)
    JWT_KEY_ROTATION_GRACE_DAYS: int = Field(default=7, ge=0)
    JWT_SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"

    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = False
    FILE_STORAGE_MAX_BYTES: int = Field(default=25 * 1024 * 1024, ge=1)
    ALLOWED_UPLOAD_EXTENSIONS: str = ".pdf,.docx,.xlsx,.xls,.csv,.png,.jpg,.jpeg"
    GENERATED_DOCUMENT_DIR: str = "generated"
    REPORT_OUTPUT_DIR: str = "generated/reports"
    REPORT_TEMPLATE_DIR: str = "templates/reports"
    EXTERNAL_API_TIMEOUT_SECONDS: int = Field(default=30, ge=1)
    NOTIFICATION_WEBHOOK_URL: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_async_database_url(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+asyncpg://", 1)
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must be a PostgreSQL URL compatible with the SQLAlchemy asyncpg driver."
            )
        return value

    @field_validator("SUPABASE_URL")
    @classmethod
    def validate_supabase_url(cls, value: str) -> str:
        if not value.startswith("http"):
            raise ValueError("SUPABASE_URL must be an absolute URL.")
        return value

    @model_validator(mode="after")
    def validate_production_hardening(self) -> "Settings":
        if not self.is_production:
            return self

        if self.DEBUG:
            raise ValueError("DEBUG must be false in production.")

        placeholder_fragments = ("your-", "[", "]", "placeholder", "changeme")
        secret_values = {
            "SECRET_KEY": self.SECRET_KEY,
            "SUPABASE_ANON_KEY": self.SUPABASE_ANON_KEY,
            "SUPABASE_SERVICE_KEY": self.SUPABASE_SERVICE_KEY,
        }
        if self.JWT_SECRET_KEY:
            secret_values["JWT_SECRET_KEY"] = self.JWT_SECRET_KEY
        for name, value in secret_values.items():
            if len(value) < 32 or any(
                fragment in value.lower() for fragment in placeholder_fragments
            ):
                raise ValueError(
                    f"{name} must be a rotated production secret with at least 32 characters."
                )

        if not self.SUPABASE_URL.startswith("https://"):
            raise ValueError("SUPABASE_URL must use HTTPS in production.")

        configured_origins = self._configured_cors_origins
        if "*" in configured_origins and not self.RENDER:
            raise ValueError("ALLOWED_ORIGINS must not contain '*' in production.")
        if not self.cors_origins or any(
            not origin.startswith("https://") for origin in self.cors_origins
        ):
            raise ValueError(
                "ALLOWED_ORIGINS must list explicit HTTPS origins in production."
            )

        configured_hosts = self._configured_allowed_hosts
        if "*" in configured_hosts and not self.RENDER:
            raise ValueError("ALLOWED_HOSTS must not contain '*' in production.")
        if not self.allowed_hosts:
            raise ValueError("ALLOWED_HOSTS must list explicit hosts in production.")

        local_redis_targets = ("redis://redis:", "redis://localhost", "redis://127.0.0.1")
        if self.BACKGROUND_JOBS_ENABLED and self.REDIS_URL.startswith(
            local_redis_targets
        ):
            raise ValueError(
                "REDIS_URL must point to a managed private Redis when background jobs are enabled in production."
            )

        return self

    @property
    def _configured_cors_origins(self) -> List[str]:
        return [
            origin.strip()
            for origin in self.ALLOWED_ORIGINS.split(",")
            if origin.strip()
        ]

    @property
    def cors_origins(self) -> List[str]:
        origins = [origin for origin in self._configured_cors_origins if origin != "*"]
        if self.RENDER_EXTERNAL_URL:
            render_url = self.RENDER_EXTERNAL_URL.rstrip("/")
            if render_url not in origins:
                origins.append(render_url)
        if self.FRONTEND_HOSTNAME:
            frontend_origin = f"https://{self.FRONTEND_HOSTNAME.strip().rstrip('/')}"
            if frontend_origin not in origins:
                origins.append(frontend_origin)
        return origins

    @property
    def _configured_allowed_hosts(self) -> List[str]:
        return [
            host.strip()
            for host in self.ALLOWED_HOSTS.split(",")
            if host.strip()
        ]

    @property
    def allowed_hosts(self) -> List[str]:
        hosts = [host for host in self._configured_allowed_hosts if host != "*"]
        if self.RENDER_EXTERNAL_HOSTNAME:
            render_host = self.RENDER_EXTERNAL_HOSTNAME.strip()
            if render_host and render_host not in hosts:
                hosts.append(render_host)
        return hosts

    @property
    def allowed_upload_extensions(self) -> List[str]:
        return [
            ext.strip().lower()
            for ext in self.ALLOWED_UPLOAD_EXTENSIONS.split(",")
            if ext.strip()
        ]

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
