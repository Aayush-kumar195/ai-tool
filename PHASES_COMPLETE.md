# JARVIS — Phase Completion Map

## Preserved existing capabilities

- Existing STELLER/JARVIS dashboard UI and styling
- Voice recognition/speech synthesis
- Camera/emotion/host-recognition layer
- Persistent memory files
- Structured knowledge base
- Autonomous learning configuration
- Existing smart-home dashboard routines
- System telemetry
- Multi-device/mobile companion and authenticated relay foundation

## Gemma 4 E2B brain integration

1. Ollama local provider is available from Consciousness Settings.
2. `gemma4:e2b` is the default model for new local-brain setups.
3. The JARVIS backend can call Ollama through its OpenAI-compatible `/v1/chat/completions` interface.
4. Gemini-style tool schemas are normalized into standard OpenAI-compatible JSON Schema for the local model.
5. Gemma can call existing JARVIS tools for memory, research, metrics, app discovery, and lightweight system operations.
6. Gemma can call `hermes_execute` for complex computer/browser/filesystem/terminal tasks.
7. Hermes remains a separate execution layer; its installed CLI and bridge are not modified as part of the Gemma integration.
8. Hermes results are fed back into the Gemma conversation loop so the final response can reflect the actual execution result.

## Existing Hermes capabilities retained

- Computer-use requests run through Hermes CLI so the `computer_use` toolset is available.
- Browser/filesystem/terminal/web/memory toolsets are enabled per task.
- YouTube requests prefer real UI execution and positive verification instead of only opening search results.
- Windows activity agent tracks foreground app/window, running processes, installed Start Menu apps, and filesystem changes in real time.
- JARVIS exposes live activity state/process/app endpoints.
- JARVIS-managed memory and research actions are preserved.
- Remote desktop liveness/task foundation remains authenticated and local-first.
- Raw `exec-raw` execution remains disabled.

## Environment-dependent verification

Actual Windows UI actions, audio playback, browser login/consent flows, Hermes provider authentication, Ollama inference on the user's hardware, Computer Use readiness, camera permissions/models, and phone OS behavior must be exercised on the target Windows machine. The repository includes deterministic tests plus `scripts/windows-acceptance.ps1` for those target-machine checks.
