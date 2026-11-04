// EC4 pages: the settings you switch on (by clicking their names in the Patch tab, or with
// "+ add" on a free knob) go on the EC4, one page (an EC4 group of 16 knobs) per object, plus
// the LIVE page you fill yourself. Each knob controls one FH-2 setting through one CC
// mapping: the config's own mapping for that setting if it has one, else one added on the
// pages channel when the setting is switched on, and removed again when it is switched off.
// A setting on two pages (its own and LIVE) is one mapping and one CC, so the EC4 keeps both
// knobs on the same value.
//
// A template per kind of object only says where a knob goes on its page (the envelope on top,
// the arp below…), and "whole page" switches on all of a template at once. The FH-2's commands
// (arp add, remove, rest, transpose…, nudge, tempo ±0.1) act while their CC is 64 or more, or
// when it gets there, so they go on the pushes, which send 127 while held and 0 on release.
//
// Night Shift's own part lives in the patch's names: `ec4:add:<page>` and `ec4:push:<page>`
// hold a page's 16 knobs and pushes as setting keys separated by commas (empty where one is
// free), `ec4:live` LIVE's knobs, `ec4:page:<page>` a page's name, and `ec4:cc` the settings
// whose mapping Night Shift added, the only ones it removes.

import { encodeTarget, isUsed } from '../patch/mappings.js';
import { replacesLevel } from '../patch/derive.js';
import { PARAM_NAMES, COMMANDS } from '../patch/tables.js';
import { sanitizeName } from '../../vendor/lilypad/js/model.js';

export const SETUP = 14; // the EC4 setup Night Shift owns: setup 15 (16 is the MDMM's)
export const GROUPS = 16;
export const KNOBS = 16;
export const LIVE_KEY = 'ec4:live';
const MADE_KEY = 'ec4:cc';
export const pageNameKey = (id) => `ec4:page:${id}`;
const knobsKey = (pageId) => (pageId === 'live' ? LIVE_KEY : `ec4:add:${pageId}`);
const pushesKey = (pageId) => `ec4:push:${pageId}`;

// The settings the FH-2 takes as 14-bit (CC n below 32 with n + 32 as the fine half).
export const HIRES = new Set(['directLevel', 'lfoSpeed', 'lfoLevel']);
// On/off settings, shown ON/OFF on the EC4.
export const SWITCHES = new Set(['arpLatch']);

// A knob Night Shift maps is relative (your call, 2026-11-04): it never jumps. The FH-2 takes
// 14-bit values only as absolute ones, so the 14-bit settings stay absolute (with its Soft
// takeover), and so do the commands a push sends (127 while held, 0 on release; arp truncate
// takes a value).
const ABSOLUTE = new Set([...COMMANDS, 'nudgeFaster', 'nudgeSlower', 'tempoUp', 'tempoDown']);
export const relativeFor = (t) => !HIRES.has(t.param) && !ABSOLUTE.has(t.param);

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
const LFO_PARAMS = ['lfoTempoBase', 'lfoTempoMultiplier', 'lfoLevel', 'directLevel', 'lfoSine', 'lfoTriangle', 'lfoSaw', 'lfoSquare',
  'lfoPulseWidth', 'lfoRandom', 'lfoNoise', 'smoothing', 'lfoPhase', 'lfoFade', 'lfoSpeed'];

