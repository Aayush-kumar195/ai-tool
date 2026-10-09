# JARVIS V16 — Render Cloud + Windows Local AI

- Added Render Blueprint for a Node/Express web service.
- Added explicit `JARVIS_CLOUD_MODE`.
- Cloud mode binds to `0.0.0.0` and Render's `PORT`.
- Added dedicated `JARVIS_WEB_TOKEN` browser/API authentication.
- Kept a separate `JARVIS_RELAY_TOKEN` for the Windows desktop relay.
- Cloud chat/tasks/actions now route to the connected Windows desktop rather than attempting to run Ollama/Hermes inside Render.
- Cloud screenshot requests now use the desktop relay.
- Hermes/Ollama status endpoints report relay-backed readiness honestly.
- Desktop relay now returns actual Hermes completion status, session id, tool use, and error data instead of unconditional success.
- Added configurable `JARVIS_DATA_DIR` so a later persistent-storage deployment can move state cleanly.
- Local mode behavior remains the default when `JARVIS_CLOUD_MODE=false`.
- No raw shell endpoint was reintroduced.
