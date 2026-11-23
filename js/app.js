import { settings, getJSON, testConnection, flush, pendingCount, eventsFor, localDate } from './store.js';
import { h, derive, renderProgress, renderSkills, renderBadges } from './progress.js';
import { renderToday, doneMap } from './today.js';

const $ = (s) => document.querySelector(s);
const VIEWS = ['today', 'progress', 'skills', 'badges', 'settings'];
const TITLES = { today: 'Today', progress: 'Progress', skills: 'Skills', badges: 'Badges', settings: 'Settings' };
let data = null; // { state, plan, carried, events, sample }

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }

async function setSync() {
  const el = $('#sync');
  if (data && data.sample) { el.textContent = 'Sample data'; el.className = 'pill warn'; return; }
  if (!settings.token) { el.textContent = 'Not connected'; el.className = 'pill bad'; return; }
  const n = await pendingCount();
  if (!navigator.onLine) { el.textContent = n ? `Offline · ${n} waiting` : 'Offline'; el.className = 'pill warn'; }
  else if (n) { el.textContent = `${n} waiting to sync`; el.className = 'pill warn'; }
  else { el.textContent = 'Synced'; el.className = 'pill ok'; }
}

async function load() {
  const today = localDate();
  if (settings.sample || !settings.token) {
    const [state, plan] = await Promise.all([fetch('sample/state.json').then((r) => r.json()), fetch('sample/plan.json').then((r) => r.json())]);
    const events = plan.done.map((id) => ({ type: 'task_done', task_id: id, local_time: '08:2' + id.slice(-1) }));
    data = { state, plan, carried: plan.carried || [], events, sample: true, connected: !!settings.token };
    return;
  }
  try {
    await flush();
    const [state, plan, events] = await Promise.all([getJSON('state/state.json'), getJSON(`plan/${today}.json`), eventsFor(today)]);
    const carried = [];
    const ids = (state && state.program.backlog_task_ids) || [];
    const dates = [...new Set(ids.map((id) => id.slice(0, 10)))];
    const plans = await Promise.all(dates.map((d) => getJSON(`plan/${d}.json`).catch(() => null)));
    for (const p of plans) if (p) for (const t of p.tasks) if (ids.includes(t.task_id)) carried.push(t);
    data = { state, plan, carried, events, sample: false, connected: true };
    try { localStorage.setItem('sc_cache', JSON.stringify({ ...data, events: [], at: Date.now(), date: today })); } catch {}
  } catch (e) {
    console.warn(e);
    const c = JSON.parse(localStorage.getItem('sc_cache') || 'null');
    if (c) { data = { ...c, events: c.date === today ? c.events : [], sample: false, connected: true, stale: true }; toast('Offline: showing your last synced data.'); }
    else throw e;
  }
}

function live() {
  const done = doneMap(data.events);
  const all = [...data.carried, ...(data.plan ? data.plan.tasks : [])];
  return { doneToday: all.filter((t) => done[t.task_id]).length, totalToday: all.length, doneTodayNew: data.sample ? 0 : Object.keys(done).length };
}

function route() {
  const [v, arg] = (location.hash.slice(1) || 'today').split('/');
  return { view: VIEWS.includes(v) ? v : 'today', arg: arg || null };
}

function render() {
  const { view, arg } = route();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== view; });
  $('#title').textContent = TITLES[view];
  $('#sample-banner').hidden = !(data && data.sample) || view === 'settings' || (view === 'today' && !settings.token && !settings.sample);
  setSync();
  const el = $('#view-' + view);
  if (view === 'settings') return renderSettings(el);
  if (!data) { el.replaceChildren(h('div', { class: 'empty' }, 'Loading…')); return; }
  if (data.sample && !settings.token && view === 'today' && !settings.sample) return renderWelcome(el);
  const dv = derive(data.state, live());
  const openSkill = (id) => { location.hash = id ? `skills/${id}` : 'skills'; };
  if (view === 'today') renderToday(el, { ...data, refresh: async () => { render(); }, toast }, dv);
  if (view === 'progress') renderProgress(el, data.state, dv, openSkill);
  if (view === 'skills') renderSkills(el, data.state, dv, arg, openSkill);
  if (view === 'badges') renderBadges(el, data.state);
}