// A voice's template: its envelope if it has an envelope output, glide where it glides (mono
// voices and unison), the arpeggiator, transpose, random depth with a random output; the arp
// commands on the pushes under the arp knobs.
function voiceTemplate(s) {
  const cv = s.raw;
  const cells = [];
  if (cv.envelopeOut) cells.push('envAttack', 'envDecay', 'envSustain', 'envRelease', 'envDepth', 'envVelocityDepth', 'envRange');
  if (cv.type === 0 || cv.allocation === 2 || cv.allocation === 3) cells.push('portamento');
  while (cells.length % 4) cells.push(null);
  const arpAt = cells.length;
  cells.push('arpMode', 'arpRange', 'arpGate', 'arpRate', 'transpose', 'arpLatch', 'arpReset');
  if (cv.randomOut) cells.push('randomDepth');
  const pushes = [];
  ARP_COMMANDS.forEach(([p], k) => (pushes[arpAt + k] = p));
  const key = (p) => p && settingKey({ kind: 'converter', index: s.index, param: p });
  return { cells: fill(cells.slice(0, KNOBS).map(key)), pushes: fill(pushes.map(key)) };
}

// Each object a page can be about, in the order Night Shift shows sources: { id, page (its
// page's id; the note sequencers share one), name, defaultName (four characters), sub (a line
// under it in the list), source (for colours), knobs: [cell], commands: [cell], template:
// { cells, pushes } (16 setting keys or null each) }.
export function objectsOf(view) {
  const out = [];
  const keysOf = (cells) => fill(cells.slice(0, KNOBS).map((c) => c?.key ?? null));
  const obj = (o) => out.push({ page: o.id, defaultName: shortName(o.name), commands: [], template: { cells: keysOf(o.knobs), pushes: fill([]) }, ...o });
  const of = (kind, index, source, params) => params.map((p) => cellOf(kind, index, p, source));
  const lfo = (index, source) => of('output', index, source, LFO_PARAMS).map((c) => (c.setting.param === 'directLevel' ? { ...c, label: 'Centre', short: 'OFFS' } : c));
  for (const s of view.sources) {
    if (s.parked) continue;
    if (s.kind === 'voice') {
      obj({ id: s.id, name: s.name, source: s.id,
        knobs: of('converter', s.index, s.id, ['envAttack', 'envDecay', 'envSustain', 'envRelease', 'envDepth', 'envVelocityDepth', 'envRange',
          'portamento', 'arpMode', 'arpRange', 'arpGate', 'arpRate', 'transpose', 'arpLatch', 'arpReset', 'randomDepth', 'arpTruncate',
          'envAttackShape', 'envDecayShape', 'envReleaseShape']),
        commands: ARP_COMMANDS.map(([p, l]) => cellOf('converter', s.index, p, s.id, { label: l })),
        template: voiceTemplate(s) });
    } else if (s.kind === 'euclid') obj({ id: s.id, name: s.name, source: s.id, knobs: of('euclid', s.index, s.id, ['pulses', 'steps', 'rotation', 'rate', 'gate', 'accent', 'reset']) });
    else if (s.kind === 'random') obj({ id: s.id, name: s.name, source: s.id, knobs: of('srr', s.index, s.id, ['randomness', 'length', 'rate', 'attenuator', 'scale', 'key', 'gateLength', 'direction']) });
    else if (s.kind === 'lfo') obj({ id: s.id, name: s.name, source: s.id, knobs: lfo(s.index, s.id) });
    else if (s.kind === 'knobs' || s.kind === 'level') {
      const ports = s.ports.filter((p) => p.output < 64);
      const levels = ports.map((p) => cellOf('output', p.output, 'directLevel', s.id, { short: jackShort(p.jack), label: `Level of ${p.jack}` }));
      const smoothing = ports.map((p) => cellOf('output', p.output, 'smoothing', s.id, { short: `S${jackDigits(p.jack)}`.slice(0, 4), label: `Smoothing of ${p.jack}` }));
      obj({ id: s.id, name: s.name, source: s.id, knobs: [...levels, ...smoothing],
        ...(!s.defaultName && { defaultName: s.kind === 'level' ? 'LEVL' : shortName(`CC ${s.channel + 1}`) }) });
    }
  }
  // an LFO on top of another source (vibrato on a pitch, wobble on a level)
  for (const o of view.outputs) {
    if (!o.lfo || o.lfo.alone) continue;
    const port = o.ports.find((p) => !p.layer);
    const under = port?.source ?? null;
    const s = under && view.sources.find((x) => x.id === under);
    const knobs = lfo(o.index, under).filter((c) => !(c.setting.param === 'directLevel' && s && replacesLevel(s, port.name)));
    obj({ id: `lfo:${o.index}`, name: `LFO on ${o.jack}`, defaultName: fourChars(`L${jackDigits(o.jack)}`), source: under, knobs });
  }
  for (const q of view.players) {
    if (q.kind === 'sequencer') {
      const knobs = ['rate', 'reset', 'gateLength', 'position'].map((p) =>
        cellOf('noteSequencer', q.index, p, q.id, { short: `${SHORT[p].slice(0, 3)}${q.index + 1}`, label: `${q.name}: ${PARAM_NAMES[p]}` }));
      const cells = [];
      knobs.forEach((c, k) => (cells[q.index * 4 + k] = c.key));
      obj({ id: q.id, page: 'sequencers', name: q.name, defaultName: 'SEQ', sub: 'Note sequencers', source: q.id, knobs, template: { cells: fill(cells), pushes: fill([]) } });
    } else if (q.kind === 'drums') {
      obj({ id: q.id, name: q.name, defaultName: 'DRUM', source: q.id, knobs: [
        ...of('drumSequencer', 0, q.id, ['reset', 'position']),
        ...Array.from({ length: 16 }, (_, l) => cellOf('drumLane', l, 'rate', q.id, { short: `LR${l + 1}`, label: `Lane ${l + 1} rate` })),
      ] });
    }
  }
  const clocks = view.sources.some((s) => s.id === 'clocks') ? 'clocks' : null;
  const commands = CLOCK_COMMANDS.map(([p, l]) => cellOf('global', 0, p, clocks, { label: l }));
  obj({ id: 'clock', name: 'Clock', defaultName: 'CLK', sub: 'Tempo, swing', source: clocks,
    knobs: of('global', 0, clocks, ['tempo', 'swingAmount', 'swingType', 'displayMode', 'displayItem']), commands,
    template: { cells: fill(['tempo', 'swingAmount', 'swingType'].map((p) => settingKey({ kind: 'global', index: 0, param: p }))), pushes: fill(commands.map((c) => c.key)) } });
  ownLayers(view, out, obj);
  return out;
}

