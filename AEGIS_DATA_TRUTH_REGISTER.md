# AEGIS Data Truth Register

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Product Integrity Lead  
**Core Rule**: Data truth is sacred. Never fabricate, mock, estimate, default, or optimistically display data that the backend did not actually return. Unknown values must remain explicitly unknown rather than zero.

---

## 1. Executive Summary

This register audits all instances across `imperium-api` and `aegis-web` where mock data, hardcoded constants, misleading optimistic updates, or fictitious fallbacks could mislead executive leadership, site supervisors, or commercial estimators.

---

## 2. Data Integrity Findings

### DATA-001: CRM Automation Visual Builder Staging Mode Misrepresentation
- **Location**: `aegis-web/src/app/dashboard/crm/automations/page.tsx:485-508`
- **Type**: MISSING BACKEND / SIMULATED UI
- **User-facing risk**: Operators configuring complex trigger-action rules believed workflows were actively executing in the background across leads and tenders, whereas rules were only stored in local React state.
- **Business decision affected**: Sales pipeline response time, automatic lead qualification, commercial tender alert dispatch.
- **Correct behaviour**: Clearly label visual designer as "Simulation & Staging Mode", clarifying that rules are staged until background Arq worker listener integration.
- **Fix approach**: Add persistent, styled amber indicator badge `[SIMULATION & STAGING MODE | Rules staged in local state until engine deployment]` to the visual builder tab bar.
- **Files to change**: `aegis-web/src/app/dashboard/crm/automations/page.tsx`
- **Backend work required**: Planned Arq worker queue integration (Wave 9).
- **Frontend work required**: Badge implemented in workspace canvas header.
- **Tests required**: Verify badge presence in UI and non-interference with rule test simulation.
- **Status**: VERIFIED FIXED

---

### DATA-002: Marketing Website CMS Articles Mock Fallback Commentary
- **Location**: `aegis-web/src/lib/api/website.ts:95-105`, `aegis-web/src/app/news/[slug]/page.tsx:27`
- **Type**: FALLBACK / COMMENTARY AMBIGUITY
- **User-facing risk**: Code comments suggested the client fell back to mock article content on missing CMS backend, causing audit confusion regarding data authenticity.
- **Business decision affected**: Public press releases, corporate announcements, and regulatory compliance publications.
- **Correct behaviour**: Real CMS endpoint `/api/cms/articles/:slug` is queried; if unresolvable, the detail page must invoke Next.js `notFound()` to render an honest 404 rather than synthetic articles.
- **Fix approach**: Verified downstream consumer calls `if (!article) notFound()`. Replaced misleading comments with explicit contract documentation.
- **Files to change**: `aegis-web/src/lib/api/website.ts`
- **Backend work required**: None (CMS router returns 404 cleanly).
- **Frontend work required**: Verified honest 404 page trigger.
- **Tests required**: `npm run typecheck`
- **Status**: VERIFIED FIXED

---

### DATA-003: Executive LTIFR Hardcoded 85,000 Man-Hour Baseline
- **Location**: `imperium-api/routers/executive.py`, `tests/test_executive_truth_state_contract.py`
- **Type**: HARDCODED / FICTITIOUS BASELINE
- **User-facing risk**: When timesheet records were absent, the HSE LTIFR calculation previously defaulted to a hardcoded `85,000.0` man-hour denominator, presenting a false compliant HSE reading.
- **Business decision affected**: Statutory safety compliance, site audit escalation, board-level risk reviews.
- **Correct behaviour**: When timesheet hours are missing or unmeasured, LTIFR must return `truth_status: "UNKNOWN"` with an honest explanation that a real denominator is unavailable.
- **Fix approach**: Eradicated the `85000.0` constant; return explicit `UNKNOWN` truth state when denominator is zero.
- **Files to change**: `imperium-api/routers/executive.py`
- **Backend work required**: Sourced from actual `hr.timesheets` queries.
- **Frontend work required**: Executive dashboard displays "UNKNOWN" pill when unmeasured.
- **Tests required**: `test_executive_truth_state_contract.py::test_ltifr_reports_unknown_without_a_real_denominator`
- **Status**: VERIFIED FIXED

---

### DATA-004: Executive Financial Runway 99-Month Sentinel
- **Location**: `imperium-api/routers/executive.py`, `tests/test_executive_truth_state_contract.py`
- **Type**: HARDCODED / SENTINEL VALUE
- **User-facing risk**: When burn rate was zero or cash reserves unavailable, runway calculation returned `99.0` months, presenting a false illusion of multi-year liquidity.
- **Business decision affected**: Working capital management, credit line negotiations, procurement release authority.
- **Correct behaviour**: When burn rate cannot be computed, runway must be reported as `None` / `UNKNOWN` with `cash_unavailable` flagged if bank balances fail to load.
- **Fix approach**: Eradicated `else 99.0`; explicit `ESTIMATED` or `UNKNOWN` state returned with basis of uncertainty documented.
- **Files to change**: `imperium-api/routers/executive.py`
- **Backend work required**: Truth state enumeration.
- **Frontend work required**: Display "Indeterminate" or "Unavailable" instead of "99 months".
- **Tests required**: `test_executive_truth_state_contract.py::test_runway_sentinel_99_months_is_gone`
- **Status**: VERIFIED FIXED

---

### DATA-005: Project Schedule Risk Fabricated Milestones
- **Location**: `imperium-api/routers/executive.py`, `tests/test_executive_schedule_risk_truth_contract.py`
- **Type**: HARDCODED TEMPLATE
- **User-facing risk**: For projects lacking real WBS milestones, schedule risk endpoint generated a fictitious 5-milestone template ("Site Prep", "Substructure", "Superstructure", "Fit-Out", "Commissioning") with synthetic completion percentages.
- **Business decision affected**: Executive milestone interventions, delay penalty provisions, client reporting.
- **Correct behaviour**: If a project has no recorded milestones in `projects.milestones`, return `task_count: 0`, `status: "UNKNOWN"`, and label truth state as incomplete.
- **Fix approach**: Removed synthetic template generation; derive strictly from live project milestone rows.
- **Files to change**: `imperium-api/routers/executive.py`
- **Backend work required**: Real query against `projects.milestones`.
- **Frontend work required**: Render "No milestones configured for this project" empty state.
- **Tests required**: `test_executive_schedule_risk_truth_contract.py::test_hardcoded_milestone_template_is_gone`
- **Status**: VERIFIED FIXED

---

## 3. Data Integrity Operating Policy
1. **Zero Fake Fallbacks**: Under no circumstances may client or server code substitute missing records with random numbers, lorem ipsum, or placeholder entities.
2. **Deterministic Uncertainty**: When data is missing, the API must return `null` and an honest status (`UNKNOWN`, `PENDING_CALCULATION`, `NOT_RECORDED`).
3. **No Optimistic Lies**: Critical mutations (approvals, payments, transfers, gate releases) must remain in a visible "Pending confirmation" state until the backend confirms database transaction commit.
