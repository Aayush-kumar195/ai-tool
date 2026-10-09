'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ollama-http-'));
const fakeHermes = path.join(tempRoot, 'fake-hermes.js');

fs.writeFileSync(fakeHermes, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('Hermes Agent test-local'); process.exit(0); }
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
if (args[0] === 'chat') {
  console.log(JSON.stringify({type:'system',session_id:'ollama-hermes-test'}));
  console.log(JSON.stringify({type:'tool_use',name:'computer_use',input:{task:'simulated'}}));
  console.log(JSON.stringify({type:'tool_result',name:'computer_use',is_error:false,duration_ms:5}));
  console.log(JSON.stringify({type:'result',session_id:'ollama-hermes-test',exit_code:0,text:'Hermes completed the requested computer task and verified the result.'}));
  process.exit(0);
}
process.exit(2);
`, 'utf8');
fs.chmodSync(fakeHermes, 0o755);

const routeMap = new Map();
const fakeApp = {
  use() {},
  get(route, handler) { routeMap.set(`GET ${route}`, handler); },
  post(route, handler) { routeMap.set(`POST ${route}`, handler); },
  delete(route, handler) { routeMap.set(`DELETE ${route}`, handler); },
  listen() { return { close() {} }; }
};
function fakeExpress() { return fakeApp; }
fakeExpress.json = () => (_req, _res, next) => next && next();
fakeExpress.static = () => (_req, _res, next) => next && next();
const fakeCors = () => (_req, _res, next) => next && next();

const originalLoad = Module._load;
const originalFetch = global.fetch;
const originalInterval = global.setInterval;
let ollamaCallCount = 0;

Module._load = function(request, parent, isMain) {
  if (request === 'express') return fakeExpress;
  if (request === 'cors') return fakeCors;
  return originalLoad.apply(this, arguments);
};

global.setInterval = () => ({ unref() {}, ref() {} });
process.env.PORT = '0';
process.env.JARVIS_HOST = '127.0.0.1';
process.env.JARVIS_ACTIVITY_ENABLED = 'false';
process.env.JARVIS_DEVICE_AUTO_REGISTER = 'false';
process.env.OLLAMA_ENABLED = 'true';
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
process.env.OLLAMA_MODEL = 'gemma4:e2b';
process.env.HERMES_ENABLED = 'true';
process.env.HERMES_USE_LOCAL_OLLAMA = 'true';
process.env.HERMES_MODEL = 'gemma4:e2b';
process.env.HERMES_PROVIDER = 'custom';
process.env.HERMES_BASE_URL = 'http://127.0.0.1:11434/v1';
process.env.HERMES_CONTEXT_LENGTH = '128000';
process.env.HERMES_COMMAND = fakeHermes;

function makeResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

global.fetch = async (url, options = {}) => {
  if (url === 'http://127.0.0.1:11434/v1/chat/completions') {
    ollamaCallCount += 1;
    const body = JSON.parse(options.body || '{}');
    assert.equal(body.model, 'gemma4:e2b');
    assert.ok(Array.isArray(body.tools), 'Ollama request should contain OpenAI-compatible tools');

    const hermesTool = body.tools.find(t => t?.function?.name === 'hermes_execute');
    assert.ok(hermesTool, 'hermes_execute must be exposed to Gemma');
    assert.equal(hermesTool.function.parameters.type, 'object', 'tool schema must use lowercase JSON Schema types');

    if (ollamaCallCount === 1) {
      return makeResponse({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-hermes-1',
              type: 'function',
              function: {
                name: 'hermes_execute',
                arguments: JSON.stringify({ instruction: 'Open Notepad and verify it opened.' })
              }
            }]
          }
        }]
      });
    }

    const messages = body.messages || [];
    const toolMessage = messages.find(m => m.role === 'tool');
    assert.ok(toolMessage, 'second model turn must contain the Hermes tool result');
    assert.match(toolMessage.content, /Hermes completed/i);

    return makeResponse({
      choices: [{
        message: {
          role: 'assistant',
          content: 'Done. Hermes completed the desktop task and verified the result.'
        }
      }]
    });
  }

  return makeResponse({ error: 'unexpected test fetch' }, 500);
};

function invoke(method, route, body = {}) {
  const handler = routeMap.get(`${method} ${route}`);
  assert(handler, `route exists: ${method} ${route}`);
  let statusCode = 200;
  let payload;
  const req = {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { authorization: '' },
    query: {}, params: {}, body
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; }
  };
  return Promise.resolve(handler(req, res)).then(() => ({ statusCode, payload }));
}

(async () => {
  try {
    require(path.join(root, 'server.js'));
    const result = await invoke('POST', '/api/chat', {
      apiProvider: 'ollama',
      customModel: 'gemma4:e2b',
      systemInstruction: 'You are JARVIS.',
      contents: [{ role: 'user', parts: [{ text: 'Open Notepad and verify it opened.' }] }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.success, true);
    assert.match(result.payload.text, /Done/i);
    assert.ok(Array.isArray(result.payload.actions));
    assert.ok(result.payload.actions.some(a => a.action === 'hermes-agent'));
    assert.equal(ollamaCallCount, 2);

    console.log('PASS Ollama HTTP adapter -> Gemma tool call -> Hermes executor -> final response harness (side-effect isolated).');
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    global.setInterval = originalInterval;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
