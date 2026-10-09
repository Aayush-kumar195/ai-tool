const express = require('express');
const cors = require('cors');
const os = require('os');
const { exec, execFile, spawn } = require('child_process');
const { runHermesTask, getHermesRuntimeStatus, resolveHermesCommand } = require('./hermes-bridge');
const { createWindowsActivityAgent } = require('./activity-agent');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load a local .env file without adding another runtime dependency.
function loadDotEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\\r?\\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (err) {
    console.warn('[Config] Could not load .env:', err.message);
  }
}

loadDotEnvFile();

const app = express();
const CLOUD_MODE = String(process.env.JARVIS_CLOUD_MODE || 'false').toLowerCase() === 'true';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.JARVIS_HOST || (CLOUD_MODE ? '0.0.0.0' : '127.0.0.1');
const WEB_ACCESS_TOKEN = String(process.env.JARVIS_WEB_TOKEN || '').trim();

if (CLOUD_MODE) {
  app.set('trust proxy', 1);
  if (!WEB_ACCESS_TOKEN) {
    console.warn('[Security] JARVIS_CLOUD_MODE=true but JARVIS_WEB_TOKEN is not configured. Private web/API routes will remain locked.');
  }
}

// ==========================================
// RESILIENT OUTBOUND FETCH (proxy-aware, retrying, diagnostic)
// Wraps the built-in fetch() used for all AI API calls (Gemini/OpenAI) so that
// network-layer failures produce a specific, human-readable reason instead of
// the generic "fetch failed" error, and so proxy/VPN environments are honored.
// ==========================================
let _proxyDispatcher = null;
let _proxyInitTried = false;
function getProxyDispatcher() {
  if (_proxyInitTried) return _proxyDispatcher;
  _proxyInitTried = true;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxyUrl) return null;
  try {
    // undici ships bundled with modern Node; require it directly for ProxyAgent support.
    const { ProxyAgent } = require('undici');
    _proxyDispatcher = new ProxyAgent(proxyUrl);
    console.log(`[Network] Detected system proxy (${proxyUrl}) — routing outbound AI API calls through it.`);
  } catch (e) {
    console.warn('[Network] A proxy env var is set, but the "undici" package is not installed, so it cannot be used automatically.');
    console.warn('[Network] Run: npm install undici   — then restart the server to enable proxy support.');
  }
  return _proxyDispatcher;
}

function describeNetworkError(err) {
  const msg = (err && err.message) || String(err);
  const code = err && err.cause && err.cause.code;
  if (code === 'ENOTFOUND' || /ENOTFOUND/.test(msg)) {
    return 'DNS lookup failed — this machine could not resolve the API hostname. Check your internet connection or DNS settings.';
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
    return 'Connection refused — a firewall, antivirus, or VPN on this machine is likely blocking outbound requests from Node.';
  }
  if (code === 'ETIMEDOUT' || /ETIMEDOUT|timeout/i.test(msg)) {
    return 'The request timed out — the network is reachable but too slow/unstable, or something is silently dropping the connection.';
  }
  if (/certificate|SSL|TLS/i.test(msg)) {
    return 'A TLS/SSL certificate error occurred — often caused by antivirus HTTPS-inspection or a corporate proxy intercepting traffic.';
  }
  if (/proxy/i.test(msg)) {
    return 'A proxy-related error occurred while trying to reach the API.';
  }
  return `Network-level failure reaching the AI provider: ${msg}`;
}

async function resilientFetch(url, options = {}, retries = 1) {
  const dispatcher = getProxyDispatcher();
  const finalOptions = dispatcher ? { ...options, dispatcher } : options;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, finalOptions);
    } catch (err) {
      lastErr = err;
      console.warn(`[Network] Outbound request attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw new Error(describeNetworkError(lastErr));
}

// CORS is intentionally disabled for cloud mode unless the operator explicitly
// configures additional trusted origins. The main JARVIS UI is same-origin, so
// cross-origin access is unnecessary for the default deployment.
const configuredCorsOrigins = String(process.env.JARVIS_CORS_ORIGINS || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);
const allowedOrigins = CLOUD_MODE
  ? configuredCorsOrigins
  : (configuredCorsOrigins.length > 0 ? configuredCorsOrigins : [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

if (allowedOrigins.length > 0) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin denied by JARVIS policy.'));
    }
  }));
}
app.use(express.json({ limit: '1mb' }));

// Serve only the explicitly public frontend assets. Do not expose the project root because it contains
// source code, configuration, memory/knowledge stores, tests, and operational scripts.
const PUBLIC_ASSETS = Object.freeze({
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/index.css': 'index.css'
});
for (const [route, file] of Object.entries(PUBLIC_ASSETS)) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
}
app.use('/mobile', express.static(path.join(__dirname, 'mobile-companion')));

// CPU Sampling Helper (returns CPU usage percentage over 150ms)
function getCpuUsage() {
  return new Promise((resolve) => {
    const startMeasure = cpuAverage();
    setTimeout(() => {
      const endMeasure = cpuAverage();
      const idleDifference = endMeasure.idle - startMeasure.idle;
      const totalDifference = endMeasure.total - startMeasure.total;
      
      if (totalDifference === 0) {
        resolve(0);
      } else {
        const percentageCPU = 100 - Math.round((100 * idleDifference) / totalDifference);
        resolve(percentageCPU);
      }
    }, 150);
  });
}

function cpuAverage() {
  let totalIdle = 0;
  let totalTick = 0;
  const cpus = os.cpus();

  if (!cpus || cpus.length === 0) {
    return { idle: 0, total: 0 };
  }

  for (let i = 0, len = cpus.length; i < len; i++) {
    const cpu = cpus[i];
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}

// ==========================================
// PERSISTENT MEMORY STORAGE HELPERS
// ==========================================
const DATA_DIR = path.resolve(process.env.JARVIS_DATA_DIR || __dirname);
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (err) { console.warn('[Storage] Could not create data directory:', err.message); }
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json');

function loadMemoriesFromDisk() {
  if (!fs.existsSync(MEMORIES_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(MEMORIES_FILE, 'utf8');
    const json = JSON.parse(data);
    return json.memories || [];
  } catch (e) {
    console.error("Error reading memories.json:", e);
    return [];
  }
}

function saveMemoryToDisk(detail) {
  return new Promise((resolve) => {
    const memories = loadMemoriesFromDisk();
    if (!memories.includes(detail)) {
      memories.push(detail);
    }
    fs.writeFile(MEMORIES_FILE, JSON.stringify({ memories }, null, 2), 'utf8', (err) => {
      if (err) console.error("Error writing memories.json:", err);
      resolve();
    });
  });
}

function deleteMemoryFromDisk(detail) {
  return new Promise((resolve) => {
    const memories = loadMemoriesFromDisk();
    const cleanDetail = detail.toLowerCase().trim();
    
    const newMemories = memories.filter(m => {
      const mClean = m.toLowerCase().trim();
      return !mClean.includes(cleanDetail) && !cleanDetail.includes(mClean);
    });

    const deletedCount = memories.length - newMemories.length;

    fs.writeFile(MEMORIES_FILE, JSON.stringify({ memories: newMemories }, null, 2), 'utf8', (err) => {
      if (err) console.error("Error writing memories.json:", err);
      resolve(deletedCount);
    });
  });
}

function clearAllMemoriesFromDisk() {
  return new Promise((resolve) => {
    fs.writeFile(MEMORIES_FILE, JSON.stringify({ memories: [] }, null, 2), 'utf8', (err) => {
      if (err) console.error("Error clearing memories.json:", err);
      resolve();
    });
  });
}

// ==========================================
// PERSISTENT STRUCTURED KNOWLEDGE BASE HELPERS
// ==========================================
const KB_FILE = path.join(DATA_DIR, 'knowledge_base.json');

function loadKnowledgeBaseFromDisk() {
  if (!fs.existsSync(KB_FILE)) {
    return { entries: [] };
  }
  try {
    const data = fs.readFileSync(KB_FILE, 'utf8');
    const json = JSON.parse(data);
    return { entries: Array.isArray(json.entries) ? json.entries : [] };
  } catch (e) {
    console.error("Error reading knowledge_base.json:", e);
    return { entries: [] };
  }
}

function saveKnowledgeEntryToDisk(entry) {
    return new Promise((resolve, reject) => {
    const kb = loadKnowledgeBaseFromDisk();
    if (!kb.entries) kb.entries = [];

    const existingIndex = kb.entries.findIndex(
      e => (e.topic && entry.topic && e.topic.toLowerCase().trim() === entry.topic.toLowerCase().trim()) ||
           (e.id && entry.id && e.id === entry.id)
    );

    const cleanEntry = {
      id: entry.id || `kb-${Date.now()}`,
      topic: entry.topic || 'General Knowledge',
      summary: entry.summary || '',
      keyFacts: Array.isArray(entry.keyFacts) ? entry.keyFacts : [],
      sourceUrls: Array.isArray(entry.sourceUrls) ? entry.sourceUrls : [],
      category: entry.category || 'General Knowledge',
      learnedAt: entry.learnedAt || new Date().toISOString(),
      confidence: entry.confidence || 0.95
    };

    if (existingIndex >= 0) {
      const existing = kb.entries[existingIndex];
      const mergedFacts = Array.from(new Set([...(existing.keyFacts || []), ...(cleanEntry.keyFacts || [])]));
      const mergedUrls = Array.from(new Set([...(existing.sourceUrls || []), ...(cleanEntry.sourceUrls || [])]));
      kb.entries[existingIndex] = {
        ...existing,
        ...cleanEntry,
        keyFacts: mergedFacts,
        sourceUrls: mergedUrls,
        learnedAt: new Date().toISOString()
      };
    } else {
      kb.entries.push(cleanEntry);
    }

        fs.writeFile(KB_FILE, JSON.stringify(kb, null, 2), 'utf8', (err) => {
      if (err) return reject(err);   // CHANGED: fail loudly instead of hiding the error
      resolve(cleanEntry);
    });
  });
}

function deleteKnowledgeEntryFromDisk(idOrTopic) {
  return new Promise((resolve) => {
    const kb = loadKnowledgeBaseFromDisk();
    const cleanKey = (idOrTopic || '').toLowerCase().trim();
    const initialCount = kb.entries.length;
    kb.entries = kb.entries.filter(e => {
      const matchId = e.id && e.id.toLowerCase() === cleanKey;
      const matchTopic = e.topic && e.topic.toLowerCase().includes(cleanKey);
      return !matchId && !matchTopic;
    });
    const deletedCount = initialCount - kb.entries.length;
    fs.writeFile(KB_FILE, JSON.stringify(kb, null, 2), 'utf8', (err) => {
      if (err) console.error("Error updating knowledge_base.json:", err);
      resolve(deletedCount);
    });
  });
}

function clearAllKnowledgeFromDisk() {
  return new Promise((resolve) => {
    fs.writeFile(KB_FILE, JSON.stringify({ entries: [] }, null, 2), 'utf8', (err) => {
      if (err) console.error("Error clearing knowledge_base.json:", err);
      resolve();
    });
  });
}

function searchKnowledgeBase(query, limit = 4) {
  if (!query || typeof query !== 'string') return [];
  const kb = loadKnowledgeBaseFromDisk();
  if (!kb.entries || kb.entries.length === 0) return [];

  const stopWords = new Set(['a','about','above','after','again','against','all','am','an','and','any','are','as','at','be','because','been','before','being','below','between','both','but','by','can','could','did','do','does','doing','down','during','each','few','for','from','further','had','has','have','having','he','her','here','hers','herself','him','himself','his','how','i','if','in','into','is','it','its','itself','just','learn','me','more','most','my','myself','no','nor','not','of','off','on','once','only','or','other','ought','our','ours','ourselves','out','over','own','research','same','she','should','so','some','such','tell','than','that','the','their','theirs','them','themselves','then','there','these','they','this','those','through','to','too','under','until','up','very','was','we','were','what','when','where','which','while','who','whom','why','with','would','you','your','yours','yourself','yourselves']);

  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t));

  if (queryTerms.length === 0) return [];

  const scored = kb.entries.map(entry => {
    let score = 0;
    const topicText = (entry.topic || '').toLowerCase();
    const summaryText = (entry.summary || '').toLowerCase();
    const factsText = (entry.keyFacts || []).join(' ').toLowerCase();
    const categoryText = (entry.category || '').toLowerCase();

    for (const term of queryTerms) {
      if (topicText.includes(term)) score += 12;
      if (summaryText.includes(term)) score += 4;
      if (factsText.includes(term)) score += 3;
      if (categoryText.includes(term)) score += 2;
    }

    return { entry, score };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.entry);
}

// ==========================================
// LIVE CURRENT-EVENTS & NEWS RSS FEED MODULE
// ==========================================
function parseRssXml(xmlText, sourceName = 'News Wire') {
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null && items.length < 10) {
    const itemXml = match[0];
    
    // Extract title (handling CDATA or plain text)
    const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i);
    const rawTitle = titleMatch ? (titleMatch[1] || titleMatch[2] || '') : '';
    const cleanTitle = rawTitle.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    
    // Extract link
    const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/link>/i);
    const link = linkMatch ? (linkMatch[1] || linkMatch[2] || '').trim() : '';

    // Extract description / summary
    const descMatch = itemXml.match(/<description>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/description>/i);
    const rawDesc = descMatch ? (descMatch[1] || descMatch[2] || '') : '';
    const cleanSummary = rawDesc.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

    // Extract pubDate
    const pubDateMatch = itemXml.match(/<pubDate>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/pubDate>/i);
    const pubDate = pubDateMatch ? (pubDateMatch[1] || pubDateMatch[2] || '').trim() : '';

    // Extract source tag if present
    const srcMatch = itemXml.match(/<source[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/source>/i);
    const itemSource = srcMatch ? (srcMatch[1] || srcMatch[2] || '').trim() : sourceName;

    if (cleanTitle && cleanTitle.length > 5) {
      items.push({
        title: cleanTitle,
        summary: cleanSummary.length > 10 ? cleanSummary : cleanTitle,
        source: itemSource || sourceName,
        publishedAt: pubDate || new Date().toUTCString(),
        link: link
      });
    }
  }
  return items;
}

async function getCurrentNews(topic = '') {
  const feeds = [];
  if (topic && topic.trim().length > 0) {
    feeds.push({
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(topic.trim())}&hl=en-US&gl=US&ceid=US:en`,
      source: 'Google News'
    });
  } else {
    feeds.push({
      url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
      source: 'Google News'
    });
    feeds.push({
      url: 'https://feeds.bbci.co.uk/news/rss.xml',
      source: 'BBC News'
    });
  }

  const allNews = [];
  for (const feed of feeds) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6500);
      const res = await fetch(feed.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
      });
      clearTimeout(timeout);
      if (res.ok) {
        const xml = await res.text();
        const parsed = parseRssXml(xml, feed.source);
        for (const item of parsed) {
          if (!allNews.some(n => n.title.toLowerCase() === item.title.toLowerCase())) {
            allNews.push(item);
          }
          if (allNews.length >= 10) break;
        }
      }
    } catch (e) {
      console.warn(`[News Feed Fetch Warning - ${feed.source}]`, e.message);
    }
    if (allNews.length >= 8) break;
  }
  return allNews.slice(0, 10);
}

// ==========================================
// PERSISTENT AUTO-LEARN QUEUE & CONFIG HELPERS
// ==========================================
const AUTOLEARN_FILE = path.join(DATA_DIR, 'autolearn_config.json');
const DEFAULT_AUTOLEARN_CONFIG = {
  enabled: false,
  intervalMinutes: 30,
  topics: [
    "Artificial General Intelligence architectures and reasoning models",
    "Quantum computing quantum supremacy milestones",
    "James Webb Space Telescope exoplanet atmospheric discoveries",
    "Clean fusion energy reactors and magnetic confinement",
    "Brain-computer interfaces and neural decoding breakthroughs",
    "Autonomous humanoid robotics and robotic kinematics",
    "Cybersecurity post-quantum encryption protocols"
  ],
  currentIndex: 0,
  lastRun: null,
  lastLearnedTopic: null
};


// ==========================================
// DEVICE REGISTRY + LOCAL ACTIVITY INTELLIGENCE
// ==========================================
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const DEVICE_FILE = path.join(DATA_DIR, 'devices.json');
const ACTIVITY_ENABLED = process.env.JARVIS_ACTIVITY_ENABLED !== 'false';
const ACTIVITY_INTERVAL_MS = Math.max(2000, Number(process.env.JARVIS_ACTIVITY_INTERVAL_MS || 5000));
const ACTIVITY_MAX_EVENTS = Math.max(200, Number(process.env.JARVIS_ACTIVITY_MAX_EVENTS || 2000));
const DEVICE_ID = process.env.JARVIS_DEVICE_ID || (CLOUD_MODE ? 'jarvis-cloud' : `${os.hostname()}-windows`);
const DEVICE_NAME = process.env.JARVIS_DEVICE_NAME || (CLOUD_MODE ? 'JARVIS Cloud' : os.hostname());

function readJsonFileSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[Storage] Failed reading ${path.basename(file)}: ${err.message}`);
    return fallback;
  }
}

async function writeJsonFileSafe(file, value) {
  await fs.promises.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

function getRegisteredDevices() {
  const db = readJsonFileSafe(DEVICE_FILE, { devices: [] });
  if (!Array.isArray(db.devices)) return [];
  const now = Date.now();
  return db.devices.map(device => ({
    ...device,
    online: Boolean(device.lastSeen && (now - Date.parse(device.lastSeen) <= 15000))
  }));
}

async function upsertLocalDevice(extra = {}) {
  const devices = getRegisteredDevices();
  const now = new Date().toISOString();
  const index = devices.findIndex(d => d.deviceId === DEVICE_ID);
  const device = {
    deviceId: DEVICE_ID,
    name: DEVICE_NAME,
    type: 'windows-desktop',
    platform: process.platform,
    hostname: os.hostname(),
    capabilities: [
      'computer_use',
      'filesystem',
      'applications',
      'browser',
      'system_metrics',
      'notifications'
    ],
    ...extra,
    lastSeen: now,
    online: true
  };
  if (index >= 0) devices[index] = { ...devices[index], ...device };
  else devices.push(device);
  await writeJsonFileSafe(DEVICE_FILE, { devices });
  return device;
}

let activityEventsCache = null;
let activityWriteChain = Promise.resolve();

function loadActivity() {
  if (activityEventsCache) return activityEventsCache;
  const db = readJsonFileSafe(ACTIVITY_FILE, { events: [] });
  activityEventsCache = Array.isArray(db.events) ? db.events.slice(-ACTIVITY_MAX_EVENTS) : [];
  return activityEventsCache;
}

function persistActivityQueue() {
  const snapshot = loadActivity().slice(-ACTIVITY_MAX_EVENTS);
  activityEventsCache = snapshot;
  activityWriteChain = activityWriteChain
    .catch(() => {})
    .then(() => writeJsonFileSafe(ACTIVITY_FILE, { events: snapshot }));
  return activityWriteChain;
}

async function recordActivity(event) {
  if (!ACTIVITY_ENABLED) return;
  const events = loadActivity();
  const normalized = {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    deviceId: DEVICE_ID,
    ...event
  };
  const previous = events[events.length - 1];
  if (previous &&
      previous.type === normalized.type &&
      previous.app === normalized.app &&
      previous.title === normalized.title &&
      previous.path === normalized.path &&
      previous.action === normalized.action) {
    return;
  }
  events.push(normalized);
  if (events.length > ACTIVITY_MAX_EVENTS) events.splice(0, events.length - ACTIVITY_MAX_EVENTS);
  try {
    await persistActivityQueue();
  } catch (err) {
    console.warn('[Activity] Failed to persist event:', err.message);
  }
}

function getForegroundWindowInfo() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ app: null, title: null, pid: null });

    const script = `
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class JarvisNativeWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$handle = [JarvisNativeWindow]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 1024
[void][JarvisNativeWindow]::GetWindowText($handle, $sb, $sb.Capacity)
$pid = [uint32]0
[void][JarvisNativeWindow]::GetWindowThreadProcessId($handle, [ref]$pid)
$p = Get-Process -Id $pid -ErrorAction SilentlyContinue
[pscustomobject]@{
  app = if ($p) { $p.ProcessName } else { $null }
  title = $sb.ToString()
  pid = $pid
} | ConvertTo-Json -Compress
`;
    execFile('powershell.exe',
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],
      { windowsHide: true, timeout: 2500 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve({ app: null, title: null, pid: null });
        try { resolve(JSON.parse(stdout.trim())); }
        catch { resolve({ app: null, title: null, pid: null }); }
      }
    );
  });
}

// Live local activity agent. The agent keeps a lightweight Windows process/foreground snapshot,
// installed-app registry, and file-system change stream. It is deliberately event-driven so we
// do not repeatedly crawl the entire profile just to answer "what is running?".
const windowsActivityAgent = createWindowsActivityAgent({
  enabled: ACTIVITY_ENABLED,
  intervalMs: Math.max(2000, Number(process.env.JARVIS_ACTIVITY_INTERVAL_MS || 3000)),
  processIntervalMs: Math.max(4000, Number(process.env.JARVIS_PROCESS_INTERVAL_MS || 6000)),
  appIntervalMs: Math.max(30000, Number(process.env.JARVIS_APP_SCAN_INTERVAL_MS || 60000)),
  maxFileEvents: ACTIVITY_MAX_EVENTS
});
let localRuntimeState = windowsActivityAgent.getState();

windowsActivityAgent.subscribe((event, snapshot) => {
  localRuntimeState = snapshot;
  if (event?.type === 'filesystem-change') {
    recordActivity({
      type: 'filesystem-change',
      action: event.action,
      path: event.path,
      root: event.root
    }).catch(() => {});
    return;
  }

  if (event?.type === 'foreground-window') {
    recordActivity({
      type: 'foreground-window',
      app: event.app || null,
      title: event.title || null,
      pid: event.pid || null,
      responsive: event.responsive
    }).catch(() => {});
    return;
  }

  if (event?.type === 'installed-app-change') {
    recordActivity({
      type: 'installed-app-change',
      installedAppCount: event.installedCount || localRuntimeState.installedApps?.length || 0
    }).catch(() => {});
    return;
  }

  if (event?.type === 'process-snapshot') {
    // Keep process changes in the persistent timeline, not the full process list.
    if ((event.started?.length || 0) > 0 || (event.stopped?.length || 0) > 0) {
      recordActivity({
        type: 'process-change',
        started: event.started || [],
        stopped: event.stopped || [],
        processCount: event.processCount || 0
      }).catch(() => {});
    }
  }
});

async function sampleLocalActivity() {
  if (!ACTIVITY_ENABLED) return;
  try {
    await windowsActivityAgent.sample();
    await windowsActivityAgent.sampleProcessSnapshot();
    localRuntimeState = windowsActivityAgent.getState();
    await upsertLocalDevice({
      currentApp: localRuntimeState.foreground?.app || null,
      currentWindow: localRuntimeState.foreground?.title || null,
      runningProcessCount: localRuntimeState.processes?.length || 0,
      installedAppCount: localRuntimeState.installedApps?.length || 0
    });
  } catch (err) {
    console.warn('[Activity] Sampling failed:', err.message);
  }
}

function startLocalActivityMonitor() {
  if (!ACTIVITY_ENABLED) return;
  windowsActivityAgent.start();
  localRuntimeState = windowsActivityAgent.getState();
  sampleLocalActivity().catch(() => {});
  console.log('[Activity] Windows activity agent enabled.');
}

function stopLocalActivityMonitor() {
  windowsActivityAgent.stop();
}

// Search stays inside the current user's profile.
function getUserHomeDirectory() {
  // Windows normally exposes USERPROFILE. HOME is a portable fallback and also
  // makes the local action layer deterministic in isolated/test harnesses.
  const configured = process.platform === 'win32'
    ? (process.env.USERPROFILE || process.env.HOME)
    : (process.env.HOME || process.env.USERPROFILE);
  return configured ? path.resolve(configured) : path.resolve(os.homedir());
}

function getUserSearchRoots() {
  const home = getUserHomeDirectory();
  const candidates = {
    home,
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents'),
    downloads: path.join(home, 'Downloads'),
    pictures: path.join(home, 'Pictures'),
    videos: path.join(home, 'Videos'),
    music: path.join(home, 'Music'),
    onedrive: path.join(home, 'OneDrive')
  };
  return Object.fromEntries(Object.entries(candidates).filter(([, p]) => {
    try { return fs.existsSync(p); } catch { return false; }
  }));
}

function isInsideUserProfile(candidate) {
  // Use the same user-home resolver as the rest of the local path layer.
  // This keeps Windows runtime behavior and isolated/test harnesses consistent
  // when USERPROFILE/HOME are intentionally overridden.
  const home = getUserHomeDirectory();
  const target = path.resolve(candidate);
  return target === home || target.startsWith(home + path.sep);
}

function resolveKnownUserPath(input) {
  const roots = getUserSearchRoots();
  const key = String(input || '').trim().toLowerCase();
  const aliases = {
    downloads: roots.downloads,
    desktop: roots.desktop,
    documents: roots.documents,
    pictures: roots.pictures,
    videos: roots.videos,
    music: roots.music,
    home: roots.home,
    onedrive: roots.onedrive
  };
  if (aliases[key]) return aliases[key];
  const raw = String(input || '').trim();
  if (!raw) return null;
  const candidate = path.resolve(raw);
  return isInsideUserProfile(candidate) ? candidate : null;
}

async function searchUserFiles(query, options = {}) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const rootsMap = getUserSearchRoots();
  const requestedRoots = Array.isArray(options.roots) && options.roots.length
    ? options.roots
    : ['desktop','documents','downloads','onedrive'];
  const roots = requestedRoots.map(r => rootsMap[String(r).toLowerCase()]).filter(Boolean);
  const includeContent = Boolean(options.includeContent);
  const maxResults = Math.min(200, Math.max(1, Number(options.maxResults || 50)));
  const queue = [...roots];
  const results = [];
  const ignoredNames = new Set(['node_modules','.git','.venv','__pycache__','AppData']);
  const textExtensions = new Set(['.txt','.md','.json','.js','.ts','.tsx','.jsx','.py','.java','.cs','.sql','.html','.css','.yaml','.yml']);

  while (queue.length && results.length < maxResults) {
    const dir = queue.shift();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }

    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (ignoredNames.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (!isInsideUserProfile(fullPath)) continue;

      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      let matched = entry.name.toLowerCase().includes(needle);
      let contentSnippet = null;
      if (!matched && includeContent && textExtensions.has(path.extname(entry.name).toLowerCase())) {
        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.size <= 1024 * 1024) {
            const content = (await fs.promises.readFile(fullPath, 'utf8')).toLowerCase();
            matched = content.includes(needle);
            if (matched) {
              const pos = content.indexOf(needle);
              contentSnippet = content.slice(Math.max(0,pos-120), pos + needle.length + 220);
            }
          }
        } catch {}
      }

      if (matched) {
        try {
          const stat = await fs.promises.stat(fullPath);
          results.push({
            name: entry.name,
            path: fullPath,
            directory: path.dirname(fullPath),
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            contentSnippet
          });
        } catch {}
      }
    }
  }

  return results.sort((a,b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

async function listStartApps(query = '') {
  if (process.platform !== 'win32') return [];
  return new Promise((resolve) => {
    const script = `$items = Get-StartApps | Select-Object Name,AppID; $items | ConvertTo-Json -Compress -Depth 3`;
    execFile('powershell.exe',
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve([]);
        try {
          let data = JSON.parse(stdout.trim() || '[]');
          if (!Array.isArray(data)) data = [data];
          const needle = String(query || '').trim().toLowerCase();
          resolve(data.filter(x => x?.Name && (!needle || String(x.Name).toLowerCase().includes(needle))).slice(0,50));
        } catch { resolve([]); }
      }
    );
  });
}

function safeAppToken(value) {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 260 &&
    !/[&|<>`;$\r\n]/.test(value);
}

function spawnDetached(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', ...options });
    } catch (error) {
      reject(error);
      return;
    }
    const onError = (error) => reject(error);
    child.once('error', onError);
    child.once('spawn', () => {
      child.removeListener('error', onError);
      child.unref();
      resolve();
    });
  });
}

async function openWindowsTarget(target) {
  const value = String(target || '').trim();
  if (!safeAppToken(value)) return { success: false, error: 'Target contains unsafe characters or is empty.' };
  const lower = value.toLowerCase();

  const webApps = {
    instagram: 'https://www.instagram.com/',
    youtube: 'https://www.youtube.com/',
    google: 'https://www.google.com/',
    github: 'https://github.com/',
    whatsapp: 'https://web.whatsapp.com/',
    spotify: 'https://open.spotify.com/',
    gmail: 'https://mail.google.com/',
    linkedin: 'https://www.linkedin.com/'
  };

  if (process.platform === 'win32' && webApps[lower]) {
    try {
      await spawnDetached('explorer.exe', [webApps[lower]], { windowsHide: true });
      return { success: true, type: 'url', target: webApps[lower] };
    } catch (error) {
      return { success: false, error: `Unable to open ${webApps[lower]}: ${error.message}` };
    }
  }

  const special = resolveKnownUserPath(value);
  if (special && fs.existsSync(special)) {
    const opener = process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    try {
      await spawnDetached(opener, [special], process.platform === 'win32' ? { windowsHide: true } : {});
      return { success: true, type: 'folder', target: special };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  const matches = await listStartApps(value);
  const match = matches[0];
  if (match?.AppID && process.platform === 'win32') {
    try {
      await spawnDetached('explorer.exe', [`shell:AppsFolder\\${match.AppID}`], { windowsHide: true });
      return { success: true, type: 'start-menu-app', target: match.Name };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  if (process.platform !== 'win32') {
    const child = spawn(value, [], { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true, type: 'process', target: value };
  }

  if (process.platform === 'win32') {
    // Never interpolate the application name into PowerShell source. Pass it through the
    // child environment so quotes, $(), and other PowerShell syntax cannot alter the command.
    const script = `$target = $env:JARVIS_TARGET; $cmd = Get-Command -Name $target -CommandType Application -ErrorAction SilentlyContinue; if (-not $cmd) { throw "Application was not found on PATH." }; Start-Process -LiteralPath $cmd.Source`;
    try {
      await spawnDetached(
        'powershell.exe',
        ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],
        { windowsHide: true, env: { ...process.env, JARVIS_TARGET: value } }
      );
      return { success: true, type: 'process', target: value };
    } catch (error) {
      return { success: false, error: `Application could not be launched: ${error.message}` };
    }
  }
  return { success: false, error: `Unsupported platform: ${process.platform}` };
}

async function openPathTarget(input) {
  const target = resolveKnownUserPath(input);
  if (!target || !fs.existsSync(target)) {
    return { success: false, error: `Path not found within the allowed user profile: ${input}` };
  }
  const opener = process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  try {
    await spawnDetached(opener, [target], process.platform === 'win32' ? { windowsHide: true } : {});
    return { success: true, target };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function openUrlTarget(url) {
  if (typeof url !== 'string' || url.length > 2048 || !/^https?:\/\/[^\s]+$/i.test(url)) {
    return { success: false, error: 'Only valid http/https URLs are allowed.' };
  }
  const opener = process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  try {
    await spawnDetached(opener, [url], process.platform === 'win32' ? { windowsHide: true } : {});
    return { success: true, target: url };
  } catch (error) {
    return { success: false, error: error.message };
  }
}



async function capturePrimaryScreen() {
  if (process.platform !== 'win32') throw new Error('Screen capture is supported only on native Windows.');
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
    execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], {windowsHide:true, timeout:12000, maxBuffer:16*1024*1024}, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      try {
        const payload = JSON.parse(String(stdout || '').trim());
        if (!payload?.data) throw new Error('Screen capture returned no image.');
        resolve(payload);
      } catch (error) { reject(error); }
    });
  });
}

function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(String(query || '').trim())}`;
}

function getRecentActivitySummary(limit = 200) {
  const events = loadActivity().slice(-Math.min(500, Math.max(1, Number(limit || 200))));
  const appCounts = {};
  for (const e of events) if (e.app) appCounts[e.app] = (appCounts[e.app] || 0) + 1;
  return {
    deviceId: DEVICE_ID,
    deviceName: DEVICE_NAME,
    eventCount: events.length,
    currentForeground: localRuntimeState.foreground || null,
    runningProcessCount: localRuntimeState.processes?.length || 0,
    installedAppCount: localRuntimeState.installedApps?.length || 0,
    recentFileEvents: (localRuntimeState.recentFileEvents || []).slice(-20),
    topApps: Object.entries(appCounts).sort((a,b) => b[1]-a[1]).slice(0,10).map(([app,count]) => ({app,count})),
    events: events.slice(-50)
  };
}

function buildReturnBriefing() {
  const events = loadActivity();
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  const recent = events.filter(e => Date.parse(e.timestamp) >= cutoff);
  const unique = [];
  const seen = new Set();
  for (const e of [...recent].reverse()) {
    const key = `${e.app || ''}|${e.title || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
    if (unique.length >= 12) break;
  }
  return {
    generatedAt: new Date().toISOString(),
    windowHours: 12,
    recentActivityCount: recent.length,
    highlights: unique.reverse(),
    currentForeground: localRuntimeState.foreground || null,
    runningProcessCount: localRuntimeState.processes?.length || 0,
    installedAppCount: localRuntimeState.installedApps?.length || 0,
    recentFileEvents: (localRuntimeState.recentFileEvents || []).slice(-12),
    registeredDevices: getRegisteredDevices()
  };
}

async function registerLocalDeviceOnBoot() {
  try {
    await upsertLocalDevice();
    startLocalActivityMonitor();
  } catch (err) {
    console.warn('[Device] Local device registration failed:', err.message);
  }
}

function getLocalRuntimeState() {
  return localRuntimeState || windowsActivityAgent.getState();
}

const localDeviceHeartbeat = setInterval(() => {
  if (!ACTIVITY_ENABLED) return;
  const state = getLocalRuntimeState();
  upsertLocalDevice({
    currentApp: state.foreground?.app || null,
    currentWindow: state.foreground?.title || null,
    runningProcessCount: state.processes?.length || 0,
    installedAppCount: state.installedApps?.length || 0
  }).catch(() => {});
}, 10_000);
if (localDeviceHeartbeat.unref) localDeviceHeartbeat.unref();

async function refreshInstalledAppsSnapshot() {
  const apps = await windowsActivityAgent.refreshInstalledApps();
  localRuntimeState = windowsActivityAgent.getState();
  return apps;
}

function loadAutoLearnConfig() {
  if (!fs.existsSync(AUTOLEARN_FILE)) {
    return { ...DEFAULT_AUTOLEARN_CONFIG };
  }
  try {
    const data = fs.readFileSync(AUTOLEARN_FILE, 'utf8');
    const json = JSON.parse(data);
    return {
      enabled: json.enabled !== undefined ? !!json.enabled : DEFAULT_AUTOLEARN_CONFIG.enabled,
      intervalMinutes: json.intervalMinutes || DEFAULT_AUTOLEARN_CONFIG.intervalMinutes,
      topics: Array.isArray(json.topics) && json.topics.length > 0 ? json.topics : DEFAULT_AUTOLEARN_CONFIG.topics,
      currentIndex: json.currentIndex || 0,
      lastRun: json.lastRun || null,
      lastLearnedTopic: json.lastLearnedTopic || null
    };
  } catch (e) {
    console.error("Error reading autolearn_config.json:", e);
    return { ...DEFAULT_AUTOLEARN_CONFIG };
  }
}

