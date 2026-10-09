# JARVIS + Hermes Setup (Windows Native)

This build keeps the existing JARVIS/STELLER UI and local intelligence features while using the Hermes Agent CLI as the primary local agentic execution layer.

## Why the CLI is used

Hermes' OpenAI-compatible API is useful for chat integrations, but JARVIS needs Windows Computer Use for tasks such as opening applications, interacting with browser UI, and starting YouTube playback. The JARVIS bridge therefore invokes `hermes chat` with the `computer_use` toolset directly on the Windows machine instead of depending on the API-server toolset.

Hermes currently supports native Windows 10/11 installation, and its CLI supports one-shot queries, query files, selected toolsets, and structured `stream-json` output.

## 1. Install Hermes

From a new PowerShell window:

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

Or let JARVIS do it from the extracted project:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-hermes.ps1
```

Then open a NEW PowerShell/Windows Terminal window and run:

```powershell
hermes --version
hermes computer-use status
hermes computer-use doctor
```

Hermes' current Windows guide documents `%LOCALAPPDATA%\hermes\bin\hermes.exe` and the Computer Use diagnostic commands.

## 2. Bind Hermes to the local Gemma brain

JARVIS now uses **Hermes + Ollama + Gemma 4 E2B** as the default local agent path. Hermes' current configuration stores the model/provider/base URL in `~/.hermes/config.yaml`; legacy `HERMES_MODEL` environment settings are not the source of truth.

Run:

```powershell
npm run hermes:configure
```

This configures:

```text
model.default        = gemma4:e2b
model.provider       = custom
model.base_url       = http://127.0.0.1:11434/v1
model.context_length = 65536
model.ollama_num_ctx  = 65536
```

The script backs up an existing Hermes config before changing it. If your Hermes configuration is administrator-managed, do not force an override; update the managed configuration instead.

The current Gemma 4 E2B Ollama listing reports a 128K maximum context window and native function-calling support. JARVIS intentionally pins the active Hermes/Ollama request context to 64K by default for a safer memory/VRAM profile, while retaining Hermes' minimum agentic context requirement. Hermes' local-provider documentation supports Ollama through an OpenAI-compatible endpoint. JARVIS does not rely on the obsolete `model.max_tokens` setting; current Hermes versions use the model/server output defaults for custom endpoints.

The CLI bridge uses `hermes chat --oneshot --query-file ... --toolsets ... --format stream-json`, which is the documented programmatic invocation pattern.

## 3. Install JARVIS dependencies

```powershell
npm install
```

## 4. Start JARVIS

```powershell
npm start
```

Or use:

```text
LAUNCH_JARVIS.bat
```

The launcher:

1. checks Node.js
2. installs JARVIS dependencies when missing
3. installs/repairs Hermes when needed
4. verifies Computer Use
5. starts the JARVIS server
6. waits for `/api/health`
7. opens the browser

A Hermes gateway is NOT required for the local Computer Use path in this build.

The JARVIS bridge refuses to silently fall back to another Hermes provider when local mode is enabled. It verifies the configured model, provider, base URL and context length before executing an agent task.

## 5. Run diagnostics

```powershell
npm run hermes:check
npm run ollama:check
npm test
npm run doctor
```

`hermes:check` now reports whether Hermes is actually bound to the expected local Ollama model instead of treating an installed executable as proof of configuration. Computer Use readiness is based on the structured `hermes computer-use doctor --json` result when the installed Hermes version supports it.

Also available:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-doctor.ps1
```

## 6. Important Computer Use / YouTube behavior

For:

```text
Play <song> on YouTube
Play <video> on YouTube
```

JARVIS first asks Hermes to use the browser/desktop UI, select the best result, start playback, and verify that the player is actually playing. Opening a YouTube search page alone is NOT considered success.

Hermes' browser toolset provides interactive navigation/click/type/scroll operations, while `computer_use` controls the native desktop.

A video can still be blocked by site consent, sign-in, region availability, autoplay policy, or a temporary browser/site error. JARVIS reports that concrete blocker instead of pretending playback succeeded.

## 7. Live activity monitoring

The Windows activity agent continuously tracks:

- foreground application/window
- running processes
- installed Start Menu applications
- filesystem changes in Desktop, Documents, Downloads, Pictures, Videos, Music, and OneDrive where those folders exist

Useful endpoints:

```text
GET /api/activity/state
GET /api/activity/processes
GET /api/activity/installed-apps
GET /api/activity/summary
GET /api/briefing
```

This is event-driven for filesystem changes plus periodic process/foreground snapshots; it does not continuously crawl the entire disk.

## 8. Security

Keep JARVIS bound to `127.0.0.1` unless you deliberately add an authenticated relay.

Do not expose raw shell execution publicly.

Do not put AI credentials in frontend source.

Review and approve destructive/external actions.

Rotate credentials that were ever exposed by older JARVIS builds.

## Security boundary

JARVIS binds to 127.0.0.1 by default. Powerful computer-control, chat, filesystem, memory, activity, and remote-desktop endpoints reject non-loopback requests unless they use the authenticated desktop relay token. Do not expose port 3000 directly to the internet.


### Windows command shim compatibility
The JARVIS bridge resolves the official Windows Hermes `hermes.cmd`/`hermes.bat` shim as well as a native executable, and invokes CMD/BAT shims through the Windows shell because Node child_process does not treat them as native executables.

### Local-only fallback policy

JARVIS defaults to `HERMES_ALLOW_CLOUD_FALLBACK=false`. The configuration script clears Hermes' primary `fallback_providers` chain so an existing OpenRouter/Anthropic/etc. fallback cannot silently turn the local assistant into a paid cloud assistant. Hermes documents the primary fallback chain as `fallback_providers` in `config.yaml`; it is managed with `hermes fallback ...`.

Set `HERMES_ALLOW_CLOUD_FALLBACK=true` only when you deliberately want a cloud fallback and have configured the provider yourself.
