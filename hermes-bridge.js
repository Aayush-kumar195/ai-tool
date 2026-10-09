'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

let cachedCommand = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;
let cachedHermesConfig = null;
let cachedHermesConfigAt = 0;
const CONFIG_CACHE_TTL_MS = 30_000;
const MIN_AGENT_CONTEXT_LENGTH = 64_000;
const DEFAULT_OLLAMA_NUM_CTX = 65_536;

function normalizeHermesBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase() === 'localhost' ? '127.0.0.1' : url.hostname;
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return raw.toLowerCase();
  }
}

function localOllamaExpectations() {
  const ollamaBase = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  return {
    model: String(process.env.HERMES_MODEL || process.env.OLLAMA_MODEL || 'gemma4:e2b').trim(),
    provider: String(process.env.HERMES_PROVIDER || 'custom').trim().toLowerCase(),
    baseUrl: normalizeHermesBaseUrl(process.env.HERMES_BASE_URL || `${ollamaBase}/v1`),
    contextLength: Math.max(0, Number(process.env.HERMES_CONTEXT_LENGTH || DEFAULT_OLLAMA_NUM_CTX)),
    ollamaNumCtx: Math.max(0, Number(process.env.HERMES_OLLAMA_NUM_CTX || DEFAULT_OLLAMA_NUM_CTX))
  };
}

function localProviderAllowed(provider) {
  return new Set(['custom', 'ollama', 'vllm', 'llamacpp', 'llama.cpp']).has(String(provider || '').trim().toLowerCase());
}

async function getHermesConfigValue(command, key) {
  const result = await execCommand(command, ['config', 'get', key, '--raw'], 10_000);
  const value = String(result.stdout || '').trim();
  return value || null;
}

async function readHermesConfig(command, force = false) {
  if (!force && cachedHermesConfig && (Date.now() - cachedHermesConfigAt) < CONFIG_CACHE_TTL_MS) {
    return cachedHermesConfig;
  }

  const config = { provider: null, model: null, baseUrl: null, contextLength: null, ollamaNumCtx: null, readable: false, error: null };
  try {
    const [model, provider, baseUrl, contextLength, ollamaNumCtx] = await Promise.all([
      getHermesConfigValue(command, 'model.default'),
      getHermesConfigValue(command, 'model.provider'),
      getHermesConfigValue(command, 'model.base_url'),
      getHermesConfigValue(command, 'model.context_length'),
      getHermesConfigValue(command, 'model.ollama_num_ctx')
    ]);
    config.model = model;
    config.provider = provider;
    config.baseUrl = normalizeHermesBaseUrl(baseUrl);
    config.contextLength = contextLength ? Number(contextLength) : null;
    config.ollamaNumCtx = ollamaNumCtx ? Number(ollamaNumCtx) : null;
    config.readable = true;
  } catch (error) {
    config.error = error.message;
  }

  cachedHermesConfig = config;
  cachedHermesConfigAt = Date.now();
  return config;
}

function evaluateLocalHermesBinding(config) {
  const expected = localOllamaExpectations();
  const actualModel = String(config.model || '').trim();
  const actualProvider = String(config.provider || '').trim().toLowerCase();
  const actualBaseUrl = normalizeHermesBaseUrl(config.baseUrl);
  const actualContext = Number(config.contextLength || 0);
  const actualOllamaNumCtx = Number(config.ollamaNumCtx || 0);
  const reasons = [];

  if (!config.readable) reasons.push(`Hermes config could not be read${config.error ? `: ${config.error}` : ''}; run \`npm run hermes:configure\`.`);
  if (!actualModel) reasons.push(`Hermes model.default is not configured (expected ${expected.model}).`);
  else if (actualModel !== expected.model) reasons.push(`Hermes model.default is ${actualModel}, expected ${expected.model}.`);
  if (!localProviderAllowed(actualProvider)) reasons.push(`Hermes model.provider is ${actualProvider || '(empty)'}, expected a local OpenAI-compatible provider such as custom.`);
  if (actualBaseUrl !== expected.baseUrl) reasons.push(`Hermes model.base_url is ${actualBaseUrl || '(empty)'}, expected ${expected.baseUrl}.`);
  if (actualContext < MIN_AGENT_CONTEXT_LENGTH) reasons.push(`Hermes context length is ${actualContext || '(unset)'}, but agentic JARVIS requires at least ${MIN_AGENT_CONTEXT_LENGTH}.`);
  if (actualOllamaNumCtx < MIN_AGENT_CONTEXT_LENGTH) reasons.push(`Hermes model.ollama_num_ctx is ${actualOllamaNumCtx || '(unset)'}, but local agent requests require at least ${MIN_AGENT_CONTEXT_LENGTH}.`);

  return {
    ready: reasons.length === 0,
    expected,
    actual: {
      model: actualModel || null,
      provider: actualProvider || null,
      baseUrl: actualBaseUrl || null,
      contextLength: actualContext || null,
      ollamaNumCtx: actualOllamaNumCtx || null
    },
    reasons
  };
}

