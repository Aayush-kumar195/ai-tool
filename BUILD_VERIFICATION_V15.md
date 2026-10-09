# JARVIS V15 — Build Verification

## Baseline
- Started from the supplied JARVIS_GEMMA4_HERMES_BUILD_V14 archive.
- No full-project rewrite. Existing JARVIS/Hermes/Windows-agent architecture was preserved.

## Implemented hardening
- Hermes local Ollama execution is pinned to a 64K request context to satisfy the agentic minimum while avoiding an unnecessarily large default local KV-cache footprint.
- Hermes is explicitly bound to the local Ollama-compatible Gemma 4 E2B endpoint through Hermes configuration.
- Hermes runtime diagnostics verify actual model/provider/base URL/context/ollama_num_ctx and prefer `computer-use doctor --json`.
- Local-only mode clears Hermes' primary fallback chain unless `HERMES_ALLOW_CLOUD_FALLBACK=true`.
- Provider tool-call loops are bounded by `JARVIS_TOOL_MAX_LOOPS`; the old fabricated-success response was removed.
- Remote desktop task endpoint now obtains its Hermes configuration correctly and reports completion honestly.
- Project-root static serving was removed; only explicit frontend assets are exposed.
- Launcher no longer kills arbitrary processes using port 3000.
- Added a dedicated final Windows audit script.
- Added deterministic tests for the local Hermes binding contract and remote desktop task path.

## Deterministic verification completed in the build environment
- Node syntax checks: PASS
- `npm test`: PASS
- Hermes local-binding regression test: PASS
- Hermes CLI/integration harness: PASS (side-effect isolated)
- Windows action harness: PASS (simulated)
- Project-root static-exposure regression checks: PASS

## Runtime verification boundary
The build environment does not have the user's Windows desktop, Ollama daemon, or Hermes installation available. The supplied Windows audit script is therefore the authoritative final step on the target PC; it verifies real Ollama/Hermes configuration and runs the actual Computer Use doctor.
