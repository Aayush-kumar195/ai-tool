'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const sourceRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-smoke-'));

function copy(rel) {
  const src = path.join(sourceRoot, rel);
  const dst = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

[
  'server.js',
  'hermes-bridge.js',
  'activity.json',
  'devices.json',
  'memories.json',
  'knowledge_base.json',
  'autolearn_config.json'
].forEach(copy);
fs.mkdirSync(path.join(tempRoot, 'windows-agent'), { recursive: true });
fs.copyFileSync(
  path.join(sourceRoot, 'windows-agent', 'activity-agent.js'),
  path.join(tempRoot, 'windows-agent', 'activity-agent.js')
);

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

try {
  require(path.join(tempRoot, 'server.js'));
} finally {
  Module._load = originalLoad;
  global.setInterval = originalInterval;
}

async function invoke(method, pathname, body, ip = '127.0.0.1') {
  const handler = routeMap.get(`${method} ${pathname}`);
  assert(handler, `route exists: ${method} ${pathname}`);
  let statusCode = 200;
  let payload;
  const req = {
    ip,
    socket: { remoteAddress: ip },
    headers: { authorization: '' },
    query: {},
    params: {},
    body: body || {}
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    sendFile(value) { payload = { file: value }; return this; }
  };
  await handler(req, res);
  return { statusCode, payload };
}

(async () => {
  const health = await invoke('GET', '/api/health');
  assert.equal(health.statusCode, 200);
  assert.equal(health.payload.success, true);

  const hermes = await invoke('GET', '/api/hermes/status');
  assert.equal(hermes.statusCode, 200);
  assert.equal(hermes.payload.success, true);
  assert.equal(hermes.payload.enabled, false);

  const activity = await invoke('GET', '/api/activity/state');
  assert.equal(activity.statusCode, 200);
  assert.equal(activity.payload.success, true);

  const badAction = await invoke('POST', '/api/action', { action: 'unsupported-action' });
  assert.equal(badAction.statusCode, 400);
  assert.equal(badAction.payload.success, false);

  const disabledAgent = await invoke('POST', '/api/agent/task', { task: 'open Downloads' });
  assert.equal(disabledAgent.statusCode, 503);
  assert.equal(disabledAgent.payload.success, false);
  assert.match(String(disabledAgent.payload.error), /Hermes integration is disabled/i);

  const blocked = await invoke('POST', '/api/action', { action: 'open-app', value: 'notepad' }, '10.10.10.5');
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.payload.success, false);

  console.log('PASS dependency-free endpoint smoke harness.');
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
