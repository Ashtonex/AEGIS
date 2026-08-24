# AEGIS System and Business Organogram

This organogram combines two views of Project AEGIS:

1. The technical system structure visible from the codebase.
2. SNC's target operating model, which explains how the business should be organised, governed, and gradually institutionalised.

The system should not simply reproduce the current informal operating reality. It should help SNC move from MD-dependent decision-making toward delegated authority, clear departmental accountability, evidence-backed workflows, and independent risk oversight.

## SNC Target Operating Model

```mermaid
flowchart TD
    md[CEO / Managing Director]

    risk[Risk Department<br/>Independent oversight and upward reporting]
    control[Corporate Control Services]
    commercial[Commercial Department]
    construction[Construction Department]
    plant[Plant and Equipment Department]

    finance[Finance]
    hr[HR]
    legal[Legal and Compliance]
    ict[ICT]
    admin[Executive Administration]

    marketing[Marketing and business development]
    crm[CRM, leads and opportunities]
    tenders[Tenders and estimating]
    qs[Quantity surveying and contracts]
    client[Client relationships]

    mobilisation[Project mobilisation]
    site[Site execution]
    quality[Quality and programme control]
    hse[HSE]
    closeout[Project closeout]

    fleet[Fleet and machinery]
    operators[Operators]
    maintenance[Maintenance]
    fuel[Fuel]
    hire[Plant hire and utilisation]

    md --> control
    md --> commercial
    md --> construction
    md --> plant
    risk -. independent assurance .-> md
    risk -. oversight .-> control
    risk -. oversight .-> commercial
    risk -. oversight .-> construction
    risk -. oversight .-> plant

    control --> finance
    control --> hr
    control --> legal
    control --> ict
    control --> admin

    commercial --> marketing
    commercial --> crm
    commercial --> tenders
    commercial --> qs
    commercial --> client

    construction --> mobilisation
    construction --> site
    construction --> quality
    construction --> hse
    construction --> closeout

    plant --> fleet
    plant --> operators
    plant --> maintenance
    plant --> fuel
    plant --> hire
```

## Operating Reality vs Target vs System Enforcement

| Layer | Meaning | AEGIS role |
|---|---|---|
| Current reality | Existing staff, informal practices, MD dependency, and current approval habits. | Capture what is happening without hard-coding weak controls as permanent rules. |
| Target operating model | The departmental structure and delegated authority SNC is moving toward. | Represent departments, roles, responsibilities, workflows, and escalation paths. |
| System enforcement | Permissions, approval limits, evidence requirements, audit trails, and segregation of duties. | Force the target model to operate consistently and reduce dependency on individuals. |

## Governance Separations AEGIS Must Enforce

| Separation | Practical meaning |
|---|---|
| Requesting from approving | A person who asks for expenditure, stock, labour, plant, or a contract action should not be the final approver of the same action. |
| Purchasing from receiving | Procurement raises orders; site/store/receiving confirms goods or services actually arrived. |
| Recording from reconciling | Data capture and finance reconciliation should be different responsibilities. |
| Site execution from commercial measurement | Site teams record progress and events; commercial/QS functions measure value, claims, variations, and contractual impact. |
| Asset use from maintenance authorisation | Plant users request and record usage; maintenance/fleet control authorises repair, service, and release decisions. |
| Operational management from risk oversight | Operating departments run the work; Risk independently reviews exceptions, controls, compliance, and exposure. |

## Business Lifecycle Architecture

```mermaid
flowchart LR
    lead[Lead / enquiry]
    qualify[Opportunity qualification]
    tender[Tender / estimate]
    award[Contract award]
    mobilise[Project mobilisation]
    execute[Site execution]
    measure[QS measurement, claims and variations]
    procure[Procurement, inventory and suppliers]
    resource[Workforce, fleet and equipment allocation]
    control[Finance, compliance and risk controls]
    closeout[Practical completion and closeout]
    report[Executive reporting and audit trail]

    lead --> qualify
    qualify --> tender
    tender --> award
    award --> mobilise
    mobilise --> execute
    execute --> measure
    execute --> procure
    execute --> resource
    procure --> control
    resource --> control
    measure --> control
    control --> closeout
    closeout --> report
    control --> report
```

## Department-to-System Mapping

| SNC function | Primary AEGIS modules |
|---|---|
| CEO / Managing Director | Executive dashboards, approvals, BI reports, automated reports, audit logs. |
| Corporate Control Services | Finance, budgets, bank accounts, payments, payroll, HR records, users, teams, settings, legal/compliance records, ICT administration. |
| Commercial Department | CRM contacts, leads, activities, communications, tenders, pursuits, quotations, BOQ progress, contracts, client relationships. |
| Construction Department | Projects, site operations, site reports, workforce, quality, HSE incidents, documents, project closeout. |
| Plant and Equipment Department | Fleet, equipment assets, operators, maintenance schedules, fuel-related records, utilisation, plant deployment. |
| Risk Department | Risk register, compliance items, SOP compliance, HSE oversight, audit evidence, exception reporting, executive assurance. |

## Authority and Workflow Model

