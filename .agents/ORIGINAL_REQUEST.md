# Original User Request

## Initial Request — 2026-07-14T09:48:40Z

Complete refinement, verification, and end-to-end testing of the AEGIS CRM and ERP modules (including Projects, Fleet, Workforce, and Settings) with secure Role-Based Access Control overrides.

Working directory: G:/work/ATMCAPPROJECTS/Mudekwa/AEGIS/aegis-web
Integrity mode: development

## Requirements

### R1. Complete ERP Dashboard Portals
- **Projects Command Hub**: Fully integrated 16-week timeline Gantt charts with view mode toggles, margin slippage simulation sliders, and concrete/steel material flow tracking.
- **Fleet Tracker**: Plant asset lists with fuel/load telemetry, low diagnostics triggers, and custom SVG CSS route animations.
- **Workforce Registry**: Tabbed roster lists, safety certificate renewals with document viewer preview modals, and gross payroll cost estimators.

### R2. Refined CRM Sub-Modules
- Interactive Opportunities Kanban deal pipeline, Tenders bids checklists, and high-density Credit Limit/Risk organizations directories.

### R3. Master Role-Based Access Control (RBAC) Guards
- Route protection guards that display restriction lockdown lock screens for unauthorized users, with dynamic bypass overrides for the Supabase `superadmin` and `admin` roles.

## Acceptance Criteria

### Security Gateways
- [ ] Non-admin users are locked out of Settings and Workforce pages and presented with a restricted warning screen.
- [ ] Users authenticated with the Supabase `superadmin` or `admin` roles bypass all restriction lock screens.

### Compilation & Build
- [ ] Running `npx tsc --noEmit` completes with exit code 0.
- [ ] Running `npm run build` generates all static routes successfully without errors.
