// Reflections tab: weekly reflections written by the nightly coach, a comparison with
// reference speakers, and a way to add reference clips (analysed in the browser).
import { h } from './progress.js?v=20261126c';
import { getJSON, logEvent } from './store.js?v=20261126c';
import { recorderBlock, showResults, closeRunner } from './today.js?v=20261126c';
import { decode16k, analyze, transcribe, transcriptMetrics, candidates, ANALYSIS_VERSION } from './audio.js?v=20261126c';

const REF_METRICS = ['L1.fillers', 'L1.pace', 'L1.pause_breaks', 'L1.run_length', 'L1.volume_drop', 'L1.voice_clarity', 'L3.pitch_range', 'L3.falling_endings', 'L3.words_per_group'];
const cache = {};
const SHORT = { podcast_host: 'Podcast host', ted_speaker: 'TED speaker', academic_elite: 'Academic', interviewee: 'Interviewee' };
const fmtDay = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

async function load(path, sample) {
  if (cache[path] !== undefined) return cache[path];
  try { cache[path] = sample ? await fetch('sample/' + path).then((r) => (r.ok ? r.json() : null)) : await getJSON(path); }
  catch { cache[path] = null; }
  return cache[path];
}

export async function renderReflections(el, data, openFile) {
  const sample = data.sample;
  el.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  const index = (await load('reflections/index.json', sample)) || [];
  const refs = (data.state.references && data.state.references.length ? data.state.references : ((await load('config/references.json', sample)) || {}).personas || []);
  const out = [];
  if (openFile) {
    const r = await load('reflections/' + openFile, sample);
    out.push(h('div', {}, h('button', { class: 'linkbtn', onclick: () => { location.hash = 'reflections'; } }, '← All reflections')));
    out.push(r ? reflection(r, data, refs) : h('div', { class: 'empty' }, 'That reflection could not be loaded.'));
  } else {
    out.push(h('p', { class: 'small', style: 'margin:0' }, 'Every Sunday night your coach writes a reflection on the week: progress, strengths, what to work on, and how you compare with the reference speakers.'));
    if (!index.length) out.push(h('div', { class: 'empty' }, 'Your first reflection arrives on Sunday night, together with your baseline profile.'));
    const latest = index[0] ? await load('reflections/' + index[0].file, sample) : null;
    if (latest) out.push(reflection(latest, data, refs));
    if (index.length > 1) out.push(h('section', {}, h('h2', { class: 'h2' }, 'Earlier reflections'),
      h('div', { class: 'slots' }, ...index.slice(1).map((r) => h('button', { class: 'task', onclick: () => { location.hash = 'reflections/' + r.file; } },
        h('div', { class: 'ck' }, '📓'), h('div', {}, h('div', { class: 't' }, r.title || 'Weekly reflection'), h('div', { class: 'small' }, fmtDay(r.date))), h('span', { class: 'go' }, '›'))))));
  }
  out.push(referenceSection(refs, data));
  el.replaceChildren(...out);
}

function list(title, items, icon) {
  if (!items || !items.length) return null;
  return h('section', {}, h('h3', { class: 'h3' }, title), h('ul', { style: 'margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px' }, ...items.map((x) => h('li', {}, icon ? icon + ' ' : '', x))));
}