// Every CV jack has its own level and smoothing, so each must belong to some page to go on the
// EC4: an LFO's on it (covered above), else its source's (a voice, a random source, a Euclid
// pattern, the clock), as an offset where one adds to it, else that of the CC → CV knobs on the
// pages channel, which a free jack's level joins anyway once it gets a CC there.
function ownLayers(view, out, obj) {
  const has = new Set(out.flatMap((o) => o.knobs.map((c) => c.key)));
  const pc = pagesChannels(view)[0];
  let free = null;
  const freeObj = () => (pc == null ? null : free ?? (free = out.find((o) => o.id === `knobs:${pc}`)
    ?? (obj({ id: `knobs:${pc}`, name: `CC → CV · ch ${pc + 1}`, defaultName: shortName(`CC ${pc + 1}`), source: null, knobs: [] }), out.at(-1))));
  for (const o of view.outputs) {
    if (o.index >= 64 || !o.present || o.gate) continue;
    const key = (param) => settingKey({ kind: 'output', index: o.index, param });
    const missing = ['directLevel', 'smoothing'].filter((p) => !has.has(key(p)));
    if (!missing.length) continue;
    const d = o.ports.find((p) => !p.layer && !p.standby);
    const s = d && view.sources.find((x) => x.id === d.source);
    const owner = d ? out.find((x) => x.id === d.source) ?? (d.source === 'clocks' ? out.find((x) => x.id === 'clock') : null) : null;
    const noOffset = s && replacesLevel(s, d.name);
    const target = owner ?? freeObj();
    if (!target) continue; // no channel left for a CC: nothing to offer
    const digits = jackDigits(o.jack);
    for (const param of missing) {
      if (param === 'directLevel' && noOffset) continue;
      target.knobs.push(param === 'smoothing'
        ? cellOf('output', o.index, 'smoothing', target.source, { short: `S${digits}`.slice(0, 4), label: `Smoothing of ${o.jack}` })
        : cellOf('output', o.index, 'directLevel', target.source, d ? { short: `O${digits}`.slice(0, 4), label: `Offset of ${o.jack}` } : { short: jackShort(o.jack), label: `Level of ${o.jack}` }));
      has.add(key(param));
    }
  }
}

