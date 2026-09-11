"""Pydantic schemas for the PrivacyShield API.

The extension sends camelCase JSON (TypeScript convention).
All models use alias_generator=to_camel so both snake_case and
camelCase field names are accepted.
"""
from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel, ConfigDict, field_validator
from pydantic.alias_generators import to_camel


def _camel_config() -> ConfigDict:
    return ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ─── Allowed action types (strict enum — no arbitrary JS) ──────────────────────

class ActionType(str, Enum):
    CLICK    = "CLICK"
    TYPE     = "TYPE"
    SELECT   = "SELECT"
    SCROLL   = "SCROLL"
    NAVIGATE = "NAVIGATE"
    WAIT     = "WAIT"


class BrowserAction(BaseModel):
    model_config = _camel_config()

    type:      ActionType
    target:    Optional[str] = None   # opaque element ID (el_7f2a)
    value_ref: Optional[str] = None   # token like [EMAIL_1] — never actual value
    value:     Optional[str] = None   # for SELECT
    direction: Optional[str] = None   # for SCROLL: UP | DOWN
    amount:    Optional[int] = None   # for SCROLL px
    url:       Optional[str] = None   # for NAVIGATE
    ms:        Optional[int] = None   # for WAIT

    @field_validator('url')
    @classmethod
    def url_must_be_http(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            if v.startswith('javascript:'):
                raise ValueError('JavaScript URLs are forbidden')
            if not v.startswith(('http://', 'https://')):
                raise ValueError('URL must be http or https')
        return v


# ─── Redaction contract ─────────────────────────────────────────────────────────

class RedactionToken(BaseModel):
    model_config = _camel_config()

    token:          str            # e.g. [EMAIL_1]
    category:       str            # EMAIL | PHONE | PASSWORD | …
    element_id:     str            # opaque: el_7f2a
    server_may:     list[str]
    server_may_not: list[str]


# ─── Sanitized element ──────────────────────────────────────────────────────────

class ElementRect(BaseModel):
    model_config = _camel_config()
    x: int; y: int; width: int; height: int


class SanitizedElement(BaseModel):
    model_config = _camel_config()

    id:          str
    role:        str
    type:        Optional[str]  = None
    text:        Optional[str]  = None
    aria_label:  Optional[str]  = None
    placeholder: Optional[str]  = None
    disabled:    bool           = False
    visible:     bool           = True
    rect:        Optional[ElementRect] = None


# ─── Request (extension → server) ──────────────────────────────────────────────

class AgentContextRequest(BaseModel):
    model_config = _camel_config()

    task:               str
    elements:           list[SanitizedElement]
    redaction_contract: list[RedactionToken]
    screenshot_b64:     Optional[str] = None
    page_url:           str
    timestamp:          int


# ─── Response (server → extension) ─────────────────────────────────────────────

class AgentResponse(BaseModel):
    model_config = _camel_config()

    actions:       list[BrowserAction]
    reasoning:     Optional[str] = None
    task_complete: bool          = False
