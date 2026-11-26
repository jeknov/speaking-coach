// Today tab: the day's plan (carried-over tasks first) and a full-screen runner per task kind.
import { h, heroCards } from './progress.js?v=20261126';
import { logEvent, saveRecording, saveFile, localTime, localDate } from './store.js?v=20261126';
import { startRecorder, decode16k, analyze, transcribe, transcriptMetrics, candidates, ANALYSIS_VERSION } from './audio.js?v=20261126';

const ICON = { record: '🎙️', memory: '🧠', quiz: '🧩', text: '✍️', form: '📝', rating: '⭐', upload: '📤', check: '✅' };
let ctx = null; // { state, plan, carried, events, sample, refresh, toast }

export function doneMap(events) {
  const m = {}; for (const e of events) if (e.type === 'task_done' && !m[e.task_id]) m[e.task_id] = e; return m;
}

export function doneDates(c) {
  const m = { ...((c.state && c.state.program && c.state.program.done_dates) || {}) };
  for (const e of c.events) if (e.type === 'task_done' && !m[e.task_id]) m[e.task_id] = e.date || localDate();
  return m;
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export function lockedUntil(t, dd) {
  if (!t.spacing) return null;
  const prev = dd[t.spacing.after_task];
  const today = localDate();
  if (!prev) return 'after you finish the first one';
  const ok = new Date(Date.parse(prev) + t.spacing.days * 864e5).toISOString().slice(0, 10);
  return ok > today ? ok : null;
}

export function renderToday(el, c, dv) {
  ctx = c;
  const dd = doneDates(c);
  const evDone = doneMap(c.events);
  const done = new Proxy({}, { get: (_, id) => evDone[id] || (dd[id] ? { local_time: dd[id] === localDate() ? '' : 'earlier', date: dd[id] } : undefined) });
  const all = [...c.carried.map((t) => ({ ...t, carried: true })), ...(c.plan ? c.plan.tasks : [])];
  const n = all.filter((t) => done[t.task_id]).length;
  const ring = ringSvg(n, all.length);
  const list = h('div', {});
  if (!all.length) list.append(h('div', { class: 'empty' }, c.plan === null ? "Today's plan arrives at 8:00. Pull to refresh, or tap ⟳." : 'Nothing planned today. Enjoy the rest day.'));
  for (const slot of ['Morning', 'Midday', 'Afternoon', 'Evening']) {
    const ts = all.filter((t) => (t.carried ? 'Morning' : t.slot) === slot); if (!ts.length) continue;
    list.append(h('div', { class: 'slot-h' }, `${slot} · ${ts[0].carried ? '08:00' : ts[0].time}`));
    const ul = h('div', { class: 'slots' });
    for (const t of ts) {
      const d = done[t.task_id];
      ul.append(h('button', { class: 'task' + (d ? ' done' : ''), onclick: () => openRunner(t) },
        h('div', { class: 'ck' }, d ? '✓' : ''),
        h('div', { style: 'min-width:0' },
          t.carried ? h('div', { class: 'carried' }, '↩ Carried over') : null,
          h('div', { class: 't' }, `${ICON[t.kind] || '•'} ${t.title}`),
          h('div', { class: 'small' }, `${t.minutes} min · ${t.skill_id}${d ? ' · done ' + (d.local_time || '') : ''}`)),
        h('span', { class: 'go' }, '›')));
    }
    list.append(ul);
  }
  const left = h('div', { class: 'view', style: 'gap:14px' },
    h('div', { class: 'today-head' }, ring, h('div', {},
      h('div', { class: 'label' }, c.plan ? c.plan.title || 'Today' : 'Today'),
      h('div', { class: 'big', style: 'font-size:1.5rem' }, `${n} of ${all.length} done`),
      h('div', { class: 'small' }, c.carried.length ? `${c.carried.length} carried over from earlier days. They come first.` : 'Nothing carried over. Clean slate.'),
      h('div', { class: 'small' }, `🔥 ${c.state.program.streak}-day streak · ⭐ ${dv.summary.zero_catchup_days} zero catch-up days`))),
    c.plan && c.plan.message ? h('div', { class: 'card', style: 'font-size:.95rem' }, '💬 ', c.plan.message) : null,
    list,
    n === all.length ? workAhead(c, dd) : null,
    coachNotes(c.notes),
    extraPractice(c, dv));
  const right = h('div', { class: 'view', style: 'gap:14px' }, heroCards(c.state, dv));
  el.replaceChildren(h('div', { class: 'today-wide' }, left, h('div', { class: 'wide-only' }, right)));
  const mq = window.matchMedia('(min-width:900px)');
  el.querySelector('.wide-only').hidden = !mq.matches;
}

function ringSvg(done, total) {
  const r = 46, c = 2 * Math.PI * r, f = total ? done / total : 0;
  const s = `<svg viewBox="0 0 110 110" width="110" height="110" role="img" aria-label="${done} of ${total} done"><circle cx="55" cy="55" r="${r}" fill="none" stroke="var(--grid)" stroke-width="10"/><circle cx="55" cy="55" r="${r}" fill="none" stroke="var(--ok)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${f * c} ${c}" transform="rotate(-90 55 55)"/><text x="55" y="60" text-anchor="middle" font-family="Georgia,serif" font-size="24" fill="var(--fg)">${done}/${total}</text></svg>`;
  const d = h('div', {}); d.innerHTML = s; return d.firstChild;
}

// ---------------- work ahead, coach's notes, extra practice
function taskButton(t, d, lock) {
  return h('button', { class: 'task' + (d ? ' done' : '') + (lock ? ' locked' : ''), onclick: () => { if (!lock) openRunner(t); }, 'aria-disabled': lock ? 'true' : null },
    h('div', { class: 'ck' }, d ? '✓' : lock ? '🔒' : ''),
    h('div', { style: 'min-width:0' }, h('div', { class: 't' }, `${ICON[t.kind] || '•'} ${t.title}`),
      h('div', { class: 'small' }, lock ? `Unlocks ${/^\d/.test(lock) ? 'on ' + lock : lock}: repeats are spaced out to test how stable your baseline is` : `${t.minutes} min · ${t.skill_id}${d ? ' · done' : ''}`)),
    lock ? null : h('span', { class: 'go' }, '›'));
}
function workAhead(c, dd) {
  const days = (c.ahead || []).map((p) => ({ p, todo: p.tasks.filter((t) => !dd[t.task_id]) })).filter((x) => x.todo.length).slice(0, 2);
  if (!days.length) return c.ahead === undefined ? null : h('div', { class: 'card' }, '🎉 All done for today, and nothing planned further ahead yet.');
  return h('section', { class: 'card', style: 'display:flex;flex-direction:column;gap:8px' },
    h('div', { class: 'label' }, 'All done for today · work ahead'),
    h('div', { class: 'small' }, 'Tasks you do early count for their own day, so that day is lighter later.' + (c.state.program.in_baseline ? ' Finish the whole baseline early and Level 1 starts the next day.' : '')),
    ...days.map(({ p, todo }) => h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
      h('div', { class: 'slot-h' }, `${p.title || p.date} · ${fmtDay(p.date)}`),
      ...todo.map((t) => taskButton(t, null, lockedUntil(t, dd))))));
}
const fmtDay = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
function coachNotes(n) {
  if (!n) return null;
  return h('section', { class: 'card', id: 'coach-notes', style: 'display:flex;flex-direction:column;gap:10px' },
    h('div', { class: 'label' }, `Coach's notes · ${fmtDay(n.date)}`),
    n.went_well ? h('div', {}, h('b', {}, '✅ What went well: '), n.went_well) : null,
    ...(n.mistakes || []).map((m, i) => h('div', { style: 'display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--line);padding-top:8px' },
      h('div', { style: 'font-weight:600' }, `${i + 1}. ${m.title}`),
      m.evidence ? h('div', { class: 'small' }, '🔎 ', m.evidence) : null,
      m.why ? h('div', { class: 'small' }, '💡 Why it matters: ', m.why) : null,
      m.try ? h('div', {}, '👉 Try: ', m.try) : null)),
    n.tomorrow ? h('div', { style: 'border-top:1px solid var(--line);padding-top:8px' }, h('b', {}, 'Pay attention to: '), n.tomorrow) : null);
}
export function voiceMinutesToday(c) {
  const vk = new Set(['record', 'memory']);
  return c.events.filter((e) => (e.type === 'task_done' || e.type === 'extra_done') && vk.has(e.kind)).reduce((a, e) => a + (+e.minutes || 3), 0);
}
function weakest(c, dv) {
  const f = (c.state.focus || [])[0];
  if (f) return { skill_id: f.skill_id, why: `${f.metric} is at ${f.share_of_target}% of target` };
  const cur = dv.mprog.filter((m) => m.measured && c.state.skills.find((s) => s.skill_id === m.skill_id && s.status === 'in_progress')).sort((a, b) => a.progress_pct - b.progress_pct)[0];
  return cur ? { skill_id: cur.skill_id, why: `${cur.metric} is ${cur.progress_pct}% of the way to target` } : null;
}
function extraPractice(c, dv) {
  const pools = c.extras || {};
  const ids = Object.keys(pools).filter((k) => (pools[k].tasks || []).length);
  if (!ids.length) return c.state.program.in_baseline ? null : h('section', { class: 'card small' }, 'Extra practice drills appear here once this week\'s pool is ready.');
  const w = weakest(c, dv); let sel = w && ids.includes(w.skill_id) ? w.skill_id : ids[0];
  const vm = voiceMinutesToday(c), capped = vm >= 45;
  const list = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  const draw = () => {
    const dd = new Set(c.events.filter((e) => e.type === 'extra_done').map((e) => e.task_id));
    list.replaceChildren(...pools[sel].tasks.map((t) => {
      const voice = t.kind === 'record' || t.kind === 'memory';
      const b = taskButton({ ...t, extra: true }, dd.has(t.task_id), voice && capped ? 'tomorrow (voice rest: 45 min of voice work today)' : null);
      return b;
    }));
  };
  const chips = h('div', { class: 'chips' }, ...ids.map((k) => h('button', { class: 'chip' + (k === sel ? ' on' : ''), onclick: (e) => { sel = k; chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); draw(); } }, (c.state.skills.find((s) => s.skill_id === k) || {}).name || k)));
  const pickWeak = () => {
    const pool = pools[sel].tasks.filter((t) => !(capped && (t.kind === 'record' || t.kind === 'memory')));
    const dd = new Set(c.events.filter((e) => e.type === 'extra_done').map((e) => e.task_id));
    const t = pool.find((x) => !dd.has(x.task_id)) || pool[0]; if (t) openRunner({ ...t, extra: true });
  };
  draw();
  return h('details', { class: 'card', id: 'extra-practice' },
    h('summary', { style: 'cursor:pointer;font-weight:600' }, '➕ Extra practice', h('span', { class: 'small', style: 'font-weight:400' }, ' · optional, no XP, never counts toward your plan')),
    h('div', { style: 'display:flex;flex-direction:column;gap:10px;margin-top:10px' },
      w ? h('button', { class: 'btn primary', onclick: () => { if (ids.includes(w.skill_id)) sel = w.skill_id; pickWeak(); } }, `🎯 Train my weakest skill`) : null,
      w ? h('div', { class: 'small' }, `Weakest right now: ${w.why}.`) : null,
      h('div', { class: 'small' }, `Voice work today: ${vm} of 45 min.`),
      chips, list));
}