// ---- what is on the EC4, as stored

const listOf = (names, key) => {
  const keys = (names?.[key] ?? '').split(',');
  return Array.from({ length: KNOBS }, (_, i) => keys[i] ?? '');
};
const listChange = (key, keys) => ({ dump: 'names', path: [key], value: keys.some(Boolean) ? keys.join(',').replace(/,+$/, '') : null });
// A page's knobs (on LIVE: all of them) and pushes, as stored: 16 setting keys or '' each.
export const addedKeys = (names, pageId) => listOf(names, knobsKey(pageId));
export const pushKeys = (names, pageId) => listOf(names, pushesKey(pageId));
export const liveKeys = (names) => addedKeys(names, 'live');
const madeKeys = (names) => new Set((names?.[MADE_KEY] ?? '').split(',').filter(Boolean));
const madeChange = (set) => ({ dump: 'names', path: [MADE_KEY], value: set.size ? [...set].join(',') : null });
// every stored page list: [names key, keys]
const storedLists = (names) => Object.keys(names ?? {}).filter((k) => k === LIVE_KEY || k.startsWith('ec4:add:') || k.startsWith('ec4:push:'))
  .map((k) => [k, listOf(names, k)]);

// Puts setting `key` on knob `i` of a page (null takes it off).
export function placeKnob(names, pageId, i, key) {
  const keys = addedKeys(names, pageId);
  keys[i] = key ?? '';
  return [listChange(knobsKey(pageId), keys)];
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
  return [listChange(LIVE_KEY, keys)];
}

// ---- the pages

// The pages channel: ch 2, unless a voice, a trigger or one of the FH-2's players uses it;
// then the first channel nothing but CC mappings uses.
export function pagesChannels(view) {
  const ok = (c) => !c.senders.length && !c.listeners.some((l) => l.source);
  const free = view.channels.filter(ok).map((c) => c.channel);
  return free.includes(1) ? [1, ...free.filter((c) => c !== 1)] : free;
}

// The config's mapping for each setting (the first, if there are several).
function mappingsByKey(view) {
  const byKey = new Map();
  for (const m of view.mappings) {
    if (m.target.kind === 'unknown') continue;
    const key = settingKey(m.target);
    if (!byKey.has(key)) byKey.set(key, m);
  }
  return byKey;
}

