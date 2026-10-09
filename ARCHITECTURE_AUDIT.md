# JARVIS Capability Audit + Target Architecture

## Preserved existing capabilities

- Futuristic STELLER/JARVIS dashboard and voice UI.
- Web Speech Recognition and speech synthesis.
- AI provider selection and legacy provider compatibility.
- Persistent `memories.json` and structured `knowledge_base.json`.
- Autonomous web-learning queue and scheduling.
- Current news endpoint.
- Camera-based emotion/face analysis with local host enrollment.
- Smart-home dashboard routines and device UI.
- System telemetry.
- Local Windows automation.

The existing knowledge base already records autonomous web research and structured source-backed facts; the auto-learn configuration is also already present. These remain part of the system rather than being discarded.

## Repaired/strengthened areas

- Hermes Agent provider and authenticated local API bridge.
- Generic natural-language local fallback for common app/folder/file/media requests.
- Safe `open_path`, `search_files`, `search_apps`, and YouTube search actions.
- Removal of raw `exec-raw` from the HTTP automation surface.
- Local-first CORS policy and loopback binding by default.
- Frontend secret cleanup: no hardcoded provider API keys in this build.
- Device registry file and local activity timeline.
- Foreground-window activity sampling on Windows.
- Return briefing endpoint.
- Health and Hermes status endpoints.
- Launcher path is relative to its own folder instead of a machine-specific absolute path.
- Smoke tests and Hermes diagnostic command.

## Still inherently dependent on environment

These cannot honestly be declared fully verified inside this Linux build environment:

- Actual Windows UI automation through Hermes.
- Actual Windows Store/desktop app launch behavior on the user's machine.
- Browser login/session state and YouTube playback behavior.
- Camera permissions and face-api model downloads.
- Real cloud relay from Render to a physical desktop.
- Native Android/iOS companion applications.
- Secure remote screen streaming.

Those require runtime testing on the target Windows/phone devices.

## Target architecture

```text
JARVIS UI
  -> JARVIS Orchestrator
  -> Hermes Agent
  -> computer_use / browser / filesystem / terminal / web
  -> authorized device

JARVIS retains:
  personality
  voice
  memory
  knowledge
  identity
  activity intelligence
  notifications
  device registry

Hermes provides:
  planning
  tool selection
  computer control
  browser automation
  filesystem/terminal operations
  agentic multi-step execution
```
