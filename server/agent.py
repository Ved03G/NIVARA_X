"""VLM reasoning layer — calls Ollama with a redaction-aware prompt."""
from __future__ import annotations
import json
import logging
from typing import Optional

try:
    from ollama import AsyncClient as OllamaAsyncClient
    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False

from schemas import AgentContextRequest, AgentResponse, BrowserAction

logger = logging.getLogger(__name__)

# ─── Model config ────────────────────────────────────────────────────────────────

DEFAULT_MODEL  = "qwen3-vl:4b"
FALLBACK_MODEL = "qwen3-vl:2b"
OLLAMA_HOST    = "http://localhost:11434"

SYSTEM_PROMPT = """You are PrivacyShield's reasoning engine — a redaction-aware browser agent.

RULES (non-negotiable):
1. You receive ONLY sanitized context. Tokens like [EMAIL_1] represent real values
   you will NEVER see — do NOT try to guess them.
2. Reference elements by their opaque IDs (e.g. el_7f2a), not by text content.
3. Return ONLY a valid JSON object — no markdown fences, no explanation outside JSON.
4. Do NOT generate JavaScript code.
5. Allowed action types: CLICK, TYPE, SELECT, SCROLL, NAVIGATE, WAIT.

RESPONSE FORMAT (strict JSON):
{
  "actions": [
    {"type": "TYPE", "target": "el_xxxx", "value_ref": "[EMAIL_1]"},
    {"type": "CLICK", "target": "el_xxxx"}
  ],
  "reasoning": "one-line explanation",
  "task_complete": false
}

If done: {"actions": [], "reasoning": "Task complete", "task_complete": true}"""


def build_user_prompt(req: AgentContextRequest) -> str:
    elements_str = json.dumps(
        [e.model_dump(exclude_none=True) for e in req.elements], indent=2
    )
    contract_str = json.dumps(
        [t.model_dump() for t in req.redaction_contract], indent=2
    )
    return (
        f"TASK: {req.task}\n\n"
        f"PAGE (origin only): {req.page_url}\n\n"
        f"INTERACTIVE ELEMENTS (sanitized):\n{elements_str}\n\n"
        f"REDACTION CONTRACT:\n{contract_str}\n\n"
        f"Reply with JSON only."
    )


def _stub_response() -> AgentResponse:
    logger.warning("Ollama not available — returning stub")
    return AgentResponse(
        actions=[],
        reasoning="[STUB] Ollama unavailable. Run: ollama pull qwen3-vl:4b",
        task_complete=False,
    )


def parse_vlm_response(raw: str) -> AgentResponse:
    raw = raw.strip()
    # Strip markdown fences if model wrapped in them
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    # Some models wrap in <think>...</think> before JSON — strip it
    if "<think>" in raw:
        raw = raw.split("</think>")[-1].strip()
    data = json.loads(raw)
    actions = [BrowserAction(**a) for a in data.get("actions", [])]
    return AgentResponse(
        actions=actions,
        reasoning=data.get("reasoning"),
        task_complete=data.get("task_complete", False),
    )


async def reason(
    req: AgentContextRequest, model: Optional[str] = None
) -> AgentResponse:
    """Call Ollama asynchronously and return a validated AgentResponse."""
    if not OLLAMA_AVAILABLE:
        return _stub_response()

    model = model or DEFAULT_MODEL
    prompt = build_user_prompt(req)

    # Use AsyncClient so FastAPI's event loop is never blocked
    client = OllamaAsyncClient(host=OLLAMA_HOST)

    try:
        response = await client.chat(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
            options={"temperature": 0.1, "num_predict": 512},
            think=False,   # disable chain-of-thought to reduce latency
        )
        raw: str = response["message"]["content"]
        logger.info("VLM response (first 300): %s", raw[:300])
        return parse_vlm_response(raw)

    except json.JSONDecodeError as e:
        logger.error("VLM returned invalid JSON: %s", e)
        return AgentResponse(
            actions=[], reasoning=f"JSON parse error: {e}", task_complete=False
        )
    except Exception as e:
        logger.error("VLM call failed (%s): %s", model, e)
        if model != FALLBACK_MODEL:
            logger.info("Retrying with fallback model %s", FALLBACK_MODEL)
            return await reason(req, model=FALLBACK_MODEL)
        return AgentResponse(
            actions=[], reasoning=f"VLM error: {e}", task_complete=False
        )