function saveAutoLearnConfig(config) {
  return new Promise((resolve, reject) => {
    fs.writeFile(AUTOLEARN_FILE, JSON.stringify(config, null, 2), 'utf8', (err) => {
      if (err) return reject(err);
      resolve(config);
    });
  });
}


// Concurrency lock for background auto-learning tasks
let isAutoLearning = false;

async function runAutoLearnCycle() {
  if (isAutoLearning) {
    console.log('[JARVIS AUTO-LEARN] Cycle skipped: Previous learning task is still active.');
    return { skipped: true, reason: 'Already in progress' };
  }

  const config = loadAutoLearnConfig();
  if (!config.enabled) return { skipped: true, reason: 'Auto-learn is disabled' };

  const topics = Array.isArray(config.topics) && config.topics.length > 0 ? config.topics : DEFAULT_AUTOLEARN_CONFIG.topics;
  const topicToLearn = topics[config.currentIndex % topics.length];

  isAutoLearning = true;
  console.log(`[JARVIS AUTO-LEARN ENGINE] Executing automated background research on: "${topicToLearn}"`);
    try {
    const outcome = await synthesizeAndLearn(topicToLearn, 'deep');
    config.currentIndex = (config.currentIndex + 1) % topics.length;
    config.lastLearnedTopic = outcome.topic;
    console.log(`[JARVIS AUTO-LEARN SUCCESS] Indexed "${outcome.topic}" (${outcome.keyFacts.length} facts) into long-term knowledge.`);
    return { success: true, topic: outcome.topic, factsCount: outcome.keyFacts.length };
  } catch (err) {
    console.error(`[JARVIS AUTO-LEARN ERROR] Failed learning "${topicToLearn}":`, err.message);
    return { success: false, error: err.message };
  } finally {
    config.lastRun = new Date().toISOString(); // ALWAYS stamp the attempt, success or not
    await saveAutoLearnConfig(config);
    isAutoLearning = false;
  }
}

// Background auto-learn interval: checks periodically if it's time to run
setInterval(async () => {
  try {
    const config = loadAutoLearnConfig();
    if (!config.enabled) return;

    const intervalMs = (config.intervalMinutes || 30) * 60 * 1000;
    const lastRunMs = config.lastRun ? new Date(config.lastRun).getTime() : 0;
    const now = Date.now();

    if (now - lastRunMs >= intervalMs) {
      await runAutoLearnCycle();
    }
  } catch (e) {
    console.error('[JARVIS AUTO-LEARN Interval Error]', e);
  }
}, 60 * 1000);

// ==========================================
// AUTONOMOUS WEB SEARCH & SCRAPING MODULES
// ==========================================
async function searchDuckDuckGo(query) {
  const results = [];

  // 1. DuckDuckGo Instant Answers API
  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
    if (res.ok) {
      const data = await res.json();
      if (data.AbstractText) {
        results.push({
          title: data.Heading || query,
          snippet: data.AbstractText,
          url: data.AbstractURL || 'https://duckduckgo.com'
        });
      }
      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        for (const item of data.RelatedTopics.slice(0, 5)) {
          if (item.Text && item.FirstURL) {
            results.push({
              title: item.Text.split(' - ')[0] || query,
              snippet: item.Text,
              url: item.FirstURL
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn("[DDG Instant API Warning]", e.message);
  }

  // 2. DuckDuckGo HTML Scraper for live web queries
  try {
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html'
      }
    });
    if (res.ok) {
      const html = await res.text();
      const snippetRegex = /<a class="result__snippet[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = snippetRegex.exec(html)) !== null && results.length < 8) {
        let rawUrl = m[1];
        if (rawUrl.includes('uddg=')) {
          const urlMatch = rawUrl.match(/uddg=([^&]+)/);
          if (urlMatch) rawUrl = decodeURIComponent(urlMatch[1]);
        }
        const snippetText = m[2].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim();
        if (snippetText) {
          results.push({
            title: query,
            snippet: snippetText,
            url: rawUrl
          });
        }
      }
    }
  } catch (e) {
    console.warn("[DDG HTML Search Warning]", e.message);
  }

  return results;
}

async function searchWikipedia(query) {
  const results = [];
  try {
    const opensearchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&namespace=0&format=json`;
    const res = await fetch(opensearchUrl);
    if (res.ok) {
      const data = await res.json();
      const titles = data[1] || [];
      const descriptions = data[2] || [];
      const urls = data[3] || [];
      for (let i = 0; i < titles.length; i++) {
        results.push({
          title: titles[i],
          snippet: descriptions[i] || '',
          url: urls[i] || ''
        });
      }
      if (titles[0]) {
        const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titles[0])}`);
        if (sumRes.ok) {
          const sumData = await sumRes.json();
          if (sumData.extract) {
            results[0].snippet = sumData.extract;
          }
        }
      }
    }
  } catch (e) {
    console.warn("[Wikipedia Search Warning]", e.message);
  }
  return results;
}

async function fetchWebPage(url, maxChars = 3500) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,text/plain'
      }
    });
    clearTimeout(timeout);
    if (!res.ok) return `Failed to fetch URL: Status ${res.status}`;
    const rawHtml = await res.text();

    const cleaned = rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned.slice(0, maxChars);
  } catch (e) {
    return `Error reading webpage: ${e.message}`;
  }
}

async function synthesizeAndLearn(topic, depth = 'deep') {
  console.log(`[JARVIS AUTONOMOUS RESEARCH] Initiated on topic: "${topic}", Depth: ${depth}`);
  
  const [wikiResults, ddgResults] = await Promise.all([
    searchWikipedia(topic),
    searchDuckDuckGo(topic)
  ]);

  const allSources = [];
  const rawFacts = [];
  let summaryExtract = '';

  // Process Wikipedia
  if (wikiResults.length > 0 && wikiResults[0].snippet) {
    summaryExtract = wikiResults[0].snippet;
    if (wikiResults[0].url) allSources.push(wikiResults[0].url);
  }

  // Process DDG snippets
  for (const item of ddgResults) {
    if (item.snippet && item.snippet.length > 20) {
      rawFacts.push(item.snippet);
      if (item.url && !allSources.includes(item.url)) {
        allSources.push(item.url);
      }
    }
  }

  // Deep research scraping if requested
  if (depth === 'deep' && allSources.length > 0) {
    const validHttpUrls = allSources.filter(u => u.startsWith('http')).slice(0, 2);
    for (const url of validHttpUrls) {
      const pageText = await fetchWebPage(url, 2000);
      if (pageText && pageText.length > 100 && !pageText.startsWith('Error')) {
        const sentences = pageText.split(/(?<=[.!?])\s+/).filter(s => s.length > 40 && s.length < 250);
        rawFacts.push(...sentences.slice(0, 3));
      }
    }
  }

  // If summaryExtract is still empty, synthesize from raw facts
  if (!summaryExtract && rawFacts.length > 0) {
    summaryExtract = rawFacts.slice(0, 2).join(' ');
    } else if (!summaryExtract) {
    throw new Error(`No usable data found for "${topic}" — searches returned nothing.`);
  }


  // Extract clean bullet facts (deduplicate and filter)
  const keyFacts = [];
  for (const fact of rawFacts) {
    const cleanFact = fact.replace(/\s+/g, ' ').trim();
    if (cleanFact.length > 30 && cleanFact.length < 280 && !keyFacts.some(kf => kf.toLowerCase() === cleanFact.toLowerCase())) {
      keyFacts.push(cleanFact);
      if (keyFacts.length >= 6) break;
    }
  }

  const newEntry = {
    id: `kb-${Date.now()}`,
    topic: topic.trim(),
    summary: summaryExtract.trim(),
    keyFacts: keyFacts.length > 0 ? keyFacts : [summaryExtract.trim()],
    sourceUrls: allSources.slice(0, 4),
    category: 'Internet Research',
    learnedAt: new Date().toISOString(),
    confidence: 0.95
  };

  await saveKnowledgeEntryToDisk(newEntry);
  console.log(`[JARVIS KNOWLEDGE COMMITTED] Successfully learned and indexed: "${topic}" (${newEntry.keyFacts.length} key facts)`);

  return {
    success: true,
    topic: newEntry.topic,
    summary: newEntry.summary,
    keyFacts: newEntry.keyFacts,
    sourceUrls: newEntry.sourceUrls
  };
}

