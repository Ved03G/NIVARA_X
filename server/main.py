"""PrivacyShield FastAPI server."""
from __future__ import annotations
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from schemas import AgentContextRequest, AgentResponse
from agent import reason

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("PrivacyShield server starting")
    yield
    logger.info("PrivacyShield server stopping")


app = FastAPI(
    title="PrivacyShield Agent Server",
    version="0.1.0",
    description="Redaction-aware VLM reasoning for privacy-preserving browser agents",
    lifespan=lifespan,
)

# Allow requests from Chrome extension (chrome-extension://...)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Tighten to specific extension origin for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@app.post("/api/agent/context", response_model=AgentResponse)
async def agent_context(req: AgentContextRequest) -> AgentResponse:
    """
    Main endpoint — receives sanitized page context, returns structured actions.

    SECURITY CONTRACT:
    - Request MUST contain only sanitized data (tokens, not real values)
    - Response MUST contain only structured actions (no arbitrary JS)
    - Raw PII must NOT appear in either direction
    """
    start = time.perf_counter()

    logger.info(
        f"Agent request | task='{req.task[:80]}' | elements={len(req.elements)} "
        f"| pii_tokens={len(req.redaction_contract)} | url={req.page_url}"
    )

    if len(req.elements) == 0:
        return AgentResponse(
            actions=[],
            reasoning="No interactive elements found on page.",
            task_complete=False,
        )

    try:
        response = await reason(req)
    except Exception as e:
        logger.error(f"Reasoning failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    elapsed = (time.perf_counter() - start) * 1000
    logger.info(
        f"Agent response | actions={len(response.actions)} "
        f"| complete={response.task_complete} | latency={elapsed:.0f}ms"
    )

    return response
