// Progress, Skills and Badges views. Everything is drawn from state.json (rebuilt nightly
// from the full raw log) plus today's live events.
import * as d3 from './vendor/d3.js?v=20261126';
import { critter, badgeArt, rankArt, RARITY } from './art.js?v=20261126';

export const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
};
const fmtDate = (s) => (s ? d3.utcFormat('%b %-d, %Y')(new Date(s + 'T00:00:00Z')) : '—');
const fmtShort = (s) => (s ? d3.utcFormat('%b %-d')(new Date(s + 'T00:00:00Z')) : '—');
const STATUS = { completed: '✅ Completed', in_progress: '▶ In progress', not_started: '🔒 Not started', remedial: '🔁 Remedial week' };
const MEDAL = { bronze: '🥉', silver: '🥈', gold: '🥇' };
const MEDAL_TXT = { bronze: 'Bronze: all tasks done', silver: 'Silver: level score 70 or more', gold: 'Gold: every target met' };
const unitStr = (u) => (u ? (u.startsWith('/') || u === '%' ? u : ' ' + u) : '');
const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v);

// ---------- derived numbers (same formulas as the approved dashboard)
export function derive(state, live) {
  const p = state.program;
  const mprog = state.metrics.map((r) => {
    const measured = isNum(r.current) && isNum(r.day0);
    const d0 = +r.day0, tg = +r.target, cur = +r.current, pb = +r.personal_best;
    const span = d0 - tg, clamp = (x) => Math.max(0, Math.min(100, x));
    const toPct = (v) => (span === 0 ? 100 : clamp(((d0 - v) / span) * 100));
    const imp = measured && d0 !== 0 ? (r.better === 'lower' ? (d0 - cur) / d0 : (cur - d0) / d0) * 100 : null;
    return { ...r, measured, progress_pct: measured ? Math.round(toPct(cur)) : null, best_pct: measured ? Math.round(toPct(isNum(pb) ? pb : cur)) : null,
      improvement_pct: imp === null ? null : Math.round(imp * 10) / 10, beaten: imp !== null && imp > 0, pb_set: measured && isNum(pb) && pb !== d0 };
  });
  const score = (v, tg, better) => (better === 'lower' ? (tg === 0 ? 100 / (1 + v) : v <= 0 ? 100 : Math.min(100, (tg / v) * 100)) : tg <= 0 ? 100 : Math.min(100, Math.max(0, (v / tg) * 100)));
  const skillsum = {};
  for (const s of state.skills) {
    const ms = mprog.filter((m) => m.skill_id === s.skill_id), meas = ms.filter((m) => m.measured);
    const bs = state.badges.filter((b) => b.skill_id === s.skill_id);
    const sc = (f) => Math.round(meas.reduce((a, m) => a + score(+m[f], +m.target, m.better), 0) / meas.length);
    skillsum[s.skill_id] = { metrics_total: ms.length, metrics_measured: meas.length, metrics_beaten: meas.filter((m) => m.beaten).length,
      avg_progress: meas.length ? Math.round(meas.reduce((a, m) => a + m.progress_pct, 0) / meas.length) : null,
      task_pct: s.tasks_total ? Math.round((100 * s.tasks_done) / s.tasks_total) : 0,
      badges_earned: bs.filter((b) => b.earned_on).length, badges_total: bs.length,
      score_day0: meas.length ? sc('day0') : null, score_now: meas.length ? sc('current') : null };
  }
  const meas = mprog.filter((m) => m.measured);
  const lvl = state.skills.find((s) => s.skill_id === p.current_level_id) || {};
  const liveDone = live ? live.doneToday : 0, liveTotal = live ? live.totalToday : 0;
  const nextStreak = [7, 30, 100].find((n) => n > p.streak) || 100;
  return {
    mprog, skillsum,
    summary: {
      metrics_beaten: meas.filter((m) => m.beaten).length, metrics_measured: meas.length, personal_bests: meas.filter((m) => m.pb_set).length,
      avg_progress_pct: meas.length ? Math.round(meas.reduce((a, m) => a + m.progress_pct, 0) / meas.length) : 0,
      practice_hours: Math.round(state.daily.reduce((a, d) => a + +d.minutes, 0) / 6) / 10,
      zero_catchup_days: state.daily.filter((d) => +d.zero_catchup === 1).length,
      today_done: liveDone, today_total: liveTotal,
      badges_earned: state.badges.filter((b) => b.earned_on).length, badges_total: state.badges.length,
      skills_completed: state.skills.filter((s) => s.status === 'completed').length,
      pct_complete: p.total_tasks ? Math.round((1000 * (p.tasks_done + (live ? live.doneTodayNew : 0))) / p.total_tasks) / 10 : 0,
      level_tasks_done: lvl.tasks_done || 0, level_tasks_total: lvl.tasks_total || 0,
      level_pct: lvl.tasks_total ? Math.round((100 * lvl.tasks_done) / lvl.tasks_total) : 0,
      days_to_level_end: Math.round((Date.parse(p.current_level_expected_end) - Date.parse(p.today_date)) / 864e5),
      days_to_next_streak_badge: nextStreak - p.streak,
      rank_pct: p.next_rank_xp > p.rank_floor_xp ? Math.round((100 * (p.xp - p.rank_floor_xp)) / (p.next_rank_xp - p.rank_floor_xp)) : 100,
      xp_to_next: Math.max(0, p.next_rank_xp - p.xp),
    },
  };
}

