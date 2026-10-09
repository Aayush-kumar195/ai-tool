'use strict';

async function main() {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL || 'gemma4:e2b';

  console.log(`[Ollama] Checking ${baseUrl}`);
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const models = Array.isArray(data.models) ? data.models : [];
  const names = models.map(item => item?.name).filter(Boolean);

  console.log(`[Ollama] Available models: ${names.length ? names.join(', ') : '(none)'}`);
  if (!names.includes(model)) {
    throw new Error(`Configured model ${model} is not installed. Run: ollama pull ${model}`);
  }

  console.log(`[Ollama] READY — ${model}`);
}

main().catch(error => {
  console.error(`[Ollama] NOT READY — ${error.message}`);
  process.exitCode = 1;
});
