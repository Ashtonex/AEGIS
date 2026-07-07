from sqlalchemy import String, Boolean, JSON, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, AuditMixin, SoftDeleteMixin
from datetime import datetime
import uuid

class Setting(Base, AuditMixin):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String, unique=True, index=True)
    value: Mapped[dict] = mapped_column(JSON)
    description: Mapped[str | None] = mapped_column(String)

class FeatureFlag(Base, AuditMixin):
    __tablename__ = "feature_flags"
    module_name: Mapped[str] = mapped_column(String, unique=True, index=True)
    status: Mapped[str] = mapped_column(String, default="disabled") # enabled, disabled, beta, maintenance

class SystemEvent(Base, AuditMixin):
    __tablename__ = "system_events"
    event_type: Mapped[str] = mapped_column(String, index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String)

class BackgroundJob(Base, AuditMixin):
    __tablename__ = "background_jobs"
    job_id: Mapped[str] = mapped_column(String, index=True)
    job_name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String) # pending, running, completed, failed
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(String)

class ApiKey(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "api_keys"
    key_hash: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class Integration(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "integrations"
    provider: Mapped[str] = mapped_column(String)
    credentials: Mapped[dict] = mapped_column(JSON)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
