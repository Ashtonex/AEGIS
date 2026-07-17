from fastapi import APIRouter
from app.api.dependencies import DBSessionDep
from app.models.user import User
from app.domain.repository import GenericRepository
from app.api.responses import StandardResponse, create_success_response

router = APIRouter()


@router.get("/", response_model=StandardResponse, summary="Get all users")
async def get_users(db: DBSessionDep, skip: int = 0, limit: int = 100):
    repo = GenericRepository(User, db)
    users = await repo.get_all(skip=skip, limit=limit)
    return create_success_response(
        data=[
            {"id": str(u.id), "email": u.email, "full_name": u.full_name} for u in users
        ]
    )


@router.post("/", response_model=StandardResponse, summary="Create a user")
async def create_user(db: DBSessionDep, email: str, full_name: str):
    repo = GenericRepository(User, db)
    # Note: In a real scenario, hash the password and use proper schemas
    new_user = await repo.create({"email": email, "full_name": full_name})
    return create_success_response(
        data={"id": str(new_user.id), "email": new_user.email},
        message="User created successfully",
    )
