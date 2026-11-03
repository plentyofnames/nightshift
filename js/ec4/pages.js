// EC4 pages: one page (an EC4 group of 16 knobs) per source that has settings a knob can
// change, made from a template for its kind, plus the LIVE page you fill yourself from the
// others. Each knob controls one FH-2 setting through one CC mapping: the config's own mapping
// for that setting if it has one, else a CC that mapPages() adds on the pages channel. A
// setting on two pages (its own and LIVE) is one mapping and one CC, so the EC4 keeps both
// knobs on the same value.
//
// Templates hold the settings you turn while playing. The rest can be put on a free knob by
// hand: a page's free knobs offer the rest of its object's settings, LIVE's every setting of
// every object (objectsOf lists them all). The FH-2's commands (arp add, remove, rest,
// transpose…, nudge, tempo ±0.1) act while their CC is 64 or more, or when it gets there, so
// they go on the pushes, which send 127 while held and 0 on release.
//
// The pages are recomputed from the patch like everything else. Night Shift's own part lives
// in the patch's names: `ec4:live` holds LIVE's 16 setting keys separated by commas (empty
// where a knob is free), `ec4:add:<page>` the knobs put on a page's free knobs the same way,
// `ec4:page:<page>` a page's name.

import { encodeTarget, isUsed } from '../patch/mappings.js';
import { PARAM_NAMES } from '../patch/tables.js';
import { sanitizeName } from '../../vendor/lilypad/js/model.js';

export const SETUP = 14; // the EC4 setup Night Shift owns: setup 15 (16 is the MDMM's)
export const GROUPS = 16;
export const KNOBS = 16;
export const LIVE_KEY = 'ec4:live';
export const pageNameKey = (id) => `ec4:page:${id}`;
const knobsKey = (pageId) => (pageId === 'live' ? LIVE_KEY : `ec4:add:${pageId}`);

// The settings the FH-2 takes as 14-bit (CC n below 32 with n + 32 as the fine half).
export const HIRES = new Set(['directLevel', 'lfoSpeed', 'lfoLevel']);
// On/off settings, shown ON/OFF on the EC4.
export const SWITCHES = new Set(['arpLatch']);

export const settingKey = (t) => `${t.kind}:${t.index}:${t.param}`;
export function settingOf(key) {
  const [kind, index, param] = key.split(':');
  return { kind, index: Number(index), param };
}

// ---- names on the EC4 (four characters) and in Night Shift

const SHORT = {
  lfoTempoBase: 'SYNC', lfoTempoMultiplier: 'MULT', lfoLevel: 'DPTH', directLevel: 'LEVL', lfoSine: 'SINE', lfoTriangle: 'TRI',
  lfoSaw: 'SAW', lfoSquare: 'SQR', lfoPulseWidth: 'PW', lfoRandom: 'RAND', lfoNoise: 'NOIS', smoothing: 'SMTH', lfoPhase: 'PHAS',
  lfoFade: 'FADE', lfoSpeed: 'RATE',
  pulses: 'PULS', steps: 'STEP', rotation: 'ROT', rate: 'RATE', gate: 'GATE', accent: 'ACNT', reset: 'RSET',
  randomness: 'RAND', length: 'LEN', attenuator: 'ATTN', scale: 'SCAL', key: 'KEY', gateLength: 'GATE', direction: 'DIR',
  envAttack: 'ATK', envDecay: 'DEC', envSustain: 'SUS', envRelease: 'REL', envDepth: 'ENVD', envVelocityDepth: 'VELD',
  envRange: 'ERNG', randomDepth: 'RNDD', envAttackShape: 'ASHP', envDecayShape: 'DSHP', envReleaseShape: 'RSHP',
  arpMode: 'ARP', arpRange: 'ARNG', arpGate: 'AGAT', arpRate: 'ARAT', arpLatch: 'LTCH', arpReset: 'ARST', portamento: 'GLID',
  transpose: 'TRNS', arpTruncate: 'TRNC',
  tempo: 'TEMP', swingAmount: 'SWNG', swingType: 'STYP', displayMode: 'DISP', displayItem: 'DITM', position: 'POS',
};

