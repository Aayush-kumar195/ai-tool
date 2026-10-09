'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const sourceRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-hermes-e2e-'));
const fakeBin = path.join(tempRoot, 'bin');
fs.mkdirSync(fakeBin, { recursive: true });

for (const rel of ['server.js', 'hermes-bridge.js', 'activity.json', 'devices.json', 'memories.json', 'knowledge_base.json', 'autolearn_config.json']) {
  const dst = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, rel), dst);
}
fs.mkdirSync(path.join(tempRoot, 'windows-agent'), { recursive: true });
fs.copyFileSync(path.join(sourceRoot, 'windows-agent', 'activity-agent.js'), path.join(tempRoot, 'windows-agent', 'activity-agent.js'));

// Small cross-platform fake Hermes CLI. It mimics the current CLI calls used by the bridge,
// including a Computer Use readiness check and JSONL task output.
const fakeCountFile = path.join(tempRoot, 'fake-hermes-count.txt');
fs.writeFileSync(fakeCountFile, '0', 'utf8');
const fakeHermes = path.join(fakeBin, process.platform === 'win32' ? 'hermes.cmd' : 'hermes');
if (process.platform === 'win32') {
  fs.writeFileSync(fakeHermes, '@echo off\nnode "%~dp0fake-hermes.js" %*\n', 'utf8');
  fs.chmodSync(fakeHermes, 0o755);
} else {
  fs.writeFileSync(fakeHermes, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('Hermes Agent test-2.0.0'); process.exit(0); }
if (args[0] === 'config' && args[1] === 'get') {
  const key = args[2];
  const values = {
    'model.default': 'gemma4:e2b',
    'model.provider': 'custom',
    'model.base_url': 'http://127.0.0.1:11434/v1',
    'model.context_length': '65536',
    'model.ollama_num_ctx': '65536'
  };
  if (Object.prototype.hasOwnProperty.call(values, key)) { console.log(values[key]); process.exit(0); }
  process.exit(2);
}
if (args[0] === 'computer-use' && args[1] === 'doctor' && args[2] === '--json') {
  console.log(JSON.stringify({ok:true, overall:'ok', probes:[{name:'cua-driver',ok:true}]}));
  process.exit(0);
}
if (args[0] === 'computer-use' && args[1] === 'status') { console.log('cua-driver installed ready version 2.0.0'); process.exit(0); }
if (args[0] === 'chat') {
  const input = process.env.FAKE_HERMES_QUERY || '';
  const marker = '[JARVIS CURRENT REQUEST]';
  const markerIndex = input.indexOf(marker);
  let userRequest = input;
  if (markerIndex >= 0) {
    const afterMarker = input.slice(markerIndex + marker.length);
    const nextSection = afterMarker.indexOf('\\n[');
    userRequest = (nextSection >= 0 ? afterMarker.slice(0, nextSection) : afterMarker).trim();
  }
  const loweredRequest = userRequest.toLowerCase();
  const looksPlay = ['youtube','play','song','video'].some(word => loweredRequest === word || loweredRequest.includes(' ' + word) || loweredRequest.includes(word + ' '));
  let count = 0;
  try { count = Number(fs.readFileSync(process.env.FAKE_HERMES_COUNT_FILE || '', 'utf8') || '0'); } catch {}
  if (process.env.FAKE_HERMES_COUNT_FILE) {
    try { fs.writeFileSync(process.env.FAKE_HERMES_COUNT_FILE, String(count + 1)); } catch {}
  }
  console.log(JSON.stringify({type:'system',session_id:'e2e-session-1'}));
  console.log(JSON.stringify({type:'tool_use',name:looksPlay?'computer_use':'browser_navigate',input:{task:'simulated'}}));
  console.log(JSON.stringify({type:'tool_result',name:looksPlay?'computer_use':'browser_navigate',is_error:false,duration_ms:12}));
  const text = looksPlay && count === 1 ? 'The YouTube player opened but playback could not be positively verified yet.' : (looksPlay ? 'Playback started and is actively playing; verified.' : 'Task completed and verified.');
  console.log(JSON.stringify({type:'result',session_id:'e2e-session-1',exit_code:0,text}));
  process.exit(0);
}
console.error('unsupported'); process.exit(2);
`, 'utf8');
  fs.chmodSync(fakeHermes, 0o755);
}

if (process.platform === 'win32') {
  fs.writeFileSync(path.join(fakeBin, 'fake-hermes.js'), `const fs=require('fs');
const args=process.argv.slice(2);
if(args.includes('--version')){console.log('Hermes Agent test-2.0.0');process.exit(0)}
if(args[0]==='config'&&args[1]==='get'){const key=args[2];const values={'model.default':'gemma4:e2b','model.provider':'custom','model.base_url':'http://127.0.0.1:11434/v1','model.context_length':'65536','model.ollama_num_ctx':'65536'};if(Object.prototype.hasOwnProperty.call(values,key)){console.log(values[key]);process.exit(0)}process.exit(2)}
if(args[0]==='computer-use'&&args[1]==='doctor'&&args[2]==='--json'){console.log(JSON.stringify({ok:true,overall:'ok',probes:[{name:'cua-driver',ok:true}]}));process.exit(0)}
if(args[0]==='computer-use'&&args[1]==='status'){console.log('cua-driver installed ready version 2.0.0');process.exit(0)}
if(args[0]==='chat'){
  const input=process.env.FAKE_HERMES_QUERY||'';
  const marker='[JARVIS CURRENT REQUEST]';
  const markerIndex=input.indexOf(marker);
  let userRequest=input;
  if(markerIndex>=0){const afterMarker=input.slice(markerIndex+marker.length); const nextSection=afterMarker.indexOf('\\n['); userRequest=(nextSection>=0?afterMarker.slice(0,nextSection):afterMarker).trim();}
  const lowered=userRequest.toLowerCase();
  const looksPlay=['youtube','play','song','video'].some(word=>lowered===word||lowered.includes(' '+word)||lowered.includes(word+' '));
  let n=0;
  try{n=Number(fs.readFileSync(process.env.FAKE_HERMES_COUNT_FILE||'', 'utf8')||'0')}catch{}
  try{if(process.env.FAKE_HERMES_COUNT_FILE)fs.writeFileSync(process.env.FAKE_HERMES_COUNT_FILE,String(n+1))}catch{}
  const verified=n>=2;
  const text=looksPlay?(verified?'Playback started and is actively playing; verified.':'The YouTube player opened but playback could not be positively verified yet.'):'Task completed and verified.';
  const toolName=looksPlay?'computer_use':'browser_navigate';
  console.log(JSON.stringify({type:'system',session_id:'e2e-session-1'}));
  console.log(JSON.stringify({type:'tool_use',name:toolName,input:{task:'simulated'}}));
  console.log(JSON.stringify({type:'tool_result',name:toolName,is_error:false,duration_ms:12}));
  console.log(JSON.stringify({type:'result',session_id:'e2e-session-1',exit_code:0,text}));
  process.exit(0)
}
process.exit(2);`, 'utf8');
}

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
process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH || ''}`;
process.env.FAKE_HERMES_COUNT_FILE = fakeCountFile;
process.env.PATHEXT = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
process.env.PORT = '0';
process.env.JARVIS_HOST = '127.0.0.1';
process.env.HERMES_ENABLED = 'true';
process.env.HERMES_USE_LOCAL_OLLAMA = 'true';
process.env.HERMES_MODEL = 'gemma4:e2b';
process.env.HERMES_PROVIDER = 'custom';
process.env.HERMES_BASE_URL = 'http://127.0.0.1:11434/v1';
process.env.HERMES_CONTEXT_LENGTH = '65536';
process.env.HERMES_COMMAND = fakeHermes;
process.env.JARVIS_ACTIVITY_ENABLED = 'false';
process.env.JARVIS_DEVICE_AUTO_REGISTER = 'false';
process.env.JARVIS_TEST_MODE = 'true';

function invoke(method, pathname, body) {
  const handler = routeMap.get(`${method} ${pathname}`);
  assert(handler, `route exists: ${method} ${pathname}`);
  let statusCode = 200;
  let payload;
  const req = { ip:'127.0.0.1', socket:{remoteAddress:'127.0.0.1'}, headers:{authorization:''}, query:{}, params:{}, body:body||{} };
  const res = {
    status(code){ statusCode=code; return this; },
    json(value){ payload=value; return this; }
  };
  return Promise.resolve(handler(req,res)).then(()=>({statusCode,payload}));
}

(async()=>{
  try {
    require(path.join(tempRoot,'server.js'));
    const status = await invoke('GET','/api/hermes/status');
    assert.equal(status.statusCode,200);
    assert.equal(status.payload.installed,true);
    assert.equal(status.payload.computerUseReady,true);

    const chat = await invoke('POST','/api/chat',{apiProvider:'hermes',message:'open Downloads',contents:[{role:'user',parts:[{text:'open Downloads'}]}],systemInstruction:'Test'});
    assert.equal(chat.statusCode,200);
    assert.equal(chat.payload.success,true);
    assert.match(chat.payload.text,/Task completed and verified/i);

    const remoteTask = await invoke('POST','/api/remote/desktop-task',{task:'open Downloads'});
    assert.equal(remoteTask.statusCode,200);
    assert.equal(remoteTask.payload.success,true);
    assert.equal(remoteTask.payload.completed,true);
    assert.equal(remoteTask.payload.verified,false);
    assert.match(remoteTask.payload.text,/Task completed and verified/i);

    fs.writeFileSync(fakeCountFile, '1', 'utf8');
    const action = await invoke('POST','/api/action',{action:'play-youtube',value:'test song'});
    assert.equal(action.statusCode,200);
    assert.equal(action.payload.success,true);
    assert.match(String(action.payload.output),/verified/i);
    const attempts = Number(fs.readFileSync(fakeCountFile, 'utf8'));
    assert.ok(attempts >= 2, `YouTube recovery should have attempted playback twice (got ${attempts})`);
    assert.equal(process.env.JARVIS_TEST_MODE, 'true');

    console.log('PASS JARVIS → Hermes CLI → tool-event/result integration harness (side-effect isolated).');
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalInterval;
    fs.rmSync(tempRoot,{recursive:true,force:true});
  }
})().catch(error=>{
  console.error(error.stack||error.message||String(error));
  process.exitCode=1;
});
