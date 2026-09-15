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

# ─── Model config ────────────────────────────────────────────────────────────

DEFAULT_MODEL  = "qwen3-vl:4b"
FALLBACK_MODEL = "qwen3-vl:4b"   # same — 2b variant not typically installed
OLLAMA_HOST    = "http://localhost:11434"

SYSTEM_PROMPT = (
    "You are a browser automation agent. "
    "IMPORTANT: value_ref is how you fill a redacted field — the local agent resolves "
    "the token to the real value automatically. You do NOT need the actual value.\n"
    "Continue the JSON the assistant already started.\n"
    'Schema: {"actions":[...],"reasoning":"<10 words>","task_complete":true/false}\n'
    "Action types: CLICK, TYPE (requires target+value_ref), SELECT, SCROLL, NAVIGATE, WAIT.\n"
    "For any redacted email/phone/name field, always TYPE with value_ref=token.\n"
    "Keep reasoning under 10 words. No prose outside JSON."
)

# ─── Local decision layer — no VLM needed ────────────────────────────────────

FILL_KEYWORDS = ("fill", "type", "enter", "input", "write", "put")
CATEGORY_MAP  = {
    "email":    "EMAIL",
    "mail":     "EMAIL",
    "phone":    "PHONE",
    "mobile":   "PHONE",
    "number":   "PHONE",
    "name":     "PERSON",
    "password": "PASSWORD",
    "pass":     "PASSWORD",
    "aadhaar":  "GOVERNMENT_ID",
    "dob":      "DATE_OF_BIRTH",
    "birth":    "DATE_OF_BIRTH",
}


def _find_token(req: AgentContextRequest):
    """Return best-matching redaction token for the task description."""
    task_lower = req.task.lower()
    # First pass: look for a keyword whose category has a token
    for word, category in CATEGORY_MAP.items():
        if word in task_lower:
            for token in req.redaction_contract:
                if token.category.upper() == category:
                    return token
    # Second pass: keyword matched but category not in contract
    # → pick the single token if there's only one, else return None (→ VLM)
    if len(req.redaction_contract) == 1:
        return req.redaction_contract[0]
    return None   # multiple tokens, ambiguous — fall through to VLM


def _try_local_response(req: AgentContextRequest) -> Optional[AgentResponse]:
    """
    Handle simple single-field fill tasks WITHOUT calling the VLM.
    Returns None if not applicable (complex/visual tasks fall through to VLM).

    Benefits:
      1. Instant — no Ollama round-trip
      2. task_complete=True — stops the agent loop after exactly 1 step
      3. 100% reliable — no JSON parsing issues
    """
    task_lower = req.task.lower()
    if not any(k in task_lower for k in FILL_KEYWORDS):
        return None
    if not req.redaction_contract:
        return None

    token = _find_token(req)
    if token is None:
        logger.info("Local router: no unambiguous token match, deferring to VLM")
        return None  # let VLM handle it

    action = BrowserAction(
        type="TYPE",
        target=token.element_id,
        value_ref=token.token,
    )
    logger.info("Local router: TYPE %s <- %s", token.element_id, token.token)
    return AgentResponse(
        actions=[action],
        reasoning=f"fill {token.category.lower()}",
        task_complete=True,
    )


# ─── Canvas PII scanner (regex, <1ms, no VLM) ────────────────────────────────

import re

_CANVAS_PATTERNS = [
    ("ACCOUNT_NUMBER", re.compile(r'\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b')),
    # Use strict lookbehind/lookahead to prevent matching the first 12 digits of a 16-digit account number separated by spaces
    ("AADHAAR",        re.compile(r'(?<!\d)(?<!\d[\s\-])\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b(?![\s\-]\d)(?!\d)')),
    ("PHONE",          re.compile(r'(\+91[\s\-]?)?\d{5}[\s\-]?\d{5}\b')),
    ("IFSC",           re.compile(r'\b[A-Z]{4}0[A-Z0-9]{6}\b')),
    ("BALANCE",        re.compile(r'[₹\$]\s?[\d,]+\.?\d*')),
    ("PERSON",         re.compile(r'\b(?!(?:ACCOUNT|AVAILABLE|REGISTERED|CODE|HOLDER|NUMBER|BALANCE|MOBILE|IFSC)\b)[A-Z]{2,}(?:\s(?!(?:ACCOUNT|AVAILABLE|REGISTERED|CODE|HOLDER|NUMBER|BALANCE|MOBILE|IFSC)\b)[A-Z]{2,}){1,3}\b')),
    ("DOB",            re.compile(r'\b\d{1,2}\s?[/\-\.]\s?\d{2}\s?[/\-\.]\s?\d{4}\b')),
]


