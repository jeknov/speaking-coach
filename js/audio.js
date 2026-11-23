// Recording and in-browser speech analysis.
// Acoustic measures are a JavaScript port of speech_metrics.py: pitch by normalised
// autocorrelation, pauses from an intensity threshold, syllable nuclei from intensity peaks.
// Transcription (optional) runs Whisper in the browser via transformers.js.

export const ANALYSIS_VERSION = 'js-0.1';

export async function startRecorder(onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
  const buf = new Float32Array(an.fftSize); let raf = 0;
  const tick = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; onLevel && onLevel(Math.min(1, Math.sqrt(s / buf.length) * 6)); raf = requestAnimationFrame(tick); };
  tick(); rec.start(1000);
  return {
    stop: () => new Promise((res) => {
      rec.onstop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); res(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' })); };
      rec.stop();
    }),
    cancel: () => { try { rec.stop(); } catch {} cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); },
  };
}

// Decode any recording to mono Float32 at 16 kHz.
export async function decode16k(blob) {
  const ab = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(ab.slice(0)); ctx.close();
  const len = Math.ceil(buf.duration * 16000);
  const off = new OfflineAudioContext(1, len, 16000);
  const s = off.createBufferSource(); s.buffer = buf; s.connect(off.destination); s.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}

const pct = (arr, p) => { if (!arr.length) return NaN; const a = [...arr].sort((x, y) => x - y); const i = (a.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const r2 = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

export function analyze(x, sr = 16000) {
  const hop = Math.round(sr * 0.01), win = Math.round(sr * 0.04), n = Math.floor((x.length - win) / hop);
  const db = new Float32Array(Math.max(n, 0)), t = new Float32Array(Math.max(n, 0));
  for (let i = 0; i < n; i++) {
    let s = 0; const o = i * hop; for (let j = 0; j < win; j++) s += x[o + j] * x[o + j];
    db[i] = 10 * Math.log10(s / win + 1e-12); t[i] = (o + win / 2) / sr;
  }
  if (n < 50) return { error: 'Recording too short to analyse.' };
  const thresh = pct(Array.from(db), 0.99) - 25;
  // pitch on candidate frames
  // pitch on a 2x-decimated signal, every second frame (fast enough for phones)
  const sr2 = sr / 2, x2 = new Float32Array(Math.floor(x.length / 2));
  for (let i = 0; i < x2.length; i++) x2[i] = 0.5 * (x[2 * i] + x[2 * i + 1]);
  const hop2 = hop / 2, win2 = win / 2;
  const lagMin = Math.floor(sr2 / 500), lagMax = Math.ceil(sr2 / 75);
  const f0 = new Float32Array(n), corr = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    if (db[i] <= thresh) continue;
    const o = i * hop2;
    if (o + win2 >= x2.length) break;
    const rs = new Float32Array(lagMax + 2); let mx = 0;
    for (let lag = lagMin; lag <= lagMax + 1 && lag < win2 - 16; lag++) {
      let num = 0, e0 = 0, e1 = 0; const m = win2 - lag;
      for (let j = 0; j < m; j++) { const a = x2[o + j], b = x2[o + j + lag]; num += a * b; e0 += a * a; e1 += b * b; }
      rs[lag] = num / Math.sqrt(e0 * e1 + 1e-12); if (lag <= lagMax && rs[lag] > mx) mx = rs[lag];
    }
    // shortest lag that is a local peak and close to the best: avoids sub-octave errors
    let bestLag = 0;
    for (let lag = lagMin + 1; lag <= lagMax; lag++) if (rs[lag] >= 0.9 * mx && rs[lag] >= rs[lag - 1] && rs[lag] >= rs[lag + 1]) { bestLag = lag; break; }
    const best = bestLag ? rs[bestLag] : 0;
    if (best > 0.55) {
      const a = rs[bestLag - 1], b = rs[bestLag], c = rs[bestLag + 1], den = a - 2 * b + c;
      const lagF = den ? bestLag + (0.5 * (a - c)) / den : bestLag;
      f0[i] = sr2 / lagF; corr[i] = best; if (i + 1 < n && db[i + 1] > thresh) { f0[i + 1] = f0[i]; corr[i + 1] = best; }
    }
  }
  // octave-jump cleanup: drop values more than 7 semitones from a running median
  const voicedIdx = []; for (let i = 0; i < n; i++) if (f0[i] > 0) voicedIdx.push(i);
  const fv = voicedIdx.map((i) => f0[i]);
  const med = pct(fv, 0.5);
  voicedIdx.forEach((i) => { if (Math.abs(12 * Math.log2(f0[i] / med)) > 12) f0[i] = 0; });
  const st = []; const hnr = [];
  for (let i = 0; i < n; i++) if (f0[i] > 0) { st.push(12 * Math.log2(f0[i] / med)); const r = Math.min(corr[i], 0.999); hnr.push(10 * Math.log10(r / (1 - r))); }

  // speech / pause runs
  const speaking = Array.from(db, (v) => v > thresh);
  let runs = []; let s0 = 0;
  for (let i = 1; i <= n; i++) if (i === n || speaking[i] !== speaking[s0]) { runs.push({ sp: speaking[s0], a: t[s0], b: t[i - 1] + 0.01, i0: s0, i1: i - 1 }); s0 = i; }
  while (runs.length && !runs[0].sp) runs.shift();
  while (runs.length && !runs[runs.length - 1].sp) runs.pop();
  if (!runs.length) return { error: 'No speech detected. Check the microphone.' };
  const minPause = 0.25;
  const pauses = runs.filter((r) => !r.sp && r.b - r.a >= minPause);
  // merge speech across short gaps into "speech runs"
  const sruns = []; let cur = null;
  for (const r of runs) {
    if (r.sp || r.b - r.a < minPause) { if (!cur) cur = { a: r.a, b: r.b, i0: r.i0, i1: r.i1 }; else { cur.b = r.b; cur.i1 = r.i1; } }
    else { if (cur) sruns.push(cur); cur = null; }
  }
  if (cur) sruns.push(cur);
  const active = runs[runs.length - 1].b - runs[0].a;
  const speechTime = runs.filter((r) => r.sp).reduce((s, r) => s + (r.b - r.a), 0);
  const minutes = active / 60;

  // syllable nuclei: voiced intensity peaks with >= 2 dB dips between them
  let peaks = 0, lastPeak = -Infinity, minSince = Infinity;
  for (let i = 1; i < n - 1; i++) {
    minSince = Math.min(minSince, db[i]);
    if (db[i] > db[i - 1] && db[i] >= db[i + 1] && db[i] > thresh && f0[i] > 0) {
      if (lastPeak === -Infinity || (lastPeak - minSince >= 2 && db[i] - minSince >= 2)) { peaks++; lastPeak = db[i]; minSince = Infinity; }
      else if (db[i] > lastPeak) lastPeak = db[i];
    }
  }

  // volume drop at the end of runs and pitch direction at the end of runs
  const drops = [], ends = [];
  for (const r of sruns) {
    const len = r.b - r.a; if (len < 1.0) continue;
    const idx = []; for (let i = r.i0; i <= r.i1; i++) if (db[i] > thresh) idx.push(i);
    if (idx.length < 40) continue;
    const head = idx.slice(0, Math.floor(idx.length * 0.6)).map((i) => db[i]);
    const tail = idx.filter((i) => t[i] > r.b - 0.3).map((i) => db[i]);
    if (tail.length > 5) drops.push(mean(head) - mean(tail));
    const pv = idx.filter((i) => t[i] > r.b - 0.45 && f0[i] > 0).map((i) => [t[i], 12 * Math.log2(f0[i] / med)]);
    if (pv.length >= 5) {
      const mx = mean(pv.map((p) => p[0])), my = mean(pv.map((p) => p[1]));
      const slope = pv.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / (pv.reduce((s, p) => s + (p[0] - mx) ** 2, 0) || 1);
      ends.push(slope * 0.45);
    }
  }
  // longest continuous voicing (allowing 60 ms gaps) for the sustained "ah"
  let longest = 0, runStart = -1, gap = 0;
  for (let i = 0; i < n; i++) {
    if (f0[i] > 0) { if (runStart < 0) runStart = i; gap = 0; longest = Math.max(longest, (i - runStart + 1) * 0.01); }
    else if (runStart >= 0 && ++gap > 6) { runStart = -1; gap = 0; }
  }
  return {
    duration_s: r2(active, 1), minutes: r2(minutes, 2),
    f0_median_hz: r2(med, 0), pitch_range_st: st.length > 20 ? r2(pct(st, 0.95) - pct(st, 0.05)) : null, pitch_sd_st: st.length > 20 ? r2(sd(st)) : null,
    phonation_ratio: r2(speechTime / active, 2), pauses_per_min: r2(pauses.length / minutes, 1), mean_pause_s: pauses.length ? r2(mean(pauses.map((p) => p.b - p.a))) : 0,
    long_pauses: pauses.filter((p) => p.b - p.a > 1).length, blanks: pauses.filter((p) => p.b - p.a > 3).length,
    run_length_s: r2(mean(sruns.map((r) => r.b - r.a))), runs: sruns.length,
    articulation_rate: speechTime ? r2(peaks / speechTime) : null,
    volume_drop_db: drops.length ? r2(mean(drops), 1) : null,
    falling_endings_pct: ends.length ? r2((100 * ends.filter((e) => e < -1).length) / ends.length, 0) : null,
    voice_clarity_db: hnr.length ? r2(mean(hnr), 1) : null,
    longest_voiced_s: r2(longest, 1),
    pause_times: pauses.map((p) => [r2(p.a, 2), r2(p.b, 2)]),
  };
}

// ---- transcription (optional, downloads a speech model the first time)
let asrPromise = null;
export function loadASR(onProgress) {
  if (!asrPromise) {
    asrPromise = (async () => {
      const tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2');
      return tf.pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', {
        progress_callback: (p) => onProgress && p.status === 'progress' && onProgress(p),
      });
    })().catch((e) => { asrPromise = null; throw e; });
  }
  return asrPromise;
}