// The pages with their knobs and pushes: { pages, extra (pages past the 16th), objects, known
// (setting key → cell), on (key → where it is: [{ page, name, index, push }]), mapOf(key),
// channel, unmapped, liveFull }. A knob's or push's `map` is { channel, cc, relative, bits,
// slot }, or null while it has no mapping.
export function pagesOf(view, names = {}) {
  const byKey = mappingsByKey(view);
  const usedOn = (ch) => new Set(view.mappings.filter((m) => m.channel === ch).map((m) => m.cc));
  const mapOf = (key) => {
    const m = byKey.get(key);
    if (!m) return null;
    const bits = HIRES.has(settingOf(key).param) && m.cc < 32 && !m.relative && !usedOn(m.channel).has(m.cc + 32) ? 14 : 7;
    return { channel: m.channel, cc: m.cc, relative: m.relative, bits, slot: m.slot };
  };
  const objects = objectsOf(view);
  const known = new Map(objects.flatMap((o) => [...o.knobs, ...o.commands].map((c) => [c.key, c])));
  const placed = (key, more = {}) => (known.has(key) ? { ...known.get(key), ...more }
    : { short: '?', label: 'Gone from the patch', key, setting: settingOf(key), source: null, gone: true, ...more });
  const nameOf = (id, fallback) => (names[pageNameKey(id)] ? fourChars(names[pageNameKey(id)]) : fallback);

  const all = [];
  for (const id of [...new Set(objects.map((o) => o.page))]) {
    const objs = objects.filter((o) => o.page === id);
    const knobs = addedKeys(names, id);
    const pushes = pushKeys(names, id);
    if (!knobs.some(Boolean) && !pushes.some(Boolean)) continue;
    all.push({ id, name: nameOf(id, objs[0].defaultName), defaultName: objs[0].defaultName, sub: objs[0].sub, objects: objs.map((o) => o.id),
      source: objs[0].source, cells: knobs.map((k) => (k ? placed(k) : null)), pushes: pushes.map((k) => (k ? placed(k) : null)) });
  }
  const live = liveKeys(names);
  if (live.some(Boolean)) {
    all.unshift({ id: 'live', name: nameOf('live', 'LIVE'), defaultName: 'LIVE', objects: [], source: null,
      cells: live.map((k) => (k ? placed(k, { live: true }) : null)), pushes: fill([]), live: true });
  }
  const pages = all.slice(0, GROUPS);
  pages.forEach((pg, g) => (pg.group = g));
  const on = new Map();
  const unmapped = new Set();
  for (const pg of all) {
    const at = (c, index, push) => {
      if (!c) return;
      if (!on.has(c.key)) on.set(c.key, []);
      on.get(c.key).push({ page: pg.id, name: pg.name, index, push });
    };
    pg.cells.forEach((c, i) => at(c, i, false));
    pg.pushes.forEach((c, i) => at(c, i, true));
  }
  for (const pg of pages) {
    for (const c of [...pg.cells, ...pg.pushes]) {
      if (!c) continue;
      c.map = mapOf(c.key);
      c.onLive = live.includes(c.key);
      if (!c.map && !c.gone) unmapped.add(c.key);
    }
  }
  return { pages, extra: all.slice(GROUPS), objects, known, on, mapOf, channel: pagesChannels(view)[0] ?? null,
    unmapped: [...unmapped], liveFull: live.every(Boolean) };
}

// What the picker offers for a free knob of `page`: [{ name, cells }] by object, without the
// settings already on that page. LIVE offers every object's.
export function choicesFor(objects, page) {
  const here = new Set(page.cells.filter(Boolean).map((c) => c.key));
  const from = page.live ? objects : objects.filter((o) => page.objects?.includes(o.id));
  return from.map((o) => ({ name: o.name, cells: o.knobs.filter((c) => !here.has(c.key)) })).filter((g) => g.cells.length);
}

// ---- CCs

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

// Hands out mappings: absolute, on the pages channel, then the next free channel once it's
// full. `add(key)` returns the config changes for one, or null when there is no CC or no
// mapping slot left (or nothing can map that setting).
class Allocator {
  constructor(config, view) {
    this.slots = [];
    config.mapping.forEach((m, n) => !isUsed(m) && this.slots.push(n));
    this.pools = pagesChannels(view).map((ch) => new CcPool(view, ch));
  }
  add(key) {
    const t = settingOf(key);
    const code = encodeTarget(t);
    if (!code || !this.slots.length) return null;
    let got = null;
    let pool = null;
    for (pool of this.pools) if ((got = pool.take(HIRES.has(t.param)))) break;
    if (!got) return null;
    const slot = this.slots.shift();
    const f = (field, value) => ({ dump: 'config', path: ['mapping', slot, field], value });
    return [f('status', 0x30 | pool.channel), f('cc', got.cc), f('target', code.target + (relativeFor(t) ? 32 : 0)), f('index', code.index)];
  }
}

