from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, AuditMixin, SoftDeleteMixin

class Organization(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    registration_number: Mapped[str | None] = mapped_column(String, nullable=True)
    
    # Relationships
    users = relationship("User", back_populates="organization")