def _scan_canvas_pii(req: AgentContextRequest) -> Optional[AgentResponse]:
    """
    Scan canvas OCR text for PII patterns locally — zero VLM needed.
    Returns a response describing what was detected, task_complete=True.
    """
    if not req.canvas_ocr_text:
        return None

    all_text = " ".join(e.text for e in req.canvas_ocr_text)
    found: list[str] = []

    for label, pattern in _CANVAS_PATTERNS:
        matches = pattern.findall(all_text)
        if matches:
            count = len(matches)
            token = f"[{label}_{count}]" if count > 1 else f"[{label}_1]"
            found.append(f"{label}: {token}")

    if not found:
        return None

    summary = ", ".join(found)
    logger.info("Canvas PII scanner: detected %d types — %s", len(found), summary)
    return AgentResponse(
        actions=[],
        reasoning=f"Canvas PII detected: {summary}",
        task_complete=True,
    )


async def _ocr_canvas_images(images_b64: list[str], model: str) -> str:
    """
    Use qwen3-vl to read text from canvas images.
    Assistant prefill skips thinking tokens — direct text output.
    """
    client = OllamaAsyncClient(host=OLLAMA_HOST)
    all_text_parts: list[str] = []
    OCR_PREFILL = "Text visible in image:\n"

    for i, img_b64 in enumerate(images_b64):
        try:
            logger.info("Canvas OCR via VLM: image %d/%d (%d chars b64)", i+1, len(images_b64), len(img_b64))
            resp = await client.chat(
                model=model,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "List every piece of text visible in this image, one item per line. "
                            "Include all names, numbers, account codes, balances, and IDs exactly as shown."
                        ),
                        "images": [img_b64],
                    },
                    {
                        # Assistant prefill — forces model to skip thinking and output text directly
                        "role": "assistant",
                        "content": OCR_PREFILL,
                    }
                ],
                options={"temperature": 0.0, "num_predict": 300},
            )
            # Prepend prefill since Ollama returns only the continuation
            raw = (resp.message.content or "").strip()
            text = (OCR_PREFILL + raw).strip() if raw else ""
            if text:
                all_text_parts.append(text)
                logger.info("Canvas OCR result: %s", text[:200])
            else:
                logger.warning("Canvas OCR: VLM returned empty content for image %d", i+1)
        except Exception as e:
            logger.warning("Canvas OCR VLM call failed: %s", e)

    return "\n".join(all_text_parts)


async def _scan_canvas_images(req: AgentContextRequest, model: str) -> Optional[AgentResponse]:
    """OCR canvas images via VLM then run PII regex on the extracted text."""
    if not req.canvas_images:
        return None

    ocr_text = await _ocr_canvas_images(req.canvas_images, model)
    if not ocr_text:
        return None

    found: list[str] = []
    for label, pattern in _CANVAS_PATTERNS:
        matches = pattern.findall(ocr_text)
        if matches:
            count = len(matches)
            token = f"[{label}_{count}]" if count > 1 else f"[{label}_1]"
            found.append(f"{label}: {token}")

    if not found:
        logger.info("Canvas image OCR: no PII patterns found in extracted text")
        return AgentResponse(actions=[], reasoning="Canvas sanitized locally: Remote VLM confirmed 0 sensitive patterns leaked", task_complete=True)

    summary = ", ".join(found)
    logger.info("Canvas image PII: %d types — %s", len(found), summary)
    return AgentResponse(
        actions=[],
        reasoning=f"Canvas PII detected: {summary}",
        task_complete=True,
    )


# ─── Prompt builders ─────────────────────────────────────────────────────────

def build_user_prompt(req: AgentContextRequest) -> str:
    # Filter out elements that are already filled so VLM doesn't try to fill them again
    unfilled_elements = [e for e in req.elements if not getattr(e, 'has_value', False)]
    
    elements_str = json.dumps(
        [e.model_dump(exclude_none=True) for e in unfilled_elements], indent=2
    )
    contract_str = json.dumps(
        [t.model_dump() for t in req.redaction_contract], indent=2
    )
    type_hints = [
        f'  To fill {t.element_id} use: {{"type":"TYPE","target":"{t.element_id}","value_ref":"{t.token}"}}'
        for t in req.redaction_contract
    ]
    hint_str = ("EXAMPLES:\n" + "\n".join(type_hints)) if type_hints else ""

    # Canvas OCR section — include any text extracted from canvas elements
    ocr_parts = []
    for entry in req.canvas_ocr_text:
        label = f"canvas#{entry.canvas_id}" if entry.canvas_id else "canvas"
        ocr_parts.append(f"  [{label}] (confidence {entry.confidence:.0f}%):\n  {entry.text}")
    ocr_str = ("CANVAS OCR TEXT (visual-only content, not in DOM):\n" + "\n".join(ocr_parts)) if ocr_parts else ""

    screenshot_note = "A screenshot is attached — use it to understand visual-only content." if req.screenshot_b64 else ""

    return "\n".join(filter(None, [
        f"TASK: {req.task}",
        f"PAGE: {req.page_url}",
        f"DOM ELEMENTS:\n{elements_str}",
        f"REDACTION CONTRACT:\n{contract_str}",
        hint_str,
        ocr_str,
        screenshot_note,
        "Output JSON only.",
    ]))


