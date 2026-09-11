// ─── Browser Actions (what the server returns, what the executor runs) ─────────

export type BrowserAction =
  | { type: 'CLICK'; target: string }
  | { type: 'TYPE'; target: string; valueRef: string }
  | { type: 'SELECT'; target: string; value: string }
  | { type: 'SCROLL'; direction: 'UP' | 'DOWN'; amount?: number }
  | { type: 'NAVIGATE'; url: string }
  | { type: 'WAIT'; ms: number };

export type AllowedActionType = BrowserAction['type'];

export const ALLOWED_ACTIONS: AllowedActionType[] = [
  'CLICK', 'TYPE', 'SELECT', 'SCROLL', 'NAVIGATE', 'WAIT',
];

// ─── PII / Redaction ──────────────────────────────────────────────────────────

export type PIICategory =
  | 'EMAIL'
  | 'PHONE'
  | 'PASSWORD'
  | 'PERSON'
  | 'ADDRESS'
  | 'CREDIT_CARD'
  | 'BANK_ACCOUNT'
  | 'GOVERNMENT_ID'
  | 'DATE_OF_BIRTH'
  | 'FACE'
  | 'FINANCIAL_DATA'
  | 'AUTH_TOKEN';

export interface PIIDetection {
  category: PIICategory;
  confidence: number;       // 0–1
  source: 'dom' | 'regex' | 'ocr' | 'vision' | 'ner';
  elementId: string;        // opaque ID
  value?: string;           // original value (never sent to server)
}

export interface RedactionToken {
  token: string;            // e.g. "[EMAIL_1]"
  category: PIICategory;
  elementId: string;
  serverMay: string[];
  serverMayNot: string[];
}

// ─── Element Mapping ─────────────────────────────────────────────────────────

export interface MappedElement {
  id: string;               // opaque: el_7f2a
  role: string;             // button / textbox / link / etc.
  type?: string;            // input type attr
  text?: string;            // safe: only kept if not PII
  ariaLabel?: string;
  placeholder?: string;
  disabled: boolean;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

// ─── Sanitized Context (what is sent to server) ───────────────────────────────

export interface SanitizedContext {
  task: string;
  elements: MappedElement[];
  redactionContract: RedactionToken[];
  screenshotB64?: string;   // after redaction/blurring
  pageUrl: string;          // domain only — no path params
  timestamp: number;
}

// ─── Server Response ──────────────────────────────────────────────────────────

export interface AgentResponse {
  actions: BrowserAction[];
  reasoning?: string;       // for debug display
  taskComplete: boolean;
}

// ─── Messages (Content Script ↔ Service Worker) ───────────────────────────────

export type ContentToSWMessage =
  | { type: 'AGENT_START'; task: string }
  | { type: 'PAGE_CONTEXT'; context: SanitizedContext }
  | { type: 'ACTION_RESULT'; actionId: string; success: boolean; error?: string };

export type SWToContentMessage =
  | { type: 'OBSERVE' }
  | { type: 'EXECUTE_ACTION'; action: BrowserAction; actionId: string }
  | { type: 'AGENT_DONE'; success: boolean; message?: string };

// ─── Popup ↔ Service Worker ───────────────────────────────────────────────────

export type PopupToSWMessage =
  | { type: 'RUN_AGENT'; task: string }
  | { type: 'GET_STATUS' };

export type SWToPopupMessage =
  | { type: 'STATUS_UPDATE'; status: AgentStatus };

export interface AgentStatus {
  running: boolean;
  step: string;
  piiDetected: number;
  piiRedacted: number;
  rawPIISent: number;
  lastAction?: string;
  error?: string;
}

// ─── Risk tiers ───────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export const ACTION_RISK: Record<AllowedActionType, RiskLevel> = {
  CLICK: 'LOW',
  SELECT: 'LOW',
  SCROLL: 'LOW',
  WAIT: 'LOW',
  TYPE: 'MEDIUM',
  NAVIGATE: 'MEDIUM',
};
