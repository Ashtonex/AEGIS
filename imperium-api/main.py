from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from core.config import settings
from core.database import check_database_health
from core.logging import logger, setup_logging
from core.security import require_resource_permission
from app.middleware.logging_middleware import StructuredLoggingMiddleware
from routers import auth, users, projects, site_operations, site_reports, workforce, fleet, equipment_assets, procurement, inventory, procurement_orders, inventory_items, budgets, financial_performance, quotations, hr_records, compliance_items, hse_incidents, documents, crm_contacts, crm_leads, client_portal_tickets, supplier_records, internal_messages, kpi_metrics, bi_reports, risk_register, tender_bids, maintenance_schedules, automated_reports, website_enquiries, executive, crm, crm_organizations, crm_activities, crm_communications, crm_automations, public_intake, profiles, portals, notifications, settings as settings_router, analytics_ml, bank_accounts, bank_transactions, payments, payroll_runs, payslips, pwa  # fmt: skip


def create_app() -> FastAPI:
    # Initialize structured log streams
    setup_logging(settings.ENVIRONMENT, settings.LOG_LEVEL)

    app = FastAPI(
        title="Project Imperium API",
        description="The foundational API layer for PROJECT AEGIS.",
        version="1.1.0",
    )

    from core.rate_limit import limiter, rate_limit_exceeded_handler
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    app.add_middleware(StructuredLoggingMiddleware)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from fastapi.responses import RedirectResponse

    @app.get("/", include_in_schema=False)
    async def root():
        return RedirectResponse(url="/docs")

    @app.get("/health", tags=["System"])
    async def health_check():
        try:
            database_health = await check_database_health()
        except Exception:
            logger.exception("Database health check failed")
            return JSONResponse(
                status_code=503,
                content={
                    "success": False,
                    "data": {"status": "degraded", "database": "unavailable"},
                    "message": "Project Imperium database is unavailable.",
                    "meta": {},
                },
            )

        return {
            "success": True,
            "data": {
                "status": "operational",
                "environment": settings.ENVIRONMENT,
                "database": database_health["status"],
            },
            "message": "Project Imperium is online.",
            "meta": {},
        }

    app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
    app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
    app.include_router(projects.router, prefix="/api/v1/projects", tags=["Projects"], dependencies=[Depends(require_resource_permission("projects"))])  # fmt: skip
    app.include_router(site_reports.router, prefix="/api/v1/site-operations", tags=["Site Operations"])  # fmt: skip
    app.include_router(site_operations.router, prefix="/api/v1/site-operations", tags=["Site Operations"], dependencies=[Depends(require_resource_permission("site_operations"))])  # fmt: skip
    app.include_router(workforce.router, prefix="/api/v1/workforce", tags=["Workforce"], dependencies=[Depends(require_resource_permission("workforce"))])  # fmt: skip
    app.include_router(fleet.router, prefix="/api/v1/fleet", tags=["Fleet"], dependencies=[Depends(require_resource_permission("fleet"))])  # fmt: skip
    app.include_router(equipment_assets.router, prefix="/api/v1/equipment-assets", tags=["Equipment Assets"], dependencies=[Depends(require_resource_permission("equipment_assets"))])  # fmt: skip
    app.include_router(
        procurement.router, prefix="/api/v1/procurement", tags=["Procurement"]
    )
    app.include_router(inventory.router, prefix="/api/v1/inventory", tags=["Inventory"])
    app.include_router(procurement_orders.router, prefix="/api/v1/procurement-orders", tags=["Procurement Orders"], dependencies=[Depends(require_resource_permission("procurement_orders"))])  # fmt: skip
    app.include_router(inventory_items.router, prefix="/api/v1/inventory-items", tags=["Inventory Items"], dependencies=[Depends(require_resource_permission("inventory_items"))])  # fmt: skip
    app.include_router(budgets.router, prefix="/api/v1/budgets", tags=["Budgets"], dependencies=[Depends(require_resource_permission("budgets"))])  # fmt: skip
    app.include_router(financial_performance.router, prefix="/api/v1/financial-performance", tags=["Financial Performance"], dependencies=[Depends(require_resource_permission("financial_performance"))])  # fmt: skip
    app.include_router(quotations.router, prefix="/api/v1/quotations", tags=["Quotations"], dependencies=[Depends(require_resource_permission("quotations"))])  # fmt: skip
    app.include_router(hr_records.router, prefix="/api/v1/hr-records", tags=["Hr Records"], dependencies=[Depends(require_resource_permission("hr_records"))])  # fmt: skip
    app.include_router(compliance_items.router, prefix="/api/v1/compliance-items", tags=["Compliance Items"], dependencies=[Depends(require_resource_permission("compliance_items"))])  # fmt: skip
    app.include_router(hse_incidents.router, prefix="/api/v1/hse-incidents", tags=["Hse Incidents"], dependencies=[Depends(require_resource_permission("hse_incidents"))])  # fmt: skip
    app.include_router(documents.router, prefix="/api/v1/documents", tags=["Documents"], dependencies=[Depends(require_resource_permission("documents"))])  # fmt: skip
    app.include_router(crm_contacts.router, prefix="/api/v1/crm-contacts", tags=["Crm Contacts"], dependencies=[Depends(require_resource_permission("crm_contacts"))])  # fmt: skip
    app.include_router(crm_leads.router, prefix="/api/v1/crm-leads", tags=["Crm Leads"])
    app.include_router(client_portal_tickets.router, prefix="/api/v1/client-portal-tickets", tags=["Client Portal Tickets"], dependencies=[Depends(require_resource_permission("client_portal_tickets"))])  # fmt: skip
    app.include_router(supplier_records.router, prefix="/api/v1/supplier-records", tags=["Supplier Records"], dependencies=[Depends(require_resource_permission("supplier_records"))])  # fmt: skip
    app.include_router(internal_messages.router, prefix="/api/v1/internal-messages", tags=["Internal Messages"], dependencies=[Depends(require_resource_permission("internal_messages"))])  # fmt: skip
    app.include_router(kpi_metrics.router, prefix="/api/v1/kpi-metrics", tags=["Kpi Metrics"], dependencies=[Depends(require_resource_permission("kpi_metrics"))])  # fmt: skip
    app.include_router(bi_reports.router, prefix="/api/v1/bi-reports", tags=["Bi Reports"], dependencies=[Depends(require_resource_permission("bi_reports"))])  # fmt: skip
    app.include_router(risk_register.router, prefix="/api/v1/risk-register", tags=["Risk Register"], dependencies=[Depends(require_resource_permission("risk_register"))])  # fmt: skip
    app.include_router(tender_bids.router, prefix="/api/v1/tender-bids", tags=["Tender Bids"], dependencies=[Depends(require_resource_permission("tender_bids"))])  # fmt: skip
    app.include_router(maintenance_schedules.router, prefix="/api/v1/maintenance-schedules", tags=["Maintenance Schedules"], dependencies=[Depends(require_resource_permission("maintenance_schedules"))])  # fmt: skip
    app.include_router(automated_reports.router, prefix="/api/v1/automated-reports", tags=["Automated Reports"], dependencies=[Depends(require_resource_permission("automated_reports"))])  # fmt: skip
    app.include_router(website_enquiries.router, prefix="/api/v1/website-enquiries", tags=["Website Enquiries"], dependencies=[Depends(require_resource_permission("website_enquiries"))])  # fmt: skip

    app.include_router(executive.router, prefix="/api/v1/executive", tags=["Executive"])
    app.include_router(crm.router, prefix="/api/v1/crm", tags=["CRM"])
    app.include_router(crm_organizations.router, prefix="/api/v1/crm-organizations", tags=["CRM Organizations"], dependencies=[Depends(require_resource_permission("crm_organizations"))])  # fmt: skip
    app.include_router(crm_activities.router, prefix="/api/v1/crm-activities", tags=["CRM Activities"], dependencies=[Depends(require_resource_permission("crm_activities"))])  # fmt: skip
    app.include_router(crm_communications.router, prefix="/api/v1/crm-communications", tags=["CRM Communications"])  # fmt: skip
    app.include_router(crm_automations.router, prefix="/api/v1/crm-automations", tags=["CRM Automations"], dependencies=[Depends(require_resource_permission("crm_automations"))])  # fmt: skip
    app.include_router(
        public_intake.router, prefix="/api/v1/public/intake", tags=["Public Intake"]
    )
    app.include_router(profiles.router, prefix="/api/v1/profile", tags=["Profile"])
    app.include_router(portals.router, prefix="/api/v1/portals", tags=["Portals"])
    app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["Notifications"])  # fmt: skip
    app.include_router(pwa.router, prefix="/api/v1/pwa", tags=["PWA"])
    app.include_router(settings_router.router, prefix="/api/v1/settings", tags=["Settings"])  # fmt: skip
    app.include_router(
        analytics_ml.router, prefix="/api/v1/analytics-ml", tags=["Analytics ML"]
    )
    app.include_router(bank_accounts.router, prefix="/api/v1/bank-accounts", tags=["Bank Accounts"])
    app.include_router(bank_transactions.router, prefix="/api/v1/bank-transactions", tags=["Bank Transactions"])
    app.include_router(payments.router, prefix="/api/v1/payments", tags=["Payments"])
    app.include_router(payroll_runs.router, prefix="/api/v1/payroll-runs", tags=["Payroll Runs"])
    app.include_router(payslips.router, prefix="/api/v1/payslips", tags=["Payslips"])

    return app


app = create_app()
