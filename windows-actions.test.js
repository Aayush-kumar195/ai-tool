'use strict';

// Cross-platform simulation of the Windows-only action layer.
// It exercises routing/security without requiring a real Windows desktop in the build environment.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const sourceRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-win-actions-'));
const fakeBin = path.join(tempRoot, 'bin');
fs.mkdirSync(fakeBin, { recursive: true });

function copy(rel) {
  const src = path.join(sourceRoot, rel);
  const dst = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
for (const rel of ['server.js','hermes-bridge.js','activity.json','devices.json','memories.json','knowledge_base.json','autolearn_config.json']) copy(rel);
fs.mkdirSync(path.join(tempRoot, 'windows-agent'), { recursive: true });
copy('windows-agent/activity-agent.js');

// Fake Windows executables. They simply succeed and are never given a real command payload.
for (const name of ['explorer.exe','powershell.exe']) {
  const p = path.join(fakeBin, name);
  if (name === 'explorer.exe') {
    fs.writeFileSync(p, '#!/bin/sh\nexit 0\n', 'utf8');
  } else {
    fs.writeFileSync(p, `#!/bin/sh
cmd="$*"
case "$cmd" in
  *System.Drawing*)
    printf '%s\\n' '{"width":1280,"height":720,"data":"V0lOLVJFUE9SVC1UZXNURkFJTEU="}'
    ;;
  *)
    printf '%s\\n' '{"Name":"Calculator","AppID":"Microsoft.WindowsCalculator_8wekyb3d8bbwe!App","Installed":true}'
    ;;
esac
exit 0
`, 'utf8');
  }
  fs.chmodSync(p, 0o755);
}

const home = path.join(tempRoot, 'home');
fs.mkdirSync(path.join(home, 'Downloads'), { recursive: true });
const routeMap = new Map();
const fakeApp = {
  use() {},
  get(p, h) { routeMap.set(`GET ${p}`, h); },
  post(p, h) { routeMap.set(`POST ${p}`, h); },
  delete(p, h) { routeMap.set(`DELETE ${p}`, h); },
  listen() { return { close() {} }; }
};
function fakeExpress() { return fakeApp; }
fakeExpress.json = () => (_req, _res, next) => next && next();
fakeExpress.static = () => (_req, _res, next) => next && next();
const fakeCors = () => (_req, _res, next) => next && next();
const originalLoad = Module._load;
const originalPlatform = process.platform;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalPath = process.env.PATH;
const originalInterval = global.setInterval;

// The test must simulate Windows execution without trying to execute a POSIX shell
// file named *.exe. On a real Windows host, Node cannot launch our shell-script
// test doubles as Win32 executables, which was the source of the misleading 500.
// Mock only the child-process boundary used by the action layer; production code
// remains unchanged and the route/security behavior is still exercised.
const realChildProcess = originalLoad('child_process');
const fakeChildProcess = {
  ...realChildProcess,
  spawn(command, args, options) {
    const listeners = new Map();
    const child = {
      once(event, handler) {
        listeners.set(event, handler);
        return child;
      },
      removeListener(event, handler) {
        if (listeners.get(event) === handler) listeners.delete(event);
        return child;
      },
      unref() {},
      kill() {}
    };
    queueMicrotask(() => {
      const handler = listeners.get('spawn');
      if (handler) handler();
    });
    return child;
  },
  execFile(command, args, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    const joined = Array.isArray(args) ? args.join(' ') : '';
    if (joined.includes('System.Drawing')) {
      return queueMicrotask(() => cb(null, '{\"width\":1280,\"height\":720,\"data\":\"V0lOLVJFUE9SVC1UZXNURkFJTEU=\"}', ''));
    }
    return queueMicrotask(() => cb(null, '{\"Name\":\"Calculator\",\"AppID\":\"Microsoft.WindowsCalculator_8wekyb3d8bbwe!App\",\"Installed\":true}', ''));
  }
};

Module._load = function(request, parent, isMain) {
  if (request === 'express') return fakeExpress;
  if (request === 'cors') return fakeCors;
  if (request === 'child_process') return fakeChildProcess;
  return originalLoad.apply(this, arguments);
};
global.setInterval = () => ({ unref() {}, ref() {} });
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.PATH = `${fakeBin}${path.delimiter}${originalPath || ''}`;
process.env.PORT = '0';
process.env.JARVIS_HOST = '127.0.0.1';
process.env.HERMES_ENABLED = 'false';
process.env.JARVIS_ACTIVITY_ENABLED = 'false';
process.env.JARVIS_DEVICE_AUTO_REGISTER = 'false';

function invoke(method, pathname, body) {
  const handler = routeMap.get(`${method} ${pathname}`);
  assert(handler, `route exists: ${method} ${pathname}`);
  let statusCode = 200;
  let payload;
  const req = { ip:'127.0.0.1', socket:{remoteAddress:'127.0.0.1'}, headers:{authorization:''}, query:{}, params:{}, body:body||{} };
  const res = { status(code){statusCode=code;return this;}, json(v){payload=v;return this;} };
  return Promise.resolve(handler(req,res)).then(()=>({statusCode,payload}));
}

(async () => {
  try {
    require(path.join(tempRoot, 'server.js'));

    let r = await invoke('POST', '/api/action', { action:'open-path', value:'downloads' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.payload.success, true);

    r = await invoke('POST', '/api/action', { action:'open-url', value:'https://www.youtube.com/results?search_query=test' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.payload.success, true);

    r = await invoke('POST', '/api/action', { action:'open-app', value:'calculator' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.payload.success, true);

    r = await invoke('POST', '/api/action', { action:'open-app', value:'bad & malicious' });
    assert.equal(r.statusCode, 500);
    assert.equal(r.payload.success, false);

    r = await invoke('GET', '/api/remote/screenshot');
    assert.equal(r.statusCode, 200);
    assert.equal(r.payload.success, true);
    assert.match(r.payload.dataUrl, /^data:image\/jpeg;base64,/);

    console.log('PASS simulated Windows open-path/open-url/open-app/screenshot/security routes.');
  } finally {
    Module._load = originalLoad;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    global.setInterval = originalInterval;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
    process.env.PATH = originalPath || '';
    fs.rmSync(tempRoot, { recursive:true, force:true });
  }
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
