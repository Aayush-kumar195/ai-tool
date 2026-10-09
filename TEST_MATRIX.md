# JARVIS + Hermes End-to-End Test Matrix

Run these on the real Windows desktop after Hermes is installed.

| ID | User request | Expected | Verification |
|---|---|---|---|
| C01 | Open Downloads | Explorer opens Downloads | Observe window and `/api/activity/state` foreground |
| C02 | Open Instagram | Browser opens Instagram | Observe browser |
| C03 | Open VS Code | VS Code opens | Observe application |
| C04 | Find my resume | JARVIS identifies matching file | Verify file path |
| C05 | Open the folder containing my resume | Correct folder opens | Observe Explorer |
| C06 | Show me what's running in the background | JARVIS reports current process/app snapshot | Compare with Task Manager |
| C07 | Is Spotify installed? | JARVIS checks installed app snapshot | Compare Start menu |
| C08 | Search YouTube for a specific song and play it | Matching video opens and playback starts | Video visibly playing/audio active |
| C09 | Search YouTube for a specific video and play it | Matching video opens and playback starts | Video visibly playing |
| C10 | Open Chrome and search for FastAPI SQLAlchemy | Browser search occurs | Observe URL/results |
| C11 | Research a topic and learn it | Research is indexed to JARVIS KB | Check `/api/knowledge` |
| C12 | Remember that ... | Memory persists | Check `/api/memories` |
| C13 | Forget ... | Matching memory is removed | Check `/api/memories` |
| C14 | What's happening in the world? | Live news response | Verify current sources in response/UI |
| C15 | What happened while I was away? | Return briefing summarizes recent activity | Check `/api/briefing` |
| C16 | Create a folder in Downloads | Folder appears | Observe Explorer and filesystem activity |
| C17 | Open a file | Correct file opens | Observe target application |
| C18 | Long multi-step browser task | Plan → execute → verify | Observe all requested end states |
| C19 | Delete a file without explicit confirmation | Action is not performed | Verify file remains |
| C20 | Remote desktop status | Live desktop capability reported | `/api/remote/desktop-status` |

For C08/C09, playback must not be marked successful merely because a YouTube search page opened. The player must be actually playing or Hermes must return the concrete blocker.


## Final iteration checks

| ID | Test | Automated | Target Windows verification |
|---|---|---:|---:|
| C21 | Relay heartbeat + authenticated device registry | YES | Optional |
| C22 | Relay task queue/poll/result round trip | YES | Optional |
| C23 | Relay screenshot queue/result plumbing | YES | YES |
| C24 | Mobile companion discovers online Windows desktop | YES | YES |
| C25 | Installed-app refresh after install/uninstall | STATIC | YES |
| C26 | Background process snapshot updates | STATIC | YES |
| C27 | YouTube actual playback + player-state verification | BRIDGE | YES |
| C28 | Windows action routing + security simulation | YES | YES |

## V16 Render cloud acceptance

1. Deploy `render.yaml` as a Render Blueprint and copy the generated `JARVIS_WEB_TOKEN` and `JARVIS_RELAY_TOKEN`.
2. On Windows, configure the project-root `.env` from `scripts/desktop-relay.env.example`.
3. Run `npm run ollama:check` and `npm run hermes:check` locally and require both the local model and Hermes Computer Use to be ready.
4. Start `scripts/LAUNCH_DESKTOP_RELAY.bat`.
5. Confirm Render `/api/health` reports `desktopRelay.online=true`.
6. Open the Render UI and authenticate with `JARVIS_WEB_TOKEN` when prompted.
7. Confirm Hermes and Ollama status cards report the remote desktop readiness.
8. Test a harmless task such as `Open Calculator and verify it launched.`
9. Test a screenshot request only after the task path succeeds.
10. Confirm a relay restart/deploy is understood as potentially losing transient queued tasks because the V16 queue is in-memory.
