# JARVIS Gemma 4 E2B Build Verification

## Build scope

This build was created from the latest available JARVIS/Hermes build and adds a local Gemma 4 E2B brain through Ollama while preserving the existing Hermes bridge, desktop activity system, UI, memory, research, and mobile/relay foundations.

## Build-side verification completed

JavaScript syntax checks passed for the modified runtime/test files. The complete deterministic `npm test` suite completed with exit code 0 in the packaging environment.

The suite covered:

- project/static/DOM/config contracts
- local Ollama provider wiring
- Ollama model status endpoint contract
- OpenAI-compatible Ollama adapter routing
- lowercase JSON Schema normalization for tool calls
- simulated Gemma tool call → `hermes_execute` → Hermes result → final response
- Hermes bridge classification and command-shim resolution
- Hermes one-shot task/result harness
- YouTube playback verification and recovery path
- Windows-action simulation and command-safety checks
- Windows activity-agent contract
- server route load/smoke behavior
- authenticated relay plumbing

## Important runtime boundary

The packaging environment is Linux and cannot truthfully perform native Windows UI Automation, real browser interaction, actual audio playback, camera access, or the user's local Ollama/Hermes runtime. Therefore this build is **not** claimed to have passed real laptop end-to-end acceptance.

On the target Windows laptop, run:

```powershell
npm install
node tools/ollama-check.js
node tools/hermes-check.js
npm run acceptance:windows
```

Then select `Local Gemma 4 E2B (Ollama Brain)` in Consciousness Settings and perform the conversational and computer-use checks.