const bar = (pct, color) => h('div', { class: 'bar' }, h('span', { style: `width:${pct || 0}%;background:${color || 'var(--ok)'}` }));

// ---------- hero cards (shared with the Today tab on wide screens)
export function heroCards(state, dv, { compact } = {}) {
  const p = state.program, s = dv.summary;
  const finish = h('div', { class: 'card hero', id: 'card-level-finish' },
    h('div', {},
      h('div', { class: 'label' }, `${p.current_level_name} finishes`),
      h('div', { class: 'huge' }, fmtDate(p.current_level_expected_end)),
      h('div', { class: 'small' }, s.days_to_level_end >= 0 ? `In ${s.days_to_level_end} days` : 'Finishing today'),
      h('details', { class: 'info' }, h('summary', {}, h('i', { class: 'i' }, 'i'), ' Whole program'),
        h('div', { class: 'body' }, `The whole program is projected to finish on ${fmtDate(p.projected_end)}, against a plan of ${fmtDate(p.original_end)}. ${p.days_added < 0 ? `You've gained ${-p.days_added} day(s) by working ahead` : p.days_added > 0 ? `${p.days_added} day(s) have been added by carried-over tasks or remedial weeks` : 'You are exactly on plan'}, and ${p.backlog} task(s) are in the backlog now. Overall, ${s.pct_complete}% of all tasks are done.`))),
    h('div', { style: 'min-width:150px;flex:1;max-width:320px' }, h('div', { class: 'small' }, `${s.level_tasks_done} of ${s.level_tasks_total} level tasks done`), bar(s.level_pct)));
  if (compact) return finish;
  const nextStreak = [7, 30, 100].find((n) => n > p.streak) || 100;
  return h('section', { class: 'cards', id: 'hero' }, finish,
    h('div', { class: 'card' }, h('div', { class: 'label' }, 'Streak 🔥'), h('div', { class: 'big' }, `${p.streak} days`),
      h('div', { class: 'small' }, `Best ${p.best_streak}. ${nextStreak - p.streak} day(s) to the next streak badge.`)),
    h('div', { class: 'card' }, h('div', { class: 'label' }, 'Zero catch-up wins ⭐'), h('div', { class: 'big' }, s.zero_catchup_days), h('div', { class: 'small' }, 'Days that ended with nothing carried over.')),
    h('div', { class: 'card' }, h('div', { class: 'label' }, 'Rank'),
      h('div', { style: 'display:flex;gap:10px;align-items:center' }, rankArt(p.rank, 56),
        h('div', {}, h('div', { class: 'big', style: 'font-size:1.25rem' }, p.rank), h('div', { class: 'small' }, `${s.xp_to_next} XP to ${p.next_rank}`))),
      bar(s.rank_pct, 'var(--accent)')));
}

// ---------- then vs now: one score per level, Day 0 vs now vs target
export function thenVsNow(state, dv, onOpen) {
  const wrap = h('div', { class: 'compare' });
  const levels = state.skills.filter((k) => k.track === 'Main' && k.status !== 'not_started').sort((a, b) => a.seq - b.seq);
  const sec = h('section', { id: 'compare' }, h('h2', { class: 'h2' }, 'Then vs now'),
    h('p', { class: 'note' }, 'One score per level: how close its metrics are to their targets, on average. 100 means every target is reached.'),
    h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--ref)' }), 'Day 0'), h('span', {}, h('i', { style: 'background:var(--accent)' }), 'Now'),
      h('span', {}, h('i', { style: 'background:none;border-top:2px dashed var(--ok);border-radius:0;height:0;width:14px;vertical-align:3px' }), 'Target (100)')),
    wrap,
    h('details', { class: 'info' }, h('summary', {}, h('i', { class: 'i' }, 'i'), ' How the level score works'),
      h('div', { class: 'body' }, 'Each metric is scored as a share of its target, capped at 100: your value divided by the target when higher is better, the target divided by your value when lower is better. A level\'s score is the average of its metrics, worked out the same way for Day 0 and for now.')));
  let any = false;
  requestAnimationFrame(() => {
    for (const k of levels) {
      const ss = dv.skillsum[k.skill_id]; if (!ss || !ss.metrics_measured) continue; any = true;
      const chart = h('div', { class: 'chart', style: 'margin-top:8px' });
      const gain = ss.score_now - ss.score_day0;
      const card = h('div', { class: 'card' }, h('div', { style: 'font-weight:600;margin-bottom:4px' }, k.name), h('span', { class: 'st ' + k.status }, STATUS[k.status]), chart,
        h('div', { class: 'small', style: 'display:flex;justify-content:space-between;gap:8px;margin-top:6px' },
          h('span', { class: gain > 0 ? 'ok' : gain < 0 ? 'bad' : '' }, `${gain >= 0 ? '▲ +' : '▼ '}${gain} points vs Day 0`),
          h('button', { class: 'linkbtn', onclick: () => onOpen && onOpen(k.skill_id) }, 'Details →')));
      wrap.append(card);
      const W = Math.max(180, chart.clientWidth || 220), H = 170, bot = 20, top = 16;
      const y = d3.scaleLinear().domain([0, 110]).range([H - bot, top]);
      const bw = Math.min(54, W * 0.24), gap = W * 0.14, x1 = W / 2 - gap / 2 - bw, x2 = W / 2 + gap / 2;
      const svg = d3.select(chart).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', `${k.name}: Day 0 ${ss.score_day0}, now ${ss.score_now}, target 100`);
      svg.append('line').attr('x1', 0).attr('x2', W).attr('y1', H - bot).attr('y2', H - bot).style('stroke', 'var(--line)');
      [{ k: 'Day 0', v: ss.score_day0, x: x1, c: 'var(--ref)' }, { k: 'Now', v: ss.score_now, x: x2, c: 'var(--accent)' }].forEach((b) => {
        svg.append('rect').attr('x', b.x).attr('y', y(b.v)).attr('width', bw).attr('height', Math.max(1, y(0) - y(b.v))).attr('rx', 4).style('fill', b.c);
        svg.append('text').attr('x', b.x + bw / 2).attr('y', y(b.v) - 5).attr('text-anchor', 'middle').style('fill', 'var(--fg)').style('font-size', '13px').style('font-weight', '600').text(b.v);
        svg.append('text').attr('x', b.x + bw / 2).attr('y', H - 5).attr('text-anchor', 'middle').text(b.k);
      });
      svg.append('line').attr('x1', 2).attr('x2', W - 2).attr('y1', y(100)).attr('y2', y(100)).style('stroke', 'var(--ok)').attr('stroke-width', 2).attr('stroke-dasharray', '6 4');
      svg.append('text').attr('x', W - 2).attr('y', y(100) - 4).attr('text-anchor', 'end').style('fill', 'var(--ok)').style('font-size', '10px').text('target 100');
    }
    if (!any) wrap.append(h('div', { class: 'empty' }, 'Your first comparison appears once Level 1 has its first weekly checkpoint.'));
  });
  return sec;
}

function calendar(state) {
  const bg = { clean: 'var(--ok)', carried: 'var(--warn)', missed: 'var(--bad)', today: 'transparent' };
  const cal = h('div', { class: 'cal' });
  for (const d of state.daily) {
    const c = h('div', { class: 'day', title: `${fmtShort(d.date)} · ${d.tasks_done}/${d.tasks_due} done`, 'aria-label': `${fmtShort(d.date)}: ${d.tasks_done} of ${d.tasks_due} done`,
      style: `background:${bg[d.status] || 'var(--grid)'};${d.status === 'today' ? 'border:2px solid var(--fg);color:var(--fg)' : ''}` }, d.day > 0 ? d.day : 'B');
    if (+d.zero_catchup === 1) c.append(h('span', { class: 'star' }, '⭐'));
    cal.append(c);
  }
  if (!state.daily.length) cal.append(h('div', { class: 'empty' }, 'Your first day appears here tonight.'));
  return h('section', { id: 'calendar' }, h('h2', { class: 'h2' }, 'Every day so far'),
    h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--ok)' }), 'All done ⭐'), h('span', {}, h('i', { style: 'background:var(--warn)' }), 'Carried over'),
      h('span', {}, h('i', { style: 'background:var(--bad)' }), 'Missed'), h('span', {}, h('i', { style: 'border:2px solid var(--fg)' }), 'Today'), h('span', {}, 'B = baseline week')), cal);
}

