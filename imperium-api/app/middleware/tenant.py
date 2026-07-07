from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import logging

class TenantResolutionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Extract tenant from header (e.g., X-Tenant-ID) or JWT payload
        tenant_id = request.headers.get("X-Tenant-ID")
        
        # In a real app, validate the tenant_id against the database or cache
        if tenant_id:
            request.state.tenant_id = tenant_id
            logging.debug(f"Resolved tenant: {tenant_id}")
        else:
            # Optionally block requests without tenant context or default to public
            request.state.tenant_id = "default"
            
        response = await call_next(request)
        return response
