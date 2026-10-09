'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function execPowerShell(script, timeout = 4000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', script
    ], { windowsHide: true, timeout, maxBuffer: 3 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(null);
      try { resolve(JSON.parse(String(stdout || '').trim() || 'null')); }
      catch { resolve(null); }
    });
  });
}

function homeRoots() {
  const home = os.homedir();
  const roots = {
    home,
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents'),
    downloads: path.join(home, 'Downloads'),
    pictures: path.join(home, 'Pictures'),
    videos: path.join(home, 'Videos'),
    music: path.join(home, 'Music'),
    onedrive: path.join(home, 'OneDrive')
  };

  const extra = String(process.env.JARVIS_ACTIVITY_ROOTS || '')
    .split(/[;,]/)
    .map(v => v.trim())
    .filter(Boolean);
  for (const raw of extra) {
    const full = path.resolve(raw);
    const keyBase = path.basename(full) || `root-${Object.keys(roots).length}`;
    let key = `extra-${keyBase.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
    let n = 2;
    while (roots[key]) key = `extra-${keyBase}-${n++}`;
    roots[key] = full;
  }

  return Object.fromEntries(Object.entries(roots).filter(([, p]) => {
    try { return fs.existsSync(p); } catch { return false; }
  }));
}

function dedupeByPid(list) {
  const seen = new Set();
  return list.filter(item => {
    const pid = item && item.pid != null ? String(item.pid) : '';
    if (!pid || seen.has(pid)) return false;
    seen.add(pid);
    return true;
  });
}

class WindowsActivityAgent {
  constructor(options = {}) {
    this.enabled = options.enabled !== false && process.platform === 'win32';
    this.intervalMs = Math.max(2000, Number(options.intervalMs || 3000));
    this.processIntervalMs = Math.max(4000, Number(options.processIntervalMs || 6000));
    this.appIntervalMs = Math.max(30000, Number(options.appIntervalMs || 60000));
    this.maxFileEvents = Math.max(200, Number(options.maxFileEvents || 2000));
    this.listeners = new Set();
    this.watchers = [];
    this.timer = null;
    this.processTimer = null;
    this.appTimer = null;
    this.lastForegroundKey = '';
    this.lastProcessKey = '';
    this.state = {
      startedAt: new Date().toISOString(),
      lastSampleAt: null,
      foreground: null,
      processes: [],
      installedApps: [],
      fileRoots: homeRoots(),
      recentFileEvents: [],
      online: false,
      deviceId: process.env.JARVIS_DEVICE_ID || `${os.hostname()}-windows`,
      deviceName: process.env.JARVIS_DEVICE_NAME || os.hostname()
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) {
      try { listener(event, this.getState()); } catch {}
    }
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  async sampleForeground() {
    const script = `
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class JarvisForegroundNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$handle = [JarvisForegroundNative]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 1024
[void][JarvisForegroundNative]::GetWindowText($handle, $sb, $sb.Capacity)
$pid = [uint32]0
[void][JarvisForegroundNative]::GetWindowThreadProcessId($handle, [ref]$pid)
$p = Get-Process -Id $pid -ErrorAction SilentlyContinue
[pscustomobject]@{ pid=$pid; app=if($p){$p.ProcessName}else{$null}; title=$sb.ToString(); responsive=if($p){$p.Responding}else{$null} } | ConvertTo-Json -Compress
`;
    return execPowerShell(script, 3500);
  }

  async sampleProcesses() {
    const script = `$items = Get-Process | ForEach-Object { [pscustomobject]@{ pid=$_.Id; name=$_.ProcessName; title=$_.MainWindowTitle; hasWindow=[bool]($_.MainWindowHandle -ne 0) } }; @($items) | ConvertTo-Json -Compress -Depth 2`;
    const data = await execPowerShell(script, 5500);
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    return dedupeByPid(list).slice(0, 700);
  }

  async sampleInstalledApps() {
    const script = `
$start = @(Get-StartApps | ForEach-Object { [pscustomobject]@{ Name=$_.Name; AppID=$_.AppID; Source='StartMenu'; Installed=$true } })
$registryPaths = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$registry = @(foreach($p in $registryPaths) {
  Get-ItemProperty $p -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName } |
    ForEach-Object { [pscustomobject]@{ Name=$_.DisplayName; AppID=$null; Version=$_.DisplayVersion; Publisher=$_.Publisher; InstallLocation=$_.InstallLocation; Source='Registry'; Installed=$true } }
})
@($start + $registry) | ConvertTo-Json -Compress -Depth 3
`;
    const data = await execPowerShell(script, 12000);
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    const seen = new Set();
    return list.filter(x => {
      if (!x?.Name) return false;
      const key = `${String(x.Name).toLowerCase()}|${String(x.AppID || '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 1800);
  }

  rememberFileEvent(eventType, filename, rootKey, root) {
    const relative = filename ? String(filename) : '';
    const fullPath = path.resolve(root, relative);
    const event = {
      id: `fs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'filesystem-change',
      action: eventType,
      root: rootKey,
      path: fullPath,
      timestamp: new Date().toISOString()
    };
    this.state.recentFileEvents.push(event);
    if (this.state.recentFileEvents.length > this.maxFileEvents) {
      this.state.recentFileEvents.splice(0, this.state.recentFileEvents.length - this.maxFileEvents);
    }
    this.emit(event);
  }

  startWatchers() {
    if (!this.enabled || this.watchers.length) return;
    const roots = this.state.fileRoots;
    for (const key of ['desktop', 'documents', 'downloads', 'pictures', 'videos', 'music', 'onedrive']) {
      const root = roots[key];
      if (!root) continue;
      try {
        const watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
          this.rememberFileEvent(eventType, filename, key, root);
        });
        this.watchers.push(watcher);
      } catch {
        try {
          const watcher = fs.watch(root, {}, (eventType, filename) => {
            this.rememberFileEvent(eventType, filename, key, root);
          });
          this.watchers.push(watcher);
        } catch {}
      }
    }
  }

  async sample() {
    if (!this.enabled) return;
    const foreground = await this.sampleForeground();
    this.state.lastSampleAt = new Date().toISOString();
    this.state.online = true;

    if (foreground) {
      const key = `${foreground.pid}|${foreground.app}|${foreground.title}`;
      this.state.foreground = foreground;
      if (key !== this.lastForegroundKey) {
        this.lastForegroundKey = key;
        this.emit({ type: 'foreground-window', ...foreground, timestamp: new Date().toISOString() });
      }
    }
  }

  async sampleProcessSnapshot() {
    if (!this.enabled) return;
    const processes = await this.sampleProcesses();
    const key = processes.map(p => `${p.pid}:${p.name}`).sort().join('|');
    this.state.processes = processes;
    if (key !== this.lastProcessKey) {
      const previous = this.lastProcessKey ? new Set(this.lastProcessKey.split('|')) : new Set();
      const current = new Set(key.split('|').filter(Boolean));
      const started = [...current].filter(x => !previous.has(x)).slice(0, 100);
      const stopped = [...previous].filter(x => !current.has(x)).slice(0, 100);
      this.lastProcessKey = key;
      this.emit({ type: 'process-snapshot', started, stopped, processCount: processes.length, timestamp: new Date().toISOString() });
    }
  }

  async refreshInstalledApps() {
    if (!this.enabled) return [];
    const apps = await this.sampleInstalledApps();
    const previous = this.state.installedApps;
    const previousKey = previous.map(a => `${String(a?.Name || '').toLowerCase()}|${String(a?.Version || '')}`).sort().join('|');
    const nextKey = apps.map(a => `${String(a?.Name || '').toLowerCase()}|${String(a?.Version || '')}`).sort().join('|');
    this.state.installedApps = apps;
    if (previousKey && previousKey !== nextKey) {
      this.emit({
        type: 'installed-app-change',
        installedCount: apps.length,
        timestamp: new Date().toISOString()
      });
    }
    return apps;
  }

  start() {
    if (!this.enabled || this.timer) return;
    this.startWatchers();
    this.sample().catch(() => {});
    this.sampleProcessSnapshot().catch(() => {});
    this.refreshInstalledApps().catch(() => {});
    this.timer = setInterval(() => this.sample().catch(() => {}), this.intervalMs);
    this.processTimer = setInterval(() => this.sampleProcessSnapshot().catch(() => {}), this.processIntervalMs);
    this.appTimer = setInterval(() => this.refreshInstalledApps().catch(() => {}), this.appIntervalMs);
    if (this.timer.unref) this.timer.unref();
    if (this.processTimer?.unref) this.processTimer.unref();
    if (this.appTimer?.unref) this.appTimer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.processTimer) clearInterval(this.processTimer);
    this.timer = null;
    this.processTimer = null;
    if (this.appTimer) clearInterval(this.appTimer);
    this.appTimer = null;
    for (const watcher of this.watchers) {
      try { watcher.close(); } catch {}
    }
    this.watchers = [];
  }
}

function createWindowsActivityAgent(options) {
  return new WindowsActivityAgent(options);
}

module.exports = { WindowsActivityAgent, createWindowsActivityAgent, homeRoots };