async function getHermesModelBindingStatus(command, force = false) {
  const config = await readHermesConfig(command, force);
  const binding = evaluateLocalHermesBinding(config);
  return { ...binding, config };
}

function candidateCommands() {
  const explicit = String(process.env.HERMES_COMMAND || '').trim();
  if (explicit) return [explicit];

  const candidates = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      candidates.push(path.join(local, 'hermes', 'bin', 'hermes.exe'));
      candidates.push(path.join(local, 'hermes', 'bin', 'hermes.cmd'));
      candidates.push(path.join(local, 'hermes', 'bin', 'hermes.bat'));
    }
    // The official Windows installer may publish a CMD/BAT shim rather than
    // a native .exe. Node must invoke those through the Windows shell.
    candidates.push('hermes.cmd');
    candidates.push('hermes.bat');
    candidates.push('hermes.exe');
    candidates.push('hermes');
  } else {
    candidates.push('hermes');
    candidates.push(path.join(os.homedir(), '.local', 'bin', 'hermes'));
  }
  return [...new Set(candidates)];
}

function shouldUseShell(command) {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(String(command || ''));
}

function quoteWindowsArg(value) {
  const arg = String(value ?? '');
  if (arg.length === 0) return '""';
  if (!/[\s"]/u.test(arg)) return arg;
  return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/g, '$1$1') + '"';
}

function buildWindowsShellCommand(command, args = []) {
  return [command, ...args].map(quoteWindowsArg).join(' ');
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const cleanArgs = Array.isArray(args) ? args : [];
    if (shouldUseShell(command)) {
      const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
      const commandLine = buildWindowsShellCommand(command, cleanArgs);
      const shellArgs = ['/d', '/s', '/c', commandLine];
      execFile(comspec, shellArgs, { ...options, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
      return;
    }

    execFile(command, cleanArgs, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function spawnCommand(command, args, options = {}) {
  const cleanArgs = Array.isArray(args) ? args : [];
  if (!shouldUseShell(command)) return spawn(command, cleanArgs, options);
  const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
  const commandLine = buildWindowsShellCommand(command, cleanArgs);
  return spawn(comspec, ['/d', '/s', '/c', commandLine], options);
}

async function resolveHermesCommand(force = false) {
  if (!force && cachedCommand && (Date.now() - cachedAt) < CACHE_TTL_MS) return cachedCommand;
  for (const candidate of candidateCommands()) {
    try {
      const result = await execFileAsync(candidate, ['--version'], { windowsHide: true, timeout: 8_000 });
      if (result.stdout.trim() || result.stderr.trim()) {
        cachedCommand = candidate;
        cachedAt = Date.now();
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }
  cachedCommand = null;
  cachedAt = Date.now();
  return null;
}

async function execCommand(command, args, timeout = 20_000) {
  const result = await execFileAsync(command, args, { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 });
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

function parseStreamJson(stdout) {
  const events = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    try { events.push(JSON.parse(raw)); } catch {
      // Ignore non-JSON output from older Hermes versions.
    }
  }
  return events;
}

function taskLooksLikeComputerUse(prompt) {
  const q = String(prompt || '').toLowerCase();
  return /\b(open|launch|start|close|quit|focus|click|type|scroll|drag|move|search|find|locate|browse|navigate|visit|go to|play|pause|resume|watch|download|upload|install|uninstall|create folder|make folder|open file|show me|look at|desktop|window|application|app|folder|file|browser|chrome|edge|youtube|instagram|spotify|whatsapp|gmail|volume|mute|lock|screen|running|background process|background app|what'?s running)\b/i.test(q);
}

function buildTaskPrompt(prompt, context = {}) {
  const contextText = context.recentConversation
    ? `\nRecent JARVIS conversation context (use only when relevant):\n${context.recentConversation}\n`
    : '';

  const q = String(prompt || '').toLowerCase();
  let specializedTaskRules = '';

  if (/\b(?:youtube|song|video|music)\b/.test(q) && /\b(?:play|listen|watch|start)\b/.test(q)) {
    specializedTaskRules += `\nSPECIALIZED YOUTUBE REQUIREMENT:\n` +
      `- The user's objective is playback, not merely navigation.\n` +
      `- Find the requested media, open the best matching non-ad result, explicitly start playback, and observe the player state after the action.\n` +
      `- Treat playback as verified only when the visible player state supports that conclusion (for example, a playing/pause control state and progressing playback).\n` +
      `- If autoplay is paused, use the visible play control and verify again.\n` +
      `- If a consent/sign-in/unavailable-video blocker prevents playback, report the blocker instead of claiming success.\n`;
  }

  if (/\bwhatsapp\b/.test(q) && /\b(?:message|messages|messaged|texted|unread|chats?|received|who\s+(?:messaged|texted|contacted))\b/.test(q)) {
    specializedTaskRules += `\nSPECIALIZED WHATSAPP READ REQUIREMENT:\n` +
      `- The user's objective includes reading the currently visible message list; opening WhatsApp alone is not completion.\n` +
      `- Wait for WhatsApp Web to load, then inspect the visible chat list for unread/new conversations and extract sender names plus the latest visible message preview/time when available.\n` +
      `- Do not send, reply to, delete, archive, or modify messages.\n` +
      `- If the account is not authenticated or the chat list cannot be accessed, report the exact blocker instead of claiming success.\n`;
  }

  return `You are the execution engine for JARVIS on the user's authorized Windows desktop.\n\n` +
    `USER TASK:\n${String(prompt || '').trim()}\n` +
    contextText +
    `\nEXECUTION CONTRACT:\n` +
    `1. Perform the task, do not merely describe how the user could do it.\n` +
    `2. For desktop actions, prefer computer_use and observe the UI.\n` +
    `3. For websites, prefer the browser tool when it can complete the task reliably.\n` +
    `4. For file discovery, use the filesystem tools instead of guessing paths.\n` +
    `5. For application discovery, use available application/process tools instead of assuming an app is installed.\n` +
    `6. For YouTube/media tasks: search for the requested song/video, open the best matching result, start playback, and verify that the video player is actively playing and that playback actually started. Do not stop at opening youtube.com or a search results page unless playback is impossible.\n` +
    `7. For opening folders/files/apps, verify that the requested target was actually opened.\n` +
    `8. Do not delete, uninstall, overwrite, send messages, purchase anything, or perform another destructive/external side effect unless the task explicitly requests it and the action is safe.\n` +
    `9. Never claim success without a concrete observation, tool result, or equivalent verification.\n` +
    `10. Keep working through intermediate failures when a safe recovery is available.\n` +
    `11. For compound requests, continue until every requested objective is complete; do not report success after completing only the first clause.\n` +
    `12. Finish with a concise factual report of what you actually accomplished or what blocked completion.\n` +
    specializedTaskRules;
}

async function runHermesTask(prompt, options = {}) {
  const command = await resolveHermesCommand();
  if (!command) throw new Error('Hermes Agent is not installed or is not available on PATH. Run scripts\install-hermes.ps1 on Windows.');

  const localMode = String(process.env.HERMES_USE_LOCAL_OLLAMA ?? 'true').toLowerCase() !== 'false';
  let selectedModel = options.model ? String(options.model).trim() : '';
  let selectedProvider = options.provider ? String(options.provider).trim() : '';
  if (localMode) {
    const binding = await getHermesModelBindingStatus(command);
    if (!binding.ready) {
      throw new Error(`Hermes is installed but the local Ollama binding is not ready. ${binding.reasons.join(' ')} Run: npm run hermes:configure`);
    }
    if (selectedModel && selectedModel !== binding.expected.model) {
      throw new Error(`Local JARVIS mode only permits the configured model ${binding.expected.model}; received ${selectedModel}.`);
    }
    if (selectedProvider && !localProviderAllowed(selectedProvider)) {
      throw new Error(`Local JARVIS mode only permits a local Hermes provider; received ${selectedProvider}.`);
    }
    selectedModel = binding.expected.model;
    selectedProvider = binding.actual.provider || binding.expected.provider;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-hermes-'));
  const queryFile = path.join(tempDir, 'task.txt');
  const taskPrompt = buildTaskPrompt(prompt, options);
  fs.writeFileSync(queryFile, taskPrompt, { encoding: 'utf8', mode: 0o600 });

  const args = [
    'chat',
    '--oneshot',
    '--quiet',
    '--format', 'stream-json',
    '--query-file', queryFile,
    '--toolsets', options.toolsets || 'computer_use,browser,file,terminal,web,memory,skills,session_search',
    '--max-turns', String(options.maxTurns || 80),
    '--source', 'tool'
  ];

  if (selectedModel) args.push('--model', selectedModel);
  if (selectedProvider) args.push('--provider', selectedProvider);
  if (options.resumeSessionId) args.push('--resume', String(options.resumeSessionId));

  const startedAt = Date.now();
  return await new Promise((resolve, reject) => {
    const hermesEnv = { ...process.env, HERMES_TUI: '0' };
    if (process.env.JARVIS_TEST_MODE === 'true') {
      hermesEnv.FAKE_HERMES_QUERY = String(prompt || '');
    }
    const spawnOptions = {
      cwd: options.cwd || process.cwd(),
      env: hermesEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    };

    const child = spawnCommand(command, args, spawnOptions);

    let stdout = '';
    let stderr = '';
    const timeoutMs = Math.max(30_000, Number(options.timeoutMs || 180_000));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 4_000).unref();
    }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('error', error => {
      clearTimeout(timer);
      fs.rmSync(tempDir, { recursive: true, force: true });
      reject(new Error(`Failed to start Hermes: ${error.message}`));
    });

    child.on('close', code => {
      clearTimeout(timer);
      fs.rmSync(tempDir, { recursive: true, force: true });

      const events = parseStreamJson(stdout);
      const resultEvent = [...events].reverse().find(e => e?.type === 'result');
      const textEvents = events.filter(e => e?.type === 'text').map(e => e.text || '').join('');
      const text = String(resultEvent?.text || textEvents || '').trim();
      const toolUses = events.filter(e => e?.type === 'tool_use').map(e => ({ name: e.name, input: e.input }));
      const toolResults = events.filter(e => e?.type === 'tool_result').map(e => ({ name: e.name, isError: Boolean(e.is_error), durationMs: e.duration_ms }));
      const sessionId = resultEvent?.session_id || events.find(e => e?.type === 'system' && e?.session_id)?.session_id || null;
      const exitCode = Number(resultEvent?.exit_code ?? code ?? 1);

      if (timedOut) {
        reject(new Error(`Hermes task timed out after ${timeoutMs / 1000}s.`));
        return;
      }
      if (exitCode !== 0 || code !== 0) {
        const diagnostic = String(resultEvent?.error || stderr || 'Hermes returned a non-zero exit code.').trim().slice(-4000);
        reject(new Error(`Hermes task failed: ${diagnostic}`));
        return;
      }
      if (!text) {
        reject(new Error('Hermes completed without a final response.'));
        return;
      }

      resolve({
        success: true,
        text,
        sessionId,
        toolUses,
        toolResults,
        durationMs: Date.now() - startedAt,
        rawEventCount: events.length,
        exitCode
      });
    });
  });
}

async function getHermesRuntimeStatus() {
  const command = await resolveHermesCommand(true);
  if (!command) {
    return {
      installed: false,
      command: null,
      version: null,
      configured: false,
      localOllamaBindingReady: false,
      computerUseReady: false,
      detail: 'Hermes Agent not found.'
    };
  }

  let version = null;
  try { version = (await execCommand(command, ['--version'], 10_000)).stdout.trim() || null; } catch {}

  const localMode = String(process.env.HERMES_USE_LOCAL_OLLAMA ?? 'true').toLowerCase() !== 'false';
  const binding = await getHermesModelBindingStatus(command, true);
  let computerUseReady = false;
  let computerUseStatus = '';
  let computerUseDoctor = null;

  try {
    const doctor = await execCommand(command, ['computer-use', 'doctor', '--json'], 20_000);
    computerUseStatus = `${doctor.stdout}
${doctor.stderr}`.trim();
    try {
      const parsed = JSON.parse(String(doctor.stdout || '').trim());
      if (parsed && typeof parsed === 'object') {
        computerUseDoctor = parsed;
        computerUseReady = parsed.ok === true || String(parsed.overall || '').toLowerCase() === 'ok';
      }
    } catch {}
  } catch (error) {
    computerUseStatus = `${error.stdout || ''}
${error.stderr || error.message || ''}`.trim();
  }

  if (!computerUseDoctor) {
    try {
      const status = await execCommand(command, ['computer-use', 'status'], 15_000);
      const legacy = `${status.stdout}
${status.stderr}`.trim();
      computerUseStatus = computerUseStatus || legacy;
      computerUseReady = /not found|missing|error/i.test(legacy) ? false : (/installed|ready|version|path/i.test(legacy) || computerUseReady);
    } catch (error) {
      if (!computerUseStatus) computerUseStatus = `${error.stdout || ''}
${error.stderr || error.message || ''}`.trim();
    }
  }

  const configured = localMode ? Boolean(binding.ready) : Boolean(binding.config.readable && binding.actual.model && binding.actual.provider);
  const detailParts = [];
  if (localMode && !configured) detailParts.push(`Local Hermes→Ollama binding is not ready: ${binding.reasons.join(' ')}`);
  if (!localMode && !configured) detailParts.push('Hermes model configuration could not be verified.');
  if (!computerUseReady) detailParts.push('Hermes Computer Use is not ready; run `hermes computer-use doctor --json`.');

  return {
    installed: true,
    command,
    version,
    configured,
    localOllamaBindingReady: localMode ? Boolean(binding.ready) : false,
    model: binding.actual.model,
    provider: binding.actual.provider,
    baseUrl: binding.actual.baseUrl,
    contextLength: binding.actual.contextLength,
    expectedLocalModel: binding.expected.model,
    expectedLocalProvider: binding.expected.provider,
    expectedLocalBaseUrl: binding.expected.baseUrl,
    localMode,
    computerUseReady,
    computerUseStatus: computerUseStatus.slice(-4000),
    computerUseDoctor,
    detail: detailParts.length === 0 ? 'Hermes, local Ollama model binding, and Computer Use are ready.' : detailParts.join(' ')
  };
}

module.exports = {
  resolveHermesCommand,
  getHermesRuntimeStatus,
  runHermesTask,
  taskLooksLikeComputerUse,
  candidateCommands,
  shouldUseShell,
  quoteWindowsArg,
  buildWindowsShellCommand,
  normalizeHermesBaseUrl,
  localOllamaExpectations,
  localProviderAllowed,
  readHermesConfig,
  evaluateLocalHermesBinding,
  getHermesModelBindingStatus,
  MIN_AGENT_CONTEXT_LENGTH
};