const label = (param) => {
  const n = (PARAM_NAMES[param] ?? param).replace(/^LFO /, '');
  return n.charAt(0).toUpperCase() + n.slice(1);
};
const cellOf = (kind, index, param, source, more = {}) => ({
  short: SHORT[param] ?? param.slice(0, 4).toUpperCase(), label: label(param), setting: { kind, index, param },
  key: settingKey({ kind, index, param }), source, ...more });
const fill = (cells) => Array.from({ length: KNOBS }, (_, i) => cells[i] ?? null);

// "CV2·1" → "C2.1", "5" → "OUT5", "GT1·3" → "G1.3": a jack in four characters.
export function jackShort(jack) {
  const j = String(jack).replace('·', '.');
  if (/^\d+$/.test(j)) return `OUT${j}`.slice(0, 4);
  return (j.charAt(0) + j.replace(/^[A-Za-z]+/, '')).slice(0, 4);
}
const jackDigits = (jack) => String(jack).replace('·', '.').replace(/^[A-Za-z]+/, '');

// A page name in the EC4's four characters: "Voice 1" → "VOI1", "Euclid 12" → "EU12", "Wobble" → "WOBB".
export function shortName(name) {
  const clean = String(name).replace('·', '.').replace(/[^0-9A-Za-z .\/-]/g, '').trim();
  const m = clean.match(/^(.*?)\s*(\d+)$/);
  if (m && m[1] && m[2].length <= 3) return fourChars(m[1].replace(/\s+/g, '').toUpperCase().slice(0, 4 - m[2].length) + m[2]);
  return fourChars(clean.replace(/\s+/g, '').toUpperCase());
}
// Up to four characters the EC4 can show (padded with spaces only when written).
export const fourChars = (text) => sanitizeName(text).trimEnd();

// ---- everything a knob or a push can control

const ARP_COMMANDS = [['arpAdd', 'Arp add'], ['arpRemove', 'Arp remove'], ['arpRest', 'Arp rest'], ['arpTranspose', 'Arp transpose'],
  ['arpTransposeInKey', 'Arp transpose in key'], ['arpSetRoot', 'Arp set root']];
const CLOCK_COMMANDS = [['nudgeSlower', 'Nudge slower'], ['nudgeFaster', 'Nudge faster'], ['tempoDown', 'Tempo −0.1'], ['tempoUp', 'Tempo +0.1']];

// Each object a page can be about: { id, name, source (for colours), knobs: [cell], commands:
// [cell] }, in the order Night Shift shows sources.
export function objectsOf(view) {
  const out = [];
  const obj = (id, name, source, knobs, commands = []) => out.push({ id, name, source, knobs, commands });
  const of = (kind, index, source, params) => params.map((p) => cellOf(kind, index, p, source));
  for (const s of view.sources) {
    if (s.parked) continue;
    if (s.kind === 'voice') {
      obj(s.id, s.name, s.id, [
        ...of('converter', s.index, s.id, ['envAttack', 'envDecay', 'envSustain', 'envRelease', 'envDepth', 'envVelocityDepth', 'envRange',
          'portamento', 'arpMode', 'arpRange', 'arpGate', 'arpRate', 'transpose', 'arpLatch', 'arpReset', 'randomDepth', 'arpTruncate',
          'envAttackShape', 'envDecayShape', 'envReleaseShape']),
      ], ARP_COMMANDS.map(([p, l]) => cellOf('converter', s.index, p, s.id, { label: l })));
    } else if (s.kind === 'euclid') obj(s.id, s.name, s.id, of('euclid', s.index, s.id, ['pulses', 'steps', 'rotation', 'rate', 'gate', 'accent', 'reset']));
    else if (s.kind === 'random') obj(s.id, s.name, s.id, of('srr', s.index, s.id, ['randomness', 'length', 'rate', 'attenuator', 'scale', 'key', 'gateLength', 'direction']));
    else if (s.kind === 'lfo') {
      obj(s.id, s.name, s.id, of('output', s.index, s.id, ['lfoTempoBase', 'lfoTempoMultiplier', 'lfoLevel', 'directLevel', 'lfoSine', 'lfoTriangle',
        'lfoSaw', 'lfoSquare', 'lfoPulseWidth', 'lfoRandom', 'lfoNoise', 'smoothing', 'lfoPhase', 'lfoFade', 'lfoSpeed'])
        .map((c) => (c.setting.param === 'directLevel' ? { ...c, label: 'Centre', short: 'OFFS' } : c)));
    } else if (s.kind === 'knobs' || s.kind === 'level') {
      obj(s.id, s.name, s.id, s.ports.filter((p) => p.output < 64).flatMap((p) => [
        cellOf('output', p.output, 'directLevel', s.id, { short: jackShort(p.jack), label: `Level of ${p.jack}` }),
        cellOf('output', p.output, 'smoothing', s.id, { short: `S${jackDigits(p.jack)}`.slice(0, 4), label: `Smoothing of ${p.jack}` }),
      ]));
    }
  }
  for (const q of view.players) {
    if (q.kind === 'sequencer') {
      obj(q.id, q.name, q.id, ['rate', 'reset', 'gateLength', 'position'].map((p) =>
        cellOf('noteSequencer', q.index, p, q.id, { short: `${SHORT[p].slice(0, 3)}${q.index + 1}`, label: `${q.name}: ${PARAM_NAMES[p]}` })));
    } else if (q.kind === 'drums') {
      obj(q.id, q.name, q.id, [
        ...of('drumSequencer', 0, q.id, ['reset', 'position']),
        ...Array.from({ length: 16 }, (_, l) => cellOf('drumLane', l, 'rate', q.id, { short: `LR${l + 1}`, label: `Lane ${l + 1} rate` })),
      ]);
    }
  }
  const clocks = view.sources.some((s) => s.id === 'clocks') ? 'clocks' : null;
  obj('clock', 'Clock', clocks, of('global', 0, clocks, ['tempo', 'swingAmount', 'swingType', 'displayMode', 'displayItem']),
    CLOCK_COMMANDS.map(([p, l]) => cellOf('global', 0, p, clocks, { label: l })));
  return out;
}

