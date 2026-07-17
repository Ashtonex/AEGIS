from sqlalchemy import String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, AuditMixin, SoftDeleteMixin
import uuid


class Country(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "countries"
    code: Mapped[str] = mapped_column(String(3), unique=True, index=True)
    name: Mapped[str] = mapped_column(String)


class Currency(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "currencies"
    code: Mapped[str] = mapped_column(String(3), unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    symbol: Mapped[str] = mapped_column(String)


class Location(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "locations"
    name: Mapped[str] = mapped_column(String)
    address_line_1: Mapped[str | None] = mapped_column(String)
    address_line_2: Mapped[str | None] = mapped_column(String)
    city: Mapped[str | None] = mapped_column(String)
    country_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("countries.id"))


class Branch(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "branches"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String)
    location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("locations.id"))


class Department(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "departments"
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"))
    name: Mapped[str] = mapped_column(String)
