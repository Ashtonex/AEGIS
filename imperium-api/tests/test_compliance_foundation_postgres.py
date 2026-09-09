"""Real localhost PostgreSQL acceptance tests; never reads a production DSN."""

import os
import asyncio
import unittest
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.services import compliance_foundation as service
from app.shared.workforce_transactions import (
    bind_workforce_context,
    begin_command,
    complete_command,
)
from schemas.compliance import (
    CatalogueCreate,
    SourceCreate,
    ObligationCreate,
    VersionReason,
    Decision,
    AssessmentCreate,
    AssignmentCreate,
    RevisionCreate,
)


@unittest.skipUnless(
    os.getenv("COMPLIANCE_LOCAL_DB_TESTS") == "1", "Local database opt-in required"
)
class CompliancePostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        name = (
            (
                Path(__file__).resolve().parents[1]
                / ".aegis-runtime/compliance-test/database-name.txt"
            )
            .read_text()
            .strip()
        )
        if (
            not name.startswith("aegis_compliance_test_")
            or not name.removeprefix("aegis_compliance_test_").isdigit()
        ):
            raise ValueError("Only isolated compliance database permitted")
        self.engine = create_async_engine(
            f"postgresql+asyncpg://workforce_test_admin@127.0.0.1:55439/{name}"
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.org, self.other = uuid4(), uuid4()
        self.people = [uuid4() for _ in range(4)]
        permissions = {
            service.PREFIX + x
            for x in [
                "read",
                "manage",
                "approve",
                "legal_review",
                "assign",
                "scope.all",
                "audit.read",
            ]
        }
        self.users = [
            {"org_id": self.org, "user_id": p, "permissions": permissions}
            for p in self.people
        ]
        self.author, self.verifier, self.legal, self.approver = self.users
        async with self.sessions.begin() as db:
            for org in [self.org, self.other]:
                await db.execute(
                    text(
                        "INSERT INTO core.organizations(id,name) VALUES(:id,'Synthetic compliance tenant')"
                    ),
                    {"id": org},
                )
            for actor in self.people:
                await db.execute(
                    text(
                        "INSERT INTO core.users(id,organization_id,email,full_name) VALUES(:id,:org,:email,'Synthetic reviewer')"
                    ),
                    {"id": actor, "org": self.org, "email": f"{actor}@example.invalid"},
                )
            await self.bind(db, self.author)
            self.domain = await service.create_catalogue(
                db,
                self.author,
                "domains",
                CatalogueCreate(
                    code="TEST", name="Synthetic domain", jurisdiction="Test"
                ),
            )
            authority = await service.create_catalogue(
                db,
                self.author,
                "authorities",
                CatalogueCreate(
                    code="TEST", name="Synthetic authority", jurisdiction="Test"
                ),
            )
            self.source = await service.create_source(
                db,
                self.author,
                SourceCreate(
                    authority_id=authority["id"],
                    title="Synthetic source",
                    citation="Test only citation",
                    jurisdiction="Test",
                    effective_from=date.today(),
                    review_on=date.today() + timedelta(days=60),
                ),
            )

    async def bind(self, db, user):
        await bind_workforce_context(db, user)
        await db.execute(
            text("SELECT set_config('app.compliance_all',:scope,true)"),
            {"scope": str(service.PREFIX + "scope.all" in user["permissions"]).lower()},
        )

    async def asyncTearDown(self):
        await self.engine.dispose()

    def payload(self):
        return ObligationCreate(
            code="OBL",
            domain_id=self.domain["id"],
            source_id=self.source["id"],
            title="Synthetic obligation",
            requirement="Provide independently checked proof",
            effective_from=date.today(),
            review_on=date.today() + timedelta(days=30),
            owner_id=self.author["user_id"],
            rule={
                "jurisdiction": "Test",
                "subject_kinds": ["organisation", "project"],
                "requires_legal_review": True,
            },
        )

    async def draft(self):
        async with self.sessions.begin() as db:
            await self.bind(db, self.verifier)
            await service.verify_source(
                db,
                self.verifier,
                self.source["id"],
                VersionReason(
                    expected_version=1, reason="Checked against original source"
                ),
            )
            await self.bind(db, self.author)
            return await service.create_obligation(db, self.author, self.payload())

    async def active(self):
        draft = await self.draft()
        async with self.sessions.begin() as db:
            await self.bind(db, self.author)
            await service.transition(
                db,
                self.author,
                draft["id"],
                "submit",
                VersionReason(
                    expected_version=1, reason="Ready for independent review"
                ),
            )
            for user in [self.legal, self.approver]:
                await self.bind(db, user)
                approved = await service.decide(
                    db,
                    user,
                    "obligation_versions",
                    draft["id"],
                    Decision(
                        expected_version=2,
                        decision="approved",
                        reason="Checked source and scope carefully",
                    ),
                )
            await self.bind(db, self.author)
            return await service.transition(
                db,
                self.author,
                draft["id"],
                "activate",
                VersionReason(
                    expected_version=approved["version"],
                    reason="Activate approved current rule",
                ),
            )

    async def test_source_independence_and_no_unverified_creation(self):
        async with self.sessions.begin() as db:
            await self.bind(db, self.author)
            with self.assertRaises(HTTPException) as caught:
                await service.verify_source(
                    db,
                    self.author,
                    self.source["id"],
                    VersionReason(
                        expected_version=1, reason="Trying to verify own source"
                    ),
                )
            self.assertEqual(caught.exception.status_code, 403)
            with self.assertRaises(HTTPException):
                await service.create_obligation(db, self.author, self.payload())

    async def test_full_approval_applicability_assignment_and_audit(self):
        active = await self.active()
        self.assertEqual(active["status"], "active")
        async with self.sessions.begin() as db:
            await self.bind(db, self.author)
            assessment = await service.assess(
                db,
                self.author,
                AssessmentCreate(
                    obligation_version_id=active["id"],
                    subject_kind="organisation",
                    subject_id=self.org,
                    outcome="applicable",
                    reason="Applies to the organisation",
                    basis="Independently sourced contractual scope",
                    review_on=date.today() + timedelta(days=10),
                ),
            )
            for user in [self.legal, self.approver]:
                await self.bind(db, user)
                await service.decide(
                    db,
                    user,
                    "applicability_assessments",
                    assessment["id"],
                    Decision(
                        expected_version=1,
                        decision="approved",
                        reason="Reviewed applicability basis",
                    ),
                )
            await self.bind(db, self.author)
            assignment = await service.assign(
                db,
                self.author,
                AssignmentCreate(
                    assessment_id=assessment["id"],
                    owner_id=self.author["user_id"],
                    reason="Accountable owner confirmed",
                ),
            )
            self.assertEqual(assignment["status"], "action_required")
            count = (
                await db.execute(
                    text(
                        "SELECT count(*) FROM core.audit_log WHERE organization_id=:org"
                    ),
                    {"org": self.org},
                )
            ).scalar()
            self.assertGreaterEqual(count, 10)
            event = (
                await db.execute(
                    text(
                        "SELECT count(*) FROM core.domain_events WHERE organization_id=:org AND event_type='compliance.obligation_activated.v1'"
                    ),
                    {"org": self.org},
                )
            ).scalar()
            self.assertEqual(event, 1)

    async def test_self_approval_and_stale_version_denied(self):
        draft = await self.draft()
        async with self.sessions.begin() as db:
            await self.bind(db, self.author)
            await service.transition(
                db,
                self.author,
                draft["id"],
                "submit",
                VersionReason(
                    expected_version=1, reason="Submit for independent review"
                ),
            )
            with self.assertRaises(HTTPException) as caught:
                await service.decide(
                    db,
                    self.author,
                    "obligation_versions",
                    draft["id"],
                    Decision(
                        expected_version=2,
                        decision="approved",
                        reason="Attempt own approval blocked",
                    ),
                )
            self.assertEqual(caught.exception.status_code, 403)
            with self.assertRaises(HTTPException) as caught:
                await service.transition(
                    db,
                    self.author,
                    draft["id"],
                    "activate",
                    VersionReason(
                        expected_version=1, reason="Use stale revision attempt"
                    ),
                )
            self.assertEqual(caught.exception.status_code, 409)

    async def test_cross_tenant_rls_and_foreign_keys(self):
        async with self.sessions.begin() as db:
            other = {**self.author, "org_id": self.other}
            await self.bind(db, other)
            self.assertEqual(
                (
                    await db.execute(text("SELECT count(*) FROM compliance.sources"))
                ).scalar(),
                0,
            )
            with self.assertRaises(HTTPException) as caught:
                await service.row(db, other, "sources", self.source["id"])
            self.assertEqual(caught.exception.status_code, 404)
        with self.assertRaises(DBAPIError):
            async with self.sessions.begin() as db:
                await self.bind(db, self.author)
                await db.execute(
                    text(
                        "INSERT INTO compliance.domains(organization_id,created_by,code,name,jurisdiction) VALUES(:other,:actor,'BAD','Bad','Test')"
                    ),
                    {"other": self.other, "actor": self.author["user_id"]},
                )

    async def test_immutable_source_and_audit(self):
        await self.draft()
        for statement in [
            "UPDATE compliance.sources SET citation='changed' WHERE organization_id=:org",
            "DELETE FROM core.audit_log WHERE organization_id=:org",
            "DELETE FROM compliance.domains WHERE organization_id=:org",
        ]:
            with self.assertRaises(DBAPIError):
                async with self.sessions.begin() as db:
                    await self.bind(db, self.author)
                    await db.execute(text(statement), {"org": self.org})

    async def test_replay_conflict_and_atomic_rollback(self):
        key = uuid4()
        async with self.sessions.begin() as db:
            await self.bind(db, self.author)
            receipt, _ = await begin_command(
                db, self.author, "compliance.test", key, {"a": 1}
            )
            await complete_command(db, self.author, receipt, {"id": "same"})
        async with self.sessions.begin() as db:
            await self.bind(db, self.author)
            _, replay = await begin_command(
                db, self.author, "compliance.test", key, {"a": 1}
            )
            self.assertEqual(replay, {"id": "same"})
            with self.assertRaises(HTTPException):
                await begin_command(db, self.author, "compliance.test", key, {"a": 2})
        with self.assertRaises(RuntimeError):
            async with self.sessions.begin() as db:
                await self.bind(db, self.author)
                await service.create_catalogue(
                    db,
                    self.author,
                    "domains",
                    CatalogueCreate(
                        code="ROLLBACK", name="Rollback record", jurisdiction="Test"
                    ),
                )
                raise RuntimeError("failure after audit and outbox")
        async with self.sessions.begin() as db:
            await self.bind(db, self.author)
            self.assertEqual(
                (
                    await db.execute(
                        text(
                            "SELECT count(*) FROM compliance.domains WHERE code='ROLLBACK'"
                        )
                    )
                ).scalar(),
                0,
            )

    async def test_revision_preserves_content(self):
        active = await self.active()
        async with self.sessions.begin() as db:
            await self.bind(db, self.author)
            successor = await service.create_obligation(
                db,
                self.author,
                RevisionCreate(
                    **self.payload().model_dump(),
                    expected_version=active["version"],
                    reason="Controlled amendment to obligation",
                ),
                active["id"],
            )
            self.assertEqual(successor["revision"], 2)
            old = await service.row(
                db, self.author, "obligation_versions", active["id"]
            )
            self.assertEqual(old["status"], "active")
            self.assertEqual(old["requirement"], active["requirement"])

    async def test_missing_capability_denied(self):
        async with self.sessions.begin() as db:
            user = {**self.author, "permissions": {service.PREFIX + "read"}}
            await self.bind(db, user)
            with self.assertRaises(HTTPException) as caught:
                await service.create_catalogue(
                    db,
                    user,
                    "domains",
                    CatalogueCreate(
                        code="DENY", name="Denied create", jurisdiction="Test"
                    ),
                )
            self.assertEqual(caught.exception.status_code, 403)

    async def test_api_permissions_scope_and_duplicate_command(self):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient
        from routers.compliance_foundation import router, context, database

        app = FastAPI()
        app.include_router(router, prefix="/compliance")
        actor = {**self.author, "permissions": {service.PREFIX + "read"}}
        async def current_context():
            return actor
        async def current_db():
            async with self.sessions.begin() as db:
                await self.bind(db, actor)
                yield db
        app.dependency_overrides[context] = current_context
        app.dependency_overrides[database] = current_db
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://local.test") as client:
            body = {"code": "API", "name": "API persisted domain", "jurisdiction": "Test"}
            headers = {"Idempotency-Key": str(uuid4())}
            denied = await client.post("/compliance/catalogues/domains", json=body, headers=headers)
            self.assertEqual(denied.status_code, 403)
            actor = self.author
            created = await client.post("/compliance/catalogues/domains", json=body, headers=headers)
            self.assertEqual(created.status_code, 201, created.text)
            replay = await client.post("/compliance/catalogues/domains", json=body, headers=headers)
            self.assertEqual(created.json(), replay.json())
            record_id = created.json()["data"]["id"]
            injected = await client.post("/compliance/catalogues/domains", json={**body,"organization_id": str(self.other)}, headers=headers)
            self.assertEqual(injected.status_code,422)
            actor = {**self.author,"org_id":self.other}
            absent = await client.get(f"/compliance/domains/{record_id}")
            self.assertEqual(absent.status_code,404)
            listed = await client.get("/compliance/domains")
            self.assertEqual(listed.json()["data"],[])

    async def test_concurrent_final_approval_exactly_once(self):
        draft = await self.draft()
        async with self.sessions.begin() as db:
            await self.bind(db,self.author)
            await service.transition(db,self.author,draft['id'],'submit',VersionReason(expected_version=1,reason="Submit for independent review"))
            await self.bind(db,self.legal)
            await service.decide(db,self.legal,'obligation_versions',draft['id'],Decision(expected_version=2,decision="approved",reason="Legal review completed independently"))
        async def approve():
            try:
                async with self.sessions.begin() as db:
                    await self.bind(db,self.approver)
                    await service.decide(db,self.approver,'obligation_versions',draft['id'],Decision(expected_version=2,decision="approved",reason="Independent final review complete"))
                return 200
            except HTTPException as exc:
                return exc.status_code
        self.assertEqual(sorted(await asyncio.gather(approve(),approve())),[200,409])

    async def test_database_prevents_unapproved_positive_state(self):
        draft = await self.draft()
        async with self.sessions.begin() as db:
            await self.bind(db,self.author)
            await service.transition(db,self.author,draft['id'],'submit',VersionReason(expected_version=1,reason="Submit for independent review"))
        with self.assertRaises(DBAPIError):
            async with self.sessions.begin() as db:
                await self.bind(db,self.author)
                await db.execute(text("UPDATE compliance.obligation_versions SET status='applicable',version=version+1 WHERE id=:id"),{"id":draft['id']})

    async def test_na_cannot_assign_and_cannot_self_approve(self):
        active = await self.active()
        async with self.sessions.begin() as db:
            await self.bind(db,self.author)
            assessment = await service.assess(db,self.author,AssessmentCreate(obligation_version_id=active['id'],subject_kind="organisation",subject_id=self.org,outcome="not_applicable",reason="Excluded by the precise scope",basis="Source clause requires another jurisdiction",review_on=date.today()+timedelta(days=5)))
            with self.assertRaises(HTTPException):
                await service.decide(db,self.author,'applicability_assessments',assessment['id'],Decision(expected_version=1,decision="approved",reason="Attempt to approve own exclusion"))
            with self.assertRaises(HTTPException):
                await service.assign(db,self.author,AssignmentCreate(assessment_id=assessment['id'],owner_id=self.author['user_id'],reason="Cannot assign an unapproved exclusion"))

    async def test_event_dispatch_replay_and_consumer_deduplication(self):
        from app.services.workforce_events import dispatch_workforce_events, consume_once
        from unittest.mock import AsyncMock
        publisher = AsyncMock()
        first = await dispatch_workforce_events(self.sessions,publisher,event_filter="event_type LIKE 'compliance.%'",transport="test:compliance",stream="compliance.events",limit=500)
        self.assertGreater(first['delivered'],0)
        second = await dispatch_workforce_events(self.sessions,publisher,event_filter="event_type LIKE 'compliance.%'",transport="test:compliance",stream="compliance.events",limit=500)
        # Previous tests may create more than one batch; test the own event receipt explicitly.
        async with self.sessions.begin() as db:
            await self.bind(db,self.author)
            event_id = (await db.execute(text("SELECT id FROM core.domain_events WHERE organization_id=:org LIMIT 1"),{"org":self.org})).scalar()
            effect = AsyncMock()
            self.assertTrue(await consume_once(db,self.author,event_id,"test:business",effect))
            self.assertFalse(await consume_once(db,self.author,event_id,"test:business",effect))
            effect.assert_awaited_once()
        self.assertEqual(second['failed'],0)
