# JARVIS — Gemma 4 E2B + Hermes Build

This release preserves the existing STELLER/JARVIS interface and established features while hardening the local **Gemma 4 E2B reasoning brain through Ollama** and binding **Hermes Agent** to that same local model as the Windows execution layer. Hermes itself remains an external dependency and is not modified by this JARVIS integration.

## Included

- Existing JARVIS/STELLER UI and styling
- Voice recognition and speech synthesis
- AI provider settings and legacy provider compatibility
- Camera / emotion / host-recognition layer
- Persistent memory and structured knowledge base
- Autonomous web-learning queue and current-news support
- Smart-home dashboard routines and telemetry
- Local Gemma 4 E2B brain through Ollama
- OpenAI-compatible Ollama adapter with normalized tool schemas
- `hermes_execute` tool for Gemma-to-Hermes computer delegation
- Hermes CLI bridge with Computer Use, browser, file, terminal, web, memory, skills, and session-search toolsets
- Natural-language app/folder/file/browser/media execution
- Verified YouTube playback path
- Real-time Windows foreground/process/installed-app/filesystem awareness
- Activity timeline and return briefing
- Hermes diagnostics and Windows setup/repair scripts
- Render cloud-relay deployment with an outbound Windows desktop agent
- Secure local/cloud defaults, separate web/relay tokens, and removal of raw `exec-raw`
- Windows acceptance matrix

## Quick start

Make sure Ollama and the model are already installed:

```powershell
ollama --version
ollama list
# If Gemma is missing: ollama pull gemma4:e2b
```

Then start JARVIS:

```powershell
npm install
npm test
npm start
```

Or double-click `LAUNCH_JARVIS.bat`. The launcher checks Node.js, the local Gemma brain, and Hermes Computer Use before opening the interface.

## First use

1. Open **Consciousness Settings**.
2. Select **Local Gemma 4 E2B (Ollama Brain)**.
3. Keep the model as `gemma4:e2b`.
4. Leave the AI bridge enabled and save.
5. Test a normal conversation first.
6. Then test a simple computer action such as `Open Calculator`.
7. Finally test a multi-step action such as `Open Chrome and search for FastAPI`.

No API key is required for the Ollama provider.

## Architecture

```text
User
  ↓
JARVIS UI
  ↓
JARVIS backend / orchestrator
  ↓
Gemma 4 E2B (Ollama)
  ├── conversation / reasoning
  ├── memory / research / system tools
  └── hermes_execute
             ↓
        Hermes Agent CLI
        (bound to local Ollama/Gemma)
             ↓
computer_use / browser / filesystem / terminal / web / memory / skills / session-search
             ↓
authorized Windows desktop
```

JARVIS keeps the personal-AI layer: personality, conversation, voice, memory, knowledge, identity, activity intelligence, notifications, devices, and UI.

Gemma is the local reasoning brain. Hermes is the agentic execution layer for desktop control and multi-step computer work, and the V15 configuration explicitly binds Hermes to the local Ollama endpoint by default. The Hermes installation itself is not changed by this package.

## Tests

The deterministic local regression suite can be run with:

```powershell
npm test
```

It covers project/static contracts, Ollama integration plumbing, the simulated Gemma → tool-call → Hermes → final-response chain, Hermes bridge behavior, activity contracts, Windows-action simulations, route loading, smoke behavior, YouTube recovery, and relay plumbing.

Run the target-machine acceptance suite on Windows with:

```powershell
npm run acceptance:windows
```

For actual YouTube playback:

```powershell
npm run acceptance:windows -- -RunYouTubeTest -YouTubeQuery "your song or video"
```

The packaging environment cannot perform real Windows UI Automation, browser interaction, audio playback, camera access, or phone OS behavior. Those remain target-machine checks.

## Useful diagnostics

```powershell
node tools/ollama-check.js
node tools/hermes-check.js
Invoke-RestMethod http://127.0.0.1:3000/api/ollama/status
```

## Security

The package does not include provider secrets or `node_modules`. JARVIS binds to loopback by default and does not expose the legacy raw `exec-raw` action.

## Final Windows verification

After Ollama and Hermes are installed/configured, run `npm run hermes:configure` and then `powershell -ExecutionPolicy Bypass -File .\scripts\jarvis-final-audit.ps1` to re-run the deterministic suite plus Windows-specific local-model and Computer Use checks. Current Hermes uses `config.yaml` as the source of truth for the model/provider/base URL; the JARVIS env file is the desired-state input for its repeatable configuration script.

## V16 Render deployment: cloud JARVIS + local Windows AI

V16 also supports a cloud-relay mode for a public Render deployment. In this mode:

```text
Browser
  ↓
Render JARVIS Cloud
  ↓ authenticated outbound relay
Windows Desktop Relay
  ├─ Hermes Agent
  ├─ Ollama
  └─ Gemma 4 E2B
       ↓
  Computer Use / Browser / Files / Windows
```

The Render service does **not** run Ollama, Gemma, or Computer Use. Those remain on the Windows machine because they require the local desktop session. The Windows relay makes outbound authenticated requests to Render, so no inbound connection to the Windows PC is required.

For deployment use the included `render.yaml` and follow `RENDER_DEPLOYMENT_V16.md`. Render provides the service `PORT`, and V16 cloud mode binds to `0.0.0.0`. On Windows, the relay agent reads the project-root `.env`; `scripts/LAUNCH_DESKTOP_RELAY.bat` starts it without requiring the local JARVIS web server. The browser uses a generated `JARVIS_WEB_TOKEN`; the desktop relay uses a separate generated `JARVIS_RELAY_TOKEN`.

The default V16 relay queue is intentionally in-memory for a single-instance personal MVP. A restart/redeploy can discard queued tasks and transient results. Durable memory and a restart-safe queue should be moved to Render Postgres or another durable store before treating the deployment as production infrastructure.
