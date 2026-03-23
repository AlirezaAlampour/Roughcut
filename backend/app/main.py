from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import init_db
from app.routers import downloads, health, jobs, presets, projects, settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    config = get_settings()
    config.ensure_directories()
    init_db()
    yield


config = get_settings()
app = FastAPI(
    title=config.app_name,
    version=config.version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix=config.api_prefix)
app.include_router(projects.router, prefix=config.api_prefix)
app.include_router(jobs.router, prefix=config.api_prefix)
app.include_router(settings.router, prefix=config.api_prefix)
app.include_router(presets.router, prefix=config.api_prefix)
app.include_router(downloads.router)

