"""Strict Phase 2 commands. Tenant, approval time and status are server-owned."""

from datetime import date
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CatalogueCreate(Payload):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=2, max_length=200)
    jurisdiction: str = Field(min_length=2, max_length=120)


class SourceCreate(Payload):
    authority_id: UUID
    title: str = Field(min_length=2, max_length=200)
    citation: str = Field(min_length=3, max_length=2000)
    jurisdiction: str = Field(min_length=2, max_length=120)
    effective_from: date
    review_on: date

    @model_validator(mode="after")
    def dates(self):
        if self.review_on < self.effective_from:
            raise ValueError("Review date must not precede effective date")
        return self


class VersionReason(Payload):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=10, max_length=2000)


class Rule(Payload):
    subject_kinds: list[
        Literal[
            "organisation", "project", "worker", "supplier", "subcontractor", "asset"
        ]
    ] = Field(min_length=1, max_length=6)
    jurisdiction: str = Field(min_length=2, max_length=120)
    # This bounded declarative rule recommends scope only; approval is human.
    critical: bool = False
    requires_legal_review: bool = True


class ObligationCreate(Payload):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    domain_id: UUID
    source_id: UUID
    title: str = Field(min_length=3, max_length=200)
    requirement: str = Field(min_length=10, max_length=10000)
    effective_from: date
    effective_to: date | None = None
    review_on: date
    owner_id: UUID
    rule: Rule

    @model_validator(mode="after")
    def dates(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValueError("Effective end must follow start")
        if self.review_on < self.effective_from:
            raise ValueError("Review date must not precede start")
        return self


class RevisionCreate(ObligationCreate):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=10, max_length=2000)


class AssessmentCreate(Payload):
    obligation_version_id: UUID
    subject_kind: Literal[
        "organisation", "project", "worker", "supplier", "subcontractor", "asset"
    ]
    subject_id: UUID
    project_id: UUID | None = None
    outcome: Literal["applicable", "not_applicable"]
    reason: str = Field(min_length=10, max_length=2000)
    basis: str = Field(min_length=10, max_length=4000)
    review_on: date

    @model_validator(mode="after")
    def project_scope(self):
        if self.subject_kind == "project" and self.project_id != self.subject_id:
            raise ValueError("Project assessment must contain its project_id")
        return self


class AssignmentCreate(Payload):
    assessment_id: UUID
    owner_id: UUID
    reason: str = Field(min_length=10, max_length=2000)


class Decision(VersionReason):
    decision: Literal["approved", "rejected"]


class AssignmentRevision(VersionReason):
    owner_id: UUID
