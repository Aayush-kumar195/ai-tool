# JARVIS V16 — Render Cloud + Windows Local AI

V16 adds a Render-ready cloud mode without moving the local Gemma/Hermes stack into Render.

## Architecture

```text
Browser
  |
  v
Render Web Service (JARVIS Cloud)
  |\
  | \__ public UI/API + web auth
  |
  | authenticated relay queue
  v
Windows Desktop Relay Agent
  |
  +--> Hermes Agent
  |       |
  |       +--> Ollama
  |              |
  |              +--> Gemma 4 E2B
  |
  +--> Windows Computer Use / Files / Browser / Screenshot
```

Render must only orchestrate requests. Ollama and Hermes remain on the Windows PC, where local computer-use permissions and the desktop session exist.

## Render deployment

The repository includes `render.yaml` for a single free Render web service. Render web services must listen on `0.0.0.0` and the platform-provided `PORT`; V16 does that automatically in cloud mode. Render supports WebSockets, but V16 intentionally uses a simple authenticated outbound polling relay for the desktop agent so the Windows machine does not need to accept inbound connections. citeturn265335search0turn483757search5

1. Push the V16 repository to GitHub.
2. In Render, create a new Blueprint from that repository.
3. Render generates `JARVIS_WEB_TOKEN` and `JARVIS_RELAY_TOKEN` automatically.
4. Open the deployed service's Environment page and copy those two values somewhere safe.
5. Note the Render URL, for example `https://your-name.onrender.com`.
6. On the Windows PC, copy `scripts/desktop-relay.env.example` to the **project-root `.env`** and set:
   - `JARVIS_RELAY_URL=https://your-name.onrender.com/api/relay`
   - `JARVIS_RELAY_TOKEN=<Render JARVIS_RELAY_TOKEN>`
   - `JARVIS_DEVICE_ID=windows-main`
   The relay agent loads this project-root `.env` itself; `server.js` does not need to be running on Windows.
7. Make sure Ollama has `gemma4:e2b` and Hermes is installed/configured locally.
8. From the JARVIS folder on Windows, run:

```powershell
npm install
npm run ollama:check
npm run hermes:configure
npm run hermes:check
node scripts/desktop-relay-agent.js
```

9. Open the Render JARVIS URL in the browser. The first protected API call prompts for the `JARVIS_WEB_TOKEN`. The browser stores the token locally and sends it in the Authorization header.
10. Run `Invoke-RestMethod https://YOUR-SERVICE.onrender.com/api/health` to verify the cloud service, then open the UI and confirm that the desktop relay reports online.

## Why there is no Ollama/Hermes service in render.yaml

Ollama/Gemma and the desktop automation runtime belong on your Windows machine. Putting the public Render web service and the Windows desktop runtime in the same process would make local computer control impossible and would also make the service dependent on a stateful desktop session.

## Persistence note

Render services have an ephemeral filesystem by default. V16 therefore treats Render's file-backed memory/activity/queue state as an MVP convenience, not durable production storage. For durable memory and a restart-safe queue, move those stores to Render Postgres or Key Value in a later phase. Render documents managed Postgres/Key Value as the preferred durable storage options; persistent disks are available only on paid services and prevent multi-instance scaling. citeturn483757search4turn265335search1turn265335search6

## Free-tier note

Free Render services are suitable for testing and hobby deployments, but they can spin down after inactivity. The desktop relay polls the cloud service, so the relay can keep the web service warm while it is running; free-plan limits still apply. citeturn444928search4

## Security model

- Render web/API routes are protected by `JARVIS_WEB_TOKEN`.
- Desktop relay routes are protected by a separate `JARVIS_RELAY_TOKEN`.
- The desktop relay makes outbound requests to Render; Render never needs to connect to `127.0.0.1:11434`.
- The old unrestricted `exec-raw` path remains disabled.
- Cloud `/api/action`, `/api/agent/task`, `/api/chat`, and remote screenshot/task routes are forwarded only to the authenticated Windows desktop relay.
- Same-origin browser requests do not need CORS. Additional cross-origin clients require explicitly configured `JARVIS_CORS_ORIGINS`.

## Important operational limitation

V16 intentionally uses an in-memory relay queue and result map. It is safe for the intended single-Render-instance personal MVP, but queued tasks can be lost during a service restart or deploy. A durable queue is the next infrastructure upgrade.