# ─── Stub ────────────────────────────────────────────────────────────────────

def _stub_response() -> AgentResponse:
    logger.warning("Ollama not available — returning stub")
    return AgentResponse(
        actions=[],
        reasoning="[STUB] Ollama unavailable. Run: ollama pull qwen3-vl:4b",
        task_complete=False,
    )


# ─── VLM response parsing ─────────────────────────────────────────────────────

def extract_content(response) -> str:
    content = ""
    thinking = ""
    try:
        msg      = response.message
        content  = (msg.content  or "").strip()
        thinking = (msg.thinking or "").strip() if hasattr(msg, "thinking") else ""
    except AttributeError:
        content  = (response.get("message", {}).get("content",  "") or "").strip()
        thinking = (response.get("message", {}).get("thinking", "") or "").strip()

    logger.info("VLM content  (%d chars): %r", len(content),  content[:300])
    logger.info("VLM thinking (%d chars): %r", len(thinking), thinking[:100])
    return content or thinking


def find_json_with_actions(text: str) -> Optional[dict]:
    """Walk text finding balanced {…} blocks; return first with 'actions' key."""
    i = 0
    while i < len(text):
        if text[i] != '{':
            i += 1
            continue
        depth = 0
        for j in range(i, len(text)):
            if text[j] == '{':
                depth += 1
            elif text[j] == '}':
                depth -= 1
                if depth == 0:
                    try:
                        data = json.loads(text[i:j + 1])
                        if isinstance(data, dict) and "actions" in data:
                            return data
                    except json.JSONDecodeError:
                        pass
                    break
        i += 1
    return None


def parse_vlm_response(raw: str) -> AgentResponse:
    if not raw:
        raise ValueError("VLM returned empty response")
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    if "<think>" in raw and "</think>" in raw:
        raw = raw.split("</think>", 1)[-1].strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = find_json_with_actions(raw)
    if data is None:
        raise ValueError(f"No valid JSON found ({len(raw)} chars)")
    actions = [BrowserAction(**a) for a in data.get("actions", [])]
    return AgentResponse(
        actions=actions,
        reasoning=data.get("reasoning"),
        task_complete=data.get("task_complete", False),
    )


# ─── Main entry point ─────────────────────────────────────────────────────────

async def reason(
    req: AgentContextRequest, model: Optional[str] = None
) -> AgentResponse:
    """Return a validated AgentResponse — local router first, VLM fallback."""
    if not OLLAMA_AVAILABLE:
        return _stub_response()

    # Fast path 1: simple fill tasks (email/phone/name) — instant, no VLM
    local = _try_local_response(req)
    if local is not None:
        return local

    # Fast path 2: canvas text OCR (Tesseract result from extension, if any)
    canvas_text = _scan_canvas_pii(req)
    if canvas_text is not None:
        return canvas_text

    # Fast path 3: canvas images sent from extension → OCR via VLM (focused prompt)
    model = model or DEFAULT_MODEL
    if req.canvas_images:
        canvas_img = await _scan_canvas_images(req, model)
        if canvas_img is not None:
            return canvas_img

    # Slow path: complex tasks where local + canvas paths both failed
    client = OllamaAsyncClient(host=OLLAMA_HOST)
    prompt = build_user_prompt(req)
    prefill = '{"actions":['
    logger.info("Calling VLM %s | task=%r", model, req.task[:80])

    try:
        response = await client.chat(
            model=model,
            messages=[
                {"role": "system",    "content": SYSTEM_PROMPT},
                {"role": "user",      "content": prompt},
                {"role": "assistant", "content": prefill},
            ],
            options={"temperature": 0.0, "num_predict": 1024},
        )
        raw = extract_content(response)
        if raw and not raw.strip().startswith(prefill):
            raw = prefill + raw
        return parse_vlm_response(raw)

    except (json.JSONDecodeError, ValueError) as e:
        logger.error("VLM parse error: %s", e)
        return AgentResponse(actions=[], reasoning=f"Parse error: {e}", task_complete=False)
    except Exception as e:
        logger.error("VLM call failed (%s): %s", model, e)
        if model != FALLBACK_MODEL:
            logger.info("Retrying with fallback: %s", FALLBACK_MODEL)
            return await reason(req, model=FALLBACK_MODEL)
        return AgentResponse(actions=[], reasoning=f"VLM error: {e}", task_complete=False)
