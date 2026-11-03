// Colours, icons and short labels for sources.

import { h } from '../../vendor/lilypad/js/dom.js';
import { noteName } from '../patch/tables.js';

const PALETTE = ['#F5A524', '#C4A1FF', '#FF7A66', '#3DD6C6', '#7FD0FF', '#B6E35A', '#6FA8FF', '#FF6FB5', '#FFD84D',
  '#4FD98A', '#E58CFF', '#F8B4A0', '#9AE6B4', '#B8BEC9'];

// A colour per source. Sources in `previous` keep theirs, so adding one doesn't recolour the
// rest; a new source gets the least used colour.
export function colorsFor(sources, previous = new Map()) {
  const map = new Map();
  for (const s of sources) if (previous.has(s.id)) map.set(s.id, previous.get(s.id));
  for (const s of sources) {
    if (map.has(s.id)) continue;
    const uses = PALETTE.map((c) => [...map.values()].filter((x) => x === c).length);
    map.set(s.id, PALETTE[uses.indexOf(Math.min(...uses))]);
  }
  return map;
}

const PATHS = {
  voice: 'M2 4h12v8H2z M5.5 4v4.5 M8 4v4.5 M10.5 4v4.5',
  triggers: 'M2.5 6c0-1.6 2.5-2.8 5.5-2.8s5.5 1.2 5.5 2.8-2.5 2.8-5.5 2.8S2.5 7.6 2.5 6z M2.5 6v4.5c0 1.6 2.5 2.8 5.5 2.8s5.5-1.2 5.5-2.8V6',
  lfo: 'M1.5 8c1.6-5.3 4.9-5.3 6.5 0s4.9 5.3 6.5 0',
  random: 'M2 5h2.5l7 6H14 M2 11h2.5l2-1.7 M9.5 6.7l2-1.7H14 M12.5 3.5L14 5l-1.5 1.5 M12.5 9.5L14 11l-1.5 1.5',
  knobs: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z M8 8l2.8-2.8',
  level: 'M2.5 6.5h11 M2.5 9.5h11',
  clock: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z M8 5v3.2l2.2 1.4',
  euclid: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z M8 1v3 M13.6 10.6l-2.7-1.2 M2.4 10.6l2.7-1.2',
  hid: 'M3 3.5h10v9H3z M5.5 6.5v0.5 M10.5 6.5v0.5 M5.5 10h5',
  sequencer: 'M2 3.5h12v9H2z M2 8h12 M6 3.5v9 M10 3.5v9',
  drums: 'M2.5 6c0-1.6 2.5-2.8 5.5-2.8s5.5 1.2 5.5 2.8-2.5 2.8-5.5 2.8S2.5 7.6 2.5 6z M2.5 6v4.5c0 1.6 2.5 2.8 5.5 2.8s5.5-1.2 5.5-2.8V6',
  arp: 'M2 12.5l3-3 3 3 3-6 3 3',
  input: 'M8 2v7.5 M5 6.5l3 3 3-3 M3 13h10',
};

const SVG = 'http://www.w3.org/2000/svg';
export function icon(kind, size = 18) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', PATHS[kind] || PATHS.level);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke-width', '1.5');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export const KIND_NAMES = { sequencer: 'Note sequencer', drums: 'Drum sequencer', arp: 'Arpeggiator out', input: 'CV → MIDI',
  voice: 'Voice', triggers: 'Triggers', lfo: 'LFO', random: 'Random (shift register)', knobs: 'CC → CV',
  level: 'Stored levels', clock: 'Clock & transport', euclid: 'Euclidean rhythm', hid: 'USB device' };

// Where a player sends, in a few words: "ch 3 → FH-2, DIN".
export function playerLine(p) {
  const to = [p.internal && 'FH-2', p.usbC && 'USB C', p.usbA && 'USB A', p.din && 'DIN', p.select && 'Select'].filter(Boolean);
  const clock = p.rate === 0 ? (p.clock ? ` · clocked by Euclid ${p.clock}` : ' · external clock') : '';
  return `ch ${p.channel + 1} → ${to.join(', ') || 'nowhere'}${clock}`;
}

// One line under the source's name.
export function subline(s) {
  switch (s.kind) {
    case 'voice': {
      const who = s.players[0]?.name ?? `ch ${s.channel + 1}`;
      const voices = s.voices > 1 ? ` ${s.voices}` : '';
      return `${s.mode}${voices} · ${who} · ${noteName(s.notes[0])}–${noteName(s.notes[1])}`;
    }
    case 'triggers': return `${s.ports.length} · ${s.players[0]?.name ?? `MIDI ch ${s.channel + 1}`}`;
    case 'lfo': return `${s.lfo.synced ? 'synced ' : ''}${s.lfo.rate}`;
    case 'euclid': return s.pattern ? `${s.pattern.pulses} of ${s.pattern.steps}${s.idle ? ' · off' : ''}` : 'pattern is in the preset';
    case 'knobs': return `MIDI ch ${s.channel + 1}`;
    case 'hid': return `only with a ${s.id === 'gamepad' ? 'gamepad' : 'keyboard'} on USB A`;
    default: return KIND_NAMES[s.kind] ?? s.kind;
  }
}

// Several sources in a few words: "Euclid 1–16, Random 3".
export function sourceList(sources) {
  const byName = new Map();
  for (const s of sources) {
    const [, base, n] = s.name.match(/^(.*?) (\d+)$/) ?? [null, s.name, null];
    if (!byName.has(base)) byName.set(base, []);
    if (n) byName.get(base).push(+n);
  }
  return [...byName].map(([base, nums]) => (nums.length ? `${base} ${ranges(nums)}` : base)).join(', ');
}

function ranges(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j;
  }
  return out.join(', ');
}

// A short label for a port, for the jack it comes out of.
export function shortLabel(s, port) {
  switch (s.kind) {
    case 'voice': return `V${s.index + 1} ${port.name}`;
    case 'euclid': return `E${s.index + 1} ${port.name}`;
    case 'random': return `R${s.index + 1} ${port.name}`;
    case 'lfo': return 'LFO';
    case 'level': return 'Level';
    default: return port.name;
  }
}

export const chip = (text, color, missing = false) =>
  h('span', { class: 'chip' + (missing ? ' missing' : ''), style: color ? `--src:${color}` : undefined, title: missing ? 'not installed in your rack' : undefined }, text);