// ---------------- runner
const R = () => document.getElementById('runner'), RI = () => document.getElementById('runner-inner');
export function closeRunner() { if (cleanup) { cleanup(); cleanup = null; } R().hidden = true; document.body.style.overflow = ''; if (ctx) ctx.refresh(); }
let cleanup = null;

export function openRunner(t) {
  const done = t.extra ? null : (doneMap(ctx.events)[t.task_id] || (doneDates(ctx)[t.task_id] ? { local_time: 'earlier' } : null));
  t = { ...t, _practice: !!t.extra || !!done };
  R().hidden = false; document.body.style.overflow = 'hidden';
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px' });
  RI().replaceChildren(...[
    h('div', { class: 'top' }, h('button', { class: 'linkbtn', onclick: closeRunner }, '← Back'), h('span', { class: 'pill', style: 'margin-left:auto' }, `${t.skill_id} · ${t.minutes} min`)),
    h('h2', {}, `${ICON[t.kind] || ''} ${t.title}`),
    done ? h('div', { class: 'pill ok', style: 'align-self:flex-start' }, `Done${done.local_time ? ' at ' + done.local_time : ''}. Practising it again is saved as extra practice and doesn't change your scores.`) : null,
    t.extra ? h('div', { class: 'pill', style: 'align-self:flex-start' }, 'Extra practice · no XP · doesn\'t change your checkpoints') : null,
    h('p', { style: 'margin:0' }, t.instructions || ''), body].filter(Boolean));
  const fn = { record: runRecord, memory: runMemory, quiz: runQuiz, text: runText, form: runForm, rating: runRating, upload: runUpload, check: runCheck }[t.kind] || runCheck;
  fn(t, body, !!done);
}

