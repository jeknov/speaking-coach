// Badge art: illustrated images in img/badges/<badge_id>.webp, with the original SVG critters as fallback.
const NS = 'http://www.w3.org/2000/svg';
export const RARITY = { common: '#3BA99C', rare: '#4A7BE0', epic: '#9B5DE5', legendary: '#E0A526' };
const ACC = {
  'clean-slate': 'sparkle', 'early-bird': 'beak', songbird: 'beak', 'perfect-week': 'crest', 'slot-machine': 'stars', 'zero-hero': 'cape', chatterbox: 'bubbles', magpie: 'beak', hummingbird: 'beak',
  'bounce-back': 'bunny', brink: 'cape', fixer: 'sparkle', llama: 'bunny', 'pb-party': 'stars', 'past-self': 'glass', 'grand-slam': 'crown',
  'baseline-brave': 'cape', mirror: 'glass', belly: 'round', 'back-row': 'stars', goldilocks: 'curls', 'pause-applause': 'stars', 'um-believable': 'bubble',
  linky: 'bubbles', sniper: 'glass', 'stress-free': 'one', rainbow: 'notes', crystal: 'crown', guru: 'curls', monotone: 'notes', falcon: 'beak', ace: 'one', melody: 'notes',
  sloth: 'round', squirrel: 'fox', bluf: 'one', prep: 'cape', tangent: 'paper', echo: 'bubbles', elephant: 'round', 'mood-ring': 'sparkle', detective: 'glass',
  'one-question': 'bubble', ladder: 'one', fox: 'fox', cat: 'fox', segue: 'notes', whisperer: 'crown', palace: 'crest', blank: 'bubble', koala: 'round', 'no-notes': 'paper', titan: 'crown',
  tortoise: 'round', wrangler: 'stars', shapeshifter: 'sparkle', owl: 'beak', butterflies: 'stars', judo: 'cape', 'room-owner': 'crown', briefing: 'paper', sommelier: 'bubbles', otter: 'round', phoenix: 'crest', rank: 'beak',
};
const FACES = ['#FFD9A8', '#BDE7D7', '#CFE6FF', '#B9F0A8', '#F7E3F0', '#FFE58A', '#FFD1C1', '#E5DBFF', '#FFE9B8', '#D7F3FF', '#EADBC8', '#FFC59B', '#DFF5E1', '#FFD6E7'];
const faceFor = (id) => FACES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % FACES.length];
function sv(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function star(s, x, y, r) { sv('path', { d: `M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z`, fill: '#FFC83D' }, s); }
export function critter(id, rarity, size) {
  const a = ACC[id] || 'sparkle', face = faceFor(id), ring = RARITY[rarity] || RARITY.common;
  const s = sv('svg', { viewBox: '0 0 100 100', width: size, height: size, role: 'img', 'aria-label': 'badge illustration' });
  sv('circle', { cx: 50, cy: 52, r: 44, fill: ring, opacity: 0.16 }, s);
  sv('circle', { cx: 50, cy: 52, r: 44, fill: 'none', stroke: ring, 'stroke-width': 4 }, s);
  if (a === 'bunny') [38, 62].forEach((x) => sv('ellipse', { cx: x, cy: 22, rx: 7, ry: 18, fill: face, stroke: '#C98BB0', 'stroke-width': 2 }, s));
  if (a === 'fox') { const c = id === 'cat' ? '#9AA0A6' : '#F08A4B'; sv('path', { d: 'M28 40 L30 14 L46 32 Z', fill: c }, s); sv('path', { d: 'M72 40 L70 14 L54 32 Z', fill: c }, s); }
  if (a === 'round') [28, 72].forEach((x) => sv('circle', { cx: x, cy: 34, r: id === 'elephant' ? 15 : 10, fill: face, stroke: 'rgba(0,0,0,.18)', 'stroke-width': 1.5 }, s));
  if (a === 'crest') sv('path', { d: 'M44 26 Q46 6 52 22 Q58 4 58 26 Z', fill: '#E85D75' }, s);
  if (a === 'curls') [34, 44, 56, 66].forEach((x) => sv('circle', { cx: x, cy: 31, r: 7, fill: '#F2C14E' }, s));
  if (a === 'crown') sv('path', { d: 'M34 32 L36 16 L44 26 L50 12 L56 26 L64 16 L66 32 Z', fill: '#F2C14E', stroke: '#C9971C', 'stroke-width': 1.5 }, s);
  sv('circle', { cx: 50, cy: 55, r: 26, fill: face, stroke: 'rgba(0,0,0,.15)', 'stroke-width': 1.5 }, s);
  [41, 59].forEach((x) => { sv('circle', { cx: x, cy: 51, r: 3.4, fill: '#2B2B2B' }, s); sv('circle', { cx: x + 1.2, cy: 49.8, r: 1.1, fill: '#fff' }, s); });
  [35, 65].forEach((x) => sv('circle', { cx: x, cy: 60, r: 4, fill: '#FF8FA3', opacity: 0.55 }, s));
  if (a === 'beak') sv('path', { d: 'M45 58 L55 58 L50 66 Z', fill: '#F59E0B' }, s);
  else sv('path', { d: 'M43 61 Q50 68 57 61', fill: 'none', stroke: '#2B2B2B', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, s);
  if (a === 'cape') sv('path', { d: 'M30 74 Q50 92 70 74 L64 70 Q50 80 36 70 Z', fill: '#E85D75' }, s);
  if (a === 'one') { sv('circle', { cx: 76, cy: 26, r: 11, fill: '#3BA99C' }, s); sv('text', { x: 76, y: 31, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: '#fff' }, s).textContent = '1'; }
  if (a === 'sparkle') { star(s, 76, 24, 7); star(s, 22, 30, 6); }
  if (a === 'stars') { star(s, 76, 24, 7); star(s, 22, 30, 6); star(s, 80, 72, 6); }
  if (a === 'bubble' || a === 'bubbles') {
    sv('rect', { x: 64, y: 14, width: 26, height: 18, rx: 8, fill: '#fff', stroke: '#9B5DE5', 'stroke-width': 2 }, s);
    sv('text', { x: 77, y: 27, 'text-anchor': 'middle', 'font-size': 10, fill: '#9B5DE5', 'font-weight': 700 }, s).textContent = a === 'bubble' ? 'um' : '…';
    if (a === 'bubble') sv('line', { x1: 66, y1: 30, x2: 88, y2: 16, stroke: '#E85D75', 'stroke-width': 2.5 }, s);
    else sv('rect', { x: 10, y: 22, width: 20, height: 14, rx: 6, fill: '#fff', stroke: '#E85D75', 'stroke-width': 2 }, s);
  }
  if (a === 'notes') { ['M74 16 L74 34', 'M84 12 L84 30', 'M74 16 L84 12'].forEach((d) => sv('path', { d, stroke: '#4A7BE0', 'stroke-width': 2.8 }, s)); sv('circle', { cx: 71, cy: 35, r: 4, fill: '#4A7BE0' }, s); sv('circle', { cx: 81, cy: 31, r: 4, fill: '#4A7BE0' }, s); }
  if (a === 'glass') { sv('circle', { cx: 74, cy: 72, r: 10, fill: 'rgba(255,255,255,.6)', stroke: '#6B4F3A', 'stroke-width': 3 }, s); sv('line', { x1: 81, y1: 79, x2: 90, y2: 88, stroke: '#6B4F3A', 'stroke-width': 4, 'stroke-linecap': 'round' }, s); }
  if (a === 'paper') { sv('rect', { x: 66, y: 64, width: 20, height: 24, rx: 2, fill: '#fff', stroke: '#888', 'stroke-width': 1.5 }, s); sv('path', { d: 'M70 70 L82 84 M82 70 L70 84', stroke: '#E85D75', 'stroke-width': 2.5 }, s); }
  return s;
}

// Illustrated badge image; falls back to the SVG critter if the file is missing.
export function badgeArt(id, rarity, size) {
  const img = document.createElement('img');
  Object.assign(img, { src: `img/badges/${id}.webp?v=20261126f`, width: size, height: size, alt: '', loading: 'lazy', decoding: 'async', className: 'badge-art' });
  img.addEventListener('error', () => img.replaceWith(critter(id, rarity, size)), { once: true });
  return img;
}

// Rank card art: one illustrated cat per rank, drawn from the badge set.
const RANK_ART = {
  'Mumble Mouse': 'baseline-brave', 'Steady Sparrow': 'songbird', 'Pause Panda': 'pause-applause',
  'Clear-Voice Crane': 'crystal', 'Silver-Tongued Otter': 'otter', 'Keynote Phoenix': 'phoenix',
};
export function rankArt(rank, size) { return badgeArt(RANK_ART[rank] || 'baseline-brave', 'epic', size); }