// The absolute knobs on the pages that Night Shift mapped and that could be relative (from before
// knobs were relative by default), and the changes that make them so: { keys, changes }.
export function toRelative(config, model, names) {
  const made = madeKeys(names);
  const cells = [...new Map(model.pages.flatMap((p) => p.cells.filter(Boolean)).map((c) => [c.key, c])).values()]; // once each, LIVE too
  const keys = cells.filter((c) => c.map && !c.map.relative && made.has(c.key) && relativeFor(c.setting)).map((c) => c.key);
  const changes = keys.map((k) => {
    const slot = model.mapOf(k).slot;
    return { dump: 'config', path: ['mapping', slot, 'target'], value: config.mapping[slot].target | 32 };
  });
  return { keys, changes };
}

// The changes that give every unmapped knob and push on the pages a mapping. The 14-bit
// settings go first, so the 7-bit ones don't take the fine halves they need. { changes,
// mapped: count, left: keys that found no CC or no mapping slot }.
export function mapPages(config, view, pages, names = {}) {
  const alloc = new Allocator(config, view);
  const made = madeKeys(names);
  const changes = [];
  const left = [];
  let mapped = 0;
  const hiresFirst = [...pages.unmapped].sort((a, b) => Number(HIRES.has(settingOf(b).param)) - Number(HIRES.has(settingOf(a).param)));
  for (const key of hiresFirst) {
    const c = alloc.add(key);
    if (!c) left.push(key);
    else {
      changes.push(...c);
      made.add(key);
      mapped++;
    }
  }
  if (mapped) changes.push(madeChange(made));
  return { changes, mapped, left };
}

// The config changes (and the note of it) that give `key` a CC if it has none, or null when
// there's no room.
function ccFor(config, view, names, model, key) {
  if (model.mapOf(key)) return [];
  const c = new Allocator(config, view).add(key);
  if (!c) return null;
  const made = madeKeys(names);
  made.add(key);
  return [...c, madeChange(made)];
}

// Puts `key` on knob `i` of a page (a free knob's "+ add"), with a CC if it has none.
// { changes } or { error }.
export function placeWithCc(config, view, names, model, pageId, i, key) {
  const cc = ccFor(config, view, names, model, key);
  if (!cc) return { error: 'No CC left for it' };
  return { changes: [...placeKnob(names, pageId, i, key), ...cc] };
}

// Takes knob `i` off a page; once its setting is on no page at all, the mapping Night Shift
// added for it goes too.
export function takeOff(names, model, pageId, i) {
  const key = addedKeys(names, pageId)[i];
  if (!key) return [];
  const elsewhere = (model.on.get(key) ?? []).some((w) => !(w.page === pageId && w.index === i && !w.push));
  return elsewhere ? placeKnob(names, pageId, i, null) : switchOff(names, model, key);
}

// ---- switching a setting on and off

// Puts `key` on its object's page (where the template has it, if that knob or push is free,
// else on the first free one) and gives it a CC if it has none. { changes, where } or { error }.
export function switchOn(config, view, names, model, key) {
  const o = model.objects.find((x) => x.knobs.some((c) => c.key === key) || x.commands.some((c) => c.key === key));
  if (!o) return { error: 'A knob can’t control that' };
  const push = o.commands.some((c) => c.key === key);
  const list = push ? pushKeys(names, o.page) : addedKeys(names, o.page);
  if (list.includes(key)) return { changes: [] };
  const tpl = (push ? o.template.pushes : o.template.cells).indexOf(key);
  const at = tpl >= 0 && !list[tpl] ? tpl : list.indexOf('');
  const pageName = names[pageNameKey(o.page)] ? fourChars(names[pageNameKey(o.page)]) : o.defaultName;
  if (at < 0) return { error: `${pageName} is full` };
  list[at] = key;
  const changes = [listChange(push ? pushesKey(o.page) : knobsKey(o.page), list)];
  const cc = ccFor(config, view, names, model, key);
  if (!cc) return { error: 'No CC left for it' };
  changes.push(...cc);
  return { changes, where: { page: o.page, name: pageName, index: at, push } };
}

