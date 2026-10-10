'use strict';

const $ = id => document.getElementById(id);
const els = { relayUrl:$('relayUrl'), token:$('token'), deviceId:$('deviceId'), deviceName:$('deviceName'), status:$('status'), task:$('task'), result:$('result'), devices:$('devices'), screen:$('screen') };
const saved = JSON.parse(localStorage.getItem('jarvisMobileConfig') || '{}');
els.relayUrl.value = saved.relayUrl || location.origin;
els.token.value = saved.token || '';
els.deviceId.value = saved.deviceId || `phone-${crypto.randomUUID ? crypto.randomUUID().slice(0,8) : Date.now()}`;
els.deviceName.value = saved.deviceName || 'JARVIS Phone';

function base() { return els.relayUrl.value.trim().replace(/\/$/, ''); }
function headers() { return { 'Content-Type':'application/json', Authorization:`Bearer ${els.token.value.trim()}` }; }
function setStatus(text, ok=false) { els.status.textContent = text; els.status.style.color = ok ? '#39ff88' : '#ffd166'; }
function save() { const cfg={relayUrl:els.relayUrl.value.trim(),token:els.token.value.trim(),deviceId:els.deviceId.value.trim(),deviceName:els.deviceName.value.trim()}; localStorage.setItem('jarvisMobileConfig', JSON.stringify(cfg)); setStatus('Configuration saved.', true); }
async function heartbeat() {
  save();
  const r = await fetch(`${base()}/api/relay/heartbeat`, {method:'POST',headers:headers(),body:JSON.stringify({deviceId:els.deviceId.value.trim(),name:els.deviceName.value.trim(),type:'mobile-companion',capabilities:['relay','notifications']})});
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  setStatus(`Connected as ${d.device?.name || els.deviceName.value}.`, true);
  await refreshDevices();
}
async function refreshDevices() {
  const r = await fetch(`${base()}/api/relay/devices`, {headers:headers()});
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  els.devices.textContent = JSON.stringify(d.devices || [], null, 2);
}
async function findDesktop() {
  const r = await fetch(`${base()}/api/relay/devices`, {headers:headers()});
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  const devices = Array.isArray(d.devices) ? d.devices : [];
  const desktop = devices.find(item => item.type === 'windows-desktop' && item.online)
    || devices.find(item => item.online);
  if (!desktop) throw new Error('No authorized desktop is currently online.');
  return desktop;
}
async function sendTask() {
  const task = els.task.value.trim();
  if (!task) return;
  save();
  els.result.textContent = 'Queueing...';
  const desktop = await findDesktop();
  const r = await fetch(`${base()}/api/relay/task`, {method:'POST',headers:headers(),body:JSON.stringify({deviceId:desktop.deviceId,task})});
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  els.result.textContent = `Queued task ${d.taskId}. The desktop relay will execute it when online.`;
}
$('saveBtn').onclick = () => { try { save(); } catch(e) { setStatus(e.message); } };
$('heartbeatBtn').onclick = () => heartbeat().catch(e => setStatus(e.message));
$('refreshBtn').onclick = () => refreshDevices().catch(e => { els.devices.textContent = e.message; });
$('sendBtn').onclick = () => sendTask().catch(e => { els.result.textContent = e.message; });
$('screenBtn').onclick = async () => {
  try {
    save();
    els.result.textContent = 'Requesting desktop screenshot...';
    const desktop = await findDesktop();
    const queued = await (await fetch(`${base()}/api/relay/task`, {method:'POST',headers:headers(),body:JSON.stringify({deviceId:desktop.deviceId,kind:'screenshot'})})).json();
    if (!queued.taskId) throw new Error(queued.error || 'Could not queue screenshot.');
    for (let i=0;i<20;i++) {
      await new Promise(r=>setTimeout(r,1000));
      const rr = await fetch(`${base()}/api/relay/result/${encodeURIComponent(queued.taskId)}`, {headers:headers()});
      if (rr.status===404) continue;
      const rd = await rr.json();
      if (!rd.result) continue;
      if (!rd.result.success) throw new Error(rd.result.error || 'Screenshot failed.');
      if (!rd.result.imageData) throw new Error('Desktop returned no screenshot.');
      els.screen.src = rd.result.imageData;
      els.screen.style.display = 'block';
      els.result.textContent = rd.result.text || 'Screenshot received.';
      return;
    }
    throw new Error('Desktop screenshot timed out.');
  } catch (e) { els.result.textContent = e.message; }
};
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/mobile/sw.js').catch(() => {});
