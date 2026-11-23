// Data layer: reads and writes the private data repository through the GitHub API.
// Every write is a new file (events are never edited), so phone and Mac can't conflict.
// Writes that fail (offline, timeout) wait in an IndexedDB queue and are retried.

const OWNER = 'jeknov', REPO = 'speaking-coach-data';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/`;
export const TZ = 'America/Toronto';

export const settings = {
  get token() { try { return localStorage.getItem('sc_token') || ''; } catch { return ''; } },
  set token(v) { try { v ? localStorage.setItem('sc_token', v) : localStorage.removeItem('sc_token'); } catch {} },
  get sample() { try { return localStorage.getItem('sc_sample') === '1'; } catch { return false; } },
  set sample(v) { try { localStorage.setItem('sc_sample', v ? '1' : '0'); } catch {} },
  get device() {
    try {
      let d = localStorage.getItem('sc_device');
      if (!d) { d = (/Android/i.test(navigator.userAgent) ? 'android' : /Mac/i.test(navigator.userAgent) ? 'mac' : 'web') + '-' + Math.random().toString(36).slice(2, 6); localStorage.setItem('sc_device', d); }
      return d;
    } catch { return 'web'; }
  },
};

export function localDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function localTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function headers(raw) {
  const h = { Authorization: 'Bearer ' + settings.token, 'X-GitHub-Api-Version': '2022-11-28' };
  h.Accept = raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json';
  return h;
}

export async function getText(path) {
  const r = await fetch(API + path + '?t=' + Date.now(), { headers: headers(true), cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} reading ${path}`);
  return r.text();
}
export async function getJSON(path) { const t = await getText(path); return t == null ? null : JSON.parse(t); }
export async function list(dir) {
  const r = await fetch(API + dir + '?t=' + Date.now(), { headers: headers(false), cache: 'no-store' });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GitHub ${r.status} listing ${dir}`);
  const j = await r.json(); return Array.isArray(j) ? j : [];
}
export async function testConnection() {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: headers(false), cache: 'no-store' });
  if (r.status === 401) throw new Error('That key was not accepted. Check it was copied in full.');
  if (r.status === 404) throw new Error('The key works, but it cannot see speaking-coach-data. Give it access to that repository.');
  if (!r.ok) throw new Error('GitHub answered ' + r.status);
  const j = await r.json();
  if (j.permissions && !j.permissions.push) throw new Error('The key can read but not write. Set Contents to "Read and write".');
  return j;
}

// ---- base64 helpers
export function textToB64(s) { return bytesToB64(new TextEncoder().encode(s)); }
export function bytesToB64(bytes) {
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

async function putRaw(path, b64, message) {
  const r = await fetch(API + path, { method: 'PUT', headers: { ...headers(false), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: b64 }) });
  if (r.status === 422) return true; // already exists: a retry of something that went through
  if (!r.ok) throw new Error(`GitHub ${r.status} writing ${path}`);
  return true;
}

// ---- IndexedDB queue
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('speaking-coach', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('queue', { keyPath: 'path' });
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function qAll() { const db = await idb(); return new Promise((res) => { const t = db.transaction('queue').objectStore('queue').getAll(); t.onsuccess = () => res(t.result || []); t.onerror = () => res([]); }); }
async function qPut(item) { const db = await idb(); return new Promise((res) => { const t = db.transaction('queue', 'readwrite'); t.objectStore('queue').put(item); t.oncomplete = res; t.onerror = res; }); }
async function qDel(path) { const db = await idb(); return new Promise((res) => { const t = db.transaction('queue', 'readwrite'); t.objectStore('queue').delete(path); t.oncomplete = res; t.onerror = res; }); }
export async function pendingCount() { try { return (await qAll()).length; } catch { return 0; } }
export async function pendingEvents() {
  try { return (await qAll()).filter((x) => x.event).map((x) => x.event); } catch { return []; }
}

export async function save(path, b64, message, event) {
  const item = { path, b64, message, event: event || null, at: Date.now() };
  await qPut(item);
  try { await putRaw(path, b64, message); await qDel(path); return 'saved'; }
  catch (e) { console.warn('queued', path, e); return 'queued'; }
}
export async function flush() {
  if (!settings.token) return 0;
  let sent = 0;
  for (const it of (await qAll()).sort((a, b) => a.at - b.at)) {
    try { await putRaw(it.path, it.b64, it.message); await qDel(it.path); sent++; } catch { break; }
  }
  return sent;
}

const rid = () => Math.random().toString(36).slice(2, 8);
export function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }

// Write one event (JSON). Returns 'saved' or 'queued'.
export async function logEvent(ev) {
  const now = new Date();
  const full = { ts: now.toISOString(), date: localDate(now), local_time: localTime(now), device: settings.device, app_version: '0.1.0', ...ev };
  const path = `events/${full.date}/${stamp()}-${full.type}-${rid()}.json`;
  return save(path, textToB64(JSON.stringify(full, null, 1)), `${full.type} ${full.task_id || full.metric_id || ''}`.trim(), full);
}

// Upload a recording (Blob). Returns the repository path.
export async function saveRecording(blob, taskId) {
  const ext = /mp4|m4a|aac/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : /wav/.test(blob.type) ? 'wav' : /mpeg|mp3/.test(blob.type) ? 'mp3' : 'webm';
  const d = localDate();
  const path = `recordings/${d.slice(0, 7)}/${d}_${taskId}_${stamp()}.${ext}`;
  const b64 = bytesToB64(new Uint8Array(await blob.arrayBuffer()));
  const res = await save(path, b64, `recording ${taskId}`);
  return { path, res };
}
export async function saveFile(file, taskId) {
  const d = localDate(); const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `uploads/${d.slice(0, 7)}/${d}_${taskId}_${safe}`;
  const b64 = bytesToB64(new Uint8Array(await file.arrayBuffer()));
  const res = await save(path, b64, `upload ${taskId}`);
  return { path, res };
}

// Today's events already in the repository plus any still waiting in the queue.
export async function eventsFor(date) {
  const out = [];
  try {
    const files = (await list(`events/${date}`)).filter((f) => f.name.endsWith('.json'));
    const got = await Promise.all(files.map((f) => getText(`events/${date}/${f.name}`).then((t) => JSON.parse(t)).catch(() => null)));
    out.push(...got.filter(Boolean));
  } catch (e) { console.warn(e); }
  const pend = (await pendingEvents()).filter((e) => e.date === date);
  const seen = new Set(out.map((e) => e.ts + e.type + (e.task_id || '')));
  pend.forEach((e) => { if (!seen.has(e.ts + e.type + (e.task_id || ''))) out.push(e); });
  return out;
}