export function renderProgress(el, state, dv, onOpen) {
  const p = state.program, s = dv.summary;
  el.replaceChildren(
    h('p', { class: 'small', style: 'margin:0' }, p.in_baseline ? `Baseline week · ${s.metrics_measured} metrics measured so far.` :
      `Week ${p.week_number}, day ${p.day_number}. You're ahead of Day-0 you on ${s.metrics_beaten} of the ${s.metrics_measured} metrics trained so far.`),
    heroCards(state, dv), thenVsNow(state, dv, onOpen),
    (state.focus || []).length ? h('section', { id: 'focus' }, h('h2', { class: 'h2' }, 'Still working on'),
      h('p', { class: 'note' }, 'Metrics below target in levels you have finished. They come first in extra practice and are re-tested every two weeks.'),
      h('div', { class: 'slots' }, ...state.focus.slice(0, 5).map((f) => h('button', { class: 'task', onclick: () => onOpen && onOpen(f.skill_id) },
        h('div', { class: 'ck' }, '🎯'), h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 't' }, f.metric), h('div', { class: 'small' }, `${f.skill_id} · now ${f.current} · target ${f.target}`), bar(f.share_of_target, 'var(--warn)')), h('span', { class: 'go' }, '›'))))) : null,
    h('section', { id: 'stats' }, h('h2', { class: 'h2' }, 'Your numbers'), h('div', { class: 'stats' },
      ...[['Personal bests set', s.personal_bests], ['Hours practised', s.practice_hours], ['Tasks done', p.tasks_done], ['Badges earned', `${s.badges_earned} / ${s.badges_total}`], ['Levels completed', s.skills_completed], ['Average progress to target', s.avg_progress_pct + '%']]
        .map(([l, v]) => h('div', { class: 'stat' }, h('div', { class: 'label' }, l), h('div', { class: 'big' }, v))))),
    calendar(state));
}

