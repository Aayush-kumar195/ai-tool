# JARVIS V16 — Build Verification

## Baseline

- Started from the supplied `JARVIS_GEMMA4_HERMES_BUILD_V15.zip`.
- Existing JARVIS/Hermes/Windows-agent architecture was preserved.
- No full-project rewrite.

## V16 cloud-mode hardening

- Added Render `render.yaml` using platform `PORT` and cloud host `0.0.0.0`.
- Added separate web and desktop-relay bearer tokens.
- Kept relay heartbeat/poll/result-write endpoints relay-only.
- Allowed authenticated web clients to inspect devices, enqueue relay tasks, and read results without exposing the relay secret.
- Stored actual Hermes runtime readiness in the Windows relay heartbeat.
- Cloud Hermes/Ollama status now reports the actual relay-reported readiness instead of assuming that an online desktop is equivalent to Computer Use readiness.
- Cloud desktop status uses the actual Hermes Computer Use readiness bit.
- Cloud telemetry avoids Windows-only PowerShell disk probing on Render.
- Added fast failure when the target desktop relay is offline.
- Preserved the no-`exec-raw` security boundary.
- Bumped package version to `1.3.0`.
- Pinned Render/Node runtime to `22.22.0` with a bounded package engine range.

## Automated verification

The final V16 package was checked with:

```text
node tests/cloud-relay.test.js
npm test
node tests/hermes-e2e.test.js
```

Expected result: all commands exit with code `0`.

The test suite is deterministic/side-effect isolated. It does not prove that the target Windows machine has the real Hermes Computer Use runtime, Ollama service, or `gemma4:e2b` model running. Those must be verified on the user's Windows machine.

## Target-machine verification

After deployment, run on Windows:

```powershell
npm install
npm run ollama:check
npm run hermes:configure
npm run hermes:check
node scripts/desktop-relay-agent.js
```

Then verify the Render `/api/health` endpoint and the JARVIS UI's Hermes/Ollama status. A real desktop task should be tested before claiming the cloud deployment is production-ready.