async function finish(t, already, extra = {}) {
  if (ctx.sample) { ctx.toast('Sample mode: nothing was saved.'); closeRunner(); return; }
  if (t.extra) {
    await logEvent({ type: 'extra_done', task_id: t.task_id, skill_id: t.skill_id, kind: t.kind, minutes: t.minutes, ...extra });
    ctx.events.push({ type: 'extra_done', task_id: t.task_id, kind: t.kind, minutes: t.minutes, date: localDate() });
    ctx.toast('Extra practice saved');
  } else if (!already) {
    const r = await logEvent({ type: 'task_done', task_id: t.task_id, skill_id: t.skill_id, kind: t.kind, minutes: t.minutes, planned_date: t.date, ...extra });
    ctx.events.push({ type: 'task_done', task_id: t.task_id, kind: t.kind, minutes: t.minutes, local_time: localTime(), date: localDate() });
    ctx.toast(r === 'saved' ? '+10 XP · saved' : '+10 XP · saved on this device, will sync when online');
  } else ctx.toast('Practice saved');
  closeRunner();
}
async function measure(t, metricId, value, extra = {}) {
  if (ctx.sample || value == null || !Number.isFinite(+value)) return;
  if (t.metrics && !t.metrics.includes(metricId)) return;
  await logEvent({ type: 'measurement', metric_id: metricId, value: +value, task_id: t.task_id, method: extra.method || 'S', tool: ANALYSIS_VERSION, source: extra.source || '', ...(t._practice ? { extra: true } : {}) });
}

