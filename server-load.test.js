'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const sourceRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-server-load-'));

function copy(rel) {
  const src = path.join(sourceRoot, rel);
  const dst = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

['server.js', 'hermes-bridge.js', 'activity.json', 'devices.json', 'memories.json', 'knowledge_base.json', 'autolearn_config.json']
  .forEach(copy);
fs.mkdirSync(path.join(tempRoot, 'windows-agent'), { recursive: true });
fs.copyFileSync(path.join(sourceRoot, 'windows-agent', 'activity-agent.js'), path.join(tempRoot, 'windows-agent', 'activity-agent.js'));

const routes = [];
const fakeApp = {
  use() {},
  get(pathname, handler) { routes.push(['GET', pathname, handler]); },
  post(pathname, handler) { routes.push(['POST', pathname, handler]); },
  delete(pathname, handler) { routes.push(['DELETE', pathname, handler]); },
  listen(port, host, cb) { if (typeof host === 'function') host(); else if (cb) cb(); return { close() {} }; }
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

try {
  require(path.join(tempRoot, 'server.js'));
} finally {
  Module._load = originalLoad;
  global.setInterval = originalInterval;
}

const routeKey = new Set(routes.map(([method, pathname]) => `${method} ${pathname}`));
for (const required of [
  'GET /',
  'GET /index.html',
  'GET /app.js',
  'GET /index.css',
  'GET /api/health',
  'GET /api/hermes/status',
  'GET /api/activity/processes',
  'GET /api/activity/installed-apps',
  'POST /api/files/search',
  'POST /api/action',
  'POST /api/agent/task',
  'POST /api/chat',
  'POST /api/remote/desktop-task',
  'POST /api/relay/task'
]) assert(routeKey.has(required), `route registered: ${required}`);

console.log(`PASS server module loads and registers ${routes.length} routes without its real Express runtime.`);
fs.rmSync(tempRoot, { recursive: true, force: true });
process.exit(0);
