# JARVIS V15 — Claude One-Pass Continuation Handoff

Use this file together with the supplied JARVIS repository. This is an EXISTING V15 hardening build, not a blank project.

## Do not rebuild

Preserve the existing JARVIS/STELLER UI, server, Windows activity agent, relay layer, memory/knowledge data, Hermes bridge, and current tests. Patch and extend the existing implementation only.

## Current intended architecture

```text
JARVIS UI
   -> JARVIS backend/orchestrator
      -> local Gemma 4 E2B through Ollama
         -> hermes_execute
            -> Hermes Agent CLI
               -> computer_use / browser / file / terminal / web / memory / skills / session_search
                  -> authorized Windows desktop
```

## Required local-first policy

Hermes must be explicitly configured for:

```text
model.default        = gemma4:e2b
model.provider       = custom
model.base_url       = http://127.0.0.1:11434/v1
model.context_length = 65536
model.ollama_num_ctx = 65536
```

Do not add a paid cloud dependency just to make Hermes work. Do not silently use a cloud fallback in local mode. The JARVIS configuration script clears Hermes' primary fallback chain when `HERMES_ALLOW_CLOUD_FALLBACK=false`.

Do NOT add `model.max_tokens` / `HERMES_MAX_TOKENS` to the Hermes configuration. Current Hermes versions treat that setting as obsolete; custom endpoint output behavior is left to the serving endpoint.

## Existing security requirements

Never restore unrestricted `exec-raw` or arbitrary model-generated shell execution.

Keep the current localhost/relay authorization boundary.

Keep filesystem roots restricted.

Keep destructive/external actions behind appropriate approval/policy checks.

Do not serve the entire project directory as a static directory.

Do not kill arbitrary processes merely because port 3000 is occupied.

## Existing V15 hardening already completed

- Hermes local binding verification
- structured Computer Use diagnostics using `hermes computer-use doctor --json` when available
- bounded provider tool loops
- no fabricated success after loop limits
- honest remote desktop task completion metadata
- explicit frontend static asset allowlist
- safer launcher behavior
- Hermes local-binding regression tests
- remote desktop task configuration bug fix

## Verification sequence

1. Inspect the repository and confirm no unrelated rewrite happened.
2. Run Node syntax validation for all JS files.
3. Run `npm test`.
4. On Windows, install dependencies with `npm install`.
5. Ensure Ollama is installed and `gemma4:e2b` exists.
6. Ensure Hermes is installed.
7. Run `npm run hermes:configure`.
8. Run `npm run hermes:check`.
9. Run the final Windows audit script.
10. Run the Windows acceptance suite.
11. Manually verify one harmless Computer Use task on the actual desktop.
12. Re-run the relevant tests after any fixes.

Never declare real Windows Computer Use successful from static tests alone.

## Success criteria

The final system must honestly distinguish:

- request processed
- agent run completed
- task semantically verified
- task blocked/failed

It must never say an action succeeded merely because an LLM generated a success sentence.
