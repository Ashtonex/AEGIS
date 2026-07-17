from functools import lru_cache
from typing import List, Literal, Optional

from pydantic import Field, field_validator
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

    DATABASE_URL: str
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_KEY: str

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None
    REDIS_URL: str = "redis://redis:6379/0"
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
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must use the postgresql+asyncpg:// SQLAlchemy asyncpg driver."
            )
        return value

    @field_validator("SUPABASE_URL")
    @classmethod
    def validate_supabase_url(cls, value: str) -> str:
        if not value.startswith("http"):
            raise ValueError("SUPABASE_URL must be an absolute URL.")
        return value

    @property
    def cors_origins(self) -> List[str]:
        return [
            origin.strip()
            for origin in self.ALLOWED_ORIGINS.split(",")
            if origin.strip()
        ]

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
