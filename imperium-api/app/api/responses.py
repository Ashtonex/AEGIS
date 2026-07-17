from typing import Any, Generic, TypeVar, Optional
from pydantic import BaseModel

T = TypeVar("T")


class StandardResponse(BaseModel, Generic[T]):
    success: bool
    data: Optional[T] = None
    message: str = ""
    meta: Optional[dict[str, Any]] = None


class ErrorDetail(BaseModel):
    code: str
    detail: str


class ErrorResponse(BaseModel):
    success: bool = False
    error: ErrorDetail


def create_success_response(
    data: T = None, message: str = "", meta: dict = None
) -> StandardResponse[T]:
    return StandardResponse(success=True, data=data, message=message, meta=meta)


def create_error_response(code: str, detail: str) -> ErrorResponse:
    return ErrorResponse(error=ErrorDetail(code=code, detail=detail))