// Takes `key` off every page (LIVE too) and removes its mapping if Night Shift added it.
export const switchOff = (names, model, key) => switchOffAll(names, model, [key]);

// Several at once (each list changed once, so one doesn't undo another's change).
export function switchOffAll(names, model, keys) {
  const drop = new Set(keys);
  const changes = [];
  for (const [k, list] of storedLists(names)) {
    if (list.some((x) => drop.has(x))) changes.push(listChange(k, list.map((x) => (drop.has(x) ? '' : x))));
  }
  const made = madeKeys(names);
  const gone = keys.filter((k) => made.has(k));
  for (const key of gone) {
    const m = model.mapOf(key);
    if (m) changes.push({ dump: 'config', path: ['mapping', m.slot, 'status'], value: 0x7f });
    made.delete(key);
  }
  if (gone.length) changes.push(madeChange(made));
  return changes;
}

// The settings of a jack's own layer: its level, smoothing and LFO.
export const jackKeys = (output, only = () => true) => LFO_PARAMS.filter(only).map((param) => settingKey({ kind: 'output', index: output, param }));

// Switches on everything of an object's template (or the page's objects') that isn't on yet.
export function wholePage(config, view, names, model, pageId) {
  const objs = model.objects.filter((o) => o.page === pageId);
  const knobs = addedKeys(names, pageId);
  const pushes = pushKeys(names, pageId);
  const alloc = new Allocator(config, view);
  const made = madeKeys(names);
  const changes = [];
  let count = 0;
  for (const o of objs) {
    for (const [tpl, list] of [[o.template.cells, knobs], [o.template.pushes, pushes]]) {
      tpl.forEach((key, i) => {
        if (!key || list.includes(key) || model.on.has(key) && !model.on.get(key).every((w) => w.page === 'live')) return;
        const at = !list[i] ? i : list.indexOf('');
        if (at < 0) return;
        if (!model.mapOf(key)) {
          const c = alloc.add(key);
          if (!c) return;
          changes.push(...c);
          made.add(key);
        }
        list[at] = key;
        count++;
      });
    }
  }
  if (!count) return { changes: [], count };
  changes.push(listChange(knobsKey(pageId), knobs), listChange(pushesKey(pageId), pushes), madeChange(made));
  return { changes, count };
}

// Mappings on the pages channels that are on no page, other than the CC knobs (whose mapping
// is the source itself): what an earlier "every knob a CC" left behind, or what a removed page
// had. [{ slot, key, label }]
export function strayMappings(view, model) {
  const channels = new Set(pagesChannels(view));
  const knobSlots = new Set(view.sources.filter((s) => s.kind === 'knobs').flatMap((s) => s.ports.map((p) => p.slot)));
  return view.mappings.filter((m) => m.target.kind !== 'unknown' && channels.has(m.channel) && !knobSlots.has(m.slot) && !model.on.has(settingKey(m.target)))
    .map((m) => {
      const key = settingKey(m.target);
      const c = model.known.get(key);
      const o = c && model.objects.find((x) => x.knobs.includes(c) || x.commands.includes(c));
      return { slot: m.slot, key, label: c ? `${o.name}: ${c.label.toLowerCase()}` : key };
    });
}
export function removeMappings(names, stray) {
  const made = madeKeys(names);
  for (const s of stray) made.delete(s.key);
  return [...stray.map((s) => ({ dump: 'config', path: ['mapping', s.slot, 'status'], value: 0x7f })), madeChange(made)];
}