function runCheck(t, body, already) {
  const tm = h('div', { class: 'timer' }, fmt(t.minutes * 60)); let left = t.minutes * 60, iv = null;
  const start = h('button', { class: 'btn', onclick: () => { if (iv) return; iv = setInterval(() => { left--; tm.textContent = fmt(Math.max(0, left)); if (left <= 0) { clearInterval(iv); iv = null; } }, 1000); } }, 'Start timer');
  cleanup = () => clearInterval(iv);
  body.append(tm, h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, start, h('button', { class: 'btn primary', onclick: () => finish(t, already) }, 'Mark done')));
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function recorderBlock(t, onBlob) {
  const max = t.max_seconds || 180;
  const tm = h('div', { class: 'timer' }, '0:00'), meter = h('div', { class: 'meter' }, h('span', {}));
  const btn = h('button', { class: 'btn rec' }, '● Start recording'); const msg = h('div', { class: 'small' }, `Up to ${fmt(max)}. Quiet room, phone about 20 cm from your mouth.`);
  let rec = null, t0 = 0, iv = null;
  const stop = async () => { clearInterval(iv); btn.disabled = true; const blob = await rec.stop(); rec = null; btn.disabled = false; btn.textContent = '● Record again'; btn.className = 'btn'; onBlob(blob, (Date.now() - t0) / 1000); };
  btn.addEventListener('click', async () => {
    if (rec) return stop();
    try {
      rec = await startRecorder((lv) => { meter.firstChild.style.width = Math.round(lv * 100) + '%'; });
      t0 = Date.now(); btn.textContent = '■ Stop'; btn.className = 'btn rec';
      iv = setInterval(() => { const s = (Date.now() - t0) / 1000; tm.textContent = fmt(s); if (s >= max) stop(); }, 250);
    } catch (e) { msg.textContent = 'Microphone not available: ' + e.message + '. Allow microphone access for this site in your browser settings.'; msg.className = 'err'; }
  });
  cleanup = () => { clearInterval(iv); if (rec) rec.cancel(); };
  return h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:10px' }, tm, meter, btn, msg);
}