// ==========================================
// LOCAL HOST SYSTEM ACTION EXECUTION (AGENTIC TOOLS)
// ==========================================
async function executeLocalAction(name, args, executedActions) {
  console.log(`[JARVIS TOOL TRIGGER] Name: ${name}, Args:`, args);
  const targetDevice = args.target_device || DEVICE_ID;

  switch (name) {
    case 'open_app': {
      const appName = String(args.appName || '').trim();
      if (!appName) return 'Error: appName is required.';
      const outcome = await openWindowsTarget(appName);
      if (outcome.success) {
        executedActions.push({ action: outcome.type === 'url' ? 'open-url' : 'open-app', value: outcome.target, target_device: targetDevice });
        return `Successfully opened ${outcome.target}.`;
      }
      return `Failed to open ${appName}: ${outcome.error}`;
    }

    case 'open_url': {
      const outcome = await openUrlTarget(String(args.url || '').trim());
      if (outcome.success) {
        executedActions.push({ action: 'open-url', value: outcome.target, target_device: targetDevice });
        return `Successfully opened URL ${outcome.target}.`;
      }
      return `Failed to open URL: ${outcome.error}`;
    }

    case 'open_path': {
      const outcome = await openPathTarget(args.path);
      if (outcome.success) {
        executedActions.push({ action: 'open-path', value: outcome.target, target_device: targetDevice });
        return `Successfully opened ${outcome.target}.`;
      }
      return `Failed to open path: ${outcome.error}`;
    }

    case 'play_youtube': {
      const query = String(args.query || '').trim();
      if (!query) return 'Error: query is required.';

      const playbackPrompt = (attempt = 1) => `Play the requested YouTube media now: "${query}". This is a real desktop action, not a request for instructions. Use Hermes computer_use on the user's actual Windows desktop. Prefer the visible/default browser already on the desktop. Navigate to YouTube, search for the requested song or video, choose the best matching non-ad result, open it, start playback, and verify from the visible player controls/status that playback is actively running. Handle cookie/consent/sign-in overlays only when a safe click is obvious. If playback is blocked, report the exact blocker. Do not claim success merely because YouTube or search results opened. Attempt ${attempt} of 2.`;

      const runtime = await getHermesRuntimeStatus();
      if (runtime.installed && runtime.computerUseReady) {
        try {
          // Put the user in the correct desktop context first; Hermes then performs and verifies the UI task.
          // Test mode must never launch real external applications/sites.
          if (process.platform === 'win32' && process.env.JARVIS_TEST_MODE !== 'true') {
            await openWindowsTarget('youtube');
            await new Promise(resolve => setTimeout(resolve, 1200));
          }

          let result = await runHermesTask(playbackPrompt(1), {
            toolsets: 'computer_use,terminal,file,skills,memory,session_search',
            model: hermesConfig().model || undefined,
            provider: hermesConfig().provider || undefined,
            maxTurns: hermesConfig().maxTurns,
            timeoutMs: hermesConfig().timeoutMs
          });

          const looksVerified = /(?:actively\s+playing|playback\s+(?:has\s+)?started|now\s+playing|is\s+playing|player\s+is\s+playing|playing\s+now)/i.test(result.text) &&
            !/(?:could\s+not|couldn't|unable|blocked|failed|not\s+playing|did\s+not\s+start|cannot)/i.test(result.text);

          if (!looksVerified) {
            console.warn('[YouTube/Hermes] First attempt did not provide positive playback verification; starting recovery attempt.');
            const recovery = await runHermesTask(playbackPrompt(2) + '\nRECOVERY: If the player is paused, click the center play control or use the visible player control. Re-check the player state after the click before finishing.', {
              toolsets: 'computer_use,terminal,file,skills,memory,session_search',
              model: hermesConfig().model || undefined,
              provider: hermesConfig().provider || undefined,
              maxTurns: Math.max(12, hermesConfig().maxTurns),
              timeoutMs: Math.min(10 * 60 * 1000, Math.max(120000, hermesConfig().timeoutMs))
            });
            result = recovery;
          }

          const verified = /(?:actively\s+playing|playback\s+(?:has\s+)?started|now\s+playing|is\s+playing|player\s+is\s+playing|playing\s+now)/i.test(result.text) &&
            !/(?:could\s+not|couldn't|unable|blocked|failed|not\s+playing|did\s+not\s+start|cannot)/i.test(result.text);
          executedActions.push({ action: 'youtube-play', value: query, target_device: targetDevice, verified, hermesSessionId: result.sessionId });
          if (verified) return result.text;
          return `YouTube was opened, but Hermes could not positively verify playback for "${query}". ${result.text}`;
        } catch (hermesError) {
          console.warn('[YouTube/Hermes] Computer-use playback failed:', hermesError.message);
        }
      }

      // Safe fallback: open the query page so the task is still useful when Hermes is unavailable.
      // In automated tests we must remain side-effect free.
      if (process.env.JARVIS_TEST_MODE === 'true') {
        return `Hermes playback was unavailable in test mode for \"${query}\".`;
      }
      const url = youtubeSearchUrl(query);
      const outcome = await openUrlTarget(url);
      if (outcome.success) {
        executedActions.push({ action: 'youtube-search', value: query, url, target_device: targetDevice, verified: false });
        return `Hermes playback was unavailable, so I opened the YouTube search for "${query}" instead. I could not verify playback.`;
      }
      return `Failed to open YouTube: ${outcome.error}`;
    }

    case 'search_files': {
      const query = String(args.query || '').trim();
      if (!query) return 'Error: query is required.';
      const results = await searchUserFiles(query, args);
      executedActions.push({ action: 'file-search', value: query, count: results.length, target_device: targetDevice });
      return JSON.stringify({ query, count: results.length, results });
    }

    case 'search_apps': {
      const query = String(args.query || '').trim();
      const results = await listStartApps(query);
      executedActions.push({ action: 'app-search', value: query, count: results.length, target_device: targetDevice });
      return JSON.stringify({ query, count: results.length, results });
    }

    case 'get_running_apps': {
      const state = getLocalRuntimeState();
      const processes = Array.isArray(state.processes) ? state.processes : [];
      const applications = processes.filter(p => p?.hasWindow || p?.title).slice(0, 180);
      const backgroundProcesses = processes.filter(p => !p?.hasWindow && !p?.title).slice(0, 240);
      executedActions.push({ action: 'running-apps', count: processes.length, target_device: targetDevice });
      return JSON.stringify({
        currentForeground: state.foreground || null,
        processCount: processes.length,
        applications,
        backgroundProcesses,
        allProcesses: processes.slice(0, 500)
      });
    }

    case 'get_installed_apps': {
      const refresh = args.refresh !== false;
      if (refresh) await refreshInstalledAppsSnapshot();
      const state = getLocalRuntimeState();
      const apps = Array.isArray(state.installedApps) ? state.installedApps : [];
      executedActions.push({ action: 'installed-apps', count: apps.length, target_device: targetDevice });
      return JSON.stringify({ count: apps.length, apps: apps.slice(0, 250) });
    }

    case 'get_activity_state': {
      const state = getLocalRuntimeState();
      return JSON.stringify({
        deviceId: state.deviceId,
        deviceName: state.deviceName,
        online: state.online,
        lastSampleAt: state.lastSampleAt,
        foreground: state.foreground,
        runningProcessCount: state.processes?.length || 0,
        installedAppCount: state.installedApps?.length || 0,
        recentFileEvents: (state.recentFileEvents || []).slice(-20)
      });
    }

    case 'hermes_execute': {
      const instruction = String(args.instruction || '').trim();
      if (!instruction) return 'Error: Hermes instruction is required.';
      if (instruction.length > 8000) return 'Error: Hermes instruction is too long.';

      try {
        const sessionKey = `gemma-hermes-${DEVICE_ID}`;
        const resumeSessionId = hermesSessions.get(sessionKey) || null;
        const outcome = await runHermesTask(instruction, {
          recentConversation: '',
          model: hermesConfig().model || undefined,
          provider: hermesConfig().provider || undefined,
          toolsets: hermesConfig().toolsets,
          maxTurns: hermesConfig().maxTurns,
          timeoutMs: hermesConfig().timeoutMs,
          resumeSessionId,
          cwd: process.cwd()
        });

        if (outcome.sessionId) hermesSessions.set(sessionKey, outcome.sessionId);
        executedActions.push({
          action: 'hermes-agent',
          target_device: targetDevice,
          sessionId: outcome.sessionId,
          toolUses: outcome.toolUses?.map(t => t.name).filter(Boolean) || [],
          durationMs: outcome.durationMs
        });

        return JSON.stringify({
          success: true,
          completed: Boolean(outcome.exitCode === 0),
          verified: false,
          text: outcome.text,
          sessionId: outcome.sessionId,
          toolUses: outcome.toolUses || [],
          toolResults: outcome.toolResults || [],
          durationMs: outcome.durationMs
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          completed: false,
          verified: false,
          error: error.message
        });
      }
    }

    case 'lock_computer': {
      const command = 'rundll32.exe';
      return new Promise((resolve) => {
        execFile(command, ['user32.dll,LockWorkStation'], { windowsHide: true, timeout: 5000 }, (err) => {
          if (err) return resolve(`Failed to lock workstation: ${err.message}`);
          executedActions.push({ action: 'lock', target_device: targetDevice });
          resolve('Workstation locked successfully.');
        });
      });
    }

    case 'adjust_volume': {
      const action = String(args.action || '').toLowerCase().trim();
      const keyCode = action === 'up' ? 175 : action === 'down' ? 174 : action === 'mute' ? 173 : null;
      if (!keyCode) return `Error: Invalid volume action: ${action}`;
      return new Promise((resolve) => {
        const script = `(New-Object -ComObject WScript.Shell).SendKeys([char]${keyCode})`;
        execFile('powershell.exe',
          ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],
          { windowsHide: true, timeout: 5000 },
          (err) => {
            if (err) return resolve(`Failed to adjust volume: ${err.message}`);
            executedActions.push({ action: 'volume', value: action, target_device: targetDevice });
            resolve(`Volume adjustment (${action}) executed successfully.`);
          }
        );
      });
    }

    case 'sys_notify': {
      const msgText = String(args.message || 'Systems operating at nominal performance levels.');
      if (msgText.length > 500) return 'Error: notification message is too long.';
      return new Promise((resolve) => {
        const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$n.BalloonTipText = $env:JARVIS_NOTIFICATION
$n.BalloonTipTitle = 'STELLER AI System'
$n.Visible = $true
$n.ShowBalloonTip(5000)
Start-Sleep -Milliseconds 5500
$n.Dispose()
`;
        execFile('powershell.exe',
          ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps],
          { windowsHide: true, timeout: 8000, env: { ...process.env, JARVIS_NOTIFICATION: msgText } },
          (err) => {
            if (err) return resolve(`Failed to send system notification: ${err.message}`);
            executedActions.push({ action: 'sys-notify', value: msgText, target_device: targetDevice });
            resolve('System notification triggered successfully.');
          }
        );
      });
    }

    case 'control_iot_device': {
      const allowedDevices = new Set(['lights','ac','tv','speakers','curtains','locks']);
      const device = String(args.device || '').toLowerCase();
      if (!allowedDevices.has(device)) return `Error: Unknown IoT device ${device}.`;
      const nextState = Boolean(args.state);
      executedActions.push({ action: 'iot', device, state: nextState, value: args.value, target_device: targetDevice });
      return `Dashboard IoT command queued: set ${device} to ${nextState ? 'ON' : 'OFF'}.`;
    }

    case 'trigger_routine': {
      const allowed = new Set(['wakeup','movie','gaming','sleep','away','party']);
      const routine = String(args.routine || '').toLowerCase();
      if (!allowed.has(routine)) return `Error: Unknown routine ${routine}.`;
      executedActions.push({ action: 'routine', value: routine, target_device: targetDevice });
      return `Dashboard routine queued: ${routine}.`;
    }

    case 'get_system_metrics': {
      try {
        const cpuLoad = await getCpuUsage();
        const totalMemBytes = os.totalmem();
        const freeMemBytes = os.freemem();
        const usedMemBytes = totalMemBytes - freeMemBytes;
        const ramPercent = Math.round((usedMemBytes / totalMemBytes) * 100);
        return JSON.stringify({
          cpu: { load: cpuLoad, cores: os.cpus().length, model: os.cpus()[0]?.model || 'Unknown' },
          ram: { totalGB: (totalMemBytes / (1024**3)).toFixed(2), usedGB: (usedMemBytes / (1024**3)).toFixed(2), percent: ramPercent },
          uptime: `${(os.uptime() / 3600).toFixed(1)} hours`,
          system: { platform: os.platform(), osType: os.type(), release: os.release() }
        });
      } catch (e) {
        return `Failed to fetch telemetry metrics: ${e.message}`;
      }
    }

    case 'save_user_memory': {
      const detail = String(args.detail || '').trim();
      if (!detail) return 'Error: Memory detail is required.';
      if (detail.length > 1000) return 'Error: Memory detail is too long.';
      await saveMemoryToDisk(detail);
      executedActions.push({ action: 'memory-save', target_device: targetDevice });
      return `Memory detail successfully saved: "${detail}"`;
    }

    case 'forget_user_memory': {
      const detail = String(args.detail || '').trim();
      if (!detail) return 'Error: Memory search key is required.';
      const deletedCount = await deleteMemoryFromDisk(detail);
      executedActions.push({ action: 'memory-forget', value: detail, target_device: targetDevice });
      return deletedCount > 0
        ? `Successfully deleted ${deletedCount} matching memory item(s).`
        : `No memory items matching "${detail}" were found.`;
    }

    case 'calculate_expression': {
      const expression = String(args.expression || '').trim();
      if (!expression || expression.length > 300) return 'Error: Expression is required and must be short.';
      if (!/^[0-9+\-*/().%\s]+$/.test(expression)) return 'Error: Invalid characters in mathematical expression.';
      try {
        const result = Function(`"use strict"; return (${expression})`)();
        if (typeof result !== 'number' || !Number.isFinite(result)) return 'Error: Invalid calculation result.';
        return `Calculation result: ${result}`;
      } catch (e) {
        return `Failed to calculate: ${e.message}`;
      }
    }

    case 'research_and_learn_topic': {
      const topic = String(args.topic || '').trim();
      if (!topic) return 'Error: Topic parameter is required for research.';
      try {
        const outcome = await synthesizeAndLearn(topic, args.depth || 'deep');
        executedActions.push({ action: 'web-research', topic: outcome.topic, target_device: targetDevice });
        return JSON.stringify({
          status: 'SUCCESS_INDEXED',
          topic: outcome.topic,
          summary: outcome.summary,
          keyFacts: outcome.keyFacts,
          sources: outcome.sourceUrls
        });
      } catch (e) {
        return `Failed to research and learn topic "${topic}": ${e.message}`;
      }
    }

    case 'search_web': {
      const query = String(args.query || '').trim();
      if (!query) return 'Error: Search query is required.';
      try {
        const [ddgResults, wikiResults] = await Promise.all([searchDuckDuckGo(query), searchWikipedia(query)]);
        executedActions.push({ action: 'web-search', value: query, target_device: targetDevice });
        return JSON.stringify({ query, resultsCount: Math.min(8, wikiResults.length + ddgResults.length), results: [...wikiResults, ...ddgResults].slice(0, 8) });
      } catch (e) {
        return `Failed to perform web search: ${e.message}`;
      }
    }

    case 'fetch_web_article': {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\/[^\s]+$/i.test(url)) return 'Error: Valid http/https URL is required.';
      try {
        const content = await fetchWebPage(url, 3500);
        executedActions.push({ action: 'web-fetch', value: url, target_device: targetDevice });
        return content;
      } catch (e) {
        return `Failed to fetch webpage content: ${e.message}`;
      }
    }

    case 'query_learned_knowledge': {
      const query = String(args.query || '').trim();
      if (!query) return 'Error: Search query is required.';
      try {
        const matches = searchKnowledgeBase(query, 4);
        executedActions.push({ action: 'knowledge-query', value: query, target_device: targetDevice });
        return JSON.stringify({ matchesFound: matches.length, matches });
      } catch (e) {
        return `Failed to search knowledge core: ${e.message}`;
      }
    }

    case 'get_current_news': {
      try {
        const newsItems = await getCurrentNews(String(args.topic || ''));
        executedActions.push({ action: 'live-news', value: args.topic || 'Global Headlines', target_device: targetDevice });
        return JSON.stringify({ topic: args.topic || 'Top Stories', articlesCount: newsItems.length, articles: newsItems });
      } catch (e) {
        return `Failed to fetch live news feeds: ${e.message}`;
      }
    }

    default:
      return `Error: Unknown function/tool: ${name}`;
  }
}

// ==========================================
// SYSTEM AUTOMATION TOOLS DEFINITIONS
// ==========================================
const SYSTEM_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "open_app",
        description: "Opens a local Windows application. Supported apps: notepad, calc (calculator), chrome (browser), cmd (command prompt), paint, explorer (file explorer), taskmgr (task manager), whatsapp (WhatsApp Web portal). Use this if the user asks you to open a program.",
        parameters: {
          type: "OBJECT",
          properties: {
            appName: { type: "STRING", description: "The name of the app to launch, e.g. 'notepad', 'calc', 'chrome', 'cmd', 'explorer', 'taskmgr', 'paint', 'whatsapp'." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["appName"]
        }
      },
      {
        name: "open_url",
        description: "Opens a website URL in default web browser, e.g. https://youtube.com, https://google.com, etc. Use this if the user asks you to navigate to a website.",
        parameters: {
          type: "OBJECT",
          properties: {
            url: { type: "STRING", description: "The complete web URL, e.g., 'https://youtube.com' or 'https://github.com'." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["url"]
        }
      },
      {
        name: "open_path",
        description: "Opens a folder or file path inside the user's own Windows profile. Supported aliases include Downloads, Desktop, Documents, Pictures, Videos, Music, Home, and OneDrive.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: "A safe user-profile path or common folder alias such as Downloads." },
            target_device: { type: "STRING", description: "Target device. Defaults to the local JARVIS device." }
          },
          required: ["path"]
        }
      },
      {
        name: "play_youtube",
        description: "Searches YouTube and uses Hermes Computer Use to start and verify actual playback of the requested song or video when Computer Use is ready. Never treat merely opening search results as playback success.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "What to search/play on YouTube." },
            target_device: { type: "STRING", description: "Target device. Defaults to the local JARVIS device." }
          },
          required: ["query"]
        }
      },
      {
        name: "search_files",
        description: "Searches the user's own profile folders for files. Use this for 'find my file', 'where is that PDF', or similar requests.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Filename or content phrase to search for." },
            roots: { type: "ARRAY", items: { type: "STRING" }, description: "Optional roots: desktop, documents, downloads, onedrive, pictures, videos, music, home." },
            includeContent: { type: "BOOLEAN", description: "Also search text-file contents. Default false." },
            maxResults: { type: "NUMBER", description: "Maximum results, up to 200." },
            target_device: { type: "STRING", description: "Target device. Defaults to the local JARVIS device." }
          },
          required: ["query"]
        }
      },
      {
        name: "search_apps",
        description: "Searches the Windows Start Menu app registry for applications matching the user's requested app name.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Application name to search." },
            target_device: { type: "STRING", description: "Target device. Defaults to the local JARVIS device." }
          },
          required: ["query"]
        }
      },
      {
        name: "get_running_apps",
        description: "Returns the current Windows process/application snapshot and foreground window. Use this to answer what is running in the background or which app/window is active.",
        parameters: {
          type: "OBJECT",
          properties: {
            target_device: { type: "STRING", description: "Target device. Defaults to the local JARVIS device." }
          }
        }
      },
      {
        name: "get_installed_apps",
        description: "Refreshes and returns applications registered in the Windows Start Menu. Use this to discover whether an app is installed and what launcher name Windows exposes.",
        parameters: {
          type: "OBJECT",
          properties: {
            refresh: { type: "BOOLEAN", description: "Refresh the Start Menu snapshot before returning results. Defaults to true." },
            target_device: { type: "STRING", description: "Target device. Defaults to the local JARVIS device." }
          }
        }
      },
      {
        name: "get_activity_state",
        description: "Returns JARVIS live desktop activity state: current foreground app/window, running-process count, installed-app count, and recent filesystem events.",
        parameters: {
          type: "OBJECT",
          properties: {
            target_device: { type: "STRING", description: "Target device. Defaults to the local JARVIS device." }
          }
        }
      },
      {
        name: "hermes_execute",
        description: "Delegates a natural-language computer, browser, filesystem, or terminal task to the locally installed Hermes Agent. Use this for multi-step UI interaction, browser automation, reading visible application state, complex file operations, or any task that needs actual desktop observation and interaction. Hermes must verify the result before reporting completion.",
        parameters: {
          type: "OBJECT",
          properties: {
            instruction: { type: "STRING", description: "The complete task Hermes should perform on the user's authorized Windows desktop. Describe the desired end state and any important constraints." },
            target_device: { type: "STRING", description: "Target device. Defaults to the local JARVIS device." }
          },
          required: ["instruction"]
        }
      },
      {
        name: "lock_computer",
        description: "Locks the Windows computer workstation immediately.",
        parameters: {
          type: "OBJECT",
          properties: {
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          }
        }
      },
      {
        name: "adjust_volume",
        description: "Changes the host system's audio volume scale.",
        parameters: {
          type: "OBJECT",
          properties: {
            action: { type: "STRING", description: "The volume operation. Must be: 'up' (increase volume), 'down' (decrease volume), or 'mute' (mute/unmute toggle)." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["action"]
        }
      },
      {
        name: "sys_notify",
        description: "Sends and displays a native Windows system notification popup toast balloon.",
        parameters: {
          type: "OBJECT",
          properties: {
            message: { type: "STRING", description: "The content text of the system notification to display." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["message"]
        }
      },
      {
        name: "control_iot_device",
        description: "Controls smart dashboard gadgets (lights, ac, tv, speakers, curtains, locks) by emulating user switches and sliders.",
        parameters: {
          type: "OBJECT",
          properties: {
            device: { type: "STRING", description: "The target smart home device: lights, ac, tv, speakers, curtains, locks." },
            state: { type: "BOOLEAN", description: "True to turn ON / open curtains / secure locks; False to turn OFF / close curtains / unlock." },
            value: { type: "NUMBER", description: "Optional slider value. Lights: 10-100%, AC temperature: 16-30°C, TV channel: 1-100, Speakers: 0-100%." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["device", "state"]
        }
      },
      {
        name: "trigger_routine",
        description: "Activates a smart automation system routine (wakeup, movie, gaming, sleep, away, party) to change dashboard modes.",
        parameters: {
          type: "OBJECT",
          properties: {
            routine: { type: "STRING", description: "The routine to activate. Must be: wakeup, movie, gaming, sleep, away, party." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["routine"]
        }
      },
      {
        name: "get_system_metrics",
        description: "Fetches live PC resource telemetry (CPU core load, memory usage percentage, uptime, platform details). Use this when the user asks how your systems/resources are doing.",
        parameters: {
          type: "OBJECT",
          properties: {
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          }
        }
      },
      {
        name: "save_user_memory",
        description: "Saves a detail, preference, project goal, or piece of info about the user to long-term database memory.",
        parameters: {
          type: "OBJECT",
          properties: {
            detail: { type: "STRING", description: "The fact, detail, or preference about the user to commit to memory." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["detail"]
        }
      },
      {
        name: "forget_user_memory",
        description: "Deletes or forgets a previously saved detail about the user.",
        parameters: {
          type: "OBJECT",
          properties: {
            detail: { type: "STRING", description: "The fact or detail to find and delete." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["detail"]
        }
      },
      {
        name: "calculate_expression",
        description: "Performs mathematical calculations with 100% accuracy. Supported operations: addition (+), subtraction (-), multiplication (*), division (/), modulo (%), and grouping parentheses (). Use this tool whenever the user asks for mathematical computations, additions, divisions, multiplications, etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            expression: { type: "STRING", description: "The mathematical expression to evaluate, e.g. '1050 * (2 + 3)' or '849 / 3'." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["expression"]
        }
      },
      {
        name: "research_and_learn_topic",
        description: "Autonomously searches the internet (DuckDuckGo, Wikipedia, online articles), distills key insights and facts, and permanently stores the knowledge in STELLER's persistent structured knowledge base. Use this tool when the user asks you to learn, study, or research any subject from the internet.",
        parameters: {
          type: "OBJECT",
          properties: {
            topic: { type: "STRING", description: "The topic, technology, scientific discovery, concept, or event to research and learn." },
            depth: { type: "STRING", description: "Research depth: 'quick' (summaries & snippets) or 'deep' (full article scraping and deep fact distillation). Default is 'deep'." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["topic"]
        }
      },
      {
        name: "search_web",
        description: "Performs a live real-time internet search across DuckDuckGo and Wikipedia to find current information, answers, news, and links. Use this when the user asks a question that requires external web info.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "The search query to look up on the web." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["query"]
        }
      },
      {
        name: "fetch_web_article",
        description: "Retrieves and reads the clean readable text content of a specific webpage or web article URL.",
        parameters: {
          type: "OBJECT",
          properties: {
            url: { type: "STRING", description: "The full URL of the webpage or article to read." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["url"]
        }
      },
      {
        name: "query_learned_knowledge",
        description: "Searches STELLER's internal structured long-term knowledge base for previously researched and learned topics and facts.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "The concept, topic, or keyword to look up in the knowledge bank." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          },
          required: ["query"]
        }
      },
      {
        name: "get_current_news",
        description: "Fetches live real-time breaking news headlines, world events, and topic updates from verified public RSS news feeds. Use this when the user asks about current world events, latest news, breaking headlines, or category news.",
        parameters: {
          type: "OBJECT",
          properties: {
            topic: { type: "STRING", description: "Optional topic or category to filter news for (e.g. 'technology', 'world', 'science', 'business')." },
            target_device: { type: "STRING", description: "Optional client device to target for this action: [Desktop-PC], [Monitor-2], [Phone-Client-1], [Display-Client-2]. Default is [Desktop-PC]." }
          }
        }
      }
    ]
  },
  {
    googleSearch: {}
  }
];

// ==========================================
// HERMES AGENT EXECUTION BRIDGE
// ==========================================
const hermesSessions = new Map();
const remoteRelayQueues = new Map();
const remoteRelayResults = new Map();
const remoteDevices = new Map();
const REMOTE_RELAY_ENABLED = String(process.env.JARVIS_RELAY_ENABLED || 'false').toLowerCase() === 'true';
const REMOTE_RELAY_TOKEN = String(process.env.JARVIS_RELAY_TOKEN || '');
const REMOTE_RELAY_MAX_QUEUE = Math.max(10, Number(process.env.JARVIS_RELAY_MAX_QUEUE || 100));

const CLOUD_DESKTOP_DEVICE_ID = String(process.env.JARVIS_CLOUD_DESKTOP_DEVICE_ID || 'windows-main').trim();
const CLOUD_RELAY_WAIT_MS = Math.max(30_000, Math.min(100 * 60 * 1000, Number(process.env.JARVIS_CLOUD_RELAY_WAIT_MS || 12 * 60 * 1000)));
const CLOUD_RELAY_POLL_MS = Math.max(250, Math.min(5000, Number(process.env.JARVIS_CLOUD_RELAY_POLL_MS || 750)));
const cloudHermesSessions = new Map();

function getRemoteDevice(deviceId = CLOUD_DESKTOP_DEVICE_ID) {
  const device = remoteDevices.get(String(deviceId || '').trim());
  if (!device || !device.lastSeen) return null;
  const age = Date.now() - Date.parse(device.lastSeen);
  return age <= 30_000 ? { ...device, online: true } : { ...device, online: false };
}

function enqueueRelayTask(deviceId, kind, task, extra = {}) {
  const id = String(deviceId || '').trim();
  if (!id) throw new Error('A target desktop deviceId is required.');
  if (!REMOTE_RELAY_ENABLED || !REMOTE_RELAY_TOKEN) throw new Error('Desktop relay is not enabled/configured on this JARVIS cloud service.');
  const device = getRemoteDevice(id);
  if (!device?.online) throw new Error(`Desktop device '${id}' is offline. Start the JARVIS desktop relay agent on Windows.`);
  const queue = relayQueueFor(id);
  if (queue.length >= REMOTE_RELAY_MAX_QUEUE) throw new Error('Desktop relay queue is full. Please try again shortly.');
  const safeKind = ['task', 'screenshot'].includes(kind) ? kind : 'task';
  const safeTask = String(task || '').trim();
  if (safeKind === 'task' && !safeTask) throw new Error('Relay task text is required.');
  const item = {
    id: `relay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    deviceId: id,
    kind: safeKind,
    task: safeTask.slice(0, 8000),
    createdAt: new Date().toISOString(),
    status: 'queued',
    resumeSessionId: typeof extra.resumeSessionId === 'string' ? extra.resumeSessionId.slice(0, 180) : undefined,
    model: typeof extra.model === 'string' ? extra.model.slice(0, 180) : undefined,
    provider: typeof extra.provider === 'string' ? extra.provider.slice(0, 120) : undefined,
    maxTurns: Number.isFinite(Number(extra.maxTurns)) ? Math.min(150, Math.max(8, Number(extra.maxTurns))) : 80,
    timeoutMs: Number.isFinite(Number(extra.timeoutMs)) ? Math.min(CLOUD_RELAY_WAIT_MS, Math.max(30_000, Number(extra.timeoutMs))) : CLOUD_RELAY_WAIT_MS
  };
  queue.push(item);
  return item;
}

async function waitForRelayResult(taskId, timeoutMs = CLOUD_RELAY_WAIT_MS) {
  const deadline = Date.now() + Math.min(CLOUD_RELAY_WAIT_MS, Math.max(30_000, Number(timeoutMs) || CLOUD_RELAY_WAIT_MS));
  while (Date.now() < deadline) {
    const result = remoteRelayResults.get(String(taskId));
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, CLOUD_RELAY_POLL_MS));
  }
  throw new Error(`Desktop relay task '${taskId}' timed out before the Windows agent returned a result.`);
}

async function runCloudDesktopTask(task, extra = {}) {
  const item = enqueueRelayTask(extra.deviceId || CLOUD_DESKTOP_DEVICE_ID, 'task', task, extra);
  return waitForRelayResult(item.id, extra.timeoutMs);
}

async function runCloudScreenshot(extra = {}) {
  const item = enqueueRelayTask(extra.deviceId || CLOUD_DESKTOP_DEVICE_ID, 'screenshot', '', extra);
  return waitForRelayResult(item.id, Math.min(CLOUD_RELAY_WAIT_MS, 60_000));
}

function tokenEquals(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function relayAuthorized(req) {
  if (!REMOTE_RELAY_ENABLED) return false;
  if (!REMOTE_RELAY_TOKEN) return false;
  return tokenEquals(bearerToken(req), REMOTE_RELAY_TOKEN);
}

function relayOrWebAuthorized(req) {
  return relayAuthorized(req) || webAuthorized(req);
}

function webAuthorized(req) {
  if (!WEB_ACCESS_TOKEN) return false;
  return tokenEquals(bearerToken(req), WEB_ACCESS_TOKEN);
}

function isLoopbackRequest(req) {
  const raw = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return raw === '127.0.0.1' || raw === '::1' || raw === 'localhost';
}

function privateRequestAllowed(req, res) {
  if (isLoopbackRequest(req) || relayAuthorized(req) || webAuthorized(req)) return true;
  if (CLOUD_MODE && WEB_ACCESS_TOKEN) {
    res.status(401).json({
      success: false,
      error: 'JARVIS web access token required.'
    });
    return false;
  }
  res.status(403).json({
    success: false,
    error: 'This JARVIS endpoint is local-only or requires an authenticated JARVIS client.'
  });
  return false;
}

function relayQueueFor(deviceId) {
  const key = String(deviceId || '').trim().slice(0, 200);
  if (!remoteRelayQueues.has(key)) remoteRelayQueues.set(key, []);
  return remoteRelayQueues.get(key);
}

function hermesConfig() {
  const ollamaBase = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const localMode = String(process.env.HERMES_USE_LOCAL_OLLAMA ?? 'true').toLowerCase() !== 'false';
  return {
    enabled: String(process.env.HERMES_ENABLED ?? 'true').toLowerCase() !== 'false',
    localMode,
    model: String(process.env.HERMES_MODEL || (localMode ? (process.env.OLLAMA_MODEL || 'gemma4:e2b') : '')).trim(),
    provider: String(process.env.HERMES_PROVIDER || (localMode ? 'custom' : '')).trim(),
    baseUrl: String(process.env.HERMES_BASE_URL || `${ollamaBase}/v1`).replace(/\/$/, ''),
    contextLength: Math.max(0, Number(process.env.HERMES_CONTEXT_LENGTH || 65536)),
    ollamaNumCtx: Math.max(0, Number(process.env.HERMES_OLLAMA_NUM_CTX || 65536)),
    maxTurns: Math.max(8, Math.min(500, Number(process.env.HERMES_MAX_TURNS || 80))),
    timeoutMs: Math.max(30_000, Math.min(10 * 60 * 1000, Number(process.env.HERMES_TIMEOUT_MS || 180_000))),
    toolsets: process.env.HERMES_TOOLSETS || 'computer_use,browser,file,terminal,web,memory,skills,session_search'
  };
}

const PROVIDER_TOOL_LOOP_LIMIT = Math.max(1, Math.min(12, Number(process.env.JARVIS_TOOL_MAX_LOOPS || 8)));

function ollamaConfig() {
  return {
    enabled: String(process.env.OLLAMA_ENABLED ?? 'true').toLowerCase() !== 'false',
    baseUrl: String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: String(process.env.OLLAMA_MODEL || 'gemma4:e2b').trim()
  };
}

async function getOllamaStatus() {
  const cfg = ollamaConfig();
  if (CLOUD_MODE) {
    const relay = getRemoteDevice(CLOUD_DESKTOP_DEVICE_ID);
    const runtime = relay?.hermes || {};
    const ready = Boolean(relay?.online && runtime.localOllamaBindingReady);
    return {
      enabled: true,
      available: Boolean(relay?.online),
      modelAvailable: ready,
      mode: 'cloud-relay',
      localViaRelay: true,
      baseUrl: null,
      model: runtime.model || process.env.HERMES_MODEL || cfg.model || 'gemma4:e2b',
      detail: !relay?.online
        ? 'Waiting for the Windows desktop relay.'
        : (ready ? 'Local Ollama/Gemma is ready on the connected Windows desktop relay.' : (runtime.detail || 'Windows relay is online but its local Ollama/Gemma binding is not ready.'))
    };
  }
  if (!cfg.enabled) {
    return {
      enabled: false,
      available: false,
      modelAvailable: false,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      detail: 'Local Ollama brain is disabled.'
    };
  }

  try {
    const response = await resilientFetch(`${cfg.baseUrl}/api/tags`, { method: 'GET' }, 0);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        enabled: true,
        available: false,
        modelAvailable: false,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        detail: data.error || `Ollama returned HTTP ${response.status}.`
      };
    }

    const models = Array.isArray(data.models) ? data.models : [];
    const modelAvailable = models.some(m => String(m?.name || '') === cfg.model);
    return {
      enabled: true,
      available: true,
      modelAvailable,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      installedModels: models.map(m => m?.name).filter(Boolean),
      detail: modelAvailable ? 'Ollama and the configured local model are ready.' : 'Ollama is reachable, but the configured model is not installed.'
    };
  } catch (error) {
    return {
      enabled: true,
      available: false,
      modelAvailable: false,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      detail: error.message
    };
  }
}

async function getHermesStatus() {
  const cfg = hermesConfig();
  if (CLOUD_MODE) {
    const relay = getRemoteDevice(CLOUD_DESKTOP_DEVICE_ID);
    const runtime = relay?.hermes || {};
    return {
      enabled: true,
      installed: Boolean(relay?.online && runtime.installed),
      reachable: Boolean(relay?.online),
      configured: Boolean(relay?.online && runtime.configured),
      localOllamaBindingReady: Boolean(relay?.online && runtime.localOllamaBindingReady),
      computerUseReady: Boolean(relay?.online && runtime.computerUseReady),
      mode: 'cloud-relay',
      relayOnline: Boolean(relay?.online),
      relayDeviceId: CLOUD_DESKTOP_DEVICE_ID,
      version: null,
      computerUseStatus: null,
      computerUseDoctor: null,
      model: runtime.model || process.env.HERMES_MODEL || 'gemma4:e2b',
      provider: runtime.provider || process.env.HERMES_PROVIDER || 'custom',
      baseUrl: process.env.HERMES_BASE_URL || 'http://127.0.0.1:11434/v1',
      contextLength: Number(process.env.HERMES_CONTEXT_LENGTH || 65536),
      ollamaNumCtx: Number(process.env.HERMES_OLLAMA_NUM_CTX || 65536),
      expectedLocalModel: process.env.HERMES_MODEL || 'gemma4:e2b',
      expectedLocalProvider: process.env.HERMES_PROVIDER || 'custom',
      expectedLocalBaseUrl: process.env.HERMES_BASE_URL || 'http://127.0.0.1:11434/v1',
      toolsets: process.env.HERMES_TOOLSETS || 'computer_use,browser,file,terminal,web,memory,skills,session_search',
      localMode: true,
      detail: !relay?.online
        ? 'Waiting for the Windows desktop relay.'
        : (runtime.detail || (runtime.computerUseReady ? 'Hermes Computer Use is ready on the Windows desktop.' : 'Windows relay is online but Hermes Computer Use is not ready.'))
    };
  }
  if (!cfg.enabled) {
    return {
      enabled: false,
      installed: false,
      reachable: false,
      configured: false,
      computerUseReady: false,
      mode: 'cli',
      model: cfg.model || null,
      detail: 'Hermes integration is disabled.'
    };
  }

  const runtime = await getHermesRuntimeStatus();
  return {
    enabled: true,
    installed: Boolean(runtime.installed),
    reachable: Boolean(runtime.installed),
    configured: Boolean(runtime.configured),
    localOllamaBindingReady: Boolean(runtime.localOllamaBindingReady),
    computerUseReady: Boolean(runtime.computerUseReady),
    mode: 'cli',
    command: runtime.command,
    version: runtime.version,
    computerUseStatus: runtime.computerUseStatus || null,
    computerUseDoctor: runtime.computerUseDoctor || null,
    model: runtime.model || cfg.model || null,
    provider: runtime.provider || cfg.provider || null,
    baseUrl: runtime.baseUrl || cfg.baseUrl || null,
    contextLength: runtime.contextLength || null,
    ollamaNumCtx: runtime.ollamaNumCtx || null,
    expectedLocalModel: runtime.expectedLocalModel || cfg.model || null,
    expectedLocalProvider: runtime.expectedLocalProvider || cfg.provider || null,
    expectedLocalBaseUrl: runtime.expectedLocalBaseUrl || cfg.baseUrl || null,
    toolsets: cfg.toolsets,
    localMode: cfg.localMode,
    detail: runtime.detail
  };
}

function isExplicitLearnRequest(query) {
  const q = String(query || '').toLowerCase();
  return /\b(?:research|learn|study|investigate|deep\s+dive|look\s+into)\b/.test(q) && /\b(?:topic|about|on|into|this)\b/.test(q);
}

function extractLearnTopic(query) {
  return String(query || '')
    .replace(/\b(?:jarvis|steller)\b/ig, '')
    .replace(/\b(?:please\s+)?(?:research|learn|study|investigate|deep\s+dive\s+into|look\s+into)\b/ig, '')
    .replace(/^[\s:,-]+|[\s?.!,-]+$/g, '')
    .trim();
}

function isRememberRequest(query) {
  const q = String(query || '').trim();
  if (!q || /\bwhat\s+(?:do|did)\s+you\s+remember\b/i.test(q) || /\bwhat'?s\s+in\s+(?:your|my)\s+memory\b/i.test(q)) return false;
  return /\b(?:remember\s+(?:this|that|that\s+i)|please\s+remember|save\s+this|keep\s+in\s+mind|don't\s+forget\s+that)\b/i.test(q);
}

function isForgetRequest(query) {
  const q = String(query || '').trim();
  if (!q || /\bwhat\s+can\s+you\s+forget\b/i.test(q)) return false;
  return /\b(?:forget\s+(?:this|that)|please\s+forget|delete\s+.*\s+from\s+memory|remove\s+.*\s+from\s+memory)\b/i.test(q);
}

function extractMemoryDetail(query) {
  return String(query || '')
    .replace(/\b(?:jarvis|steller)\b/ig, '')
    .replace(/^.*?\b(?:remember|save\s+this|remember\s+that|keep\s+in\s+mind)\b[:\s]*/i, '')
    .replace(/^[\s:,-]+|[\s?.!,-]+$/g, '')
    .trim()
    .slice(0, 1000);
}

function extractForgetDetail(query) {
  return String(query || '')
    .replace(/\b(?:jarvis|steller)\b/ig, '')
    .replace(/^.*?\b(?:forget|delete\s+from\s+memory|remove\s+from\s+memory)\b[:\s]*/i, '')
    .replace(/^[\s:,-]+|[\s?.!,-]+$/g, '')
    .trim()
    .slice(0, 1000);
}

function buildLiveDeviceContext(query) {
  const q = String(query || '').toLowerCase();
  const needsDetail = /\b(?:running|background|process|installed|app(?:s|lication)?|window|what'?s\s+open|active)\b/.test(q);
  const state = getLocalRuntimeState();
  const base = {
    deviceId: state.deviceId,
    deviceName: state.deviceName,
    online: state.online,
    currentForeground: state.foreground || null,
    runningProcessCount: state.processes?.length || 0,
    installedAppCount: state.installedApps?.length || 0,
    recentFileEvents: (state.recentFileEvents || []).slice(-10)
  };
  if (needsDetail) {
    base.runningApps = (state.processes || [])
      .filter(p => p?.hasWindow || p?.title)
      .slice(0, 120)
      .map(p => ({ pid: p.pid, name: p.name, title: p.title, hasWindow: p.hasWindow }));
    base.installedApps = (state.installedApps || []).slice(0, 180);
  }
  return JSON.stringify(base);
}

function currentHermesQuery(contents) {
  const items = Array.isArray(contents) ? contents : [];
  const latest = [...items].reverse().find(item => item?.role === 'user' && item?.parts?.[0]?.text);
  return String(latest?.parts?.[0]?.text || '').trim();
}

function compactConversation(contents, maxItems = 8) {
  const items = Array.isArray(contents) ? contents.slice(-maxItems) : [];
  return items.map(item => {
    const role = item?.role === 'model' ? 'JARVIS' : String(item?.role || 'user').toUpperCase();
    const content = String(item?.parts?.[0]?.text || '').trim();
    return content ? `${role}: ${content}` : null;
  }).filter(Boolean).join('\n');
}

async function runChatWithHermes(systemInstruction, contents, sessionId = '', customModel = '') {
  const cfg = hermesConfig();
  if (!cfg.enabled) throw new Error('Hermes integration is disabled. Set HERMES_ENABLED=true in .env.');

  const query = currentHermesQuery(contents) || 'Continue the current JARVIS conversation.';
  const safeKey = String(sessionId || `jarvis-${DEVICE_ID}`).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 180);
  const resumeSessionId = hermesSessions.get(safeKey) || null;

  // Preserve JARVIS-managed persistence features that are separate from Hermes' own agent memory.
  let managedContext = '';
  if (isExplicitLearnRequest(query)) {
    const topic = extractLearnTopic(query);
    if (topic.length >= 3) {
      try {
        const learned = await synthesizeAndLearn(topic, 'deep');
        managedContext += `\n[JARVIS KNOWLEDGE ACTION COMPLETED]\nThe requested topic was researched and indexed into JARVIS knowledge. Topic: ${learned.topic}. Summary: ${learned.summary}\nKey facts: ${learned.keyFacts.join(' | ')}\nSources: ${learned.sourceUrls.join(', ')}\n`;
      } catch (error) {
        managedContext += `\n[JARVIS KNOWLEDGE ACTION FAILED]\nResearch could not be indexed: ${error.message}\n`;
      }
    }
  } else if (isForgetRequest(query)) {
    const detail = extractForgetDetail(query);
    if (detail) {
      const deleted = await deleteMemoryFromDisk(detail);
      managedContext += `\n[JARVIS MEMORY ACTION]\nForget request processed. Matching memory items deleted: ${deleted}.\n`;
    }
  } else if (isRememberRequest(query)) {
    const detail = extractMemoryDetail(query);
    if (detail) {
      await saveMemoryToDisk(detail);
      managedContext += `\n[JARVIS MEMORY ACTION]\nMemory saved successfully: ${detail}\n`;
    }
  }

  const liveDeviceContext = buildLiveDeviceContext(query);
  const context = [
    liveDeviceContext ? `\n[LIVE LOCAL DEVICE SNAPSHOT]\n${liveDeviceContext}` : '',
    resumeSessionId ? '' : (compactConversation(contents, 8) ? `\n[RECENT JARVIS CONVERSATION]\n${compactConversation(contents, 8)}` : ''),
    managedContext
  ].join('\n');

  const composedPrompt = [
    systemInstruction || 'You are JARVIS, a helpful personal AI assistant.',
    '\n[JARVIS CURRENT REQUEST]\n' + query,
    context
  ].join('\n');

  const outcome = await runHermesTask(composedPrompt, {
    model: cfg.model || String(customModel || '').trim() || undefined,
    provider: cfg.provider || undefined,
    toolsets: cfg.toolsets,
    maxTurns: cfg.maxTurns,
    timeoutMs: cfg.timeoutMs,
    resumeSessionId: resumeSessionId || undefined,
    cwd: process.cwd()
  });

  if (outcome.sessionId) hermesSessions.set(safeKey, outcome.sessionId);

  return {
    text: outcome.text,
    completed: Boolean(outcome.exitCode === 0),
    verified: false,
    actions: [{
      action: 'hermes-agent',
      target_device: DEVICE_ID,
      model: cfg.model || 'configured-default',
      sessionId: outcome.sessionId,
      toolUses: outcome.toolUses?.map(t => t.name).filter(Boolean) || [],
      durationMs: outcome.durationMs
    }],
    hermes: {
      sessionId: outcome.sessionId,
      toolUses: outcome.toolUses || [],
      toolResults: outcome.toolResults || [],
      durationMs: outcome.durationMs
    }
  };
}

// ==========================================
// GEMINI MULTI-TURN FUNCTION CALLING SYNAPSE
// ==========================================
async function runChatWithGemini(apiKey, systemInstruction, contents, customModel = '') {
  const model = customModel || 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: contents,
    tools: SYSTEM_TOOLS
  };

  const executedActions = [];

  // Handle multi-turn tool calling (up to 3 sequential calls in one turn)
  for (let loop = 0; loop < PROVIDER_TOOL_LOOP_LIMIT; loop++) {
    const res = await resilientFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `Gemini API Status Error ${res.status}`);
    }

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error("Empty content parts in Gemini API response.");
    }

    const functionCallPart = parts.find(p => p.functionCall);
    if (!functionCallPart) {
      // Final text response reached!
      const textPart = parts.find(p => p.text);
      return {
        text: textPart ? textPart.text : (executedActions.length > 0 ? 'The requested tool actions completed, but no final assistant text was returned.' : 'No final assistant response was returned.'),
        actions: executedActions,
        completed: true,
        verified: false
      };
    }

    const call = functionCallPart.functionCall;
    const name = call.name;
    const args = call.args || {};

    // Execute local system tool
    const result = await executeLocalAction(name, args, executedActions);

    // Feed back tool call and response turns to keep context chain aligned
    requestBody.contents.push({
      role: 'model',
      parts: [{ functionCall: call }]
    });

    requestBody.contents.push({
      role: 'user',
      parts: [{
        functionResponse: {
          name: name,
          response: { output: result }
        }
      }]
    });
  }

  return {
    text: `I reached the tool-call safety limit (${PROVIDER_TOOL_LOOP_LIMIT}) before I could obtain a final verified response. I will not claim that the overall task was completed.`,
    actions: executedActions,
    completed: false,
    verified: false,
    limitReached: true
  };
}