export async function transcribe(x16k, onProgress) {
  const asr = await loadASR(onProgress);
  let out;
  try { out = await asr(x16k, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word' }); }
  catch { out = await asr(x16k, { chunk_length_s: 30, stride_length_s: 5 }); }
  return { text: (out.text || '').trim(), words: (out.chunks || []).map((c) => ({ w: c.text, a: c.timestamp?.[0], b: c.timestamp?.[1] })) };
}

const HARD = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'eh', 'hmm', 'mm']);
const SOFT1 = new Set(['like', 'basically', 'actually', 'literally']);
const norm = (w) => w.toLowerCase().replace(/[^a-z']/g, '');
function wer(ref, hyp) {
  let d = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= hyp.length; j++) { const tmp = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (ref[i - 1] === hyp[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return d[hyp.length] / Math.max(ref.length, 1);
}
export function transcriptMetrics(tr, acoustic, reference) {
  const toks = tr.text.split(/\s+/).map(norm).filter(Boolean);
  const content = toks.filter((t) => !HARD.has(t));
  const min = acoustic.minutes || 1;
  const res = {
    words: content.length, words_per_min: r2(content.length / min, 0),
    fillers_per_min: r2(toks.filter((t) => HARD.has(t)).length / min, 2),
    soft_fillers_per_min: r2((toks.filter((t) => SOFT1.has(t)).length + (tr.text.toLowerCase().match(/\byou know\b|\bi mean\b|\bkind of\b|\bsort of\b/g) || []).length) / min, 2),
    words_per_group: acoustic.runs ? r2(content.length / acoustic.runs, 1) : null,
  };
  if (tr.words.length > 3 && tr.words.every((w) => Number.isFinite(w.a))) {
    let gaps = 0, atB = 0;
    for (let i = 0; i < tr.words.length - 1; i++) {
      if (tr.words[i + 1].a - tr.words[i].b >= 0.3) { gaps++; if (/[.,;:?!]\s*$/.test(tr.words[i].w)) atB++; }
    }
    res.pauses_at_breaks_pct = gaps ? r2((100 * atB) / gaps, 0) : null;
  }
  if (reference) {
    const ref = reference.split(/\s+/).map(norm).filter(Boolean);
    res.reading_error_pct = r2(100 * wer(ref, content), 1);
  }
  return res;
}

// Map analysis outputs to metric ids. Only metrics a task asks for are saved.
export function candidates(ac, tm) {
  const c = {
    'L1.run_length': ac.run_length_s, 'L1.volume_drop': ac.volume_drop_db, 'L1.voice_clarity': ac.voice_clarity_db,
    'L1.sustained_ah': ac.longest_voiced_s, 'L3.pitch_range': ac.pitch_range_st, 'L3.falling_endings': ac.falling_endings_pct,
    'L5.no_notes_min': ac.minutes, 'L5.blanks': ac.blanks,
  };
  if (tm) Object.assign(c, {
    'L1.fillers': tm.fillers_per_min, 'L1.pace': tm.words_per_min, 'L1.pause_breaks': tm.pauses_at_breaks_pct,
    'L3.words_per_group': tm.words_per_group, 'L2.reading_error': tm.reading_error_pct, 'L5.fillers_recall': tm.fillers_per_min,
  });
  return c;
}