const LABELS = {
  duration_s: ['Length', 's'], words_per_min: ['Pace', 'wpm'], fillers_per_min: ['Fillers', '/min'], soft_fillers_per_min: ['Soft fillers', '/min'],
  pauses_per_min: ['Pauses', '/min'], mean_pause_s: ['Average pause', 's'], run_length_s: ['Seconds between pauses', 's'], pauses_at_breaks_pct: ['Pauses at clause breaks', '%'],
  pitch_range_st: ['Pitch range', 'st'], falling_endings_pct: ['Falling endings', '%'], volume_drop_db: ['Volume drop at ends', 'dB'], voice_clarity_db: ['Voice clarity', 'dB'],
  longest_voiced_s: ['Longest steady voicing', 's'], articulation_rate: ['Syllables per second', ''], reading_error_pct: ['Reading error rate', '%'], words_per_group: ['Words per thought group', ''], blanks: ['Blanks over 3 s', ''],
};
export function showResults(obj) {
  return h('div', { class: 'results' }, ...Object.entries(LABELS).filter(([k]) => obj[k] != null).map(([k, [l, u]]) => h('div', { class: 'result' }, h('div', { class: 'small' }, l), h('div', { class: 'v' }, `${obj[k]}${u ? ' ' + u : ''}`))));
}

function analysisFlow(t, body, already, blob, extraEvent = {}) {
  const area = h('div', { style: 'display:flex;flex-direction:column;gap:10px' });
  const url = URL.createObjectURL(blob);
  const wantTr = h('input', { type: 'checkbox', id: 'tr', checked: true });
  const status = h('div', { class: 'small' });
  const go = h('button', { class: 'btn primary' }, 'Analyse and save');
  area.append(h('audio', { controls: true, src: url, style: 'width:100%' }),
    h('label', { class: 'small', style: 'display:flex;gap:8px;align-items:center' }, wantTr, 'Also transcribe for pace, fillers and accuracy (downloads a ~80 MB speech model the first time; faster on the Mac)'),
    go, status);
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      status.textContent = 'Measuring pitch, pauses and volume…';
      const x = await decode16k(blob); const ac = analyze(x);
      if (ac.error) { status.textContent = ac.error; status.className = 'err'; go.disabled = false; return; }
      let tr = null, tm = null, trErr = '';
      if (wantTr.checked) {
        try {
          status.textContent = 'Transcribing (first time: downloading the model)…';
          tr = await transcribe(x, (p) => { status.textContent = `Downloading speech model… ${Math.round(p.progress || 0)}%`; });
          tm = transcriptMetrics(tr, ac, t.reference);
        } catch (e) { console.warn(e); trErr = 'Transcription did not run on this device, so pace, fillers and reading accuracy were skipped this time. Pitch, pauses and volume are saved.'; }
      }
      area.append(h('h3', { class: 'h3' }, 'Your results'), showResults({ ...ac, ...(tm || {}) }));
      if (tr) area.append(h('details', { class: 'info' }, h('summary', {}, 'Transcript'), h('div', { class: 'body' }, tr.text || '(empty)')));
      if (trErr) area.append(h('div', { class: 'small warn' }, trErr));
      if (ctx.sample) { status.textContent = 'Sample mode: results shown, nothing saved.'; go.replaceWith(h('button', { class: 'btn', onclick: closeRunner }, 'Close')); return; }
      status.textContent = 'Saving recording…';
      const { path } = await saveRecording(blob, t.task_id);
      const cand = candidates(ac, tm);
      for (const mid of t.metrics || []) if (cand[mid] != null) await measure(t, mid, cand[mid], { source: path });
      const { pause_times, ...acSlim } = ac;
      await logEvent({ type: 'recording', task_id: t.task_id, skill_id: t.skill_id, path, mime: blob.type, analysis: acSlim, pause_times, transcript: tr ? tr.text : null, words: tr ? tr.words : null, transcript_metrics: tm, reference: t.reference || null, tool: ANALYSIS_VERSION, ...extraEvent, ...(t._practice ? { extra: true } : {}) });
      status.textContent = 'Saved.';
      const fin = h('button', { class: 'btn primary', onclick: () => finish(t, already, { recording: path }) }, already ? 'Close' : 'Finish task');
      go.remove(); area.append(status, fin);
    } catch (e) { console.error(e); status.textContent = 'Something went wrong: ' + e.message; status.className = 'err'; go.disabled = false; }
  });
  return area;
}