// ---- the template pages

// A voice: its envelope if it has an envelope output, glide where it glides (mono voices and
// unison), the arpeggiator, transpose, random depth with a random output. The arp commands
// go on the pushes under the arp knobs.
function voicePage(o, s) {
  const cv = s.raw;
  const by = new Map(o.knobs.map((c) => [c.setting.param, c]));
  const cells = [];
  const add = (params) => params.forEach((p) => cells.push(by.get(p)));
  if (cv.envelopeOut) add(['envAttack', 'envDecay', 'envSustain', 'envRelease', 'envDepth', 'envVelocityDepth', 'envRange']);
  if (cv.type === 0 || cv.allocation === 2 || cv.allocation === 3) add(['portamento']);
  while (cells.length % 4) cells.push(null);
  const arpAt = cells.length;
  add(['arpMode', 'arpRange', 'arpGate', 'arpRate', 'transpose', 'arpLatch', 'arpReset']);
  if (cv.randomOut) add(['randomDepth']);
  const pushes = [];
  o.commands.forEach((c, k) => (pushes[arpAt + k] = c));
  return { cells: cells.slice(0, KNOBS), pushes };
}

// The template pages, in the order sources are shown, then the note sequencers and the clock.
// Every page holds at most 16 knobs; a "CC → CV" source with more gets several.
function templatePages(view, objects) {
  const pages = [];
  const page = (id, name, o, cells, pushes = []) => pages.push({ id, name, defaultName: shortName(name), object: o.id, source: o.source, cells: fill(cells), pushes: fill(pushes) });
  const byId = new Map(objects.map((o) => [o.id, o]));
  for (const s of view.sources) {
    const o = byId.get(s.id);
    if (!o) continue;
    if (s.kind === 'voice') {
      const { cells, pushes } = voicePage(o, s);
      page(s.id, s.name, o, cells, pushes);
    } else if (s.kind === 'euclid' || s.kind === 'random' || s.kind === 'lfo') page(s.id, s.name, o, o.knobs);
    else if (s.kind === 'knobs') {
      const levels = o.knobs.filter((c) => c.setting.param === 'directLevel');
      for (let k = 0; k < levels.length; k += KNOBS) {
        page(k ? `${s.id}:${k / KNOBS}` : s.id, k ? `${s.name} ${k / KNOBS + 1}` : s.name, o, levels.slice(k, k + KNOBS));
        if (!s.defaultName) pages.at(-1).defaultName = shortName(`CC ${s.channel + 1}${k ? String.fromCharCode(65 + k / KNOBS) : ''}`);
      }
    }
  }
  const seqs = objects.filter((o) => o.id.startsWith('noteSequencer:'));
  if (seqs.length) {
    page('sequencers', 'Sequencers', { id: 'sequencers', source: null }, seqs.flatMap((o) => o.knobs));
    Object.assign(pages.at(-1), { defaultName: 'SEQ', sub: 'Note sequencers' });
  }
  const clock = byId.get('clock');
  page('clock', 'Clock', clock, clock.knobs.slice(0, 3), clock.commands);
  Object.assign(pages.at(-1), { defaultName: 'CLK', sub: 'Tempo, swing' });
  return pages;
}

