# NIVARA-X
**On-Device Visual Intelligence for Privacy-Preserving Browser Agents**  
**SIH 26171 | ISRO**

## 🎥 Demo Video
[**Watch the 5-Minute Demo on YouTube**]:- https://youtu.be/dQw4w9WgXcQ

---

## 🚀 Quick Start Guide for Judges

### 1. Download the Extension
Download the pre-compiled extension ZIP from the [Releases page](https://github.com/Ved03G/NIVARA_X/releases/tag/v1.0.0) or use the `NIVARA-X-Extension.zip` file provided in this repository.

### 2. Install in Chrome
1. Extract `NIVARA-X-Extension.zip` to a folder.
2. Open Chrome and navigate to `chrome://extensions`.
3. Toggle **Developer Mode** ON (top right corner).
4. Click **Load unpacked** (top left).
5. Select the extracted folder. The NIVARA-X extension will appear in your browser.

### 3. Run the Demos
Navigate to the local test pages provided in the `test-pages` directory to test the agent:
- **[Demo A (DOM Privacy)](test-pages/demo-a-dom-form.html)**: Tests structured form redaction.
- **[Demo B (Visual Canvas Privacy)](test-pages/demo-b-canvas-dashboard.html)**: Tests OCR and visual pixel redaction (The Hero Demo).
- **[Demo C (Mixed KYC)](test-pages/demo-c-mixed-page.html)**: Tests Aadhaar and mixed media ID redaction.

*To run the agent on the demo pages, click the NIVARA-X extension icon and enter a task like "Fill my details" or "What sensitive information do you see?".*

---

## 🧠 Architecture Overview

Modern browser agents (like MultiOn or Browser-Use) rely heavily on visual perception, but sending raw screenshots of banking dashboards or KYC forms to remote AI models exposes users to massive privacy risks.

NIVARA-X acts as a **Zero-Trust Privacy Shield**:
1. **On-Device Perception**: Intercepts DOM nodes and visual `<canvas>` pixels entirely locally.
2. **Local Redaction**: Scans for PII (Aadhaar, Account Numbers, Balances) and physically draws black boxes over sensitive visual regions before any screenshot is taken.
3. **Semantic Tokens**: Replaces sensitive text with tokens (e.g., `[ACCOUNT_NUMBER_1]`) so the remote AI can still reason about the page without seeing the actual data.
4. **Privacy Firewall**: A hard failsafe that mathematically blocks outbound network requests if a zero-day bug causes the redaction engine to miss a target.
5. **Local Execution (My Vault)**: When the remote AI issues an action (e.g., "Type [EMAIL_1]"), the local engine retrieves the real data from local storage and executes the action safely.

---

## 📂 Project Structure

```text
NIVARA-X/
├── extension/           # The Chrome Extension source code (TypeScript/Vite)
├── server/              # FastAPI + Ollama routing server (Python)
├── test-pages/          # Local HTML mock banking/KYC websites for demos
├── benchmarks/          # Inference latency and RAM utilization scripts
├── NIVARA-X-Extension.zip # Pre-packaged Chrome extension for easy loading
└── README.md
```

## 🛠️ Developer Setup (Server)

If you wish to run the backend routing server locally:
1. Ensure Python 3.10+ and [Ollama](https://ollama.com/) are installed.
2. Pull the visual model: `ollama pull qwen3-vl:4b`
3. Navigate to `/server` and install dependencies: `pip install -r requirements.txt`
4. Start the server: `uvicorn main:app --host 0.0.0.0 --port 8000`