function runRecord(t, body, already) {
  if (t.reference) body.append(h('div', { class: 'reference' }, t.reference));
  if (t.prompts) body.append(h('ol', { class: 'steps' }, ...t.prompts.map((p) => h('li', {}, p.replace(/^\d+\.\s*/, '')))));
  const slot = h('div', {});
  body.append(recorderBlock(t, (blob) => slot.replaceChildren(analysisFlow(t, body, already, blob))), slot);
}

function runMemory(t, body, already) {
  const notes = h('textarea', { placeholder: 'Your key points, one per line' });
  const tm = h('div', { class: 'timer' }, fmt(t.prep_seconds || 600)); let left = t.prep_seconds || 600;
  const iv = setInterval(() => { left = Math.max(0, left - 1); tm.textContent = fmt(left); }, 1000);
  cleanup = () => clearInterval(iv);
  const ready = h('button', { class: 'btn primary' }, "I'm ready: hide my notes");
  const step = h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('div', { class: 'label' }, 'Preparation'), tm, notes, ready);
  body.append(step);
  ready.addEventListener('click', () => {
    clearInterval(iv);
    const kept = notes.value;
    const slot = h('div', {});
    step.replaceChildren(h('div', { class: 'small' }, 'Notes hidden. Talk for about 3 minutes.'), recorderBlock(t, (blob) => slot.replaceChildren(analysisFlow(t, body, already, blob, { key_points: kept }))), slot);
  });
}

function fragments(text, cue) {
  const parts = text.split(/(?<=[.,;!?…])\s+|\s+—\s+|\.\.\./).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3 && !s.includes(cue) && !cue.includes(s));
  const picks = []; for (const p of parts) if (picks.length < 2) picks.push(p.replace(/[.,;]$/, ''));
  while (picks.length < 2) picks.push(text.split(/\s+/).slice(0, 4 + picks.length).join(' '));
  const all = [cue, ...picks]; for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return all;
}
function runQuiz(t, body, already) {
  const items = t.items || []; let i = 0, cues = 0, emos = 0; const answers = [];
  const box = h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:10px' });
  body.append(box);
  const show = () => {
    if (i >= items.length) return end();
    const it = items[i]; let phase = 0; const rec = { i, cue_pick: null, emotion_pick: null };
    const q = h('div', { class: 'small' }), opts = h('div', {});
    const next = h('button', { class: 'btn', hidden: true, onclick: () => { answers.push(rec); i++; show(); } }, i === items.length - 1 ? 'See score' : 'Next');
    const render = () => {
      opts.replaceChildren();
      const list = phase === 0 ? fragments(it.text, it.cue) : it.options;
      q.textContent = phase === 0 ? 'Which phrase carries the feeling?' : 'What is the feeling?';
      for (const o of list) {
        const b = h('button', { class: 'opt' }, phase === 0 ? `“${o}”` : o);
        b.addEventListener('click', () => {
          const right = phase === 0 ? o === it.cue : o === it.emotion;
          b.classList.add(right ? 'right' : 'wrong');
          [...opts.children].forEach((x) => { x.disabled = true; if ((phase === 0 ? x.textContent === `“${it.cue}”` : x.textContent === it.emotion)) x.classList.add('right'); });
          if (phase === 0) { rec.cue_pick = o; if (right) cues++; setTimeout(() => { phase = 1; render(); }, 700); }
          else { rec.emotion_pick = o; if (right) emos++; next.hidden = false; }
        });
        opts.append(b);
      }
    };
    box.replaceChildren(h('div', { class: 'label' }, `${i + 1} of ${items.length}`), h('div', { class: 'reference', style: 'font-size:1.05rem' }, `“${it.text}”`), q, opts, next);
    render();
  };
  const end = async () => {
    box.replaceChildren(h('div', { class: 'label' }, 'Score'), h('div', { class: 'big' }, `${cues}/${items.length} cues · ${emos}/${items.length} feelings`),
      h('div', { class: 'small' }, 'Saved as your score for this drill.'));
    await measure(t, 'C2.cues_caught', Math.round((cues / items.length) * 10), { method: 'D' });
    await measure(t, 'C2.emotion_named', Math.round((emos / items.length) * 10), { method: 'D' });
    if (!ctx.sample) await logEvent({ type: 'drill', task_id: t.task_id, kind: 'quiz', answers, cues, emotions: emos, n: items.length, ...(t._practice ? { extra: true } : {}) });
    box.append(h('button', { class: 'btn primary', onclick: () => finish(t, already) }, already ? 'Close' : 'Finish task'));
  };
  show();
}