// ---- knobs you put on pages yourself

// The knobs put on a page by hand (on LIVE: all of them), as stored: 16 setting keys or ''.
export function addedKeys(names, pageId) {
  const keys = (names?.[knobsKey(pageId)] ?? '').split(',');
  return Array.from({ length: KNOBS }, (_, i) => keys[i] ?? '');
}
export const liveKeys = (names) => addedKeys(names, 'live');
function setKeys(pageId, keys) {
  const value = keys.some(Boolean) ? keys.map((k) => k ?? '').join(',').replace(/,+$/, '') : null;
  return [{ dump: 'names', path: [knobsKey(pageId)], value }];
}
// Puts setting `key` on knob `i` of a page (null takes it off).
export function placeKnob(names, pageId, i, key) {
  const keys = addedKeys(names, pageId);
  keys[i] = key ?? '';
  return setKeys(pageId, keys);
}
// Puts a setting on the first free LIVE knob, or takes it off.
export function toggleLive(names, key) {
  const keys = liveKeys(names);
  const at = keys.indexOf(key);
  if (at >= 0) keys[at] = '';
  else {
    const free = keys.indexOf('');
    if (free < 0) return null; // LIVE is full
    keys[free] = key;
  }
  return setKeys('live', keys);
}

// What the picker offers for a free knob of `page`: [{ name, cells }] by object, without the
// settings already on that page. LIVE offers every object's.
export function choicesFor(objects, page) {
  const here = new Set(page.cells.filter(Boolean).map((c) => c.key));
  const from = page.live ? objects : objects.filter((o) => o.id === page.object || (page.object === 'sequencers' && o.id.startsWith('noteSequencer:')));
  return from.map((o) => ({ name: o.name, cells: o.knobs.filter((c) => !here.has(c.key)) })).filter((g) => g.cells.length);
}

// ---- the pages channel and CCs

// The pages channel: ch 2, unless a voice, a trigger or one of the FH-2's players uses it;
// then the first channel nothing but CC mappings uses.
export function pagesChannels(view) {
  const ok = (c) => !c.senders.length && !c.listeners.some((l) => l.source);
  const free = view.channels.filter(ok).map((c) => c.channel);
  return free.includes(1) ? [1, ...free.filter((c) => c !== 1)] : free;
}

// Every page with its knobs' and pushes' CCs: { pages, extra (pages past the 16th), objects,
// channel, unmapped, liveFull }. A knob's or push's `map` is { channel, cc, relative, bits, slot },
// or null while it has no mapping.
export function pagesOf(view, names = {}) {
  const byKey = new Map();
  for (const m of view.mappings) {
    if (m.target.kind === 'unknown') continue;
    const key = settingKey(m.target);
    if (!byKey.has(key)) byKey.set(key, m);
  }
  const usedOn = (ch) => new Set(view.mappings.filter((m) => m.channel === ch).map((m) => m.cc));
  const mapOf = (key) => {
    const m = byKey.get(key);
    if (!m) return null;
    const p = settingOf(key).param;
    const bits = HIRES.has(p) && m.cc < 32 && !m.relative && !usedOn(m.channel).has(m.cc + 32) ? 14 : 7;
    return { channel: m.channel, cc: m.cc, relative: m.relative, bits, slot: m.slot };
  };
  const objects = objectsOf(view);
  const known = new Map(objects.flatMap((o) => o.knobs.map((c) => [c.key, c])));
  const gone = (key) => ({ short: '?', label: 'Gone from the patch', key, setting: settingOf(key), source: null, gone: true });
  // a knob put there by hand: as the object lists it, or gone once its object is
  const placed = (key, more) => (known.has(key) ? { ...known.get(key), ...more } : { ...gone(key), ...more });

  const all = templatePages(view, objects);
  for (const pg of all) {
    pg.name = names[pageNameKey(pg.id)] ? fourChars(names[pageNameKey(pg.id)]) : pg.defaultName;
    addedKeys(names, pg.id).forEach((key, i) => {
      if (key && !pg.cells[i]) pg.cells[i] = placed(key, { added: true });
    });
  }
  const live = liveKeys(names).map((key) => key && placed(key, { live: true }));
  if (live.some(Boolean)) all.unshift({ id: 'live', name: names[pageNameKey('live')] ? fourChars(names[pageNameKey('live')]) : 'LIVE', defaultName: 'LIVE', object: null, source: null, cells: live.map((c) => c || null), pushes: fill([]), live: true });
  const pages = all.slice(0, GROUPS);
  pages.forEach((pg, g) => (pg.group = g));
  const onLive = new Set(liveKeys(names).filter(Boolean));
  const unmapped = new Set();
  for (const pg of pages) {
    for (const c of [...pg.cells, ...pg.pushes]) {
      if (!c) continue;
      c.map = mapOf(c.key);
      c.onLive = onLive.has(c.key);
      if (!c.map && !c.gone) unmapped.add(c.key);
    }
  }
  return { pages, extra: all.slice(GROUPS), objects, channel: pagesChannels(view)[0] ?? null, unmapped: [...unmapped], liveFull: onLive.size >= KNOBS };
}

