# AEGIS MODULES REGISTRY

The AEGIS ecosystem consists of 26 interconnected business modules resting on the Imperium base layer.

## Module Status Definitions
- **STUB**: Table structure exists. Empty FastAPI router exists. Basic UI card exists.
- **IN PROGRESS**: Business logic is actively being developed.
- **COMPLETE**: Deployed and fully functional.

## Module List

| ID | Module Name | Status | Dependencies |
|---|---|---|---|
| 01 | Projects | STUB | Auth |
| 02 | Site Operations | STUB | Projects, HR |
| 03 | Workforce (HR) | STUB | Auth |
| 04 | Fleet | STUB | Auth |
| 05 | Equipment Assets | STUB | Fleet |
| 06 | Procurement Orders | STUB | Projects, Inventory |
| 07 | Inventory Items | STUB | Auth |
| 08 | Budgets | STUB | Finance |
| 09 | Financial Performance | STUB | Budgets |
| 10 | Quotations | STUB | CRM |
| 11 | HR Records | STUB | Workforce |
| 12 | Compliance Items | STUB | Legal |
| 13 | HSE Incidents | STUB | Site Operations |
| 14 | Documents | STUB | Auth |
| 15 | CRM Contacts | STUB | Auth |
| 16 | CRM Leads | STUB | CRM Contacts |
| 17 | Client Portal Tickets | STUB | CRM |
| 18 | Supplier Records | STUB | Procurement |
| 19 | Internal Messages | STUB | Auth |
| 20 | KPI Metrics | STUB | BI |
| 21 | BI Reports | STUB | KPI |
| 22 | Risk Register | STUB | Site Operations |
| 23 | Tender Bids | STUB | CRM |
| 24 | Maintenance Schedules | STUB | Fleet |
| 25 | Automated Reports | STUB | BI |
| 26 | Website Enquiries | STUB | CRM |

## Recommended Build Sequence
1. Core Imperium (Auth, Orgs, Users)
2. CRM & Website Enquiries
3. Projects & Site Operations
4. HR & Workforce
5. Fleet & Procurement