function reflection(r, data, refs) {
  const rows = r.progress || [];
  const tbl = rows.length ? h('div', { style: 'overflow-x:auto' }, h('table', { style: 'border-collapse:collapse;width:100%;font-size:.88rem;font-variant-numeric:tabular-nums' },
    h('thead', {}, h('tr', {}, ...['Metric', 'Day 0', 'Last week', 'Now', 'Target'].map((c, i) => h('th', { style: `text-align:${i ? 'right' : 'left'};padding:6px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:600` }, c)))),
    h('tbody', {}, ...rows.map((x) => h('tr', {}, h('td', { style: 'padding:6px;border-bottom:1px solid var(--line)' }, x.metric),
      ...[x.day0, x.last_week, x.now, x.target].map((v, i) => h('td', { style: `text-align:right;padding:6px;border-bottom:1px solid var(--line);${i === 2 ? 'font-weight:600' : ''}` }, v ?? '—'))))))) : null;
  return h('article', { class: 'card', style: 'display:flex;flex-direction:column;gap:14px' },
    h('div', {}, h('div', { class: 'label' }, fmtDay(r.date)), h('h2', { style: 'font-family:var(--serif);font-weight:400;font-size:1.6rem;margin:4px 0' }, r.title || 'Weekly reflection')),
    r.summary ? h('p', { style: 'margin:0;font-size:1.02rem;line-height:1.55' }, r.summary) : null,
    tbl,
    list('Strengths', r.strengths, '💪'),
    list('Still to work on', r.focus, '🎯'),
    personaChart(r.persona_comparison || [], refs),
    r.persona_note ? h('p', { class: 'small', style: 'margin:0' }, r.persona_note) : null,
    list('Next week', r.next_week, '➡️'));
}

// One row per metric: you vs each reference persona, on a shared 0–100 "share of the way" scale
function personaChart(rows, refs) {
  if (!rows.length) return null;
  const colors = { you: 'var(--accent)', podcast_host: '#d97706', ted_speaker: '#db2777', academic_elite: '#059669', interviewee: '#7c3aed' };
  const names = Object.fromEntries(refs.map((p) => [p.persona_id, p.name]));
  const legend = h('div', { class: 'legend' }, h('span', {}, h('i', { style: `background:${colors.you};border-radius:50%` }), 'You'),
    ...[...new Set(rows.flatMap((r) => Object.keys(r.personas || {})))].map((p) => h('span', {}, h('i', { style: `background:${colors[p] || 'var(--ref)'};border-radius:50%` }), names[p] || p)));
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px' });
  for (const r of rows) {
    const vals = [r.you, ...Object.values(r.personas || {})].filter((v) => v != null).map(Number);
    if (!vals.length) continue;
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1; lo -= pad; hi += pad;
    const pos = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
    const track = h('div', { style: 'position:relative;height:30px' }, h('div', { style: 'position:absolute;left:0;right:0;top:14px;height:3px;background:var(--grid);border-radius:2px' }));
    for (const [p, v] of Object.entries(r.personas || {})) if (v != null) track.append(h('div', { title: `${names[p] || p}: ${v}`, style: `position:absolute;left:${pos(+v)};top:7px;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:${colors[p] || 'var(--ref)'};opacity:.85` }));
    if (r.you != null) track.append(h('div', { title: `You: ${r.you}`, style: `position:absolute;left:${pos(+r.you)};top:3px;width:24px;height:24px;margin-left:-12px;border-radius:50%;background:${colors.you};border:3px solid var(--panel);box-shadow:0 1px 3px rgba(0,0,0,.3)` }));
    const lbl = [`you ${r.you ?? '—'}`, ...Object.entries(r.personas || {}).map(([p, v]) => `${SHORT[p] || names[p] || p} ${v}`)].join(' · ');
    body.append(h('div', {}, h('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, h('span', { style: 'font-weight:600' }, r.metric), r.better ? h('span', { class: 'small' }, r.better === 'lower' ? 'lower is better' : 'higher is better') : null),
      track, h('div', { class: 'small' }, lbl)));
  }
  return h('section', {}, h('h3', { class: 'h3' }, 'You vs the reference speakers'), legend, body);
}

function referenceSection(refs, data) {
  const vals = (p) => Object.keys(p.metrics || {}).length;
  return h('section', { id: 'references' }, h('h2', { class: 'h2' }, 'Reference speakers'),
    h('p', { class: 'note' }, 'Clips of the speakers you chose are analysed with exactly the same measures as your recordings. Only the numbers are kept, not the audio.'),
    h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, ...refs.map((p) => h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:6px' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap' }, h('b', {}, p.name), h('span', { class: 'small' }, vals(p) ? `${vals(p)} metrics measured` : 'not measured yet')),
      h('div', { class: 'small' }, p.context || ''),
      ...(p.exemplars || []).map((x) => h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' },
        h('span', {}, x.speaker), x.url ? h('a', { href: x.url, target: '_blank', rel: 'noopener', class: 'small' }, 'open video') : null,
        h('button', { class: 'btn', style: 'padding:6px 12px;margin-left:auto', onclick: () => openRefRunner(p, x, data) }, 'Add clip'))),
      !(p.exemplars || []).length ? h('div', { class: 'small' }, 'No speakers chosen yet. Tell your coach who should go here.') : null))));
}

