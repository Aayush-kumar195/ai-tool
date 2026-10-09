'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const sourceRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cloud-relay-'));

function copy(rel) {
  const src = path.join(sourceRoot, rel);
  const dst = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

['server.js', 'hermes-bridge.js', 'activity.json', 'devices.json', 'memories.json', 'knowledge_base.json', 'autolearn_config.json']
  .forEach(copy);
fs.mkdirSync(path.join(tempRoot, 'windows-agent'), { recursive: true });
fs.copyFileSync(
  path.join(sourceRoot, 'windows-agent', 'activity-agent.js'),
  path.join(tempRoot, 'windows-agent', 'activity-agent.js')
);

const routes = new Map();
const fakeApp = {
  set() {},
  use() {},
  get(pathname, handler) { routes.set(`GET ${pathname}`, handler); },
  post(pathname, handler) { routes.set(`POST ${pathname}`, handler); },
  delete(pathname, handler) { routes.set(`DELETE ${pathname}`, handler); },
  listen(_port, _host, cb) { if (cb) cb(); return { close() {} }; }
};
function fakeExpress() { return fakeApp; }
fakeExpress.json = () => (_req, _res, next) => next && next();
fakeExpress.static = () => (_req, _res, next) => next && next();
const fakeCors = () => (_req, _res, next) => next && next();

const previousEnv = { ...process.env };
process.env.PORT = '0';
process.env.JARVIS_HOST = '127.0.0.1';
process.env.JARVIS_CLOUD_MODE = 'true';
process.env.JARVIS_WEB_TOKEN = 'web-secret';
process.env.JARVIS_RELAY_ENABLED = 'true';
process.env.JARVIS_RELAY_TOKEN = 'relay-secret';
process.env.JARVIS_CLOUD_DESKTOP_DEVICE_ID = 'windows-main';
process.env.OLLAMA_ENABLED = 'false';
process.env.HERMES_ENABLED = 'false';
process.env.JARVIS_ACTIVITY_ENABLED = 'false';
process.env.JARVIS_DEVICE_AUTO_REGISTER = 'false';
process.env.JARVIS_DATA_DIR = path.join(tempRoot, 'data');

function responseHarness() {
  let statusCode = 200;
  let payload;
  return {
    res: {
      status(code) { statusCode = code; return this; },
      json(value) { payload = value; return this; },
      sendFile(value) { payload = { file: value }; return this; }
    },
    get() { return { statusCode, payload }; }
  };
}

function invoke(method, pathname, body, {
  ip = '10.10.10.10',
  token = '',
  query = {},
  params = {}
} = {}) {
  let handler = routes.get(`${method} ${pathname}`);
  if (!handler && method === 'GET' && pathname.startsWith('/api/relay/result/')) {
    handler = routes.get('GET /api/relay/result/:taskId');
  }
  assert(handler, `route exists: ${method} ${pathname}`);
  const h = responseHarness();
  const req = {
    ip,
    socket: { remoteAddress: ip },
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query,
    params: Object.keys(params).length ? params : (pathname.startsWith('/api/relay/result/') ? { taskId: decodeURIComponent(pathname.split('/').pop()) } : {}),
    body: body || {}
  };
  return Promise.resolve(handler(req, h.res)).then(() => h.get());
}

(async () => {
  const originalLoad = Module._load;
  const originalInterval = global.setInterval;
  try {
    Module._load = function(request, parent, isMain) {
      if (request === 'express') return fakeExpress;
      if (request === 'cors') return fakeCors;
      return originalLoad.apply(this, arguments);
    };
    global.setInterval = () => ({ unref() {}, ref() {} });

    require(path.join(tempRoot, 'server.js'));

    let res = await invoke('GET', '/api/hermes/status', null);
    assert.equal(res.statusCode, 401, 'cloud private route rejects missing web token');

    res = await invoke('POST', '/api/relay/heartbeat', {
      deviceId: 'windows-main',
      name: 'Test Windows PC',
      capabilities: ['computer_use', 'screen_snapshot'],
      hermes: { installed: true, configured: true, localOllamaBindingReady: true, computerUseReady: true, model: 'gemma4:e2b', provider: 'custom' }
    }, { token: 'relay-secret' });
    assert.equal(res.statusCode, 200, 'relay heartbeat accepted');

    res = await invoke('GET', '/api/hermes/status', null, { token: 'web-secret' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.mode, 'cloud-relay');
    assert.equal(res.payload.relayOnline, true);
    assert.equal(res.payload.computerUseReady, true);
    assert.equal(res.payload.localOllamaBindingReady, true);
    assert.equal(res.payload.model, 'gemma4:e2b');

    res = await invoke('GET', '/api/relay/devices', null, { token: 'web-secret' });
    assert.equal(res.statusCode, 200, 'web token can discover the authorized desktop');
    assert.equal(res.payload.devices[0].deviceId, 'windows-main');

    res = await invoke('GET', '/api/relay/poll', null, { token: 'web-secret', query: { deviceId: 'windows-main' } });
    assert.equal(res.statusCode, 401, 'web token cannot impersonate the desktop relay poller');

    const taskPromise = invoke('POST', '/api/agent/task', { task: 'Open Calculator and verify it launched.' }, { token: 'web-secret' });
    let polled;
    for (let i = 0; i < 20; i++) {
      const poll = await invoke('GET', '/api/relay/poll', null, {
        token: 'relay-secret',
        query: { deviceId: 'windows-main' }
      });
      if (poll.payload?.task) {
        polled = poll.payload.task;
        break;
      }
      await new Promise(r => setTimeout(r, 5));
    }
    assert(polled?.id, 'cloud agent task was queued for the relay');

    res = await invoke('POST', '/api/relay/result', {
      deviceId: 'windows-main',
      taskId: polled.id,
      success: true,
      completed: true,
      text: 'Calculator opened successfully.',
      sessionId: 'session-1',
      toolUses: [{ name: 'computer_use' }],
      toolResults: []
    }, { token: 'relay-secret' });
    assert.equal(res.statusCode, 200);

    res = await taskPromise;
    assert.equal(res.statusCode, 200, 'cloud agent task returned a result');
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.completed, true);
    assert.match(res.payload.text, /Calculator opened successfully/);

    const chatPromise = invoke('POST', '/api/chat', {
      message: 'Please open Notepad.',
      sessionId: 'chat-session-1',
      contents: [{ role: 'user', parts: [{ text: 'Please open Notepad.' }] }],
      systemInstruction: 'You are JARVIS.'
    }, { token: 'web-secret' });
    let chatTask;
    for (let i = 0; i < 20; i++) {
      const poll = await invoke('GET', '/api/relay/poll', null, {
        token: 'relay-secret',
        query: { deviceId: 'windows-main' }
      });
      if (poll.payload?.task) { chatTask = poll.payload.task; break; }
      await new Promise(r => setTimeout(r, 5));
    }
    assert(chatTask?.id, 'cloud chat was delegated to the desktop relay');
    assert.match(chatTask.task, /Please open Notepad/);

    await invoke('POST', '/api/relay/result', {
      deviceId: 'windows-main',
      taskId: chatTask.id,
      success: true,
      completed: true,
      text: 'Notepad is open.'
    }, { token: 'relay-secret' });

    res = await chatPromise;
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.completed, true);
    assert.equal(res.payload.target_device, undefined);
    assert.match(res.payload.text, /Notepad is open/);

    res = await invoke('POST', '/api/relay/task', { deviceId: 'windows-main', task: 'Read-only status check.' }, { token: 'web-secret' });
    assert.equal(res.statusCode, 200, 'web token can enqueue through the browser-facing relay API');
    assert.equal(res.payload.queued, true);
    const webQueuedId = res.payload.taskId;
    res = await invoke('GET', '/api/relay/poll', null, { token: 'relay-secret', query: { deviceId: 'windows-main' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.task.id, webQueuedId);
    res = await invoke('POST', '/api/relay/result', { deviceId: 'windows-main', taskId: webQueuedId, success: true, text: 'Read-only status complete.' }, { token: 'relay-secret' });
    assert.equal(res.statusCode, 200);
    res = await invoke('GET', `/api/relay/result/${encodeURIComponent(webQueuedId)}`, null, { token: 'web-secret' });
    assert.equal(res.statusCode, 200, 'web token can read a relay task result');
    assert.equal(res.payload.result.success, true);

    console.log('PASS Render cloud mode auth + relay + cloud agent/chat delegation harness.');
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalInterval;
    for (const [key, value] of Object.entries(previousEnv)) process.env[key] = value;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
