# API STANDARDS

## Response Envelopes

Every single endpoint MUST return data wrapped in this standard envelope.

**Success Payload:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "Project Alpha"
  },
  "message": "Project fetched successfully.",
  "meta": {
    "page": 1,
    "total": 50
  }
}
```

**Error Payload:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "detail": "The 'name' field is required."
  }
}
```

## Authentication Header Format

FastAPI routes are secured via dependency injection. The frontend must pass the Supabase JWT in the Authorization header.

```http
Authorization: Bearer <SUPABASE_JWT_TOKEN>
```

## Adding Routers

1. Routers are strictly versioned (e.g., `routers/v1/projects.py`).
2. Always import `APIRouter` from `fastapi`.
3. Apply the security dependency (e.g., `Depends(get_current_user)`).
4. Do NOT execute synchronous DB queries. Always use `db: AsyncSession = Depends(get_db)`.
