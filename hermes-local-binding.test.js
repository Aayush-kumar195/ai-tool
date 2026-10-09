'use strict';
const assert = require('assert');
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
process.env.OLLAMA_MODEL = 'gemma4:e2b';
process.env.HERMES_MODEL = 'gemma4:e2b';
process.env.HERMES_PROVIDER = 'custom';
process.env.HERMES_BASE_URL = 'http://127.0.0.1:11434/v1';
process.env.HERMES_CONTEXT_LENGTH = '65536';
process.env.HERMES_OLLAMA_NUM_CTX = '65536';
const bridge = require('../hermes-bridge');

let result = bridge.evaluateLocalHermesBinding({
  readable: true,
  model: 'gemma4:e2b',
  provider: 'custom',
  baseUrl: 'http://127.0.0.1:11434/v1',
  contextLength: 65536,
  ollamaNumCtx: 65536,
  error: null
});
assert.equal(result.ready, true);

result = bridge.evaluateLocalHermesBinding({
  readable: true,
  model: 'gemma4:e2b',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  contextLength: 65536,
  ollamaNumCtx: 65536,
  error: null
});
assert.equal(result.ready, false);
assert.ok(result.reasons.some(reason => /local OpenAI-compatible provider/i.test(reason)));

result = bridge.evaluateLocalHermesBinding({
  readable: true,
  model: 'gemma4:e2b',
  provider: 'custom',
  baseUrl: 'http://127.0.0.1:11434/v1',
  contextLength: 32000,
  error: null
});
assert.equal(result.ready, false);
assert.ok(result.reasons.some(reason => /at least 64000/i.test(reason)));

result = bridge.evaluateLocalHermesBinding({
  readable: true,
  model: 'other-model',
  provider: 'custom',
  baseUrl: 'http://127.0.0.1:11434/v1',
  contextLength: 65536,
  ollamaNumCtx: 65536,
  error: null
});
assert.equal(result.ready, false);
assert.ok(result.reasons.some(reason => /expected gemma4:e2b/i.test(reason)));

console.log('PASS Hermes local Ollama binding validation (model/provider/base URL/context).');