function renderWelcome(el) {
  el.replaceChildren(h('div', { class: 'welcome' },
    h('h1', {}, 'Speaking Coach'),
    h('p', {}, 'Your daily speaking practice, progress dashboard and badges, synced between your phone and your Mac through your private GitHub data repository.'),
    h('button', { class: 'btn primary', onclick: () => { location.hash = 'settings'; } }, 'Connect my data'),
    h('button', { class: 'btn', onclick: () => { settings.sample = true; render(); } }, 'Look around with sample data')));
}

function renderSettings(el) {
  const tok = h('input', { type: 'password', placeholder: 'github_pat_…', value: settings.token, autocomplete: 'off' });
  const msg = h('div', { class: 'small' });
  const pend = h('span', {}, '…'); pendingCount().then((n) => { pend.textContent = n; });
  el.replaceChildren(
    h('section', { class: 'card', style: 'display:flex;flex-direction:column;gap:10px' },
      h('h2', { class: 'h2' }, 'Connect your data'),
      h('p', { class: 'small', style: 'margin:0' }, 'The app reads and writes only your private repository jeknov/speaking-coach-data. The key stays on this device.'),
      h('ol', { class: 'steps small' },
        h('li', {}, 'On github.com, open Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.'),
        h('li', {}, 'Repository access: Only select repositories → speaking-coach-data.'),
        h('li', {}, 'Permissions → Repository permissions → Contents: Read and write.'),
        h('li', {}, 'Set an expiry you are comfortable with, generate it, and paste it below. Do the same paste once on each device.')),
      tok,
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        h('button', { class: 'btn primary', onclick: async () => {
          settings.token = tok.value.trim(); msg.className = 'small'; msg.textContent = 'Checking…';
          try { await testConnection(); settings.sample = false; msg.textContent = 'Connected.'; msg.className = 'small ok'; await reload(); }
          catch (e) { msg.textContent = e.message; msg.className = 'err'; }
        } }, 'Save and test'),
        settings.token ? h('button', { class: 'btn', onclick: () => { settings.token = ''; tok.value = ''; msg.textContent = 'Disconnected on this device.'; reload(); } }, 'Disconnect this device') : null),
      msg),
    h('section', { class: 'card', style: 'display:flex;flex-direction:column;gap:10px' },
      h('h2', { class: 'h2' }, 'Sync'),
      h('div', { class: 'small' }, 'Waiting to upload: ', pend, ' item(s). Items wait here when you are offline and upload automatically.'),
      h('button', { class: 'btn', onclick: async () => { const n = await flush(); toast(n ? `${n} item(s) uploaded` : 'Nothing to upload'); pendingCount().then((c) => { pend.textContent = c; }); setSync(); } }, 'Sync now')),
    h('section', { class: 'card', style: 'display:flex;flex-direction:column;gap:10px' },
      h('h2', { class: 'h2' }, 'Sample data'),
      h('label', { class: 'small', style: 'display:flex;gap:8px;align-items:center' },
        h('input', { type: 'checkbox', checked: settings.sample, onchange: (e) => { settings.sample = e.target.checked; reload(); } }), 'Show the made-up Week 10 sample instead of my data')),
    h('p', { class: 'small' }, `Speaking Coach 0.1 · device ${settings.device}`));
}

async function reload() { try { await load(); } catch (e) { console.error(e); toast('Could not load: ' + e.message); } render(); }

window.addEventListener('hashchange', render);
window.addEventListener('online', async () => { const n = await flush(); if (n) toast(`${n} item(s) synced`); setSync(); });
window.addEventListener('offline', setSync);
let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!$('#runner').hidden) return; render(); }, 250); });
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.view; }));
$('#gear').addEventListener('click', () => { location.hash = 'settings'; });
$('#refresh').addEventListener('click', () => { toast('Refreshing…'); reload(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && settings.token && !settings.sample && $('#runner').hidden) reload(); });
reload();