function runText(t, body, already) {
  const areas = (t.prompts || []).map((p) => ({ p, ta: h('textarea', { placeholder: 'Your answer' }) }));
  areas.forEach(({ p, ta }, k) => body.append(h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:8px' }, h('div', { class: 'label' }, `Guest line ${k + 1}`), h('div', { class: 'reference', style: 'font-size:1.05rem' }, `“${p}”`), ta)));
  const err = h('div', { class: 'err' });
  body.append(err, h('div', { class: 'small' }, 'I score these tonight and you get feedback in tomorrow\'s plan.'), h('button', { class: 'btn primary', onclick: async () => {
    if (areas.some((a) => !a.ta.value.trim())) { err.textContent = 'Answer every line first.'; return; }
    if (!ctx.sample) await logEvent({ type: 'drill', task_id: t.task_id, kind: 'text', prompts: areas.map((a) => a.p), answers: areas.map((a) => a.ta.value.trim()), score_with: t.metrics || [], ...(t._practice ? { extra: true } : {}) });
    finish(t, already);
  } }, already ? 'Save again' : 'Save and finish'));
}

function runForm(t, body, already) {
  const fs = (t.fields || []).map((f) => ({ f, ta: h('textarea', {}) }));
  fs.forEach(({ f, ta }) => body.append(h('label', { style: 'display:flex;flex-direction:column;gap:6px' }, h('span', { style: 'font-weight:600' }, f), ta)));
  body.append(h('button', { class: 'btn primary', onclick: async () => {
    if (!ctx.sample) await logEvent({ type: 'form', task_id: t.task_id, answers: Object.fromEntries(fs.map(({ f, ta }) => [f, ta.value.trim()])) });
    finish(t, already);
  } }, 'Save and finish'));
}

function runRating(t, body, already) {
  const max = t.scale || 5; const vals = {};
  for (const it of t.items || []) {
    const sc = h('div', { class: 'scale' });
    for (let v = 1; v <= max; v++) { const b = h('button', {}, v); b.addEventListener('click', () => { vals[it] = v; [...sc.children].forEach((x) => x.classList.toggle('sel', x === b)); }); sc.append(b); }
    body.append(h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, h('div', { style: 'font-weight:600' }, it), sc));
  }
  const err = h('div', { class: 'err' });
  body.append(err, h('button', { class: 'btn primary', onclick: async () => {
    if (Object.keys(vals).length < (t.items || []).length) { err.textContent = 'Rate every line first.'; return; }
    if (!ctx.sample) await logEvent({ type: 'rating', task_id: t.task_id, values: vals, scale: max });
    if ((t.metrics || []).includes('L7.nerves')) await measure(t, 'L7.nerves', Object.values(vals)[0], { method: 'L' });
    finish(t, already);
  } }, 'Save and finish'));
}

function runUpload(t, body, already) {
  const inp = h('input', { type: 'file', accept: t.accept || '*/*', multiple: true });
  const st = h('div', { class: 'small' }, 'Audio, video or a transcript. Up to 25 MB per file.');
  body.append(inp, st, h('button', { class: 'btn primary', onclick: async () => {
    const files = [...inp.files]; if (!files.length) { st.textContent = 'Choose a file first.'; st.className = 'err'; return; }
    if (files.some((f) => f.size > 25e6)) { st.textContent = 'One file is over 25 MB. Trim it to about 3 minutes of audio.'; st.className = 'err'; return; }
    if (ctx.sample) return finish(t, already);
    const paths = [];
    for (const f of files) { st.textContent = `Uploading ${f.name}…`; paths.push((await saveFile(f, t.task_id)).path); }
    await logEvent({ type: 'upload', task_id: t.task_id, paths, names: files.map((f) => f.name), score_with: t.metrics || [], ...(t._practice ? { extra: true } : {}) });
    finish(t, already);
  } }, 'Upload and finish'));
}
