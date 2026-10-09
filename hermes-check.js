const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const base = process.env.JARVIS_URL || 'http://127.0.0.1:3000';

async function get(pathname) {
  const response = await fetch(`${base}${pathname}`, { cache: 'no-store' });
  let data = null;
  try { data = await response.json(); } catch {}
  return { response, data };
}

function candidateCommands() {
  const explicit = String(process.env.HERMES_COMMAND || '').trim();
  if (explicit) return [explicit];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    return [
      ...(local ? [
        path.join(local, 'hermes', 'bin', 'hermes.exe'),
        path.join(local, 'hermes', 'bin', 'hermes.cmd'),
        path.join(local, 'hermes', 'bin', 'hermes.bat')
      ] : []),
      'hermes.cmd', 'hermes.bat', 'hermes.exe', 'hermes'
    ];
  }
  return ['hermes'];
}

function quoteWindowsArg(value) {
  const arg = String(value ?? '');
  if (!arg.length) return '""';
  if (!/[\s"]/u.test(arg)) return arg;
  return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/g, '$1$1') + '"';
}

async function runVersion(command) {
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) {
    const out = await execFileAsync(command, ['--version'], { timeout: 10_000, windowsHide: true });
    return (out.stdout || out.stderr || '').trim();
  }

  const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
  const commandLine = [command, '--version'].map(quoteWindowsArg).join(' ');
  const out = await execFileAsync(comspec, ['/d', '/s', '/c', commandLine], {
    timeout: 10_000,
    windowsHide: true
  });
  return (out.stdout || out.stderr || '').trim();
}

async function hermesCommand() {
  const candidates = candidateCommands();
  for (const command of candidates) {
    try {
      return { command, version: await runVersion(command) };
    } catch {}
  }
  return { command: null, version: null, error: `No Hermes executable found. Tried: ${candidates.join(', ')}` };
}

(async () => {
  const localHermes = await hermesCommand();
  console.log(`Hermes CLI: ${localHermes.command ? 'FOUND' : 'NOT FOUND'}${localHermes.version ? ` (${localHermes.version})` : ''}`);

  try {
    const health = await get('/api/health');
    if (!health.response.ok || !health.data?.success) {
      throw new Error(`JARVIS health check failed (HTTP ${health.response.status}).`);
    }

    const hermes = await get('/api/hermes/status');
    console.log(`JARVIS: ONLINE (${base})`);
    console.log(`Hermes installed: ${Boolean(hermes.data?.installed)}`);
    console.log(`Hermes configured: ${Boolean(hermes.data?.configured)}`);
    console.log(`Local Ollama binding ready: ${Boolean(hermes.data?.localOllamaBindingReady)}`);
    console.log(`Computer Use ready: ${Boolean(hermes.data?.computerUseReady)}`);
    if (hermes.data?.model) console.log(`Hermes model: ${hermes.data.model}`);
    if (hermes.data?.provider) console.log(`Hermes provider: ${hermes.data.provider}`);
    if (hermes.data?.baseUrl) console.log(`Hermes base URL: ${hermes.data.baseUrl}`);
    if (hermes.data?.contextLength) console.log(`Hermes context length: ${hermes.data.contextLength}`);
    if (hermes.data?.version) console.log(`Hermes version: ${hermes.data.version}`);
    if (hermes.data?.detail) console.log(`Detail: ${hermes.data.detail}`);

    if (!hermes.data?.installed) process.exitCode = 2;
    else if (!hermes.data?.configured) process.exitCode = 3;
    else if (!hermes.data?.computerUseReady) process.exitCode = 4;
    else process.exitCode = 0;
  } catch (err) {
    console.error(`Hermes diagnostic failed: ${err.message}`);
    process.exitCode = 1;
  }
})();
