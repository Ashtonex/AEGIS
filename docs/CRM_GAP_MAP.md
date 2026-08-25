# AEGIS CRM Gap Map

AEGIS CRM should compete as a construction CRM and commercial handoff system, not as a generic Salesforce clone.

The target position is:

- Pipedrive-level ease for reps working deals every day.
- Odoo-level business integration across quote, project, procurement, stores, and finance.
- vTiger-level sales, support, and customer coverage.
- Salesforce-style governance where close, approval, and handoff actions are auditable.
- Construction-specific intelligence that generic CRMs do not provide out of the box.

## Differentiating Flow

```text
Lead / Enquiry
  -> Qualified Opportunity
  -> Site Visit / Tender / Quotation
  -> Commercial Review / CCB Check
  -> Won Deal or Awarded Tender
  -> Project Auto-Created
  -> Project Store Auto-Created
  -> Cost Codes Auto-Created
  -> Procurement / RFQ / PO
  -> Goods Received
  -> Store Stock Populated
  -> Site Issue / Usage
  -> Budget, CCB, Forecast, and Reports Updated
```

## Current Gap Priority

| Area | AEGIS Direction | Priority |
| --- | --- | --- |
| Leads | Keep and improve qualification automation | High |
| Contacts / Accounts | Keep and improve duplicate control and 360 views | High |
| Opportunities / Deals | Make pipeline movement easier and stricter | High |
| Tender Pipeline | Keep as construction-specific advantage | Keep |
| Quotation Link | Keep as commercial handoff advantage | Keep |
| Won Deal to Project | Keep as construction-specific advantage | Keep |
| Project Store Creation | Keep as construction-specific advantage | Keep |
| Procurement Link | Keep as construction-specific advantage | Keep |
| CCB / Cost Control | Keep as construction-specific advantage | Keep |
| Email Sync | Add proper Gmail/Outlook sync | Critical |
| Calendar Sync | Add proper scheduling and calendar sync | Critical |
| Pipeline UX | Improve drag/drop, deal health, and stage controls | Critical |
| Activities / Follow-ups | Require next action on open opportunities | High |
| Automation Builder | Add non-technical workflow configuration | Critical |
| Reports / Forecasting | Improve forecast, velocity, stale deals, and rep performance | Critical |
| AI Sales Assistant | Add lead scoring and next-best-action | Critical |
| Mobile CRM | Build mobile-first sales workflow | High |
| Integrations | Add Gmail, Outlook, WhatsApp, accounting, maps, and documents | Critical |
| Role Permissions | Keep strong governance | Keep |
| Audit / Governance | Keep strong audit trail | Keep |

## Implementation Phases

### Phase 1: Match Pipedrive Basics

- Drag/drop opportunity pipeline.
- Deal detail modal or drawer with activity timeline.
- Email logging and outbound email from CRM.
- Calendar activity scheduling.
- Stale deal warnings.
- Next action required on every open opportunity.

Status: partially implemented. The opportunities board now surfaces stale and missing-next-action deals, requires a next action when moving active stages, and routes Won/Lost movement through the proper close flows.

### Integration Core Foundation

Status: implemented as a foundation. CRM now has provider/account records, sync jobs, sync errors, email/calendar sync event mapping, a Connected Apps page, and explainable AI recommendations. Gmail, Outlook, Google Calendar, Microsoft Calendar, WhatsApp, maps, documents, and accounting are represented through one shared operating layer. Live provider sync still depends on production OAuth/API credentials and background workers for each provider.

### Phase 2: Match vTiger/Odoo Breadth

- Workflow automation builder.
- Campaign member journeys.
- Lead scoring.
- Duplicate detection for contacts and organizations.
- Quote/proposal templates.
- Customer 360 page with contacts, deals, quotes, projects, tickets, documents, and invoices.

### Phase 3: Construction Advantage

- Tender-to-project handoff dashboard.
- CCB deal risk review before marking won.
- Auto project store and cost code audit trail.
- Procurement readiness checklist from won deal.
- Sales forecast tied to project capacity and cashflow.
- "Can we take this job?" AI/commercial gate.

### Phase 4: Enterprise Level

- AI sales assistant.
- Forecast accuracy dashboard.
- Sales rep performance.
- Territory and region pipeline map.
- WhatsApp, Gmail, and Outlook integrations.
- Mobile-first CRM experience.

## Near-Term Build Rule

Every open opportunity must always have a next action. Every stage movement should either create a future activity or close through a governed Won/Lost process. This keeps sales work active while preserving the construction handoff controls that make AEGIS different.
