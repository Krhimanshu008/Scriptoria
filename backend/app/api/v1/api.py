from fastapi import APIRouter
from app.api.v1.endpoints import storyboard, foundry

api_router = APIRouter()
api_router.include_router(storyboard.router, prefix="/storyboard", tags=["Storyboard"])
api_router.include_router(foundry.router, prefix="/foundry", tags=["Foundry"])

