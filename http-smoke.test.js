'use strict';

const { spawn } = require('child_process');
const path = require('path');

try {
  require.resolve('express');
  require.resolve('cors');
} catch {
  console.error('HTTP smoke test requires installed production dependencies. Run: npm install');
  process.exit(2);
}

const PORT = 3017;
const BASE = `http://127.0.0.1:${PORT}`;
const root = path.resolve(__dirname, '..');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function request(pathname, options) {
  const response = await fetch(`${BASE}${pathname}`, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { response, data };
}

let child = null;
const cleanup = () => {
    if (child && !child.killed) child.kill();
  };
process.on('exit', cleanup);

(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      JARVIS_HOST: '127.0.0.1',
      JARVIS_ACTIVITY_ENABLED: 'false',
      HERMES_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const health = await request('/api/health');
      if (health.response.ok && health.data.success) { ready = true; break; }
    } catch {}
    await sleep(250);
  }
  if (!ready) throw new Error(`JARVIS HTTP server did not start. ${stderr}`);

  const health = await request('/api/health');
  if (!health.response.ok || !health.data?.success) throw new Error('Health endpoint failed.');

  const hermes = await request('/api/hermes/status');
  if (!hermes.response.ok || hermes.data?.enabled !== false) throw new Error('Hermes status endpoint failed.');

  const action = await request('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'unsupported-action' })
  });
  if (action.response.status !== 400) throw new Error('Unsupported action was not rejected.');

  console.log('PASS real HTTP smoke test.');
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}).finally(cleanup);
