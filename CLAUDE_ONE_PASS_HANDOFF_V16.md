# JARVIS V16 Handoff

V16 is an extension of V15, not a rewrite.

The architecture is now explicitly split between:

- Render: public UI/API, web-token authentication, relay queue/result handling.
- Windows PC: Ollama + Gemma 4 E2B + Hermes + actual Computer Use/browser/filesystem execution.

Do not move Ollama/Hermes into Render.
Do not remove the relay.
Do not restore raw exec-raw.
Do not treat Hermes installation as proof of desktop readiness.
Do not claim tasks are complete unless the desktop relay reports a successful Hermes exit.

Render-specific environment is defined in `render.yaml`.
Windows relay settings are described in `scripts/desktop-relay.env.example`.
Detailed deployment steps are in `RENDER_DEPLOYMENT_V16.md`.
