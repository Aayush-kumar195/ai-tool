'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const sourceRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-specialized-test-'));
const fakeBin = path.join(tempRoot, 'bin');
fs.mkdirSync(fakeBin, { recursive: true });
const countFile = path.join(tempRoot, 'count.json');
fs.writeFileSync(countFile, JSON.stringify({ youtube: 0, whatsapp: 0 }), 'utf8');

const fakeHermes = path.join(fakeBin, 'hermes');
fs.writeFileSync(fakeHermes, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('Hermes Agent test-specialized'); process.exit(0); }
if (args[0] === 'computer-use' && args[1] === 'status') { console.log('cua-driver installed ready'); process.exit(0); }
if (args[0] === 'chat') {
  const toolsetIndex = args.indexOf('--toolsets');
  const selectedToolsets = toolsetIndex >= 0 ? String(args[toolsetIndex + 1] || '') : '';
  fs.appendFileSync(process.env.TOOLSETS_LOG, selectedToolsets + '\n');
  const q = process.env.FAKE_HERMES_QUERY || '';
  const c = JSON.parse(fs.readFileSync(process.env.COUNT_FILE, 'utf8'));
  const isYT = /youtube|song|video/.test(q.toLowerCase());
  const isWA = /whatsapp/.test(q.toLowerCase());
  const key = isYT ? 'youtube' : (isWA ? 'whatsapp' : 'other');
  c[key] = (c[key] || 0) + 1;
  fs.writeFileSync(process.env.COUNT_FILE, JSON.stringify(c), 'utf8');
  const first = c[key] === 1;
  let text = 'Task completed and verified.';
  if (isYT) text = first ? 'YouTube opened but playback is not verified.' : 'Playback started and is actively playing; verified.';
  if (isWA) text = first ? 'WhatsApp is open.' : 'Found messages from Alice and Bob; latest visible previews are available.';
  console.log(JSON.stringify({type:'system',session_id:key+'-session'}));
  console.log(JSON.stringify({type:'tool_use',name:'computer_use',input:{task:'simulated'}}));
  console.log(JSON.stringify({type:'tool_result',name:'computer_use',is_error:false,duration_ms:5}));
  console.log(JSON.stringify({type:'result',session_id:key+'-session',exit_code:0,text}));
  process.exit(0);
}
process.exit(2);
`, 'utf8');
fs.chmodSync(fakeHermes, 0o755);

const routes = new Map();
const fakeApp = {
  use() {},
  get(p, h) { routes.set('GET '+p, h); },
  post(p, h) { routes.set('POST '+p, h); },
  delete(p, h) { routes.set('DELETE '+p, h); },
  listen() { return { close() {} }; }
};
function express(){ return fakeApp; }
express.json = () => (_r,_s,n)=>n&&n();
express.static = () => (_r,_s,n)=>n&&n();
const cors=()=>()=>{};
const originalLoad=Module._load;
const originalInterval=global.setInterval;
global.setInterval=()=>({unref(){},ref(){}});
Module._load=function(request,parent,isMain){
  if(request==='express') return express;
  if(request==='cors') return cors;
  return originalLoad.apply(this, arguments);
};
process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH||''}`;
process.env.HERMES_COMMAND = fakeHermes;
process.env.HERMES_ENABLED = 'true';
process.env.HERMES_MAX_TURNS='20';
process.env.JARVIS_HOST='127.0.0.1';
process.env.PORT='0';
process.env.JARVIS_ACTIVITY_ENABLED='false';
process.env.JARVIS_DEVICE_AUTO_REGISTER='false';
process.env.JARVIS_TEST_MODE='true';
process.env.COUNT_FILE=countFile;
process.env.TOOLSETS_LOG=path.join(tempRoot,'toolsets.log');
fs.writeFileSync(process.env.TOOLSETS_LOG, '', 'utf8');
process.env.FAKE_HERMES_QUERY='';

function invoke(body){
  const h=routes.get('POST /api/agent/task');
  assert(h,'agent task route exists');
  let statusCode=200,payload;
  const req={ip:'127.0.0.1',socket:{remoteAddress:'127.0.0.1'},headers:{authorization:''},body};
  const res={status(code){statusCode=code;return this;},json(v){payload=v;return this;}};
  return Promise.resolve(h(req,res)).then(()=>({statusCode,payload}));
}

(async()=>{
  try {
    require(path.join(sourceRoot,'server.js'));
    process.env.FAKE_HERMES_QUERY='Play a song on YouTube';
    let r=await invoke({task:'Play a song on YouTube'});
    console.error('DEBUG status', r.statusCode, r.payload);
    assert.equal(r.statusCode,200);
    assert.equal(r.payload.success,true);
    assert.equal(r.payload.completed,true);
    assert.equal(r.payload.verified,true);
    assert.match(r.payload.text,/actively playing|verified/i);

    process.env.FAKE_HERMES_QUERY='Open WhatsApp and tell me who messaged me';
    r=await invoke({task:'Open WhatsApp and tell me who messaged me'});
    assert.equal(r.statusCode,200);
    assert.equal(r.payload.success,true);
    assert.equal(r.payload.completed,true);
    assert.equal(r.payload.verified,true);
    assert.match(r.payload.text,/messages from/i);

    const c=JSON.parse(fs.readFileSync(countFile,'utf8'));
    const toolsets=fs.readFileSync(process.env.TOOLSETS_LOG,'utf8').trim().split(/\r?\n/).filter(Boolean);
    assert.ok(toolsets.length >= 4, `expected recovery tool invocations, got ${toolsets.length}`);
    assert.ok(toolsets.every(v => v === 'computer_use'), `specialized tasks must force computer_use only: ${toolsets.join('|')}`);
    assert.ok(c.youtube>=2,`YouTube recovery attempts: ${c.youtube}`);
    assert.ok(c.whatsapp>=2,`WhatsApp recovery attempts: ${c.whatsapp}`);
    console.log('PASS specialized YouTube/WhatsApp tasks recover from open-only responses and require computer_use verification.');
  } finally {
    Module._load=originalLoad;
    global.setInterval=originalInterval;
    fs.rmSync(tempRoot,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
