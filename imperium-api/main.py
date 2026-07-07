from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from routers import auth, users, projects, site_operations, workforce, fleet, equipment_assets, procurement_orders, inventory_items, budgets, financial_performance, quotations, hr_records, compliance_items, hse_incidents, documents, crm_contacts, crm_leads, client_portal_tickets, supplier_records, internal_messages, kpi_metrics, bi_reports, risk_register, tender_bids, maintenance_schedules, automated_reports, website_enquiries, executive, crm


def create_app() -> FastAPI:
    app = FastAPI(
        title="Project Imperium API",
        description="The foundational API layer for PROJECT AEGIS.",
        version="1.1.0"
    )

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
        return {"success": True, "data": {"status": "operational", "environment": settings.ENVIRONMENT}, "message": "Project Imperium is online.", "meta": {}}


    app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
    app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
    app.include_router(projects.router, prefix="/api/v1/projects", tags=["Projects"])
    app.include_router(site_operations.router, prefix="/api/v1/site-operations", tags=["Site Operations"])
    app.include_router(workforce.router, prefix="/api/v1/workforce", tags=["Workforce"])
    app.include_router(fleet.router, prefix="/api/v1/fleet", tags=["Fleet"])
    app.include_router(equipment_assets.router, prefix="/api/v1/equipment-assets", tags=["Equipment Assets"])
    app.include_router(procurement_orders.router, prefix="/api/v1/procurement-orders", tags=["Procurement Orders"])
    app.include_router(inventory_items.router, prefix="/api/v1/inventory-items", tags=["Inventory Items"])
    app.include_router(budgets.router, prefix="/api/v1/budgets", tags=["Budgets"])
    app.include_router(financial_performance.router, prefix="/api/v1/financial-performance", tags=["Financial Performance"])
    app.include_router(quotations.router, prefix="/api/v1/quotations", tags=["Quotations"])
    app.include_router(hr_records.router, prefix="/api/v1/hr-records", tags=["Hr Records"])
    app.include_router(compliance_items.router, prefix="/api/v1/compliance-items", tags=["Compliance Items"])
    app.include_router(hse_incidents.router, prefix="/api/v1/hse-incidents", tags=["Hse Incidents"])
    app.include_router(documents.router, prefix="/api/v1/documents", tags=["Documents"])
    app.include_router(crm_contacts.router, prefix="/api/v1/crm-contacts", tags=["Crm Contacts"])
    app.include_router(crm_leads.router, prefix="/api/v1/crm-leads", tags=["Crm Leads"])
    app.include_router(client_portal_tickets.router, prefix="/api/v1/client-portal-tickets", tags=["Client Portal Tickets"])
    app.include_router(supplier_records.router, prefix="/api/v1/supplier-records", tags=["Supplier Records"])
    app.include_router(internal_messages.router, prefix="/api/v1/internal-messages", tags=["Internal Messages"])
    app.include_router(kpi_metrics.router, prefix="/api/v1/kpi-metrics", tags=["Kpi Metrics"])
    app.include_router(bi_reports.router, prefix="/api/v1/bi-reports", tags=["Bi Reports"])
    app.include_router(risk_register.router, prefix="/api/v1/risk-register", tags=["Risk Register"])
    app.include_router(tender_bids.router, prefix="/api/v1/tender-bids", tags=["Tender Bids"])
    app.include_router(maintenance_schedules.router, prefix="/api/v1/maintenance-schedules", tags=["Maintenance Schedules"])
    app.include_router(automated_reports.router, prefix="/api/v1/automated-reports", tags=["Automated Reports"])
    app.include_router(website_enquiries.router, prefix="/api/v1/website-enquiries", tags=["Website Enquiries"])
    app.include_router(executive.router, prefix="/api/v1/executive", tags=["Executive"])
    app.include_router(crm.router, prefix="/api/v1/crm", tags=["CRM"])

    return app

app = create_app()