// ---------- skills list and detail
export function renderSkills(el, state, dv, openId, onOpen) {
  if (openId) return renderSkill(el, state, dv, openId, onOpen);
  const cards = (track) => h('div', { class: 'skills' }, ...state.skills.filter((k) => k.track === track).sort((a, b) => a.seq - b.seq).map((k) => {
    const m = dv.skillsum[k.skill_id] || {};
    return h('button', { class: 'skill ' + k.status, onclick: () => onOpen(k.skill_id) },
      h('span', { class: 'st ' + k.status }, STATUS[k.status]), h('div', { class: 'nm' }, k.medal && MEDAL[k.medal] ? h('span', { class: 'medal', title: MEDAL_TXT[k.medal] }, MEDAL[k.medal]) : null, k.name),
      h('div', { class: 'small' }, k.status === 'completed' ? `Done ${fmtShort(k.end_date)}` : k.status === 'in_progress' ? `Finishes ${fmtShort(k.end_date)}` : `Starts ~${fmtShort(k.start_date)}`),
      bar(m.task_pct, k.status === 'not_started' ? 'var(--grid)' : 'var(--ok)'),
      h('div', { class: 'small' }, m.metrics_measured ? `${m.avg_progress}% to target · ` : m.metrics_total ? `${m.metrics_total} metrics · ` : '', `🏅 ${m.badges_earned}/${m.badges_total}`));
  }));
  el.replaceChildren(h('p', { class: 'note', style: 'margin:0' }, 'Tap a skill to see all its metrics, your weekly checkpoints and its badges.'),
    h('h3', { class: 'h3' }, 'Main track'), cards('Main'), h('h3', { class: 'h3' }, 'Conversation track'), cards('Conversation'));
}

