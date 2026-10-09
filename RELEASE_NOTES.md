# Release Notes — Local Gemma Brain Build

## 1.2.0 — Hermes/Gemma hardening

- Bound Hermes to the same local Ollama/Gemma 4 E2B model path instead of leaving Hermes' provider implicit.
- Added `npm run hermes:configure` for repeatable Windows configuration using Hermes' current `config set` interface.
- Hermes runtime diagnostics now verify model/provider/base URL/context and prefer `computer-use doctor --json`.
- Local mode rejects accidental cloud-provider/model overrides.
- Replaced false-success provider tool-loop fallbacks with explicit bounded-limit failures.
- Launcher no longer kills arbitrary processes occupying port 3000.
- `/api/chat` now returns completion/verification metadata rather than always implying success.

## 1.1.0

- Added Local Gemma 4 E2B provider through Ollama.
- Added local Ollama health/model status endpoint.
- Added `hermes_execute` as a JARVIS tool so the local Gemma brain can delegate complex computer work to the existing Hermes Agent installation.
- Preserved the existing Hermes bridge and computer-use implementation.
- Added local Ollama setup/check documentation.
- Launcher now checks Ollama + Gemma before starting JARVIS.
- No API keys are bundled in the frontend.

### Verification boundary

The source package is syntax/static-tested in the build environment. Actual Ollama inference and Windows Computer Use must be verified on the user's Windows machine because the packaging environment cannot operate that desktop.

## V15 hardening

- Hermes local mode is now explicitly bound to the local Ollama `gemma4:e2b` model through Hermes configuration checks.
- Hermes runtime diagnostics prefer `computer-use doctor --json` and expose the actual model/provider/base URL/context state.
- Provider tool-call loops are bounded by `JARVIS_TOOL_MAX_LOOPS` and never report fabricated success when the safety limit is reached.
- The Windows launcher no longer kills arbitrary processes occupying port 3000.
- Deterministic tests now cover the Hermes local-binding contract.
- Removed the obsolete `model.max_tokens` / `HERMES_MAX_TOKENS` configuration from the JARVIS installer and audit because current Hermes versions no longer read that setting.
- Fixed the remote desktop task endpoint to obtain its Hermes configuration locally (eliminating an undefined-config runtime path) and to report completion honestly.
- Hermes CLI diagnostics now fail when Hermes is installed but not actually configured for the local model.
