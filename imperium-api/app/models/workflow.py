from sqlalchemy import String, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, AuditMixin, SoftDeleteMixin
import uuid


class Workflow(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "workflows"
    name: Mapped[str] = mapped_column(String)
    module: Mapped[str] = mapped_column(String)
    definition: Mapped[dict] = mapped_column(JSON)


class ApprovalChain(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "approval_chains"
    workflow_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workflows.id"))
    target_type: Mapped[str] = mapped_column(String)  # e.g., 'Quotation', 'Invoice'
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id")
    )  # Generic foreign key placeholder
    status: Mapped[str] = mapped_column(String)  # pending, approved, rejected
    current_step: Mapped[int] = mapped_column(default=0)


class ActivityLog(Base, AuditMixin):
    __tablename__ = "activity_logs"
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String)
    target_type: Mapped[str] = mapped_column(String)
    target_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("organizations.id"))
    details: Mapped[dict | None] = mapped_column(JSON)
    ip_address: Mapped[str | None] = mapped_column(String)