// Convert Gemini-style uppercase JSON schema types to standard OpenAI-compatible JSON Schema.
function normalizeOpenAIToolSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = { ...schema };
  if (typeof out.type === 'string') out.type = out.type.toLowerCase();
  if (out.properties && typeof out.properties === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([key, value]) => [key, normalizeOpenAIToolSchema(value)])
    );
  }
  if (Array.isArray(out.required)) out.required = [...out.required];
  if (out.items) out.items = normalizeOpenAIToolSchema(out.items);
  return out;
}

// ==========================================
// OPENAI-COMPATIBLE MULTI-TURN FUNCTION CALLING SYNAPSE
// ==========================================
async function runChatWithOpenAI(provider, apiKey, modelName, systemInstruction, contents) {
  // Translate tools from SYSTEM_TOOLS[0]
  const openAiTools = SYSTEM_TOOLS[0].functionDeclarations.map(fd => ({
    type: "function",
    function: {
      name: fd.name,
      description: fd.description,
      parameters: normalizeOpenAIToolSchema(fd.parameters)
    }
  }));

  // Build endpoint and model
  let url = 'https://api.openai.com/v1/chat/completions';
  let defaultModel = 'gpt-4o';

  if (provider === 'openrouter') {
    url = 'https://openrouter.ai/api/v1/chat/completions';
    defaultModel = 'meta-llama/llama-3-8b-instruct:free';
  } else if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    defaultModel = 'llama3-8b-8192';
  } else if (provider === 'huggingface') {
    url = 'https://api-inference.huggingface.co/v1/chat/completions';
    defaultModel = 'meta-llama/Meta-Llama-3-8B-Instruct';
  } else if (provider === 'ollama') {
    const ollama = ollamaConfig();
    url = `${ollama.baseUrl}/v1/chat/completions`;
    defaultModel = ollama.model;
  }

  const model = modelName || defaultModel;

  // Build message chain
  const messages = [
    { role: "system", content: systemInstruction }
  ];

  contents.forEach(item => {
    const role = item.role === 'model' ? 'assistant' : item.role;
    const content = item.parts?.[0]?.text || '';
    messages.push({ role, content });
  });

  const executedActions = [];
  let useTools = true;

  for (let loop = 0; loop < PROVIDER_TOOL_LOOP_LIMIT; loop++) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider === 'ollama' ? 'ollama' : apiKey}`
    };
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'http://localhost:3000';
      headers['X-Title'] = 'STELLAR AI';
    }

    const bodyData = {
      model: model,
      messages: messages
    };

    if (useTools) {
      bodyData.tools = openAiTools;
      bodyData.tool_choice = "auto";
    }

    let response = await resilientFetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(bodyData)
    });

    // Fallback: If request fails because of tool calling support (e.g. Hugging Face serverless 400 bad request for certain models)
    if (!response.ok && useTools && provider !== 'ollama') {
      console.warn(`[JARVIS API Warning] Provider ${provider} failed with tools. Retrying request without tool calling...`);
      useTools = false;
      delete bodyData.tools;
      delete bodyData.tool_choice;
      response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(bodyData)
      });
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `API Status Error ${response.status} from ${provider}`);
    }

    const choice = data.choices?.[0];
    const assistantMessage = choice?.message;
    if (!assistantMessage) {
      throw new Error("No response message from model.");
    }

    // Push the assistant's message to the conversation history so they see their tool call
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // No tool calls, return text response!
      return {
        text: assistantMessage.content || (executedActions.length > 0 ? 'The requested tool actions completed, but the model did not provide a final response.' : 'The model did not provide a final response.'),
        actions: executedActions,
        completed: true,
        verified: false
      };
    }

    // Execute tool calls
    for (const toolCall of toolCalls) {
      const name = toolCall.function.name;
      let args = {};
      try {
        args = typeof toolCall.function.arguments === 'string' ? JSON.parse(toolCall.function.arguments) : toolCall.function.arguments || {};
      } catch (e) {
        console.error("Failed to parse function arguments:", e);
      }

      const result = await executeLocalAction(name, args, executedActions);

      // Append tool result
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: name,
        content: JSON.stringify({ output: result })
      });
    }
  }

  // Safety stop after the configured tool-call budget. Never fabricate success.
  return {
    text: `I reached the tool-call safety limit (${PROVIDER_TOOL_LOOP_LIMIT}) before I could obtain a final verified response. I will not claim that the overall task was completed.`,
    actions: executedActions,
    completed: false,
    verified: false,
    limitReached: true
  };
}

// Telemetry Endpoint
app.get('/api/system', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    if (CLOUD_MODE) {
      const relay = getRemoteDevice(CLOUD_DESKTOP_DEVICE_ID);
      return res.json({
        cloudMode: true,
        source: 'render-cloud',
        cpu: { load: os.loadavg()[0] || 0, cores: os.cpus().length, model: os.cpus()[0]?.model || 'Render host' },
        ram: {
          total: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
          used: Number(((os.totalmem() - os.freemem()) / (1024 ** 3)).toFixed(2)),
          percent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
        },
        disk: { total: 'N/A', free: 'N/A', percent: 0 },
        system: { platform: process.platform, osType: os.type(), release: os.release(), uptime: (os.uptime() / 3600).toFixed(1) },
        desktop: {
          deviceId: CLOUD_DESKTOP_DEVICE_ID,
          online: Boolean(relay?.online),
          computerUseReady: Boolean(relay?.online && relay?.hermes?.computerUseReady),
          lastSeen: relay?.lastSeen || null
        }
      });
    }

    const cpuLoad = await getCpuUsage();
    
    // RAM calculations (in GB)
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = totalMemBytes - freeMemBytes;
    
    const ramTotal = (totalMemBytes / (1024 * 1024 * 1024)).toFixed(2);
    const ramUsed = (usedMemBytes / (1024 * 1024 * 1024)).toFixed(2);
    const ramPercent = Math.round((usedMemBytes / totalMemBytes) * 100);

    // Platform & Uptime
    const platform = os.platform(); // win32, linux, etc.
    const osType = os.type();
    const release = os.release();
    const uptimeSec = os.uptime();
    const uptimeHours = (uptimeSec / 3600).toFixed(1);

    // Disk Telemetry (using WMIC/PowerShell for C: drive stats)
    let diskTotal = 'N/A';
    let diskFree = 'N/A';
    let diskPercent = 0;

    exec('powershell -Command "Get-CimInstance Win32_LogicalDisk -Filter \\"DeviceID=\'C:\'\\" | Select-Object Size, FreeSpace | ConvertTo-Json"', (err, stdout) => {
      if (!err && stdout) {
        try {
          const diskInfo = JSON.parse(stdout);
          if (diskInfo && diskInfo.Size && diskInfo.FreeSpace) {
            const total = parseInt(diskInfo.Size);
            const free = parseInt(diskInfo.FreeSpace);
            const used = total - free;
            diskTotal = (total / (1024 * 1024 * 1024)).toFixed(0);
            diskFree = (free / (1024 * 1024 * 1024)).toFixed(0);
            diskPercent = Math.round((used / total) * 100);
          }
        } catch (e) {
          // Fallback if parsing errors
        }
      }

      res.json({
        cpu: {
          load: cpuLoad,
          cores: os.cpus().length,
          model: os.cpus()[0]?.model || 'Unknown'
        },
        ram: {
          total: parseFloat(ramTotal),
          used: parseFloat(ramUsed),
          percent: ramPercent
        },
        disk: {
          total: diskTotal,
          free: diskFree,
          percent: diskPercent
        },
        system: {
          platform,
          osType,
          release,
          uptime: uptimeHours
        }
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve telemetry data.' });
  }
});


// Basic local health probe used by launchers and smoke tests.
app.get('/api/health', (req, res) => {
  if (CLOUD_MODE) {
    const relay = getRemoteDevice(CLOUD_DESKTOP_DEVICE_ID);
    return res.json({
      success: true,
      service: 'jarvis',
      status: 'healthy',
      mode: 'cloud-relay',
      authRequired: Boolean(WEB_ACCESS_TOKEN),
      desktopRelay: {
        enabled: REMOTE_RELAY_ENABLED,
        deviceId: CLOUD_DESKTOP_DEVICE_ID,
        online: Boolean(relay?.online),
        lastSeen: relay?.lastSeen || null
      },
      uptimeSeconds: Math.round(process.uptime())
    });
  }
  const runtime = getLocalRuntimeState();
  res.json({
    success: true,
    service: 'jarvis',
    deviceId: DEVICE_ID,
    deviceName: DEVICE_NAME,
    host: HOST,
    port: PORT,
    activityEnabled: ACTIVITY_ENABLED,
    activityAgent: {
      online: Boolean(runtime.online),
      currentForeground: runtime.foreground || null,
      runningProcessCount: runtime.processes?.length || 0,
      installedAppCount: runtime.installedApps?.length || 0,
      lastSampleAt: runtime.lastSampleAt || null
    },
    uptimeSeconds: Math.round(process.uptime())
  });
});

app.get('/api/hermes/status', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  const status = await getHermesStatus();
  res.json({ success: true, ...status });
});

app.get('/api/ollama/status', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  const status = await getOllamaStatus();
  res.json({ success: true, ...status });
});

app.get('/api/hermes/doctor', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const status = await getHermesStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/hermes/refresh', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    await resolveHermesCommand(true);
    const status = await getHermesStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.get('/api/hermes/capabilities', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const status = await getHermesStatus();
    if (!status.enabled) return res.json({ success: true, enabled: false, capabilities: null });
    res.json({
      success: status.installed && status.computerUseReady,
      enabled: true,
      installed: status.installed,
      computerUseReady: status.computerUseReady,
      localOllamaBindingReady: Boolean(status.localOllamaBindingReady),
      mode: status.mode,
      toolsets: status.toolsets,
      version: status.version,
      capabilities: {
        computerUse: status.computerUseReady,
        localOllama: Boolean(status.localOllamaBindingReady),
        browser: true,
        filesystem: true,
        terminal: true,
        web: true,
        memory: true,
        sessionSearch: true
      },
      detail: status.detail
    });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.get('/api/devices', (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  const now = Date.now();
  const remote = [...remoteDevices.values()].map(device => ({
    ...device,
    online: Boolean(device.lastSeen && now - Date.parse(device.lastSeen) <= 30000)
  }));
  const local = getRegisteredDevices();
  const map = new Map(local.map(device => [device.deviceId, device]));
  for (const device of remote) map.set(device.deviceId, device);
  res.json({ success: true, devices: [...map.values()] });
});

app.get('/api/activity', (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  res.json({ success: true, deviceId: DEVICE_ID, activity: loadActivity().slice(-limit) });
});

app.get('/api/briefing', (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  res.json({ success: true, briefing: buildReturnBriefing() });
});

app.get('/api/activity/summary', (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  res.json({ success: true, summary: getRecentActivitySummary(Number(req.query.limit || 200)) });
});

app.get('/api/activity/state', (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  res.json({ success: true, state: getLocalRuntimeState() });
});

app.get('/api/activity/processes', (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  const state = getLocalRuntimeState();
  res.json({ success: true, currentForeground: state.foreground || null, count: state.processes?.length || 0, processes: state.processes || [] });
});

app.get('/api/activity/installed-apps', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const apps = await refreshInstalledAppsSnapshot();
    const query = String(req.query.q || '').trim().toLowerCase();
    const filtered = query ? apps.filter(a => String(a?.Name || '').toLowerCase().includes(query)) : apps;
    res.json({ success: true, count: filtered.length, apps: filtered });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/files/search', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const { query, roots, includeContent, maxResults } = req.body || {};
    if (!query || typeof query !== 'string') return res.status(400).json({ success: false, error: 'query is required.' });
    const results = await searchUserFiles(query, { roots, includeContent, maxResults });
    res.json({ success: true, query, count: results.length, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/apps/search', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const query = String(req.query.q || '').trim();
    const results = await listStartApps(query);
    res.json({ success: true, query, count: results.length, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Optional cloud-to-desktop relay. The desktop agent makes outbound authenticated polls, so the
// cloud does not need to expose the user's local machine directly. Queue storage is in-memory for this
// single-node MVP; production deployments should replace it with a durable queue/database.
app.post('/api/relay/heartbeat', (req, res) => {
  if (!relayAuthorized(req)) return res.status(401).json({ success: false, error: 'Relay authorization failed or relay is disabled.' });
  const deviceId = String(req.body?.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId is required.' });
  remoteDevices.set(deviceId, {
    deviceId,
    name: String(req.body?.name || deviceId).slice(0, 120),
    type: String(req.body?.type || 'windows-desktop').slice(0, 80),
    capabilities: Array.isArray(req.body?.capabilities) ? req.body.capabilities.slice(0, 100) : ['computer_use'],
    hermes: req.body?.hermes && typeof req.body.hermes === 'object' ? {
      installed: Boolean(req.body.hermes.installed),
      configured: Boolean(req.body.hermes.configured),
      localOllamaBindingReady: Boolean(req.body.hermes.localOllamaBindingReady),
      computerUseReady: Boolean(req.body.hermes.computerUseReady),
      model: String(req.body.hermes.model || '').slice(0, 180) || null,
      provider: String(req.body.hermes.provider || '').slice(0, 120) || null,
      detail: String(req.body.hermes.detail || '').slice(0, 4000) || null
    } : null,
    lastSeen: new Date().toISOString(),
    online: true
  });
  res.json({ success: true, device: remoteDevices.get(deviceId) });
});

app.get('/api/relay/devices', (req, res) => {
  if (!relayOrWebAuthorized(req)) return res.status(401).json({ success: false, error: 'Relay/web authorization failed or relay is disabled.' });
  const now = Date.now();
  const local = getRegisteredDevices();
  const remote = [...remoteDevices.values()].map(device => ({
    ...device,
    online: Boolean(device.lastSeen && now - Date.parse(device.lastSeen) <= 30000)
  }));
  const map = new Map(local.map(device => [device.deviceId, device]));
  for (const device of remote) map.set(device.deviceId, device);
  res.json({ success: true, devices: [...map.values()] });
});

app.post('/api/relay/task', (req, res) => {
  if (!relayOrWebAuthorized(req)) return res.status(401).json({ success: false, error: 'Relay/web authorization failed or relay is disabled.' });
  const deviceId = String(req.body?.deviceId || '').trim();
  const kind = String(req.body?.kind || 'task').trim().toLowerCase();
  const task = String(req.body?.task || '').trim();
  if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId is required.' });
  if (!['task', 'screenshot'].includes(kind)) return res.status(400).json({ success: false, error: 'Unsupported relay task kind.' });
  if (kind === 'task' && !task) return res.status(400).json({ success: false, error: 'task is required for a normal relay task.' });
  if (task.length > 8000) return res.status(413).json({ success: false, error: 'task is too long.' });
  const queue = relayQueueFor(deviceId);
  if (queue.length >= REMOTE_RELAY_MAX_QUEUE) return res.status(429).json({ success: false, error: 'Device relay queue is full.' });
  const item = { id: `relay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, deviceId, kind, task, createdAt: new Date().toISOString(), status: 'queued' };
  queue.push(item);
  res.json({ success: true, taskId: item.id, queued: true, kind, depth: queue.length });
});

