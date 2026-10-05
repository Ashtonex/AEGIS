# HR & Workforce re-engineering plan

Started 2026-10-04. Two modules that share one person record but do different jobs:

- **Workforce** = who we have and where they are deployed. People register, the
  person card (dossier), catalogue of disciplines/roles, reporting lines, org
  chart, availability, project allocations, workforce planning.
- **HR** = what we owe them and what they owe us. Contracts, credentials,
  assets issued, attendance, leave, payroll, performance, training, recruitment,
  vendor & supplier verification.

Both open the same **person card** popup, so a person is built once.

## What was wrong (found 2026-10-04)

| Problem | Cause |
|---|---|
| Phoebe Lifa keeps appearing | Login disabled, but `hr.employees.employment_status` still `active`. No way to mark someone as having left. |
| Duplicate "Trish Mapaya" | Old `trish@` login (disabled) still has its own employee row. Same for a second Phoebe login. |
| "Not assigned" everywhere | 0 worker categories, 0 positions, no worker numbers ever issued. Register form demanded both by hand. |
| Organisation settings asks for a code | Codes were manual free text. |
| Same KPI strip + Log Attendance / Apply Leave + "Workforce Intelligence" on every HR page | One shared `HRWorkspace` component rendered all 13 tabs. |
| Reporting authority page is empty and confusing | Dated manager links with 4 relationship types, set from a hidden form. Nothing reads them. |

## Phase 1: People foundation (in progress)

1. **Construction catalogue.** 15 disciplines (Executive, Project Management,
   Engineering, QS & Commercial, Site Supervision, HSE, Procurement, Finance,
   Admin & HR, Business Development, Trades, Plant Operators, General Labour,
   Interns & Trainees, Consultants) and ~55 roles, each mapped to a department.
2. **Codes generated automatically.** "Quantity Surveyor" becomes `QS` and
   "Plant Mechanic" becomes `PM2` when `PM` is taken. Nobody types a code.
3. **Worker numbers issued automatically.** Format `SNC-0001`. A number is
   permanent and never reused. Existing staff with a working login are back-filled.
4. **Person card popup** (Open on any register). It scrolls inside the popup
   and does not stretch the page. Tabs:
   - Overview
   - Employment: discipline, role, department, type, start date, base, line manager
   - Projects: allocations with role on project and %
   - Pay: salary/rate, currency, tax and NSSA numbers, bank. Feeds payroll.
   - Personal: ID, date of birth, contacts, address, next of kin
   - Assessments: psychometric results
   - History
5. **Leaving the organisation.** "Mark as left" sets status `terminated`, end
   date and reason, ends open project allocations, and can disable the login. Former
   staff drop off every active list but keep their history.
6. **Reporting authority, simplified.** Each person has one **line manager**
   on the Employment tab. Changing it closes the old link and opens a new one
   from today. Leave approvals and the org chart will use this link.
7. **My Profile is self-service.** Every employee completes their own
   personal details. HR controls employment and pay.
8. **HR shell clean-up.** KPIs appear only on the HR dashboard. Log Attendance
   appears only on Attendance and Apply Leave only on Leave. The person card
   replaces the "Workforce Intelligence" side card.

## Phase 2: Documents that expire

- **Contracts & Docs.** List of employees. Clicking one opens their contract
  history: every contract, its signed copy, and start and end dates. Uploads
  go to SharePoint/Storage. 60/30/7 days before a contract ends:
  - email `nyasha@sixnineconstruction.com` and the employee
  - create a Teams/Outlook meeting between management and the employee
  - post an in-app notification
- **Credentials.** Certifications, driver's licences (class, number, expiry),
  professional registrations (ECZ, ZIQS…), vehicle registrations, medicals.
  These use the same expiry engine.
- **Assets.** Who holds what, issued on, issued by, condition out/in, returned
  on, signed acknowledgement. Fleet vehicles link to the fleet register.

## Phase 3: Time

- **Automatic attendance.** The first authenticated AEGIS request of the day
  records check-in. The clock stops at 16:30 (Harare). A day with approved leave
  is excluded and flagged.
- **Friday confirmation.** On the first login each Friday the employee sees
  Saturday–Friday hours and can correct them with a reason. Corrections go to
  the line manager.
- **Second source.** Teams presence (Graph) gives a second time record that
  is matched against AEGIS. Mismatches are flagged. Hardware clocks plug into the
  same `attendance_events` table later.
- **Leave management** reports days absent per employee and period, leave
  balances, and unplanned absences.

## Phase 4: Payroll

The run moves through one pipeline: HR verifies the people, Workforce verifies
hours, and Finance approves pay. The run builds automatically from confirmed
weekly hours and the pay profile. PAYE, NSSA and AIDS levy come from the
existing statutory rate tables. One PDF payslip is produced per person per
period. Posting reuses the existing GL bridge.

## Phase 5: Intelligence

- **Org chart.** Interactive and drawn from line-manager links. Clicking a unit
  shows its lead, its members and how information flows.
- **Workforce planning.** Demand comes from project programmes and roles
  needed per stage. Supply comes from people, availability and allocations. The
  planner proposes allocations across concurrent projects and shows
  shortfalls, clashes and hiring needs.
- **Training matrix.** Detects friction from failed actions, repeated errors
  and abandoned flows in the audit and API logs, per user. It groups the cause
  and proposes a training plan for the people affected.
- **Performance.** Review cycles, KPIs per role, and a link to task-completion data.
- **Recruitment.** A candidate pipeline (applied → assessed → interviewed →
  offered → hired). Hiring creates the person card and carries the psychometric
  result across.

## Phase 6: Vendor & Supplier verification

Renamed. Any supplier or subcontractor that is not fully verified is flagged
**Not safe for business**. Raising a PO against one alerts the Procurement
Manager, the MD and `nyasha@sixnineconstruction.com`.
