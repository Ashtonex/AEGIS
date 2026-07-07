from sqlalchemy import String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, AuditMixin
import uuid

class Role(Base, AuditMixin):
    __tablename__ = "roles"
    name: Mapped[str] = mapped_column(String, unique=True)
    description: Mapped[str | None] = mapped_column(String)

class Permission(Base, AuditMixin):
    __tablename__ = "permissions"
    resource: Mapped[str] = mapped_column(String) # e.g., 'projects', 'fleet'
    action: Mapped[str] = mapped_column(String) # e.g., 'create', 'view'

class RolePermission(Base, AuditMixin):
    __tablename__ = "role_permissions"
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id"))
    permission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("permissions.id"))

class UserRole(Base, AuditMixin):
    __tablename__ = "user_roles"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id"))
