# JARVIS — Local Gemma 4 E2B Brain

This build uses **Ollama + Gemma 4 E2B** as JARVIS's local reasoning/conversation layer and binds **Hermes Agent to the same local Ollama endpoint**, so the whole agent path remains local-first.

## Prerequisites

Windows with these already installed:

```powershell
ollama --version
hermes --version
hermes computer-use doctor
```

The Gemma model should already be installed:

```powershell
ollama pull gemma4:e2b
ollama list
```

## Configure Hermes for the local Gemma model

Run after Hermes is installed:

```powershell
npm run hermes:configure
```

This sets Hermes' current model configuration to the local Ollama OpenAI-compatible endpoint and a 128K context target.

## Start JARVIS

From this folder:

```powershell
npm install
npm test
npm start
```

Or use `LAUNCH_JARVIS.bat`. The launcher checks both Ollama/Gemma and Hermes before starting the server.

## Select the local brain

Open **Consciousness Settings** and choose:

`Local Gemma 4 E2B (Ollama Brain)`

The model field should be:

`gemma4:e2b`

No API key is required.

## Architecture

```text
User
  ↓
JARVIS UI
  ↓
JARVIS orchestrator
  ↓
Gemma 4 E2B (Ollama)
  ├── normal conversation
  ├── reasoning
  ├── memory/research tools
  └── computer task delegation
            ↓
      Hermes Agent
            ↓
 Windows computer_use / browser / filesystem / terminal
```

For complex computer tasks, Gemma can call the `hermes_execute` tool. The result is returned to Gemma so JARVIS can report what actually happened instead of assuming success.

## Useful checks

```powershell
node tools/ollama-check.js
Invoke-RestMethod http://127.0.0.1:3000/api/ollama/status
Invoke-RestMethod http://127.0.0.1:3000/api/hermes/status
```

## Important

This package does not include your API keys. Legacy cloud providers remain optional.
