'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { runHermesTask, getHermesRuntimeStatus } = require('../hermes-bridge');

// Load the project-root .env without adding a runtime dependency. The relay is
// intentionally standalone, so it cannot rely on server.js having loaded it.
function loadDotEnvFile() {
  const candidates = [path.join(__dirname, '..', '.env'), path.join(__dirname, '.env')];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (!(key in process.env)) process.env[key] = value;
      }
      break;
    } catch (error) {
      console.warn(`[Relay] Could not load ${envPath}: ${error.message}`);
    }
  }
}

loadDotEnvFile();

const relayBase = String(process.env.JARVIS_RELAY_URL || '').replace(/\/$/, '');
const token = String(process.env.JARVIS_RELAY_TOKEN || '');
const deviceId = String(process.env.JARVIS_DEVICE_ID || `${os.hostname()}-windows`);
const deviceName = String(process.env.JARVIS_DEVICE_NAME || os.hostname());
const pollMs = Math.max(2000, Number(process.env.JARVIS_RELAY_POLL_MS || 4000));

if (!relayBase || !token) {
  console.error('JARVIS_RELAY_URL and JARVIS_RELAY_TOKEN are required.');
  process.exit(2);
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json'
};

let cachedHermesRuntime = null;
let cachedHermesAt = 0;

async function getCachedHermesRuntime(force = false) {
  const now = Date.now();
  if (!force && cachedHermesRuntime && now - cachedHermesAt < 30_000) return cachedHermesRuntime;
  try {
    cachedHermesRuntime = await getHermesRuntimeStatus();
  } catch (error) {
    cachedHermesRuntime = { installed: false, configured: false, localOllamaBindingReady: false, computerUseReady: false, detail: error.message };
  }
  cachedHermesAt = now;
  return cachedHermesRuntime;
}

async function relayFetch(pathname, options = {}) {
  const response = await fetch(`${relayBase}${pathname}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(data?.error || `Relay HTTP ${response.status}`);
  return data;
}

async function heartbeat() {
  const runtime = await getCachedHermesRuntime();
  return relayFetch('/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      deviceId,
      name: deviceName,
      type: 'windows-desktop',
      capabilities: ['computer_use', 'browser', 'filesystem', 'terminal', 'activity', 'screen_snapshot'],
      hermes: {
        installed: Boolean(runtime?.installed),
        configured: Boolean(runtime?.configured),
        localOllamaBindingReady: Boolean(runtime?.localOllamaBindingReady),
        computerUseReady: Boolean(runtime?.computerUseReady),
        model: runtime?.model || 'gemma4:e2b',
        provider: runtime?.provider || 'custom',
        detail: runtime?.detail || null
      }
    })
  });
}

function capturePrimaryScreen() {
  if (process.platform !== 'win32') return Promise.reject(new Error('Screen capture is supported only on Windows.'));
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$maxWidth = 1600
$scale = [Math]::Min(1.0, $maxWidth / [double]$bounds.Width)
$outWidth = [Math]::Max(1, [int]($bounds.Width * $scale))
$outHeight = [Math]::Max(1, [int]($bounds.Height * $scale))
$outBmp = New-Object System.Drawing.Bitmap $outWidth, $outHeight
$outGraphics = [System.Drawing.Graphics]::FromImage($outBmp)
$outGraphics.DrawImage($bmp, 0, 0, $outWidth, $outHeight)
$stream = New-Object System.IO.MemoryStream
$outBmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Jpeg)
[pscustomobject]@{ width=$outWidth; height=$outHeight; data=[Convert]::ToBase64String($stream.ToArray()) } | ConvertTo-Json -Compress
$outGraphics.Dispose(); $outBmp.Dispose(); $graphics.Dispose(); $bmp.Dispose(); $stream.Dispose()
`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], { windowsHide:true, timeout:12000, maxBuffer:16*1024*1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      try {
        const payload = JSON.parse(String(stdout || '').trim());
        if (!payload?.data) throw new Error('Screen capture returned no image.');
        resolve(payload);
      } catch (error) { reject(error); }
    });
  });
}

async function executeTask(task) {
  if (task.kind === 'screenshot') {
    try {
      const image = await capturePrimaryScreen();
      await relayFetch('/result', {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          taskId: task.id,
          success: true,
          text: `Primary desktop screenshot captured at ${image.width}x${image.height}.`,
          imageData: `data:image/jpeg;base64,${image.data}`
        })
      });
    } catch (error) {
      await relayFetch('/result', {
        method: 'POST',
        body: JSON.stringify({ deviceId, taskId: task.id, success:false, error:error.message })
      }).catch(() => {});
    }
    return;
  }

  try {
    const result = await runHermesTask(task.task, {
      timeoutMs: Math.max(30_000, Number(task.timeoutMs || 10 * 60 * 1000)),
      maxTurns: Math.min(150, Math.max(8, Number(task.maxTurns || 150))),
      model: typeof task.model === 'string' ? task.model : undefined,
      provider: typeof task.provider === 'string' ? task.provider : undefined,
      resumeSessionId: typeof task.resumeSessionId === 'string' ? task.resumeSessionId : undefined
    });
    const completed = Number(result.exitCode) === 0;
    await relayFetch('/result', {
      method: 'POST',
      body: JSON.stringify({
        deviceId,
        taskId: task.id,
        success: completed,
        completed,
        verified: false,
        text: result.text || '',
        sessionId: result.sessionId || null,
        toolUses: result.toolUses || [],
        toolResults: result.toolResults || [],
        durationMs: result.durationMs || null,
        error: completed ? null : (result.text || `Hermes exited with code ${result.exitCode}`)
      })
    });
  } catch (error) {
    await relayFetch('/result', {
      method: 'POST',
      body: JSON.stringify({ deviceId, taskId: task.id, success: false, error: error.message })
    }).catch(() => {});
  }
}

let running = true;
async function loop() {
  while (running) {
    try {
      await heartbeat();
      const data = await relayFetch(`/poll?deviceId=${encodeURIComponent(deviceId)}`);
      if (data?.task) await executeTask(data.task);
    } catch (error) {
      console.warn(`[Relay] ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

console.log(`[Relay] Desktop agent online as ${deviceId}; polling ${relayBase}`);
loop().catch(error => { console.error(error); process.exitCode = 1; });
