'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const sourceRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-relay-test-'));

function copy(rel) {
  const src = path.join(sourceRoot, rel);
  const dst = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

for (const rel of [
  'server.js',
  'hermes-bridge.js',
  'activity.json',
  'devices.json',
  'memories.json',
  'knowledge_base.json',
  'autolearn_config.json'
]) copy(rel);

fs.mkdirSync(path.join(tempRoot, 'windows-agent'), { recursive: true });
copy('windows-agent/activity-agent.js');

const routeMap = new Map();
const fakeApp = {
  use() {},
  get(pathname, handler) { routeMap.set(`GET ${pathname}`, handler); },
  post(pathname, handler) { routeMap.set(`POST ${pathname}`, handler); },
  delete(pathname, handler) { routeMap.set(`DELETE ${pathname}`, handler); },
  listen() { return { close() {} }; }
};
function fakeExpress() { return fakeApp; }
fakeExpress.json = () => (_req, _res, next) => next && next();
fakeExpress.static = () => (_req, _res, next) => next && next();
const fakeCors = () => (_req, _res, next) => next && next();
const originalLoad = Module._load;
const originalInterval = global.setInterval;
const previousEnv = { ...process.env };

Module._load = function(request, parent, isMain) {
  if (request === 'express') return fakeExpress;
  if (request === 'cors') return fakeCors;
  return originalLoad.apply(this, arguments);
};
global.setInterval = () => ({ unref() {}, ref() {} });
process.env.PORT = '0';
process.env.JARVIS_HOST = '127.0.0.1';
process.env.HERMES_ENABLED = 'false';
process.env.JARVIS_ACTIVITY_ENABLED = 'false';
process.env.JARVIS_DEVICE_AUTO_REGISTER = 'false';
process.env.JARVIS_RELAY_ENABLED = 'true';
process.env.JARVIS_RELAY_TOKEN = 'relay-test-secret';

function invoke(method, pathname, body, { ip = '127.0.0.1', token = 'relay-test-secret', query = {}, params = {} } = {}) {
  const handler = routeMap.get(`${method} ${pathname}`);
  assert(handler, `route exists: ${method} ${pathname}`);
  let statusCode = 200;
  let payload;
  const req = {
    ip,
    socket: { remoteAddress: ip },
    headers: { authorization: token ? `Bearer ${token}` : '' },
    query,
    params,
    body: body || {}
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    sendFile(value) { payload = { file: value }; return this; }
  };
  return Promise.resolve(handler(req, res)).then(() => ({ statusCode, payload }));
}

(async () => {
  try {
    require(path.join(tempRoot, 'server.js'));

    let res = await invoke('GET', '/api/relay/devices', null, { token: '' });
    assert.equal(res.statusCode, 401, 'relay rejects requests without token');

    res = await invoke('POST', '/api/relay/heartbeat', {
      deviceId: 'desktop-test-1',
      name: 'Test Windows Desktop',
      type: 'windows-desktop',
      capabilities: ['computer_use', 'screen_snapshot']
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.device.deviceId, 'desktop-test-1');

    res = await invoke('GET', '/api/relay/devices');
    assert.equal(res.statusCode, 200);
    assert.ok(res.payload.devices.some(d => d.deviceId === 'desktop-test-1' && d.online));

    res = await invoke('POST', '/api/relay/task', { deviceId: 'desktop-test-1', task: 'Open Downloads' });
    assert.equal(res.statusCode, 200);
    const taskId = res.payload.taskId;
    assert.ok(taskId);

    res = await invoke('GET', '/api/relay/poll', null, { query: { deviceId: 'desktop-test-1' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.task.id, taskId);
    assert.equal(res.payload.task.kind, 'task');

    res = await invoke('POST', '/api/relay/task', { deviceId: 'desktop-test-1', kind: 'screenshot' });
    assert.equal(res.statusCode, 200);
    const screenshotTaskId = res.payload.taskId;

    res = await invoke('GET', '/api/relay/poll', null, { query: { deviceId: 'desktop-test-1' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.task.id, screenshotTaskId);
    assert.equal(res.payload.task.kind, 'screenshot');

    res = await invoke('POST', '/api/relay/result', {
      deviceId: 'desktop-test-1',
      taskId: screenshotTaskId,
      success: true,
      text: 'Screenshot captured.',
      imageData: 'data:image/jpeg;base64,TEST'
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.result.success, true);

    res = await invoke('GET', '/api/relay/result/:taskId', null, { params: { taskId: screenshotTaskId } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.result.taskId, screenshotTaskId);
    assert.match(res.payload.result.imageData, /^data:image\/jpeg;base64,/);

    console.log('PASS authenticated relay heartbeat/device/task/result/screenshot harness.');
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