```mermaid
flowchart TD
    request[Request raised]
    evidence[Evidence attached]
    budget[Budget / authority check]
    dept[Department review]
    risk[Risk or compliance review when required]
    approval[Delegated approval]
    action[Operational action]
    receipt[Receipt / confirmation]
    reconcile[Finance reconciliation]
    audit[Audit trail and reporting]

    request --> evidence
    evidence --> budget
    budget --> dept
    dept --> risk
    dept --> approval
    risk --> approval
    approval --> action
    action --> receipt
    receipt --> reconcile
    reconcile --> audit
```

## High-Level System Structure

```mermaid
flowchart TD
    user[Users]
    public[Public visitors]

    subgraph web[Aegis Web - Next.js Frontend]
        website[Public website]
        dashboard[Protected dashboards]
        portals[Client and supplier portals]
        webapi[Frontend API helpers]
    end

    subgraph auth[Identity and Access]
        supaauth[Supabase Auth]
        jwt[JWT session token]
        rbac[Backend RBAC and permissions]
    end

    subgraph api[Imperium API - FastAPI Backend]
        gateway[API gateway, CORS, rate limits, logging]
        routers[Versioned API routers]
        services[Business services]
        workers[Background worker]
        realtime[Realtime listener]
    end

    subgraph modules[AEGIS Business Modules]
        operations[Projects, site operations, workforce, fleet, equipment]
        commercial[CRM, leads, pursuits, tenders, quotations]
        supply[Procurement, suppliers, inventory]
        finance[Budgets, payments, payroll, financial performance, final accounts]
        governance[Compliance, HSE, documents, SOPs, risk register]
        intelligence[Executive dashboards, BI reports, KPI metrics, automated reports]
    end

    subgraph data[Data and Infrastructure]
        postgres[Supabase PostgreSQL]
        rls[Row Level Security and organization isolation]
        storage[Supabase storage]
        redis[Redis queue/cache]
    end

    public --> website
    user --> dashboard
    user --> portals

    website --> webapi
    dashboard --> webapi
    portals --> webapi

    webapi --> supaauth
    supaauth --> jwt
    webapi --> gateway
    jwt --> gateway

    gateway --> rbac
    rbac --> routers
    routers --> services
    services --> modules

    services --> postgres
    postgres --> rls
    services --> storage
    services --> redis
    redis --> workers
    workers --> postgres
    postgres --> realtime
    realtime --> services
```

## Request Flow

```mermaid
sequenceDiagram
    participant U as User
    participant W as Aegis Web
    participant A as Supabase Auth
    participant I as Imperium API
    participant R as Router
    participant S as Service
    participant D as Supabase PostgreSQL
    participant Q as Redis / Worker

    U->>W: Opens page or submits action
    W->>A: Gets authenticated session
    A-->>W: Returns JWT
    W->>I: Sends REST request with Bearer token
    I->>I: Applies CORS, host checks, rate limits, logging
    I->>I: Validates JWT and checks permissions
    I->>R: Routes request to module endpoint
    R->>S: Calls business logic
    S->>D: Reads or writes tenant-scoped data
    D-->>S: Returns data under RLS rules
    S-->>R: Returns result
    R-->>I: Wraps response in standard API envelope
    I-->>W: Sends JSON response
    W-->>U: Updates dashboard or portal
    S-->>Q: Queues long-running work when needed
    Q-->>D: Writes generated reports, jobs, or async results
```

## Backend Module Groups

```mermaid
flowchart LR
    root[Imperium API Routers]

    root --> core[Core platform]
    core --> auth[Auth, users, profiles, teams, assignments, settings, notifications, PWA]

    root --> ops[Construction operations]
    ops --> projects[Projects, site reports, site operations, workforce, fleet, equipment assets, maintenance]

    root --> crm[Commercial and CRM]
    crm --> crmitems[CRM contacts, leads, organizations, activities, communications, automations, tasks, lifecycle]
    crm --> tenders[Tender bids, pursuits, pursuit teams, public intake, supplier records]

    root --> procurement[Procurement and stock]
    procurement --> stock[Procurement, inventory, inventory items, BOQ progress]

    root --> finance[Finance]
    finance --> money[Budgets, bank accounts, bank transactions, payments, payroll, payslips]
    finance --> controls[Financial performance, finance departments, transfers, statutory, CCB findings, final accounts]

    root --> compliance[Governance and records]
    compliance --> gov[Compliance items, SOP compliance, HSE incidents, documents, drawings, risk register]

    root --> reporting[Reporting and intelligence]
    reporting --> insight[Executive, BI reports, KPI metrics, analytics ML, automated reports]

    root --> portals[External access]
    portals --> ext[Client portal tickets, portals, public intake]
```

## Runtime Components

| Component | Role |
|---|---|
| `aegis-web` | Next.js frontend for the public website, dashboards, and portals. |
| `imperium-api` | FastAPI backend that owns authorization, business logic, and database access. |
| `imperium-worker` | Background worker for queued or long-running tasks. |
| `redis` | Queue/cache used by the API and worker. |
| Supabase Auth | User authentication and JWT session issuing. |
| Supabase PostgreSQL | Main application database with tenant isolation through `organization_id` and RLS. |
| Supabase Storage | Document, report, quotation, and generated-file storage target. |

## Plain-English Summary

AEGIS works as a layered business platform. The frontend is the screen that users interact with. The Imperium API is the control layer that checks who the user is, what they are allowed to do, and which business module should handle the request. Business modules then read or write data in Supabase, while background workers handle slower jobs such as generated reports, documents, quotation outputs, or automation tasks.
