# Workforce enhancement contract

The target question is: who is working where, doing what, under whose authority, at what cost, with what qualifications, and producing what result?

## Operational increment implemented

- Existing HR employee register remains authoritative; employment status and base location use the actual API field names. Base location is not counted as a deployment. The profile displays an explicit set of operational attributes.
- Project allocations show worker, role, project, period, capacity and status. Only active allocations within the selected day contribute to expected headcount. The existing API compliance gate remains the allocation authority.
- Daily manual attendance can be captured with project, status, ordinary hours, overtime worked and notes. A register does not manufacture clock timestamps. Duplicate employee/day records are rejected without overwriting evidence.
- Timesheets can be saved as drafts, submitted, independently approved or rejected. Reviewers need `workforce.update`; creators need `workforce.create`; reads require `workforce.read`. Existing dashboard role restrictions remain in place.
- Approval requires a project, activity description and matching project/day attendance supporting ordinary and overtime hours separately. The author and linked worker cannot decide their own timesheet. Decisions lock the row and only transition submitted records.
- Exceptions identify missing attendance for active deployments, presence without deployment, missing clock-out, overtime needing separate authorisation and attendance after recorded contract expiry.
- All reads and writes are organization-scoped. Missing operational sources suppress headline totals and exception conclusions. Dates are selected in Africa/Harare time.

This increment uses existing tables and requires no migration. Deploy the API and frontend together because the frontend uses the new timesheet list endpoint. Existing attendance must use migration 023's `attendance_date` and `recorded_by` columns.

## Definitions and boundaries

- HR owns engagement, contracts, leave decisions, personal records and employment classification. Workforce consumes those records.
- An active allocation is deployment evidence; it is not itself proof of presence, accepted production or a complete mobilisation checklist.
- Manual attendance is recorded presence, not independent attendance verification. The existing attendance schema has no verification workflow.
- Timesheet descriptions capture activity evidence in this increment; they are not validated work-package, BOQ or cost-code foreign keys.
- Operational approval is not payroll approval, overtime authorisation or a payment instruction. No export from this increment should be treated as payroll-ready.
- Hours actually worked remain stored even if supporting authority is missing. Missing authority prevents downstream conclusions; it does not erase evidence.
- Employee lists currently cap at 250 and allocation lists at 500. Exceptions describe loaded records, not an exhaustive organization audit.

## Remaining delivery sequence from the supplied brief

1. Foundation: workforce category dictionary, supervisor/team hierarchy, restricted identity and rate fields, contract/document verification, full register pagination and revision history.
2. Site control: manpower plans and requisitions; dated leave/availability consumption; complete mobilisation checklist; approval-controlled crews, transfers and demobilisation; site access events; independent attendance verification and correction revisions.
3. Time and cost: structured work-package/activity/cost codes, approved rates, overtime request/budget/approval evidence, cross-project daily hour reconciliation, weekly operational/HR/QS approvals and a separately authorised Finance handoff.
4. Production: accepted versus rejected output, crew labour productivity, target/actual hours, recorded delay causes, cost per accepted unit and corrective actions.
5. Intelligence: forecasts and anomaly detection only after the underlying records and approval controls are reliable.

Before each schema expansion, define its permissions, approvers, event consumers, evidence requirements, historical corrections and acceptance tests. Do not present inferred availability, unverified time or missing cost/output data as established facts.

## Verification

`imperium-api/tests/test_workforce_operations.py` exercises payload validation, duplicate preservation, correct attendance columns, independent review, supporting hours, rejection, terminal states and bounded date reads with a mocked database. Existing workforce contract suites cover tenant authorization and deployment gate integration. These are not live PostgreSQL integration or authenticated browser tests.
