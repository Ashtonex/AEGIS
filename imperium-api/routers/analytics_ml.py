from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import List, Optional
from core.security import get_current_user
from core.analytics_ml import ml_engine

router = APIRouter()


class TaskInput(BaseModel):
    name: str = Field(min_length=1)
    a: float = Field(gt=0, description="Optimistic duration in weeks")
    m: float = Field(gt=0, description="Most likely duration in weeks")
    b: float = Field(gt=0, description="Pessimistic duration in weeks")


class ScheduleSimulationPayload(BaseModel):
    tasks: List[TaskInput]
    iterations: Optional[int] = Field(default=1000, ge=10, le=100000)


class PricePoint(BaseModel):
    date: str
    price: float = Field(ge=0)


class PriceForecastPayload(BaseModel):
    history: List[PricePoint]
    forecast_steps: Optional[int] = Field(default=3, ge=1, le=12)


@router.post("/simulate-schedule")
async def simulate_schedule(
    payload: ScheduleSimulationPayload, user: dict = Depends(get_current_user)
):
    """
    Exposes the Monte Carlo scheduling simulator to project managers and executives.
    """
    tasks_list = [t.model_dump() for t in payload.tasks]
    result = ml_engine.run_monte_carlo_schedule(tasks_list, payload.iterations)

    if not result.get("success", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("error", "Simulation failed."),
        )

    return result


@router.post("/forecast-material-rate")
async def forecast_material_rate(
    payload: PriceForecastPayload, user: dict = Depends(get_current_user)
):
    """
    Exposes price forecasting regression models to estimators and estimators.
    """
    history_list = [p.model_dump() for p in payload.history]
    result = ml_engine.forecast_rate_trend(history_list, payload.forecast_steps)

    if not result.get("success", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("error", "Forecasting failed."),
        )

    return result
