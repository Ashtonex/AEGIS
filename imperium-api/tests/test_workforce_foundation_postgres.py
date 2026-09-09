"""Real PostgreSQL control tests; opt in against the isolated bootstrap fixture.

Run with WORKFORCE_LOCAL_DB_TESTS=1 after scripts/bootstrap_workforce_test_db.py.
No application DATABASE_URL is used for test connections.
"""

import asyncio
import os
import unittest
from datetime import date
from pathlib import Path
from uuid import UUID, uuid4
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.services.workforce_foundation import (
    availability,
    create_person,
    create_engagement,
    engagement_command,
    engagement_document_snapshot,
    create_reporting_line,
    update_person,
)
from app.services.workflow_service import WorkflowService
from app.shared.workforce_transactions import (
    begin_command,
    bind_workforce_context,
    complete_command,
)
from schemas.workforce_foundation import (
    PersonCreate,
    PersonUpdate,
    ReportingLine,
    EngagementCreate,
    VersionReason,
    EngagementDecision,
)
from core.database import get_db
from core.security import get_current_user
from routers.workforce_foundation import router
from routers.workforce import router as legacy_router
from app.services.workforce_events import (
    consume_once,
    dispatch_workforce_events,
    TRANSPORT,
)


@unittest.skipUnless(
    os.getenv("WORKFORCE_LOCAL_DB_TESTS") == "1", "Isolated PostgreSQL opt-in required"
)
class FoundationPostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        name = (
            (
                Path(__file__).resolve().parents[1]
                / ".aegis-runtime/workforce-test/database-name.txt"
            )
            .read_text()
            .strip()
        )
        if (
            not name.startswith("aegis_workforce_test_")
            or not name.removeprefix("aegis_workforce_test_").isdigit()
        ):
            raise ValueError("Only the isolated database fixture is permitted")
        self.engine = create_async_engine(
            f"postgresql+asyncpg://workforce_test_admin@127.0.0.1:55439/{name}"
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.org, self.other_org, self.actor, self.reviewer, self.category = [
            uuid4() for _ in range(5)
        ]
        self.user = {"org_id": self.org, "user_id": self.actor}
        async with self.sessions.begin() as db:
            for org in (self.org, self.other_org):
                await db.execute(
                    text(
                        "INSERT INTO core.organizations(id,name) VALUES(:id,'Synthetic test organisation')"
                    ),
                    {"id": org},
                )
            for actor in (self.actor, self.reviewer):
                await db.execute(
                    text(
                        "INSERT INTO core.users(id,organization_id,email,full_name) VALUES(:id,:org,:email,'Synthetic actor')"
                    ),
                    {"id": actor, "org": self.org, "email": f"{actor}@example.invalid"},
                )
            await db.execute(
                text(
                    "INSERT INTO hr.worker_categories(id,organization_id,code,name) VALUES(:id,:org,'TEST','Synthetic category')"
                ),
                {"id": self.category, "org": self.org},
            )

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_contract_file_owner_must_belong_to_tenant(self):
        foreign_actor, document, attachment = uuid4(), uuid4(), uuid4()
        storage_path = f"synthetic/{attachment}.pdf"
        async with self.sessions.begin() as db:
            await db.execute(
                text(
                    "INSERT INTO core.users(id,organization_id,email,full_name) VALUES(:id,:org,:email,'Foreign synthetic uploader')"
                ),
                {
                    "id": foreign_actor,
                    "org": self.other_org,
                    "email": f"{foreign_actor}@example.invalid",
                },
            )
            await db.execute(
                text(
                    "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('documents',:path,:owner)"
                ),
                {"path": storage_path, "owner": str(foreign_actor)},
            )
            await db.execute(
                text(
                    "INSERT INTO core.file_attachments(id,organization_id,uploaded_by,file_name,storage_path) VALUES(:id,:org,:actor,'synthetic.pdf',:path)"
                ),
                {
                    "id": attachment,
                    "org": self.org,
                    "actor": self.actor,
                    "path": storage_path,
                },
            )
            await db.execute(
                text(
                    "INSERT INTO core.documents(id,organization_id,title,file_attachment_id) VALUES(:id,:org,'Forged synthetic reference',:file)"
                ),
                {"id": document, "org": self.org, "file": attachment},
            )
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            with self.assertRaises(HTTPException) as caught:
                await engagement_document_snapshot(db, self.user, document)
            self.assertEqual(caught.exception.status_code, 422)
        async with self.sessions.begin() as db:
            self.assertEqual(
                (
                    await db.execute(
                        text(
                            "SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Authenticated users can update their document uploads'"
                        )
                    )
                ).scalar(),
                0,
            )
        with self.assertRaises(DBAPIError):
            async with self.sessions.begin() as db:
                await db.execute(text("SET LOCAL ROLE authenticated"))
                await db.execute(
                    text("SELECT core.workforce_document_object(:path)"),
                    {"path": storage_path},
                )

    async def test_worker_number_is_not_reassigned_after_archival(self):
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            result = await create_person(
                db,
                self.user,
                PersonCreate(
                    employee_name="Synthetic permanent worker",
                    employee_number="PERMANENT",
                    category_id=self.category,
                ),
            )
            await db.execute(
                text("UPDATE hr.employees SET is_deleted=true WHERE id=:id"),
                {"id": UUID(result["id"])},
            )
        with self.assertRaises(IntegrityError):
            async with self.sessions.begin() as db:
                await bind_workforce_context(db, self.user)
                await create_person(
                    db,
                    self.user,
                    PersonCreate(
                        employee_name="Different synthetic worker",
                        employee_number="PERMANENT",
                        category_id=self.category,
                    ),
                )
        with self.assertRaises(IntegrityError):
            async with self.sessions.begin() as db:
                await db.execute(
                    text(
                        "UPDATE hr.employees SET employee_number='REPLACED' WHERE id=:id"
                    ),
                    {"id": UUID(result["id"])},
                )

    async def test_engagement_requires_file_and_independent_verification(self):
        document, attachment = uuid4(), uuid4()
        async with self.sessions.begin() as db:
            storage_path = f"synthetic/{attachment}.pdf"
            await db.execute(
                text(
                    "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('documents',:path,:owner)"
                ),
                {"path": storage_path, "owner": str(self.actor)},
            )
            await db.execute(
                text(
                    "INSERT INTO core.file_attachments(id,organization_id,uploaded_by,file_name,storage_path) VALUES(:id,:org,:actor,'synthetic-contract.pdf',:path)"
                ),
                {
                    "id": attachment,
                    "org": self.org,
                    "actor": self.actor,
                    "path": storage_path,
                },
            )
            await db.execute(
                text(
                    "INSERT INTO core.documents(id,organization_id,created_by,title,file_attachment_id) VALUES(:id,:org,:actor,'Synthetic contract',:file)"
                ),
                {
                    "id": document,
                    "org": self.org,
                    "actor": self.actor,
                    "file": attachment,
                },
            )
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            worker = await create_person(
                db,
                self.user,
                PersonCreate(
                    employee_name="Synthetic contracted worker",
                    employee_number="CONTRACT",
                    category_id=self.category,
                ),
            )
            engagement = await create_engagement(
                db,
                self.user,
                EngagementCreate(
                    employee_id=UUID(worker["id"]),
                    category_id=self.category,
                    document_id=document,
                    starts_on=date(2026, 1, 1),
                    ends_on=date(2026, 12, 31),
                    normal_minutes=480,
                    jurisdiction="Synthetic test policy",
                ),
            )
            engagement_id = UUID(engagement["id"])
            await engagement_command(
                db,
                self.user,
                engagement_id,
                VersionReason(expected_version=1, reason="Evidence prepared"),
            )
            decision = EngagementDecision(
                expected_version=2,
                reason="Evidence inspected independently",
                decision="approved",
            )
            with self.assertRaises(HTTPException) as caught:
                await engagement_command(
                    db, self.user, engagement_id, decision, {"hr.engagement.verify"}
                )
            self.assertEqual(caught.exception.status_code, 403)
            reviewer = {"org_id": self.org, "user_id": self.reviewer}
            await bind_workforce_context(db, reviewer)
            result = await engagement_command(
                db, reviewer, engagement_id, decision, {"hr.engagement.verify"}
            )
            self.assertEqual(result["status"], "verified")
            ready = await availability(
                db, reviewer, UUID(worker["id"]), date(2026, 9, 1), date(2026, 9, 2)
            )
            self.assertTrue(ready["available"])
        for statement, target in (
            (
                "UPDATE hr.worker_engagements SET normal_minutes=600 WHERE id=:id",
                engagement_id,
            ),
            (
                "UPDATE core.documents SET title='Changed contract' WHERE id=:id",
                document,
            ),
            (
                "UPDATE core.file_attachments SET storage_path='replacement.pdf' WHERE id=:id",
                attachment,
            ),
        ):
            with self.assertRaises(IntegrityError):
                async with self.sessions.begin() as db:
                    await db.execute(text(statement), {"id": target})

    async def test_event_delivery_and_consumer_receipts(self):
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            worker = await create_person(
                db,
                self.user,
                PersonCreate(
                    employee_name="Synthetic event worker",
                    employee_number="EVENT",
                    category_id=self.category,
                ),
            )
            event_id = (
                await db.execute(text("SELECT id FROM core.domain_events"))
            ).scalar_one()
        publisher = AsyncMock()
        await dispatch_workforce_events(self.sessions, publisher, limit=500)
        await dispatch_workforce_events(self.sessions, publisher, limit=500)
        matching = [
            call
            for call in publisher.publish.call_args_list
            if call.args[2]["event_id"] == str(event_id)
        ]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0].args[2]["organization_id"], str(self.org))
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)

            async def apply_event(event):
                self.assertEqual(event["id"], event_id)
                await db.execute(
                    text("UPDATE hr.employees SET version=version+1 WHERE id=:id"),
                    {"id": UUID(worker["id"])},
                )

            self.assertTrue(
                await consume_once(
                    db, self.user, event_id, "synthetic:projection", apply_event
                )
            )
            self.assertFalse(
                await consume_once(
                    db, self.user, event_id, "synthetic:projection", apply_event
                )
            )
            self.assertEqual(
                (
                    await db.execute(
                        text("SELECT version FROM hr.employees WHERE id=:id"),
                        {"id": UUID(worker["id"])},
                    )
                ).scalar(),
                2,
            )

    async def test_failed_transport_retains_event_without_receipt(self):
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            await create_person(
                db,
                self.user,
                PersonCreate(
                    employee_name="Synthetic retry worker",
                    employee_number="RETRY",
                    category_id=self.category,
                ),
            )
            event_id = (
                await db.execute(text("SELECT id FROM core.domain_events"))
            ).scalar_one()
        publisher = AsyncMock()
        publisher.publish.side_effect = ConnectionError(
            "Synthetic transport unavailable"
        )
        await dispatch_workforce_events(self.sessions, publisher, limit=500)
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            self.assertEqual(
                (
                    await db.execute(
                        text(
                            "SELECT count(*) FROM core.event_receipts WHERE event_id=:id AND consumer_key=:consumer"
                        ),
                        {"id": event_id, "consumer": TRANSPORT},
                    )
                ).scalar(),
                0,
            )
            attempt = (
                (
                    await db.execute(
                        text(
                            "SELECT attempts,last_error,next_attempt_at>now() AS deferred FROM core.event_dispatch_attempts WHERE event_id=:id"
                        ),
                        {"id": event_id},
                    )
                )
                .mappings()
                .one()
            )
            self.assertEqual(attempt["attempts"], 1)
            self.assertEqual(attempt["last_error"], "ConnectionError")
            self.assertTrue(attempt["deferred"])

    async def test_reporting_cycles_and_disjoint_periods(self):
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            workers = []
            for index in range(3):
                result = await create_person(
                    db,
                    self.user,
                    PersonCreate(
                        employee_name=f"Synthetic manager {index}",
                        employee_number=f"GRAPH{index}",
                        category_id=self.category,
                    ),
                )
                workers.append(UUID(result["id"]))
            for worker, manager in zip(workers, workers[1:]):
                await create_reporting_line(
                    db,
                    self.user,
                    ReportingLine(
                        employee_id=worker,
                        manager_employee_id=manager,
                        effective_from=date(2026, 1, 1),
                        effective_to=date(2026, 6, 30),
                    ),
                )
            with self.assertRaises(HTTPException) as caught:
                await create_reporting_line(
                    db,
                    self.user,
                    ReportingLine(
                        employee_id=workers[2],
                        manager_employee_id=workers[0],
                        effective_from=date(2026, 6, 30),
                    ),
                )
            self.assertEqual(caught.exception.status_code, 409)
            await create_reporting_line(
                db,
                self.user,
                ReportingLine(
                    employee_id=workers[2],
                    manager_employee_id=workers[0],
                    effective_from=date(2026, 7, 1),
                ),
            )

    async def test_readiness_uses_current_clearance_without_clinical_details(self):
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            result = await create_person(
                db,
                self.user,
                PersonCreate(
                    employee_name="Synthetic worker",
                    employee_number="MEDICAL",
                    category_id=self.category,
                ),
            )
            worker = UUID(result["id"])
        async with self.sessions.begin() as db:
            await db.execute(
                text(
                    "INSERT INTO hr.employee_medicals(organization_id,employee_id,title,completed_on,expires_on,status) VALUES(:org,:id,'Synthetic historical clearance','2025-01-01','2025-12-31','expired'),(:org,:id,'Synthetic current clearance','2026-01-01','2026-12-31','current')"
                ),
                {"org": self.org, "id": worker},
            )
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            current = await availability(
                db, self.user, worker, date(2026, 9, 1), date(2026, 9, 30)
            )
            self.assertFalse(
                any(row["source"] == "hse_readiness" for row in current["restrictions"])
            )
            expired = await availability(
                db, self.user, worker, date(2027, 1, 1), date(2027, 1, 2)
            )
            clearance = [
                row
                for row in expired["restrictions"]
                if row["source"] == "hse_readiness"
            ]
            self.assertEqual(len(clearance), 1)
            self.assertEqual(set(clearance[0]), {"source", "reason"})

    async def test_database_fence_and_pool_context_reset(self):
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            # Deliberately omit application WHERE: database must still fence rows.
            rows = (
                (
                    await db.execute(
                        text("SELECT organization_id FROM hr.worker_categories")
                    )
                )
                .scalars()
                .all()
            )
            self.assertEqual(rows, [self.org])
        async with self.sessions.begin() as db:
            await db.execute(text("SET LOCAL ROLE aegis_workforce_runtime"))
            self.assertEqual(
                (
                    await db.execute(text("SELECT count(*) FROM hr.worker_categories"))
                ).scalar(),
                0,
            )

    async def test_registration_audit_event_and_stale_version(self):
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            result = await create_person(
                db,
                self.user,
                PersonCreate(
                    employee_name="Synthetic worker",
                    employee_number="T001",
                    category_id=self.category,
                ),
            )
            employee = UUID(result["id"])
            updated = await update_person(
                db,
                self.user,
                employee,
                PersonUpdate(
                    expected_version=1,
                    reason="Updated location",
                    work_location="Test site",
                ),
            )
            self.assertEqual(updated["version"], 2)
            with self.assertRaises(HTTPException) as caught:
                await update_person(
                    db,
                    self.user,
                    employee,
                    PersonUpdate(
                        expected_version=1,
                        reason="Stale revision",
                        work_location="Other",
                    ),
                )
            self.assertEqual(caught.exception.status_code, 409)
            self.assertEqual(
                (
                    await db.execute(
                        text("SELECT count(*) FROM core.audit_log WHERE record_id=:id"),
                        {"id": employee},
                    )
                ).scalar(),
                2,
            )
            self.assertEqual(
                (
                    await db.execute(
                        text(
                            "SELECT count(*) FROM core.domain_events WHERE aggregate_id=:id"
                        ),
                        {"id": employee},
                    )
                ).scalar(),
                1,
            )

    async def test_receipt_replay_and_content_conflict(self):
        key = uuid4()
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            receipt, replay = await begin_command(
                db, self.user, "test", key, {"value": 1}
            )
            self.assertIsNone(replay)
            await complete_command(db, self.user, receipt, {"version": 1})
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            receipt, replay = await begin_command(
                db, self.user, "test", key, {"value": 1}
            )
            self.assertIsNone(receipt)
            self.assertEqual(replay, {"version": 1})
            with self.assertRaises(HTTPException) as caught:
                await begin_command(db, self.user, "test", key, {"value": 2})
            self.assertEqual(caught.exception.status_code, 409)

    async def test_rollback_removes_receipt_and_worker(self):
        key = uuid4()
        with self.assertRaisesRegex(RuntimeError, "simulated"):
            async with self.sessions.begin() as db:
                await bind_workforce_context(db, self.user)
                await begin_command(db, self.user, "register", key, {})
                await create_person(
                    db,
                    self.user,
                    PersonCreate(
                        employee_name="Synthetic worker",
                        employee_number="ROLLBACK",
                        category_id=self.category,
                    ),
                )
                raise RuntimeError("simulated downstream failure")
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            for table in (
                "hr.employees",
                "core.command_receipts",
                "core.domain_events",
                "core.audit_log",
            ):
                self.assertEqual(
                    (await db.execute(text(f"SELECT count(*) FROM {table}"))).scalar(),
                    0,
                )

    async def test_approval_separation_and_terminal_state(self):
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            workflow = WorkflowService(db)
            instance = await workflow.initiate_approval(
                user=self.user,
                workflow_name="test",
                target_type="worker",
                target_id=uuid4(),
                target_version=1,
                steps=["hr.engagement.verify"],
            )
            args = dict(
                permissions={"hr.engagement.verify"},
                instance_id=instance,
                target_version=1,
                decision="approved",
                reason="Evidence inspected",
            )
            with self.assertRaises(HTTPException) as caught:
                await workflow.decide(user=self.user, **args)
            self.assertEqual(caught.exception.status_code, 403)
            reviewer = {"org_id": self.org, "user_id": self.reviewer}
            await bind_workforce_context(db, reviewer)
            await workflow.decide(user=reviewer, **args)
            with self.assertRaises(HTTPException) as caught:
                await workflow.decide(user=reviewer, **args)
            self.assertEqual(caught.exception.status_code, 409)
            self.assertEqual(
                (
                    await db.execute(
                        text("SELECT count(*) FROM core.approval_decisions")
                    )
                ).scalar(),
                1,
            )

    async def test_cross_tenant_foreign_key_rejects_privileged_insert(self):
        # Even a privileged migration session cannot attach another tenant's category.
        with self.assertRaises(IntegrityError):
            async with self.sessions.begin() as db:
                await db.execute(
                    text(
                        "INSERT INTO hr.employees(organization_id,employee_name,category_id) VALUES(:org,'Synthetic invalid reference',:category)"
                    ),
                    {"org": self.other_org, "category": self.category},
                )

    async def test_runtime_cannot_rewrite_audit_evidence(self):
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            await create_person(
                db,
                self.user,
                PersonCreate(
                    employee_name="Synthetic worker",
                    employee_number="AUDIT",
                    category_id=self.category,
                ),
            )
        for mutation in (
            "UPDATE core.audit_log SET action='DELETE'",
            "DELETE FROM core.audit_log",
            "TRUNCATE core.audit_log",
        ):
            with self.assertRaises(DBAPIError):
                async with self.sessions.begin() as db:
                    await bind_workforce_context(db, self.user)
                    await db.execute(text(mutation))

    async def test_http_permissions_idempotency_and_cross_tenant_detail(self):
        app = FastAPI()
        app.include_router(router, prefix="/foundation")
        app.include_router(legacy_router, prefix="/legacy")

        async def identity():
            return self.user

        async def authentication_db():
            async with self.sessions() as db:
                yield db

        app.dependency_overrides[get_current_user] = identity
        app.dependency_overrides[get_db] = authentication_db
        # Real permission dependencies, SQL grants, RLS and transactions run.
        with patch(
            "app.shared.workforce_transactions.AsyncSessionLocal", self.sessions
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                denied = await client.get("/foundation/people")
                self.assertEqual(denied.status_code, 403)
                role = uuid4()
                async with self.sessions.begin() as db:
                    await db.execute(
                        text(
                            "INSERT INTO core.roles(id,organization_id,name) VALUES(:id,:org,'TEST_WORKFORCE')"
                        ),
                        {"id": role, "org": self.org},
                    )
                    await db.execute(
                        text(
                            "INSERT INTO core.user_roles(user_id,role_id,organization_id) VALUES(:actor,:role,:org)"
                        ),
                        {"actor": self.actor, "role": role, "org": self.org},
                    )
                    await db.execute(
                        text(
                            "INSERT INTO core.role_permissions(role_id,permission_id) SELECT :role,id FROM core.permissions WHERE key IN ('workforce.people.read','workforce.people.create')"
                        ),
                        {"role": role},
                    )
                payload = {
                    "employee_name": "Synthetic HTTP worker",
                    "employee_number": "HTTP1",
                    "category_id": str(self.category),
                }
                missing_key = await client.post("/foundation/people", json=payload)
                self.assertEqual(missing_key.status_code, 422)
                headers = {"Idempotency-Key": str(uuid4())}
                first = await client.post(
                    "/foundation/people", json=payload, headers=headers
                )
                self.assertEqual(first.status_code, 201, first.text)
                replay = await client.post(
                    "/foundation/people", json=payload, headers=headers
                )
                self.assertEqual(replay.json(), first.json())
                legacy_replay = await client.post(
                    "/legacy/", json=payload, headers=headers
                )
                self.assertEqual(legacy_replay.status_code, 201, legacy_replay.text)
                self.assertEqual(legacy_replay.json(), first.json())
                worker = first.json()["data"]["id"]
                denied_edit = await client.patch(
                    f"/foundation/people/{worker}",
                    json={
                        "expected_version": 1,
                        "reason": "Unauthorised change",
                        "employee_name": "Wrong",
                    },
                    headers={"Idempotency-Key": str(uuid4())},
                )
                self.assertEqual(denied_edit.status_code, 403)
                foreign = uuid4()
                async with self.sessions.begin() as db:
                    await db.execute(
                        text(
                            "INSERT INTO hr.employees(id,organization_id,employee_name) VALUES(:id,:org,'Foreign synthetic worker')"
                        ),
                        {"id": foreign, "org": self.other_org},
                    )
                self.assertEqual(
                    (await client.get(f"/foundation/people/{foreign}")).status_code, 404
                )
                listing = await client.get("/foundation/people")
                self.assertEqual(listing.status_code, 200, listing.text)
                self.assertEqual(
                    [row["id"] for row in listing.json()["data"]], [worker]
                )

    async def test_concurrent_duplicate_command_creates_once(self):
        key = uuid4()
        first_inserted = asyncio.Event()

        async def command(first):
            async with self.sessions.begin() as db:
                await bind_workforce_context(db, self.user)
                if not first:
                    await first_inserted.wait()
                receipt, replay = await begin_command(
                    db, self.user, "concurrent", key, {"number": "ONCE"}
                )
                if replay is not None:
                    return replay
                first_inserted.set()
                worker = await create_person(
                    db,
                    self.user,
                    PersonCreate(
                        employee_name="Synthetic worker",
                        employee_number="ONCE",
                        category_id=self.category,
                    ),
                )
                return await complete_command(db, self.user, receipt, worker)

        first, second = await asyncio.wait_for(
            asyncio.gather(command(True), command(False)), timeout=20
        )
        self.assertEqual(first, second)
        async with self.sessions.begin() as db:
            await bind_workforce_context(db, self.user)
            self.assertEqual(
                (await db.execute(text("SELECT count(*) FROM hr.employees"))).scalar(),
                1,
            )
            self.assertEqual(
                (
                    await db.execute(text("SELECT count(*) FROM core.command_receipts"))
                ).scalar(),
                1,
            )
