from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PersonCreate(Input):
    employee_name: str = Field(min_length=1, max_length=255)
    employee_number: str = Field(min_length=1, max_length=80)
    job_title: str | None = Field(default=None, max_length=100)
    category_id: UUID
    position_id: UUID | None = None
    department_id: UUID | None = None
    work_location: str | None = Field(default=None, max_length=255)


class PersonUpdate(Input):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=2000)
    employee_name: str | None = Field(default=None, min_length=1, max_length=255)
    job_title: str | None = Field(default=None, max_length=100)
    category_id: UUID | None = None
    position_id: UUID | None = None
    department_id: UUID | None = None
    work_location: str | None = Field(default=None, max_length=255)


class VersionReason(Input):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=2000)


class CatalogueCreate(Input):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=160)
    payroll_eligible: bool = False
    department_id: UUID | None = None
    trade: str | None = Field(default=None, max_length=160)
    grade: str | None = Field(default=None, max_length=80)


class ReportingLine(Input):
    employee_id: UUID
    manager_employee_id: UUID
    effective_from: date
    effective_to: date | None = None
    relationship_type: Literal[
        "line_manager", "project_manager", "mentor", "dotted_line"
    ] = "line_manager"

    @model_validator(mode="after")
    def valid_interval(self):
        if self.employee_id == self.manager_employee_id:
            raise ValueError("A worker cannot report to themselves")
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValueError("End cannot precede start")
        return self


class EngagementCreate(Input):
    employee_id: UUID
    category_id: UUID
    document_id: UUID
    starts_on: date
    ends_on: date | None = None
    normal_minutes: int = Field(ge=1, le=1440)
    jurisdiction: str = Field(min_length=2, max_length=80)
    employer_name: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def valid_interval(self):
        if self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("End cannot precede start")
        return self


class EngagementDecision(VersionReason):
    decision: Literal["approved", "rejected"]


class AvailabilityCreate(Input):
    employee_id: UUID
    available_from: date
    available_to: date
    status: Literal["available", "unavailable", "training"]
    capacity_percent: int = Field(default=100, ge=0, le=100)
    notes: str = Field(min_length=3, max_length=2000)

    @model_validator(mode="after")
    def valid_interval(self):
        if self.available_to < self.available_from:
            raise ValueError("End cannot precede start")
        if self.status != "available" and self.capacity_percent != 0:
            raise ValueError(
                "Unavailable or training periods must have zero deployment capacity"
            )
        return self
