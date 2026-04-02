"""
main.py — pi-monitor FastAPI application

Runs on the Raspberry Pi at 127.0.0.1:8080
Exposed to the internet via cloudflared tunnel → api-pi.andrewbaker.ninja
Protected by Cloudflare Access (Google SSO)
"""

from contextlib import asynccontextmanager
import logging
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

import db as database
import seed as seeder
import scheduler
from routes import stats, devices, traffic, rules, schedules, settings
from config import BIND_HOST, BIND_PORT

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting pi-monitor API...")
    await database.init_app_db()
    await seeder.seed()
    sched = scheduler.start_scheduler()
    log.info("Ready on %s:%s", BIND_HOST, BIND_PORT)
    yield
    sched.shutdown()
    log.info("Shutdown complete")


app = FastAPI(title="pi-monitor", lifespan=lifespan)

# CORS — Cloudflare Pages origin + localhost for dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://pi.andrewbaker.ninja",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def no_cache(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return response

app.include_router(stats.router,     prefix="/api")
app.include_router(devices.router,   prefix="/api")
app.include_router(traffic.router,   prefix="/api")
app.include_router(rules.router,     prefix="/api")
app.include_router(schedules.router, prefix="/api")
app.include_router(settings.router,  prefix="/api")


if __name__ == "__main__":
    uvicorn.run("main:app", host=BIND_HOST, port=BIND_PORT, reload=False)
