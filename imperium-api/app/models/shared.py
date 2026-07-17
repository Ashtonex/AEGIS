from sqlalchemy import String, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, AuditMixin, SoftDeleteMixin
import uuid


class Tag(Base, AuditMixin):
    __tablename__ = "tags"
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    color: Mapped[str | None] = mapped_column(String)


class Comment(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "comments"
    target_type: Mapped[str] = mapped_column(String)  # e.g., 'Project', 'Task'
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id")
    )  # Generic foreign key placeholder
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    content: Mapped[str] = mapped_column(String)


class Attachment(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "attachments"
    target_type: Mapped[str] = mapped_column(String)
    target_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    file_name: Mapped[str] = mapped_column(String)
    file_url: Mapped[str] = mapped_column(String)
    file_size: Mapped[int] = mapped_column()
    mime_type: Mapped[str] = mapped_column(String)


class CustomField(Base, AuditMixin):
    __tablename__ = "custom_fields"
    target_type: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    field_type: Mapped[str] = mapped_column(String)  # e.g., string, number, date
    is_required: Mapped[bool] = mapped_column(default=False)
    options: Mapped[dict | None] = mapped_column(JSON)  # For select fields
