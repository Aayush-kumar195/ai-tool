const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

function has(text, pattern, message) {
  assert(text.includes(pattern), message);
  console.log(`PASS  ${message}`);
}

has(server, "provider === 'ollama'", 'server recognizes Ollama provider');
has(server, '/api/ollama/status', 'Ollama status endpoint is wired');
has(server, '/v1/chat/completions', 'OpenAI-compatible chat endpoint is supported');
has(server, 'hermes_execute', 'Gemma has a Hermes execution tool');
has(server, "OLLAMA_BASE_URL", 'Ollama base URL is configurable');
has(server, "OLLAMA_MODEL", 'Ollama model is configurable');
has(app, "apiProvider: 'ollama'", 'new JARVIS installs default to the local Ollama brain');
has(app, "'ollama'", 'frontend exposes Ollama provider state');
has(html, 'Local Gemma 4 E2B (Ollama Brain)', 'settings UI exposes Local Gemma provider');
has(html, 'id="field-ollama"', 'settings UI exposes Local Gemma configuration');
has(env, 'OLLAMA_MODEL=gemma4:e2b', 'environment example pins Gemma 4 E2B');

console.log('All Ollama/Gemma integration static checks passed.');