function renderSkill(el, state, dv, id, onOpen) {
  const k = state.skills.find((x) => x.skill_id === id); if (!k) return renderSkills(el, state, dv, null, onOpen);
  const m = dv.skillsum[id] || {};
  const chips = h('div', { class: 'chips' }, ...[...state.skills].sort((a, b) => (a.track === b.track ? a.seq - b.seq : a.track === 'Main' ? -1 : 1))
    .map((s) => h('button', { class: 'chip' + (s.skill_id === id ? ' on' : ''), 'aria-label': s.name, onclick: () => onOpen(s.skill_id) }, (s.status === 'completed' ? '✅ ' : s.status === 'in_progress' ? '▶ ' : '🔒 ') + s.skill_id)));
  const rows = dv.mprog.filter((r) => r.skill_id === id);
  const race = h('div', { class: 'race' });
  if (!rows.length) race.append(h('div', { class: 'empty' }, 'This level is your baseline: the recordings that set every Day 0 score.'));
  for (const r of rows) {
    const u = unitStr(r.unit), tr = h('div', { class: 'track' }, h('div', { class: 'rail' }));
    let v;
    if (r.measured) {
      const good = r.improvement_pct > 0, col = good ? 'var(--ok)' : r.improvement_pct < 0 ? 'var(--bad)' : 'var(--ref)', pos = `calc((100% - 14px) * ${r.progress_pct / 100})`;
      tr.append(h('div', { class: 'fill', style: `width:${pos};background:${col}` }), h('div', { class: 'pb', style: `left:calc((100% - 14px) * ${r.best_pct / 100})` }),
        h('div', { class: 'me', style: `left:${pos};background:${col}`, 'aria-label': `${r.progress_pct}% of the way to target` }, '🏃'));
      v = h('div', { class: 'val' }, h('div', {}, r.current + u), h('div', { class: 'small ' + (good ? 'ok' : r.improvement_pct < 0 ? 'bad' : '') }, `${good ? '▲' : r.improvement_pct < 0 ? '▼' : '■'} ${Math.abs(r.improvement_pct)}% vs Day 0`), h('div', { class: 'small' }, `Best ${r.personal_best ?? r.current}`));
    } else {
      tr.append(h('div', { class: 'me', style: 'left:0;background:var(--panel);border:1px solid var(--line)' }, '🔒'));
      v = h('div', { class: 'val' }, h('div', {}, isNum(r.day0) ? r.day0 + u : '—'), h('div', { class: 'small' }, isNum(r.day0) ? 'Day 0' : 'not measured yet'));
    }
    tr.append(h('div', { class: 'flag' }, '🏁'));
    const refs = (state.references || []).filter((p) => p.metrics && isNum(p.metrics[r.metric_id])).map((p) => `${({ podcast_host: 'Podcast host', ted_speaker: 'TED speaker', academic_elite: 'Academic', leadership: 'Leadership' })[p.persona_id] || p.name} ${p.metrics[r.metric_id]}${u}`);
    race.append(h('div', { class: 'race-row' }, h('div', {}, h('div', {}, r.metric, h('span', { class: 'tag' }, r.method)), h('div', { class: 'small' }, `Day 0 ${isNum(r.day0) ? r.day0 + u : '—'} → target ${r.target}${u}`),
      refs.length ? h('div', { class: 'small', style: 'color:var(--accent)' }, '◆ ', refs.join(' · ')) : null), tr, v));
  }
  // weekly checkpoints
  const measured = rows.filter((r) => r.measured);
  const chart = h('div', { class: 'chart', style: 'min-height:220px' });
  const sel = h('select', { 'aria-label': 'Metric', style: 'margin-bottom:8px;max-width:340px' }, ...measured.map((r) => h('option', { value: r.metric }, r.metric)));
  const draw = () => {
    chart.replaceChildren();
    const metric = sel.value, raw = rows.find((r) => r.metric === metric);
    const pts = state.history.filter((x) => x.skill_id === id && x.metric === metric).map((x) => ({ x: +x.week, v: +x.value }));
    if (!raw || !pts.length) { chart.append(h('div', { class: 'empty' }, 'Weekly checkpoints appear here once this skill starts.')); return; }
    const W = Math.max(280, chart.clientWidth || 600), H = 220, mg = { t: 16, r: 16, b: 28, l: 42 };
    const svg = d3.select(chart).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', `${metric} by week`);
    const x = d3.scaleLinear().domain(d3.extent(pts, (d) => d.x)).range([mg.l, W - mg.r]);
    const ext = d3.extent([...pts.map((d) => d.v), +raw.target]), pad = (ext[1] - ext[0]) * 0.15 || 1;
    const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice().range([H - mg.b, mg.t]);
    svg.append('g').attr('transform', `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(Math.min(pts.length, 8)).tickFormat((d) => (d === 0 ? 'Day 0' : 'Wk ' + d)).tickSizeOuter(0));
    svg.append('g').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - mg.l - mg.r))).call((g) => { g.select('.domain').remove(); g.selectAll('line').style('stroke', 'var(--grid)'); });
    svg.append('line').attr('x1', mg.l).attr('x2', W - mg.r).attr('y1', y(+raw.target)).attr('y2', y(+raw.target)).style('stroke', 'var(--ok)').attr('stroke-dasharray', '4 3');
    svg.append('text').attr('x', W - mg.r).attr('y', y(+raw.target) - 5).attr('text-anchor', 'end').text('Target ' + raw.target);
    svg.append('path').datum(pts).attr('fill', 'none').style('stroke', 'var(--accent)').attr('stroke-width', 2.5).attr('d', d3.line().x((d) => x(d.x)).y((d) => y(d.v)));
    svg.append('g').selectAll('circle').data(pts).join('circle').attr('cx', (d) => x(d.x)).attr('cy', (d) => y(d.v)).attr('r', 4).style('fill', 'var(--accent)');
    svg.append('g').selectAll('text').data(pts).join('text').attr('x', (d) => x(d.x)).attr('y', (d) => y(d.v) - 9).attr('text-anchor', 'middle').text((d) => d.v);
  };
  sel.addEventListener('change', draw);
  el.replaceChildren(
    h('div', {}, h('button', { class: 'linkbtn', onclick: () => onOpen(null) }, '← All skills')), chips,
    h('div', {}, h('span', { class: 'st ' + k.status }, STATUS[k.status]), h('h2', { style: 'font-family:var(--serif);font-weight:400;font-size:1.7rem;margin:8px 0 4px' }, k.name),
      h('div', { class: 'small' }, k.status === 'completed' ? `${fmtShort(k.start_date)} – ${fmtShort(k.end_date)} · completed` : k.status === 'in_progress' ? `Started ${fmtShort(k.start_date)} · expected to finish ${fmtShort(k.end_date)}` : `Expected to start ~${fmtShort(k.start_date)}`),
      h('p', { class: 'small', style: 'font-size:.95rem' }, m.metrics_measured ? `Ahead of Day 0 on ${m.metrics_beaten} of ${m.metrics_measured} metrics, on average ${m.avg_progress}% of the way to target.` : 'Not started yet. Your Day 0 scores are below; the race starts when this skill does.'),
      h('div', { class: 'small' }, `${k.tasks_done} of ${k.tasks_total} tasks done`), h('div', { style: 'max-width:420px' }, bar(m.task_pct)),
      k.medal && MEDAL[k.medal] ? h('div', { style: 'margin-top:10px' }, h('span', { class: 'medal' }, MEDAL[k.medal]), MEDAL_TXT[k.medal], k.level_score != null ? ` · level score ${k.level_score}` : '', k.medal !== 'gold' ? h('div', { class: 'small' }, 'Medals can still go up: every metric below target stays in your extra practice and is re-tested every two weeks.') : null) : null,
      k.status === 'remedial' ? h('div', { class: 'small warn', style: 'margin-top:6px' }, `Remedial week until ${fmtShort(k.remedial_until)}: one focused week on the metrics that didn't move yet.`) : null),
    h('section', {}, h('h2', { class: 'h2' }, 'Metrics'), h('p', { class: 'note' }, 'Each track runs from your Day 0 score (left) to your target (🏁). The thin line is your personal best.'), race),
    h('section', {}, h('h2', { class: 'h2' }, 'Weekly checkpoints'), measured.length ? sel : null, chart),
    h('section', {}, h('h2', { class: 'h2' }, 'Badges for this skill'), badgeGrid(state.badges.filter((b) => b.skill_id === id))),
    h('details', { class: 'info' }, h('summary', {}, h('i', { class: 'i' }, 'i'), ' How each metric is measured'),
      h('div', { class: 'body' }, 'S: measured by the app\'s speech analysis. S+: needs an addition to the analysis. T: counted from a transcript. D: drill score. R: rated against a rubric. E: scored by an outside rater. L: logged by you, or self-rated.')));
  requestAnimationFrame(draw);
  window.scrollTo({ top: 0 });
}

export function badgeGrid(list) {
  if (!list.length) return h('div', { class: 'empty' }, 'No badges here.');
  const sorted = [...list].sort((a, b) => (b.earned_on ? 1 : 0) - (a.earned_on ? 1 : 0));
  return h('div', { class: 'badges' }, ...sorted.map((b) => h('div', { class: 'badge' + (b.earned_on ? '' : ' locked') }, badgeArt(b.badge_id, b.rarity, 84),
    h('div', { class: 'bn' }, (b.earned_on ? '' : '🔒 ') + b.name), h('div', { class: 'bd' }, b.description),
    h('div', { class: 'br', style: `color:${RARITY[b.rarity] || 'inherit'}` }, b.rarity + (b.earned_on ? ' · ' + fmtShort(b.earned_on) : '')))));
}

export function renderBadges(el, state) {
  const groups = [['ALL', 'Program-wide: streaks, comebacks and milestones'], ...state.skills.map((s) => [s.skill_id, s.name])];
  const earned = state.badges.filter((b) => b.earned_on).length;
  el.replaceChildren(h('p', { class: 'small', style: 'margin:0' }, `${earned} of ${state.badges.length} earned. Grey badges are still locked; each says how to unlock it.`),
    ...groups.map(([gid, name]) => {
      const list = state.badges.filter((b) => b.skill_id === gid); if (!list.length) return null;
      return h('section', {}, h('h3', { class: 'h3' }, `${name} · ${list.filter((b) => b.earned_on).length}/${list.length}`), badgeGrid(list));
    }));
}