// CCs on a channel in the order knobs get them: 14-bit settings take a free pair below 32
// (n and n + 32); the rest take CCs from 64 up, then 32–63, then below 32, so the 14-bit
// pairs last. Bank select, data entry, sustain, sostenuto, (N)RPN, the channel mode messages
// and CC 119 (which free knobs send) are never used.
const NEVER = new Set([0, 6, 32, 38, 64, 66, 96, 97, 98, 99, 100, 101, 119, 120, 121, 122, 123, 124, 125, 126, 127]);
export const DEAD_CC = 119;

class CcPool {
  constructor(view, channel) {
    this.channel = channel;
    this.used = new Set(view.mappings.filter((m) => m.channel === channel).map((m) => m.cc));
  }
  free(cc) {
    return !NEVER.has(cc) && !this.used.has(cc) && !(cc >= 32 && cc < 64 && this.used.has(cc - 32)) && !(cc < 32 && this.used.has(cc + 32));
  }
  take(hires) {
    if (hires) {
      for (let cc = 1; cc < 32; cc++) if (this.free(cc) && !NEVER.has(cc + 32) && !this.used.has(cc + 32)) return this.use(cc, 14);
    }
    for (const range of [[64, 128], [32, 64], [1, 32]]) {
      for (let cc = range[0]; cc < range[1]; cc++) if (this.free(cc)) return this.use(cc, 7);
    }
    return null;
  }
  use(cc, bits) {
    this.used.add(cc);
    if (bits === 14) this.used.add(cc + 32);
    return { cc, bits };
  }
}

// The changes that give every unmapped knob and push a mapping: absolute, on the pages
// channel (the next free channel once it's full). The 14-bit settings go first, so the 7-bit
// ones don't take the fine halves they need. { changes, mapped: count, left: keys that found
// no CC or no mapping slot }.
export function mapPages(config, view, pages) {
  const changes = [];
  const left = [];
  const slots = [];
  config.mapping.forEach((m, n) => !isUsed(m) && slots.push(n));
  const pools = pagesChannels(view).map((ch) => new CcPool(view, ch));
  const hiresFirst = [...pages.unmapped].sort((a, b) => Number(HIRES.has(settingOf(b).param)) - Number(HIRES.has(settingOf(a).param)));
  for (const key of hiresFirst) {
    const t = settingOf(key);
    const code = encodeTarget(t);
    if (!code || !slots.length) {
      left.push(key);
      continue;
    }
    let got = null;
    let pool = null;
    for (pool of pools) if ((got = pool.take(HIRES.has(t.param)))) break;
    if (!got) {
      left.push(key);
      continue;
    }
    const slot = slots.shift();
    const f = (field, value) => changes.push({ dump: 'config', path: ['mapping', slot, field], value });
    f('status', 0x30 | pool.channel);
    f('cc', got.cc);
    f('target', code.target);
    f('index', code.index);
  }
  return { changes, mapped: changes.length / 4, left };
}