app.get('/api/relay/poll', (req, res) => {
  if (!relayAuthorized(req)) return res.status(401).json({ success: false, error: 'Relay authorization failed or relay is disabled.' });
  const deviceId = String(req.query.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId is required.' });
  const queue = relayQueueFor(deviceId);
  const task = queue.shift() || null;
  res.json({ success: true, task });
});

app.post('/api/relay/result', (req, res) => {
  if (!relayAuthorized(req)) return res.status(401).json({ success: false, error: 'Relay authorization failed or relay is disabled.' });
  const deviceId = String(req.body?.deviceId || '').trim();
  const taskId = String(req.body?.taskId || '').trim();
  if (!deviceId || !taskId) return res.status(400).json({ success: false, error: 'deviceId and taskId are required.' });
  const imageData = typeof req.body?.imageData === 'string' ? req.body.imageData.slice(0, 2_000_000) : null;
  const resultEvent = {
    taskId,
    deviceId,
    status: req.body?.success ? 'completed' : 'failed',
    success: Boolean(req.body?.success),
    completed: typeof req.body?.completed === 'boolean' ? req.body.completed : Boolean(req.body?.success),
    verified: Boolean(req.body?.verified),
    text: String(req.body?.text || '').slice(0, 12000),
    sessionId: req.body?.sessionId ? String(req.body.sessionId).slice(0, 180) : null,
    toolUses: Array.isArray(req.body?.toolUses) ? req.body.toolUses.slice(0, 100).map(item => typeof item === 'string' ? item.slice(0, 500) : { name: String(item?.name || '').slice(0, 180), status: String(item?.status || '').slice(0, 80) }).filter(item => typeof item === 'string' ? item.length > 0 : item.name.length > 0) : [],
    toolResults: Array.isArray(req.body?.toolResults) ? req.body.toolResults.slice(0, 100).map(item => typeof item === 'string' ? item.slice(0, 4000) : item).filter(Boolean) : [],
    durationMs: Number.isFinite(Number(req.body?.durationMs)) ? Math.max(0, Math.min(100 * 60 * 1000, Number(req.body.durationMs))) : null,
    imageData,
    error: req.body?.error ? String(req.body.error).slice(0, 4000) : null,
    completedAt: new Date().toISOString()
  };
  remoteRelayResults.set(taskId, resultEvent);
  if (remoteRelayResults.size > 5000) {
    const oldestKey = remoteRelayResults.keys().next().value;
    if (oldestKey) remoteRelayResults.delete(oldestKey);
  }
  res.json({ success: true, result: resultEvent });
});

app.get('/api/relay/result/:taskId', (req, res) => {
  if (!relayOrWebAuthorized(req)) return res.status(401).json({ success: false, error: 'Relay/web authorization failed or relay is disabled.' });
  const result = remoteRelayResults.get(String(req.params.taskId || ''));
  if (!result) return res.status(404).json({ success: false, error: 'Result not available yet.' });
  res.json({ success: true, result });
});

// Remote desktop control foundation. Actual screen streaming is intentionally separate from
// computer-use execution; this endpoint exposes liveness/capability state for an authorized client.
app.get('/api/remote/desktop-status', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  if (CLOUD_MODE) {
    const relay = getRemoteDevice(CLOUD_DESKTOP_DEVICE_ID);
    return res.json({
      success: true,
      desktopOnline: Boolean(relay?.online),
      deviceId: CLOUD_DESKTOP_DEVICE_ID,
      deviceName: relay?.name || CLOUD_DESKTOP_DEVICE_ID,
      computerUseReady: Boolean(relay?.online && relay?.hermes?.computerUseReady),
      hermes: relay?.hermes || null,
      lastSeen: relay?.lastSeen || null,
      streaming: false,
      screenshotAvailable: Boolean(relay?.online),
      screenshotEndpoint: '/api/remote/screenshot',
      streamingNote: 'Cloud mode uses authenticated on-demand relay screenshots; continuous low-latency streaming is not enabled.'
    });
  }
  const status = await getHermesStatus();
  const activity = getLocalRuntimeState();
  res.json({
    success: true,
    desktopOnline: Boolean(activity.online),
    deviceId: DEVICE_ID,
    deviceName: DEVICE_NAME,
    computerUseReady: Boolean(status.computerUseReady),
    lastSeen: activity.lastSampleAt,
    streaming: false,
    screenshotAvailable: process.platform === 'win32',
    screenshotEndpoint: '/api/remote/screenshot',
    streamingNote: 'JARVIS exposes secure on-demand screenshots; continuous low-latency streaming remains a separate transport.'
  });
});

