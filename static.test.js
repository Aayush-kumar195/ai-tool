const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'hermes-bridge.js'), 'utf8');
const activityAgent = fs.readFileSync(path.join(root, 'windows-agent', 'activity-agent.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const autolearn = JSON.parse(fs.readFileSync(path.join(root, 'autolearn_config.json'), 'utf8'));
const kb = JSON.parse(fs.readFileSync(path.join(root, 'knowledge_base.json'), 'utf8'));
const memories = JSON.parse(fs.readFileSync(path.join(root, 'memories.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL  ${message}`);
  console.log(`PASS  ${message}`);
}

assert(fs.existsSync(path.join(root, 'app.js')), 'app.js exists');
assert(fs.existsSync(path.join(root, 'server.js')), 'server.js exists');
assert(fs.existsSync(path.join(root, 'index.html')), 'index.html exists');
assert(fs.existsSync(path.join(root, 'hermes-bridge.js')), 'Hermes CLI bridge exists');
assert(fs.existsSync(path.join(root, 'windows-agent', 'activity-agent.js')), 'Windows activity agent exists');
assert(fs.existsSync(path.join(root, 'scripts', 'install-hermes.ps1')), 'Hermes installer script exists');
assert(fs.existsSync(path.join(root, 'scripts', 'windows-doctor.ps1')), 'Windows doctor script exists');
assert(fs.existsSync(path.join(root, 'scripts', 'windows-acceptance.ps1')), 'Windows acceptance runner exists');
assert(fs.existsSync(path.join(root, 'tests', 'windows-actions.test.js')), 'simulated Windows action test exists');
assert(fs.existsSync(path.join(root, 'TEST_MATRIX.md')), 'acceptance test matrix exists');
assert(pkg.scripts?.start === 'node server.js', 'start script is node server.js');
assert(pkg.engines?.node === '>=22.0.0 <23.0.0', 'Node engine range is bounded for deployment stability');
assert(pkg.scripts?.test, 'test script is defined');
assert(pkg.scripts?.hermes_check === undefined, 'legacy accidental hermes_check alias is absent');
assert(Array.isArray(autolearn.topics), 'autolearn topic queue is valid JSON');
assert(Array.isArray(kb.entries), 'knowledge base has an entries array');
assert(Array.isArray(memories.memories), 'memory bank has a memories array');

assert(server.includes("require('./hermes-bridge')"), 'server imports Hermes CLI bridge');
assert(server.includes("require('./windows-agent/activity-agent')"), 'server imports Windows activity agent');
assert(server.includes('const PUBLIC_ASSETS = Object.freeze'), 'frontend static serving uses an explicit asset allowlist');
assert(!server.includes('express.static(path.join(__dirname))'), 'project root is not served as a static directory');
assert(fs.existsSync(path.join(root, 'scripts', 'jarvis-final-audit.ps1')), 'final Windows audit script exists');
assert(/fallback clear/.test(fs.readFileSync(path.join(root, 'scripts', 'configure-hermes-ollama.ps1'), 'utf8')), 'local-only Hermes configuration clears primary fallbacks');
assert(fs.readFileSync(path.join(root, '.env.example'), 'utf8').includes('HERMES_ALLOW_CLOUD_FALLBACK=false'), 'local-only fallback policy is explicit');
for (const publicAsset of ['index.html','app.js','index.css']) assert(fs.existsSync(path.join(root, publicAsset)), `public frontend asset exists: ${publicAsset}`);
assert(fs.existsSync(path.join(root, 'render.yaml')), 'Render Blueprint exists');
assert(fs.existsSync(path.join(root, '.node-version')), 'Render Node version pin exists');
assert(fs.readFileSync(path.join(root, '.node-version'), 'utf8').trim() === '22.22.0', 'Render Node version is pinned to 22.22.0');
assert(server.includes('JARVIS_CLOUD_MODE'), 'cloud mode is implemented');
assert(server.includes('JARVIS_WEB_TOKEN'), 'cloud web token authentication is implemented');
assert(server.includes('JARVIS_CLOUD_DESKTOP_DEVICE_ID'), 'cloud desktop device targeting is implemented');
assert(fs.existsSync(path.join(root, 'scripts', 'desktop-relay.env.example')), 'desktop relay environment template exists');
assert(fs.existsSync(path.join(root, 'scripts', 'LAUNCH_DESKTOP_RELAY.bat')), 'desktop relay launcher exists');
assert(fs.readFileSync(path.join(root, 'scripts', 'desktop-relay-agent.js'), 'utf8').includes('loadDotEnvFile'), 'desktop relay loads project .env independently of server.js');
assert(server.includes("path.join(DATA_DIR, 'autolearn_config.json')"), 'auto-learn uses DATA_DIR/autolearn_config.json');
assert(server.includes('/api/hermes/status'), 'Hermes status endpoint is wired');
assert(server.includes('/api/hermes/doctor'), 'Hermes doctor endpoint is wired');
assert(server.includes('/api/hermes/capabilities'), 'Hermes capabilities endpoint is wired');
assert(server.includes('/api/agent/task'), 'direct Hermes agent task endpoint is wired');
assert(server.includes('/api/activity/state'), 'live activity state endpoint is wired');
assert(server.includes('/api/activity/processes'), 'running process endpoint is wired');
assert(server.includes('/api/activity/installed-apps'), 'installed app endpoint is wired');
assert(server.includes('/api/remote/desktop-status'), 'remote desktop status foundation is wired');
assert(server.includes('/api/remote/screenshot'), 'secure on-demand screenshot endpoint is wired');
assert(server.includes('/api/relay/devices'), 'authenticated relay device discovery endpoint is wired');
assert(server.includes('function relayOrWebAuthorized'), 'browser-facing relay APIs have separate web/relay authorization');
assert(server.includes('sessionId: req.body?.sessionId'), 'relay result preserves Hermes session id');
assert(server.includes('toolUses: Array.isArray(req.body?.toolUses)'), 'relay result preserves bounded tool-use metadata');
assert(server.includes("app.use('/mobile'"), 'mobile companion is served by JARVIS');
assert(fs.existsSync(path.join(root, 'mobile-companion', 'index.html')), 'mobile companion UI exists');
assert(fs.existsSync(path.join(root, 'mobile-companion', 'app.js')), 'mobile companion logic exists');
const mobileApp = fs.readFileSync(path.join(root, 'mobile-companion', 'app.js'), 'utf8');
assert(mobileApp.includes('/api/relay/devices'), 'mobile companion discovers authorized relay devices');
assert(!/async function findDesktop\(\)\s*\{\s*const desktop = await findDesktop\(\);/.test(mobileApp), 'mobile desktop discovery is not recursively self-calling');
assert(mobileApp.includes('api/relay/result/${encodeURIComponent(queued.taskId)}'), 'mobile companion polls relay task results');

assert(server.includes('play_youtube'), 'YouTube action is wired');
assert(server.includes('youtube-play'), 'YouTube playback action reports verification state');
assert(server.includes('backgroundProcesses'), 'background process results are exposed');
assert(server.includes('RECOVERY: If the player is paused'), 'YouTube recovery attempt is implemented');
assert(server.includes('computerUseReady'), 'Computer Use readiness is tracked');
assert(server.includes('searchUserFiles'), 'filesystem search implementation is present');
assert(server.includes('WindowsActivityAgent'), 'real-time Windows activity implementation is present');
assert(!server.includes("action === 'exec-raw'"), 'raw exec-raw action is not exposed');
assert(!server.includes("['/d','/c','start'"), 'legacy cmd-shell app fallback was removed');
assert(bridge.includes('--format',) || bridge.includes("'--format', 'stream-json'"), 'Hermes stream-json mode is configured');
assert(bridge.includes("'--query-file'"), 'Hermes uses query-file for safe programmatic prompts');
assert(bridge.includes('computer_use'), 'Hermes Computer Use toolset is requested');
assert(bridge.includes('verify that the video player is actively playing'), 'YouTube playback verification is required');
assert(activityAgent.includes('Get-Process'), 'background process scanning is implemented');
assert(activityAgent.includes('Get-StartApps'), 'installed app discovery is implemented');
assert(activityAgent.includes('fs.watch'), 'filesystem real-time watching is implemented');
assert(!/apiKey:\s*apiKey\s*,/.test(app), 'Hermes path does not send the key from the frontend');
assert(app.includes("'jarvis_session_id'"), 'frontend stores a stable JARVIS session id');
assert(app.includes('hermesComputerUseReady'), 'frontend tracks Computer Use readiness');

assert(server.includes('function privateRequestAllowed'), 'private endpoint security guard exists');
assert(server.includes('isLoopbackRequest'), 'loopback enforcement exists');
assert(server.includes('JARVIS_TARGET'), 'Windows app launcher passes target through process environment');
assert(server.includes('JARVIS_DEVICE_AUTO_REGISTER'), 'device boot registration can be disabled for isolated harnesses');
assert(server.includes('JARVIS_NOTIFICATION'), 'system notification passes message through process environment');

assert(server.includes('JARVIS_APP_SCAN_INTERVAL_MS'), 'installed-app refresh cadence is configurable');
assert(activityAgent.includes('this.appTimer'), 'installed-app refresh timer is implemented');
assert(activityAgent.includes('installed-app-change'), 'installed-app changes are surfaced to activity timeline');
assert(!/Get-Item\s+\$candidate[\s\S]*?\$hermes\.Source/.test(fs.readFileSync(path.join(root, 'scripts', 'install-hermes.ps1'), 'utf8')), 'installer avoids Get-Item/.Source path bug');
assert(!/Get-Item\s+\$candidate[\s\S]*?\$hermes\.Source/.test(fs.readFileSync(path.join(root, 'scripts', 'repair-hermes.ps1'), 'utf8')), 'repair script avoids Get-Item/.Source path bug');
assert(fs.readFileSync(path.join(root, 'scripts', 'install-hermes.ps1'), 'utf8').includes('https://hermes-agent.nousresearch.com/install.ps1'), 'installer uses current official Hermes installer URL');


const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]));
const refs = new Set([...app.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map(m => m[1]));
const missing = [...refs].filter(id => !ids.has(id) && id !== 'runAutoLearnBtn');
assert(ids.has('runAutoLearnBtn'), 'auto-learn Run Now control exists');
assert(missing.length === 0, `all static getElementById references exist (missing: ${missing.join(', ') || 'none'})`);

console.log('All dependency-free JARVIS static checks passed.');

assert(app.includes('sendHermesTaskToBackend'), 'focused desktop tasks can invoke Hermes directly');
assert(app.includes('isDirectHermesYouTubeTask'), 'compound YouTube request guard exists');
assert(app.includes('isDirectHermesWhatsAppReadTask'), 'compound WhatsApp read request guard exists');
assert(bridge.includes('SPECIALIZED YOUTUBE REQUIREMENT'), 'Hermes YouTube execution contract is explicit');
assert(bridge.includes('SPECIALIZED WHATSAPP READ REQUIREMENT'), 'Hermes WhatsApp read contract is explicit');
assert(bridge.includes('For compound requests, continue until every requested objective is complete'), 'Hermes must finish every clause of a compound request');

assert(server.includes('runSpecializedAgentTask'), 'specialized Hermes task executor exists');
assert(server.includes("toolsets: 'computer_use'"), 'specialized desktop tasks force Computer Use toolset');
assert(server.includes('youtubeOutcomeVerified'), 'YouTube playback verification gate exists');
assert(server.includes('whatsappOutcomeSatisfied'), 'WhatsApp read completion gate exists');
assert(server.includes('Do not claim completion merely because WhatsApp is open'), 'WhatsApp open-only false success guard exists');
assert(server.includes('Do not finish with a generic success message'), 'YouTube generic success guard exists');

assert(app.includes('Do not gate direct Hermes tasks on telemetry state'), 'direct Hermes tasks are not gated by asynchronous telemetry state');
assert(app.includes("voiceEngine.speak(`I couldn't complete that computer task."), 'direct Hermes failures are reported without generic-AI fallback');