function openRefRunner(p, x, data) {
  const R = document.getElementById('runner'), RI = document.getElementById('runner-inner');
  R.hidden = false; document.body.style.overflow = 'hidden';
  const slot = h('div', {});
  const file = h('input', { type: 'file', accept: 'audio/*,video/*' });
  const t = { task_id: `ref-${p.persona_id}`, max_seconds: 300, title: x.speaker };
  RI.replaceChildren(
    h('div', { class: 'top' }, h('button', { class: 'linkbtn', onclick: () => { R.hidden = true; document.body.style.overflow = ''; } }, '← Back'), h('span', { class: 'pill', style: 'margin-left:auto' }, p.name)),
    h('h2', {}, `Reference clip: ${x.speaker}`),
    h('p', { style: 'margin:0' }, '3–5 minutes of the speaker talking on their own works best. Two ways to add it:'),
    h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:8px' }, h('b', {}, '1. Upload an audio or video file'), file),
    h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:8px' }, h('b', {}, '2. Or capture it: play the video out loud and record it here'),
      x.url ? h('a', { href: x.url, target: '_blank', rel: 'noopener' }, `Open ${x.speaker}'s video`) : null,
      h('div', { class: 'small' }, 'Turn the volume up and keep the room quiet. Through speakers, only pace and fillers can be measured reliably; pauses, pitch and volume need an uploaded file.'),
      recorderBlock(t, (blob) => slot.replaceChildren(refAnalysis(p, x, blob, true, data)))),
    slot);
  file.addEventListener('change', () => { if (file.files[0]) slot.replaceChildren(refAnalysis(p, x, file.files[0], false, data)); });
}

function refAnalysis(p, x, blob, captured, data) {
  const area = h('div', { style: 'display:flex;flex-direction:column;gap:10px' });
  const status = h('div', { class: 'small' }); const go = h('button', { class: 'btn primary' }, 'Analyse and save');
  area.append(go, status);
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      status.textContent = 'Measuring…';
      let a = await decode16k(blob); if (a.length > 16000 * 300) a = a.subarray(0, 16000 * 300);
      const ac = analyze(a); if (ac.error) { status.textContent = ac.error; go.disabled = false; return; }
      let tm = null;
      try { status.textContent = 'Transcribing (the first time downloads the speech model)…'; tm = transcriptMetrics(await transcribe(a, (q) => { status.textContent = `Downloading speech model… ${Math.round(q.progress || 0)}%`; }), ac, null); }
      catch (e) { status.textContent = 'Transcription did not run here, so pace and fillers are skipped.'; }
      const cand = candidates(ac, tm);
      const keep = (captured ? ['L1.pace', 'L1.fillers'] : REF_METRICS).filter((m) => cand[m] != null);
      area.append(showResults({ ...ac, ...(tm || {}) }));
      if (data.sample) { status.textContent = 'Sample mode: nothing saved.'; return; }
      for (const m of keep) await logEvent({ type: 'reference_measurement', persona: p.persona_id, speaker: x.speaker, metric_id: m, value: +cand[m], captured, tool: ANALYSIS_VERSION });
      status.textContent = `Saved ${keep.length} measure(s) for ${x.speaker}${captured ? ' (captured clips keep only pace and fillers)' : ''}. They appear in your comparisons after tonight\'s update.`;
      go.remove(); area.append(h('button', { class: 'btn', onclick: () => closeRunner() }, 'Done'));
    } catch (e) { status.textContent = 'Something went wrong: ' + e.message; go.disabled = false; }
  });
  return area;
}