app.get('/api/remote/screenshot', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    if (CLOUD_MODE) {
      const result = await runCloudScreenshot({ deviceId: CLOUD_DESKTOP_DEVICE_ID });
      if (!result.success || !result.imageData) throw new Error(result.error || 'Desktop relay did not return a screenshot.');
      return res.json({ success: true, mimeType: 'image/jpeg', dataUrl: result.imageData, relayTaskId: result.taskId });
    }
    const image = await capturePrimaryScreen();
    res.json({ success: true, mimeType: 'image/jpeg', width: image.width, height: image.height, dataUrl: `data:image/jpeg;base64,${image.data}` });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/remote/desktop-task', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  const task = String(req.body?.task || '').trim();
  if (!task) return res.status(400).json({ success: false, error: 'task is required.' });
  if (task.length > 8000) return res.status(413).json({ success: false, error: 'task is too long.' });
  if (CLOUD_MODE) {
    try {
      const result = await runCloudDesktopTask(task, {
        deviceId: CLOUD_DESKTOP_DEVICE_ID,
        resumeSessionId: typeof req.body?.resumeSessionId === 'string' ? req.body.resumeSessionId : undefined,
        timeoutMs: Math.min(CLOUD_RELAY_WAIT_MS, Number(req.body?.timeoutMs || CLOUD_RELAY_WAIT_MS)),
        maxTurns: Math.min(150, Number(req.body?.maxTurns || 150))
      });
      return res.json({
        success: true,
        completed: Boolean(result.success),
        verified: false,
        text: String(result.text || '').trim(),
        sessionId: result.sessionId || null,
        toolUses: result.toolUses || [],
        toolResults: result.toolResults || [],
        durationMs: result.durationMs || null,
        relayTaskId: result.taskId
      });
    } catch (error) {
      return res.status(502).json({ success: false, error: error.message });
    }
  }
  req.body = { ...(req.body || {}), task };
  const cfg = hermesConfig();
  if (!cfg.enabled) return res.status(503).json({ success: false, error: 'Hermes integration is disabled.' });
  try {
    const status = await getHermesStatus();
    if (!status.computerUseReady) return res.status(503).json({ success: false, error: 'Hermes Computer Use is not ready on this desktop.' });
    if (cfg.localMode && !status.localOllamaBindingReady) {
      return res.status(503).json({ success: false, error: 'Hermes is not bound to the configured local Ollama/Gemma model.' });
    }
    const outcome = await runHermesTask(task, {
      model: cfg.model || undefined,
      provider: cfg.provider || undefined,
      toolsets: cfg.toolsets,
      maxTurns: Math.min(150, Number(req.body.maxTurns || cfg.maxTurns)),
      timeoutMs: Math.min(10 * 60 * 1000, Number(req.body.timeoutMs || cfg.timeoutMs)),
      resumeSessionId: typeof req.body.resumeSessionId === 'string' ? req.body.resumeSessionId : undefined
    });
    const completed = Boolean(outcome.exitCode === 0);
    res.json({
      success: completed,
      completed,
      verified: false,
      text: outcome.text,
      sessionId: outcome.sessionId,
      toolUses: outcome.toolUses,
      toolResults: outcome.toolResults,
      durationMs: outcome.durationMs
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// Laptop Automation Control Endpoint
app.post('/api/action', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  const { action, value } = req.body || {};
  console.log(`[JARVIS COMMAND RECEIVED] Action: ${action}, Value: ${value}`);

  if (CLOUD_MODE) {
    const allowedActions = new Set(['lock','open-app','open-url','open-path']);
    if (!allowedActions.has(String(action))) return res.status(400).json({ success: false, error: 'Unsupported cloud action.' });
    const task = action === 'open-app'
      ? `On the authorized Windows desktop, open the application named "${String(value || '').slice(0, 200)}" and verify that it launched successfully. Do not perform any unrelated action.`
      : action === 'open-url'
        ? `On the authorized Windows desktop, open this exact URL in the browser: ${String(value || '').slice(0, 1000)}. Verify the browser navigated successfully. Do not perform any unrelated action.`
        : action === 'open-path'
          ? `On the authorized Windows desktop, open this user path/folder alias: ${String(value || '').slice(0, 1000)}. Verify it opened successfully. Do not perform any unrelated action.`
          : 'On the authorized Windows desktop, lock the workstation and verify that the lock action was initiated successfully.';
    try {
      const result = await runCloudDesktopTask(task, { deviceId: CLOUD_DESKTOP_DEVICE_ID, timeoutMs: Math.min(CLOUD_RELAY_WAIT_MS, 120_000), maxTurns: 40 });
      return res.json({ success: Boolean(result.success), output: result.text || (result.success ? 'Action completed.' : 'Action failed.'), completed: Boolean(result.success), verified: false, relayTaskId: result.taskId });
    } catch (error) {
      return res.status(502).json({ success: false, error: error.message });
    }
  }

  try {
    let outcome;
    switch (action) {
      case 'lock':
        outcome = await executeLocalAction('lock_computer', {}, []);
        break;
      case 'open-app':
        outcome = await executeLocalAction('open_app', { appName: value }, []);
        break;
      case 'open-url':
        outcome = await executeLocalAction('open_url', { url: value }, []);
        break;
      case 'open-path':
        outcome = await executeLocalAction('open_path', { path: value }, []);
        break;
      case 'play-youtube':
        outcome = await executeLocalAction('play_youtube', { query: value }, []);
        break;
      case 'volume-up':
        outcome = await executeLocalAction('adjust_volume', { action: 'up' }, []);
        break;
      case 'volume-down':
        outcome = await executeLocalAction('adjust_volume', { action: 'down' }, []);
        break;
      case 'volume-mute':
        outcome = await executeLocalAction('adjust_volume', { action: 'mute' }, []);
        break;
      case 'sys-notify':
        outcome = await executeLocalAction('sys_notify', { message: value }, []);
        break;
      default:
        return res.status(400).json({ success: false, error: `Unsupported action: ${action}` });
    }

    const outcomeText = String(outcome || '').trim();
    const success = !/^(Failed|Error|Unable)\b/i.test(outcomeText) && outcomeText.length > 0;
    res.status(success ? 200 : 500).json({
      success,
      action,
      output: outcome
    });
  } catch (error) {
    console.error('[JARVIS Action Error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all saved memories from the memory core
app.get('/api/memories', (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const memories = loadMemoriesFromDisk();
    res.json({ success: true, memories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all memories in the memory core
app.delete('/api/memories', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    await clearAllMemoriesFromDisk();
    res.json({ success: true, message: 'Memory bank cleared.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all structured knowledge entries from the knowledge base
app.get('/api/knowledge', (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const kb = loadKnowledgeBaseFromDisk();
    res.json({ success: true, entries: kb.entries || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete or clear knowledge entries
app.delete('/api/knowledge', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const { id, topic, clearAll } = req.body || {};
    if (clearAll) {
      await clearAllKnowledgeFromDisk();
      return res.json({ success: true, message: 'Knowledge bank cleared completely.' });
    }
    const key = id || topic;
    if (!key) {
      return res.status(400).json({ error: 'id or topic parameter is required to delete knowledge entry.' });
    }
    const deletedCount = await deleteKnowledgeEntryFromDisk(key);
    res.json({ success: true, deletedCount, message: `Deleted ${deletedCount} knowledge record(s).` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Autonomous Web Learning Endpoint
app.post('/api/learn', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  const { topic, depth } = req.body;
  if (!topic) {
    return res.status(400).json({ error: 'Topic parameter is required.' });
  }
  try {
    const result = await synthesizeAndLearn(topic, depth || 'deep');
    res.json({ success: true, result });
  } catch (error) {
    console.error('[Autonomous Learn Error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get live current events & news headlines via RSS feeds
app.get('/api/news', async (req, res) => {
  try {
    const topic = req.query.topic || req.query.q || '';
    const news = await getCurrentNews(topic);
    res.json({ success: true, count: news.length, topic: topic || 'top_stories', news });
  } catch (error) {
    console.error('[News API Error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get autolearn settings and topic queue
app.get('/api/autolearn', (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const config = loadAutoLearnConfig();
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update autolearn settings
app.post('/api/autolearn', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const current = loadAutoLearnConfig();
    const { enabled, intervalMinutes, topics } = req.body;
    if (enabled !== undefined) current.enabled = !!enabled;
    if (intervalMinutes !== undefined && Number(intervalMinutes) > 0) current.intervalMinutes = Number(intervalMinutes);
    if (Array.isArray(topics)) current.topics = topics.filter(t => typeof t === 'string' && t.trim().length > 0);
    
    await saveAutoLearnConfig(current);
    res.json({ success: true, config: current, message: `Auto-learning is now ${current.enabled ? 'ENABLED' : 'DISABLED'}.` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a new topic to the autolearn queue
app.post('/api/autolearn/topic', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const { topic } = req.body;
    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return res.status(400).json({ error: 'Topic parameter is required.' });
    }
    const cleanTopic = topic.trim();
    const config = loadAutoLearnConfig();
    if (!config.topics.some(t => t.toLowerCase() === cleanTopic.toLowerCase())) {
      config.topics.push(cleanTopic);
      await saveAutoLearnConfig(config);
    }
    res.json({ success: true, topic: cleanTopic, topics: config.topics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a topic from the autolearn queue
app.delete('/api/autolearn/topic', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const { topic } = req.body;
    if (!topic) {
      return res.status(400).json({ error: 'Topic parameter is required.' });
    }
    const cleanTopic = topic.toLowerCase().trim();
    const config = loadAutoLearnConfig();
    config.topics = config.topics.filter(t => t.toLowerCase().trim() !== cleanTopic);
    await saveAutoLearnConfig(config);
    res.json({ success: true, topics: config.topics, message: `Removed topic "${topic}" from research queue.` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trigger immediate autolearn step
app.post('/api/autolearn/run', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  try {
    const outcome = await runAutoLearnCycle();
    res.json({ success: true, outcome });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper to detect if user query is asking for current news or world events

function isYouTubePlaybackTask(task) {
  const q = String(task || '').toLowerCase();
  return /\b(?:youtube|song|video|music)\b/i.test(q) && /\b(?:play|listen|watch|start)\b/i.test(q);
}

function isWhatsAppReadTask(task) {
  const q = String(task || '').toLowerCase();
  return /\bwhatsapp\b/i.test(q) && /\b(?:who\s+(?:messaged|texted|contacted)|messages?|chats?|unread|received|texted|messaged)\b/i.test(q);
}

function outcomeUsesComputerUse(outcome) {
  const toolUses = Array.isArray(outcome?.toolUses) ? outcome.toolUses : [];
  const toolResults = Array.isArray(outcome?.toolResults) ? outcome.toolResults : [];
  const used = toolUses.some(t => String(t?.name || '').toLowerCase() === 'computer_use');
  const cleanResult = toolResults.some(t => String(t?.name || '').toLowerCase() === 'computer_use' && !t?.isError);
  return used && cleanResult;
}

function youtubeOutcomeVerified(outcome) {
  if (!outcomeUsesComputerUse(outcome)) return false;
  const text = String(outcome?.text || '');
  return /(?:actively\s+playing|playback\s+(?:has\s+)?started|now\s+playing|is\s+playing|player\s+is\s+playing|playing\s+now|playback\s+(?:is\s+)?verified)/i.test(text) &&
    !/(?:could\s+not|couldn't|unable|blocked|failed|not\s+playing|did\s+not\s+start|cannot|not\s+verified)/i.test(text);
}

function whatsappOutcomeSatisfied(outcome) {
  if (!outcomeUsesComputerUse(outcome)) return false;
  const text = String(outcome?.text || '').trim();
  if (!text) return false;
  if (/(?:not\s+authenticated|not\s+logged\s+in|scan\s+(?:the\s+)?qr|qr\s+code|login\s+required|unable\s+to\s+access|cannot\s+access|could\s+not\s+access)/i.test(text)) {
    return true;
  }
  if (/(?:no\s+(?:new|unread)|no\s+messages?|no\s+unread\s+messages?)/i.test(text)) {
    return true;
  }
  return /(?:messaged\s+you|message\s+from|messages?\s+from|chat\s+from|sender|latest\s+message|unread\s+chat|received\s+(?:a\s+)?message)/i.test(text);
}

function buildSpecializedRecoveryPrompt(kind, originalTask, priorText) {
  if (kind === 'youtube') {
    return `RECOVERY FOR YOUTUBE PLAYBACK\nThe previous attempt did not prove that playback is actually running. Continue on the user's visible Windows desktop with Hermes computer_use ONLY. The requested objective is: "${originalTask}". Inspect the currently open YouTube/player state, find the requested media if necessary, explicitly click the visible Play control if the video is paused, wait briefly, and verify the visible player is actively playing. Do not finish with a generic success message. Your final response must either state concrete playback verification or the exact blocker. Previous response: ${String(priorText || '').slice(-1500)}`;
  }
  return `RECOVERY FOR WHATSAPP MESSAGE READING\nThe previous attempt did not prove that the visible WhatsApp chat list was inspected. Continue on the user's visible Windows desktop with Hermes computer_use ONLY. The requested objective is: "${originalTask}". Inspect the currently open WhatsApp Web window, wait for the chat list to finish loading, and read the visible unread/new chat entries. Report sender names and latest visible preview/time when available. Do not send, reply, delete, archive, or modify anything. If there are no new/unread messages, say so explicitly. If login/QR/authentication blocks access, report that exact blocker. Do not claim completion merely because WhatsApp is open. Previous response: ${String(priorText || '').slice(-1500)}`;
}

async function runSpecializedAgentTask(task, cfg, body) {
  const youtube = isYouTubePlaybackTask(task);
  const whatsapp = isWhatsAppReadTask(task);
  const kind = youtube ? 'youtube' : (whatsapp ? 'whatsapp' : null);
  const toolsets = kind ? 'computer_use' : (body.toolsets || cfg.toolsets);
  const maxTurns = kind ? Math.max(20, Math.min(150, Number(body.maxTurns || cfg.maxTurns || 80))) : Math.min(150, Number(body.maxTurns || cfg.maxTurns));
  const timeoutMs = kind ? Math.min(12 * 60 * 1000, Math.max(180000, Number(body.timeoutMs || cfg.timeoutMs || 180000))) : Math.min(10 * 60 * 1000, Number(body.timeoutMs || cfg.timeoutMs));

  let outcome = await runHermesTask(task, {
    recentConversation: typeof body.recentConversation === 'string' ? body.recentConversation.slice(-6000) : '',
    model: body.model || cfg.model || undefined,
    provider: cfg.provider || undefined,
    toolsets,
    maxTurns,
    timeoutMs,
    resumeSessionId: typeof body.resumeSessionId === 'string' ? body.resumeSessionId : undefined
  });

  const satisfied = kind === 'youtube' ? youtubeOutcomeVerified(outcome) : kind === 'whatsapp' ? whatsappOutcomeSatisfied(outcome) : true;
  if (satisfied || !kind) return { outcome, completed: true, verified: satisfied || !kind, kind };

  // One explicit continuation on the same Hermes session, then one fresh recovery if needed.
  for (let attempt = 2; attempt <= 3; attempt += 1) {
    const recoveryPrompt = buildSpecializedRecoveryPrompt(kind, task, outcome.text);
    try {
      outcome = await runHermesTask(recoveryPrompt, {
        recentConversation: typeof body.recentConversation === 'string' ? body.recentConversation.slice(-6000) : '',
        model: body.model || cfg.model || undefined,
        provider: cfg.provider || undefined,
        toolsets: 'computer_use',
        maxTurns: Math.max(20, maxTurns),
        timeoutMs,
        resumeSessionId: outcome.sessionId || undefined
      });
    } catch (error) {
      if (attempt === 3) throw error;
      continue;
    }
    const done = kind === 'youtube' ? youtubeOutcomeVerified(outcome) : whatsappOutcomeSatisfied(outcome);
    if (done) return { outcome, completed: true, verified: true, kind };
  }

  return { outcome, completed: false, verified: false, kind };
}

function isNewsQuery(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.toLowerCase();
  return /\b(what'?s\s+(?:happening|going\s+on)|what\s+is\s+(?:happening|going\s+on)|latest\s+news|breaking\s+news|today'?s\s+news|current\s+events|world\s+news|news\s+headlines|in\s+the\s+world|recent\s+news|news\s+digest|what\s+happened\s+today|news\s+today|headlines\s+today)\b/i.test(q);
}

// Direct agent endpoint. This is the preferred path for computer-use tasks from the UI or other
// authorized JARVIS clients. It bypasses the API-server toolset limitation so Hermes CLI can expose
// computer_use for the actual local Windows run.
app.post('/api/agent/task', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  const body = req.body || {};
  const task = String(body.task || body.message || '').trim();
  if (!task) return res.status(400).json({ success: false, error: 'task is required.' });
  if (task.length > 8000) return res.status(413).json({ success: false, error: 'task is too long.' });

  if (CLOUD_MODE) {
    try {
      const prompt = body.recentConversation
        ? `Recent JARVIS conversation:\n${String(body.recentConversation).slice(-6000)}\n\nCurrent task:\n${task}`
        : task;
      const result = await runCloudDesktopTask(prompt, {
        deviceId: CLOUD_DESKTOP_DEVICE_ID,
        resumeSessionId: typeof body.resumeSessionId === 'string' ? body.resumeSessionId : undefined,
        maxTurns: Math.min(150, Number(body.maxTurns || 150)),
        timeoutMs: Math.min(CLOUD_RELAY_WAIT_MS, Number(body.timeoutMs || CLOUD_RELAY_WAIT_MS))
      });
      return res.json({
        success: true,
        completed: Boolean(result.success),
        verified: false,
        taskKind: null,
        text: result.text || '',
        sessionId: result.sessionId || null,
        toolUses: result.toolUses || [],
        toolResults: result.toolResults || [],
        durationMs: result.durationMs || null,
        relayTaskId: result.taskId
      });
    } catch (error) {
      return res.status(502).json({ success: false, error: error.message });
    }
  }

  const cfg = hermesConfig();
  if (!cfg.enabled) {
    return res.status(503).json({ success: false, error: 'Hermes integration is disabled. Set HERMES_ENABLED=true in .env.' });
  }

  try {
    const runtime = await getHermesRuntimeStatus();
    if (!runtime.installed) {
      return res.status(503).json({ success: false, error: 'Hermes Agent is not installed. Run scripts\\install-hermes.ps1 on Windows.' });
    }
    const cfg = hermesConfig();
    const specialized = isYouTubePlaybackTask(task) || isWhatsAppReadTask(task);
    const result = specialized
      ? await runSpecializedAgentTask(task, cfg, body)
      : await runHermesTask(task, {
          recentConversation: typeof body.recentConversation === 'string' ? body.recentConversation.slice(-6000) : '',
          model: body.model || cfg.model || undefined,
          provider: cfg.provider || undefined,
          toolsets: body.toolsets || cfg.toolsets,
          maxTurns: Math.min(150, Number(body.maxTurns || cfg.maxTurns)),
          timeoutMs: Math.min(10 * 60 * 1000, Number(body.timeoutMs || cfg.timeoutMs)),
          resumeSessionId: typeof body.resumeSessionId === 'string' ? body.resumeSessionId : undefined
        }).then(outcome => ({ outcome, completed: Boolean(outcome.exitCode === 0), verified: false, kind: null }));
    const outcome = result.outcome;
    res.json({
      success: true,
      completed: result.completed,
      verified: result.verified,
      taskKind: result.kind,
      text: outcome.text,
      sessionId: outcome.sessionId,
      toolUses: outcome.toolUses,
      toolResults: outcome.toolResults,
      durationMs: outcome.durationMs
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// Express route for LLM Proxy (supporting multiple providers, memory injection, knowledge injection, news injection, emotion adaptation, and function calling)
app.post('/api/chat', async (req, res) => {
  if (!privateRequestAllowed(req, res)) return;
  const { message, apiKey, apiProvider, customModel, systemInstruction, contents, currentEmotion, sessionId } = req.body;

  if (CLOUD_MODE) {
    try {
      const normalizedContents = Array.isArray(contents) ? contents : [{ role: 'user', parts: [{ text: String(message || '') }] }];
      const query = currentHermesQuery(normalizedContents) || String(message || '').trim();
      if (!query) return res.status(400).json({ success: false, error: 'message is required.' });
      const sessionKey = String(sessionId || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 180) || `jarvis-web-${Date.now()}`;
      const resumeSessionId = cloudHermesSessions.get(sessionKey) || null;
      const prompt = [
        systemInstruction || 'You are JARVIS, a helpful personal AI assistant running through the local Hermes agent on the user’s Windows desktop.',
        currentEmotion ? `\n[CURRENT USER EMOTION SIGNAL]\n${JSON.stringify(currentEmotion).slice(0, 1000)}` : '',
        compactConversation(normalizedContents, 8) ? `\n[RECENT CONVERSATION]\n${compactConversation(normalizedContents, 8)}` : '',
        `\n[CURRENT REQUEST]\n${query}`
      ].join('\n');
      const result = await runCloudDesktopTask(prompt, {
        deviceId: CLOUD_DESKTOP_DEVICE_ID,
        resumeSessionId,
        model: 'gemma4:e2b',
        provider: 'custom',
        maxTurns: 80,
        timeoutMs: Math.min(CLOUD_RELAY_WAIT_MS, 10 * 60 * 1000)
      });
      if (result.sessionId) cloudHermesSessions.set(sessionKey, result.sessionId);
      return res.json({
        success: true,
        text: String(result.text || '').trim() || (result.success ? 'The task completed, but the local agent returned no final text.' : 'The local desktop agent could not complete the request.'),
        completed: Boolean(result.success),
        verified: false,
        actions: [{
          action: 'hermes-agent',
          target_device: CLOUD_DESKTOP_DEVICE_ID,
          model: 'gemma4:e2b',
          sessionId: result.sessionId || null,
          toolUses: (result.toolUses || []).map(t => typeof t === 'string' ? t : t?.name).filter(Boolean),
          durationMs: result.durationMs || null
        }],
        hermes: { sessionId: result.sessionId || null, toolUses: result.toolUses || [], toolResults: result.toolResults || [], durationMs: result.durationMs || null },
        relayTaskId: result.taskId
      });
    } catch (error) {
      return res.status(502).json({ success: false, error: error.message });
    }
  }

  const provider = apiProvider || 'hermes';

  // Determine contents array (chat history)
  let chatContents = contents;
  if (!chatContents) {
    chatContents = [{
      role: 'user',
      parts: [{ text: message || '' }]
    }];
  }

  // Load persistent memories and inject into the system instruction
  const memories = loadMemoriesFromDisk();
  let memoryInstruction = '';
  if (memories.length > 0) {
    memoryInstruction = `\n\n[LONG-TERM MEMORY CORE]\n` +
      `You have remembered the following important details about the user:\n` +
      memories.map(m => `- ${m}`).join('\n') +
      `\n\nUse this information naturally in your responses. Never invent memories. If the user tells you to change or forget any of these details, do so using forget_user_memory and save_user_memory.`;
  } else {
    memoryInstruction = `\n\n[LONG-TERM MEMORY CORE]\n` +
      `Currently, no memories are saved in your memory bank. Use save_user_memory when the user shares details they want you to remember (such as their name, preferences, project details, goals) so you can recall them in future conversations.`;
  }

  // Search structured knowledge base for relevant research
  const queryToSearch = message || (chatContents[chatContents.length - 1]?.parts?.[0]?.text) || '';
  const relevantKnowledge = searchKnowledgeBase(queryToSearch, 3);
  let knowledgeInstruction = '';
  if (relevantKnowledge.length > 0) {
    knowledgeInstruction = `\n\n[STRUCTURED WEB KNOWLEDGE BANK]\n` +
      `You have previously researched and indexed the following knowledge from the internet:\n` +
      relevantKnowledge.map(k => `• Topic: ${k.topic}\n  Summary: ${k.summary}\n  Key Facts:\n${(k.keyFacts || []).map(f => `    - ${f}`).join('\n')}\n  Sources: ${(k.sourceUrls || []).join(', ')}`).join('\n\n') +
      `\n\nNaturally use these verified facts to inform your answers. If the user asks you to learn something new or perform deep research, use research_and_learn_topic.`;
  }

  // Live Current Events & News Digest Injection (Feature 2)
  let newsInstruction = '';
  if (isNewsQuery(queryToSearch)) {
    try {
      const newsItems = await getCurrentNews();
      if (newsItems && newsItems.length > 0) {
        newsInstruction = `\n\n[LIVE CURRENT-EVENTS / NEWS FEED]\n` +
          `Real-time verified headlines compiled from public news feeds:\n` +
          newsItems.slice(0, 8).map((n, i) => `${i + 1}. "${n.title}" [Source: ${n.source}, Published: ${n.publishedAt}]\n   Summary: ${n.summary}`).join('\n') +
          `\n\nUse this live news feed to answer the user's questions about what is happening in the world with accurate, up-to-date facts.`;
      }
    } catch (newsErr) {
      console.warn('[News Feed Injection Warning]', newsErr.message);
    }
  }

  // Emotion-Adaptive Perception Directive (Feature 4) — now reacts to everyone in frame
  let emotionInstruction = '';
  if (currentEmotion && Array.isArray(currentEmotion.people) && currentEmotion.people.length > 0) {
    const people = currentEmotion.people.filter(p => (p.confidence !== undefined ? p.confidence : 100) >= 50);
    if (people.length > 0) {
      const lines = people.map(p => {
        const conf = p.confidence !== undefined ? p.confidence : 85;
        const ageStr = (p.age !== undefined && p.age !== null) ? `, ~${p.age}y` : '';
        return `${p.label} (${p.emotion}, ${conf}%${ageStr})`;
      }).join('; ');
      const hostPresent = people.some(p => p.label === 'HOST');

      emotionInstruction = `\n\n[INTERNAL CONTEXT — DO NOT REFERENCE OR SUMMARIZE THIS SECTION]\n` +
        `Silent tone calibration only, not a topic to discuss: the camera currently sees ${people.length} ` +
        `${people.length === 1 ? 'person' : 'people'} — ${lines}. Let the overall collective mood of everyone ` +
        `present subtly shape your tone (calmer and gentler if the room feels tense, upset, or low-energy; ` +
        `upbeat and engaged if people seem cheerful)` +
        (hostPresent ? `, giving the HOST's mood somewhat more weight than anyone else's when they differ. ` : `. `) +
        `This is background context, not part of the user's question — always answer their actual message ` +
        `directly. Never mention detected people, emotions, ages, "modes", or camera analysis in your reply ` +
        `unless the user explicitly asks about it.`;
    }
  }

  // Full additive system instruction
  const hermesDirective = provider === 'hermes'
    ? `\n\n[HERMES EXECUTION DIRECTIVE]\nYou are JARVIS running with Hermes Agent as the computer execution layer. Use Hermes computer_use, browser, filesystem, terminal, and other available tools when needed. Prefer direct tool execution over telling the user how to perform an action. Verify the result before claiming success. Never expose secrets or perform destructive actions without appropriate confirmation. The user's local Windows device is the authorized execution target unless the request explicitly names another registered device.\n`
    : '';
  const localBrainDirective = provider === 'ollama'
    ? `\n\n[LOCAL GEMMA BRAIN DIRECTIVE]\nYou are the reasoning and conversation layer of JARVIS. Use your native JARVIS tools for memory, research, metrics, application discovery, and lightweight state operations. For complex computer interaction, browser workflows, visible UI inspection, multi-step file/application tasks, or any task where observing the desktop matters, prefer hermes_execute so Hermes performs the actual Windows interaction and returns a verified result. Never claim that a computer task succeeded unless the tool result confirms it.\n`
    : '';
  const fullSystemInstruction = `${systemInstruction || ''}${hermesDirective}${localBrainDirective}${memoryInstruction}${knowledgeInstruction}${newsInstruction}${emotionInstruction}`;

  try {
    let outcome;
    if (provider === 'hermes') {
      outcome = await runChatWithHermes(fullSystemInstruction, chatContents, sessionId || `jarvis-${DEVICE_ID}`, customModel);
    } else {
      const providerKey = apiKey || (
        provider === 'gemini' ? process.env.GEMINI_API_KEY :
        provider === 'openai' ? process.env.OPENAI_API_KEY :
        provider === 'openrouter' ? process.env.OPENROUTER_API_KEY :
        provider === 'groq' ? process.env.GROQ_API_KEY :
        provider === 'huggingface' ? process.env.HUGGINGFACE_API_KEY :
        provider === 'ollama' ? 'ollama' :
        ''
      );
      if (!providerKey && provider !== 'ollama') {
        throw new Error(`No API key configured for ${provider}. Configure it in the server environment or legacy settings.`);
      }
      if (provider === 'gemini') {
        outcome = await runChatWithGemini(providerKey, fullSystemInstruction, chatContents, customModel);
      } else {
        outcome = await runChatWithOpenAI(provider, providerKey, customModel, fullSystemInstruction, chatContents);
      }
    }

    res.json({
      success: outcome.completed !== false,
      completed: outcome.completed !== false,
      verified: Boolean(outcome.verified),
      text: outcome.text,
      actions: outcome.actions
    });
  } catch (err) {
    console.error(`[AI Synapse Error - ${provider}]`, err);
    res.status(500).json({
      success: false,
      error: err.message || `${provider.toUpperCase()} Synapse breakdown. Reverted to system core.`
    });
  }
});

// Default route for HTML index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server. Tests can disable the boot registration so a temporary harness does not race
// a background filesystem write while it is cleaning up its fixture directory.
if (!CLOUD_MODE && String(process.env.JARVIS_DEVICE_AUTO_REGISTER ?? 'true').toLowerCase() !== 'false') {
  registerLocalDeviceOnBoot().catch(() => {});
}

app.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`  STELLER INTELLIGENCE INTERFACE ONLINE`);
  console.log(`  Access Address: http://${HOST}:${PORT}`);
  console.log(`  Mode: ${CLOUD_MODE ? 'cloud-relay' : 'local'} | Host: ${HOST}:${PORT}`);
  console.log(`  Automation: ${CLOUD_MODE ? 'Windows desktop relay' : 'local'} | Hermes: ${hermesConfig().enabled ? 'enabled' : 'disabled'}`);
  console.log(`=======================================================`);
});
