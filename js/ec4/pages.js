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
// free), `ec4:live` LIVE's knobs (`ec4:live:2`… the further LIVE pages', `ec4:lives` the LIVE
// pages you made, so an empty one stays), `ec4:page:<page>` a page's name, and `ec4:cc` the
// settings whose mapping Night Shift added, the only ones it removes.

import { encodeTarget, isUsed } from '../patch/mappings.js';
import { replacesLevel } from '../patch/derive.js';
import { PARAM_NAMES, COMMANDS, DRUM_LANES } from '../patch/tables.js';
import { sanitizeName } from '../../vendor/lilypad/js/model.js';

export const SETUP = 14; // the EC4 setup Night Shift owns: setup 15 (16 is the MDMM's)
export const GROUPS = 16;
export const KNOBS = 16;
export const LIVE_KEY = 'ec4:live';
const LIVES_KEY = 'ec4:lives';
const MADE_KEY = 'ec4:cc';
export const pageNameKey = (id) => `ec4:page:${id}`;
// LIVE pages (your call, 2026-11-05: as many as you like): 'live', then 'live:2', 'live:3'…
export const isLive = (pageId) => pageId === 'live' || /^live:\d+$/.test(pageId);
const liveNumber = (id) => (id === 'live' ? 1 : Number(id.split(':')[1]));
const liveName = (id) => (id === 'live' ? 'LIVE' : liveNumber(id) < 10 ? `LIV${liveNumber(id)}` : `LV${liveNumber(id)}`);
const knobsKey = (pageId) => (pageId === 'live' ? LIVE_KEY : isLive(pageId) ? `ec4:${pageId}` : `ec4:add:${pageId}`);
const pushesKey = (pageId) => `ec4:push:${pageId}`;
// Editing the pages (your list, 2026-11-03; built 2026-11-06): their order as you moved them, the
// hidden ones (off the EC4 with their knobs and CCs), and a page sharing another's group (its
// knobs in that page's lower half: `ec4:into:<page>` names the page it went into).
const ORDER_KEY = 'ec4:order';
const HIDDEN_KEY = 'ec4:hidden';
const intoKey = (pageId) => `ec4:into:${pageId}`;
const FRONT = ['clock', 'sequencers', 'drumSequencer']; // after LIVE, so they aren't the ones cut past 16
const idList = (names, key) => (names?.[key] ?? '').split(',').filter(Boolean);

// The settings the FH-2 takes as 14-bit (CC n below 32 with n + 32 as the fine half).
export const HIRES = new Set(['directLevel', 'lfoSpeed', 'lfoLevel']);
// On/off settings, shown ON/OFF on the EC4.
export const SWITCHES = new Set(['arpLatch']);

// A knob Night Shift maps is absolute: the EC4's FH-2 sync (controlfrog 0.11 for 14-bit, 0.12
// for 7-bit too) and Night Shift's live link keep it where the FH-2 is, so it doesn't jump, and
// the EC4 can show its value (your call, 2026-11-04; for a while 7-bit knobs were relative).

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
      // the reset and position on the first row, the eight lanes' rates on the next two
      const knobs = [...of('drumSequencer', 0, q.id, ['reset', 'position']),
        ...Array.from({ length: DRUM_LANES }, (_, l) => cellOf('drumLane', l, 'rate', q.id, { short: `LR${l + 1}`, label: `Lane ${l + 1} rate` }))];
      const cells = [knobs[0].key, knobs[1].key, null, null, ...knobs.slice(2).map((c) => c.key)];
      obj({ id: q.id, name: q.name, defaultName: 'DRUM', source: q.id, knobs, template: { cells: fill(cells), pushes: fill([]) } });
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
export const liveKeys = (names, pageId = 'live') => addedKeys(names, pageId);
// The LIVE pages there are, in order: the ones you made and the ones holding knobs.
export function liveIds(names) {
  const made = (names?.[LIVES_KEY] ?? '').split(',').filter(isLive);
  const holding = Object.keys(names ?? {}).filter((k) => k === LIVE_KEY || /^ec4:live:\d+$/.test(k)).map((k) => (k === LIVE_KEY ? 'live' : k.slice(4)));
  return [...new Set([...made, ...holding])].sort((a, b) => liveNumber(a) - liveNumber(b));
}
const livesChange = (ids) => ({ dump: 'names', path: [LIVES_KEY], value: ids.length ? ids.join(',') : null });
const madeKeys = (names) => new Set((names?.[MADE_KEY] ?? '').split(',').filter(Boolean));
const madeChange = (set) => ({ dump: 'names', path: [MADE_KEY], value: set.size ? [...set].join(',') : null });
// every stored page list: [names key, keys]
const storedLists = (names) => Object.keys(names ?? {}).filter((k) => k === LIVE_KEY || /^ec4:live:\d+$/.test(k) || k.startsWith('ec4:add:') || k.startsWith('ec4:push:'))
  .map((k) => [k, listOf(names, k)]);

// Puts setting `key` on knob `i` of a page (null takes it off).
export function placeKnob(names, pageId, i, key) {
  const keys = addedKeys(names, pageId);
  keys[i] = key ?? '';
  return [listChange(knobsKey(pageId), keys)];
}
// Puts a setting on the first free knob of a LIVE page, or takes it off there.
export function toggleLive(names, key, pageId = 'live') {
  const keys = liveKeys(names, pageId);
  const at = keys.indexOf(key);
  if (at >= 0) keys[at] = '';
  else {
    const free = keys.indexOf('');
    if (free < 0) return null; // that LIVE page is full
    keys[free] = key;
  }
  return [listChange(knobsKey(pageId), keys)];
}

// A new LIVE page, after the last: { id, changes }. Up to as many as fit with the other pages.
export function addLivePage(names) {
  const ids = liveIds(names);
  const id = !ids.includes('live') ? 'live' : `live:${Math.max(...ids.map(liveNumber)) + 1}`;
  return { id, changes: [livesChange([...ids, id])] };
}

// A LIVE page gone, with its knobs: a setting on no other page loses the mapping Night Shift
// added for it.
export function removeLivePage(names, model, pageId) {
  const keys = liveKeys(names, pageId).filter(Boolean);
  const alone = keys.filter((k) => (model.on.get(k) ?? []).every((w) => w.page === pageId));
  return [...switchOffAll(names, model, alone), listChange(knobsKey(pageId), []), { dump: 'names', path: [pageNameKey(pageId)], value: null },
    livesChange(liveIds(names).filter((id) => id !== pageId))];
}

// Swaps two places of a page, a knob with the push under it (a free place takes the other's).
export function movePlace(names, pageId, from, to) {
  if (from === to) return [];
  const knobs = addedKeys(names, pageId);
  [knobs[from], knobs[to]] = [knobs[to], knobs[from]];
  const changes = [listChange(knobsKey(pageId), knobs)];
  if (!isLive(pageId)) {
    const pushes = pushKeys(names, pageId);
    if (pushes[from] || pushes[to]) {
      [pushes[from], pushes[to]] = [pushes[to], pushes[from]];
      changes.push(listChange(pushesKey(pageId), pushes));
    }
  }
  return changes;
}

// Knob `i` of a page onto LIVE page `toId` (its first free knob): from another LIVE page it
// moves; from its object's page it stays there too, as a knob on LIVE does. { changes } or { error }.
export function toLivePage(names, fromId, i, toId) {
  const key = addedKeys(names, fromId)[i];
  if (!key || fromId === toId || !isLive(toId)) return { changes: [] };
  const there = liveKeys(names, toId);
  if (there.includes(key)) return isLive(fromId) ? { changes: placeKnob(names, fromId, i, null) } : { changes: [] };
  const free = there.indexOf('');
  if (free < 0) return { error: `${liveName(toId)} is full` };
  there[free] = key;
  return { changes: [listChange(knobsKey(toId), there), ...(isLive(fromId) ? placeKnob(names, fromId, i, null) : [])] };
}

// ---- the pages

// The pages channel: ch 2, unless a voice, a trigger or one of the FH-2's players uses it;
// then the first channel nothing but CC mappings uses.
export function pagesChannels(view) {
  const ok = (c) => !c.senders.length && !c.listeners.some((l) => l.source);
  const free = view.channels.filter(ok).map((c) => c.channel);
  return free.includes(1) ? [1, ...free.filter((c) => c !== 1)] : free;
}

// The config's mapping for each setting (the first, if there are several), leaving out an input's:
// its CC is the input's, not a knob's (derive marks them).
function mappingsByKey(view) {
  const byKey = new Map();
  for (const m of view.mappings) {
    if (m.target.kind === 'unknown' || m.input != null) continue;
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
  // the LIVE pages first, in their order
  const lives = liveIds(names).map((id) => {
    const keys = liveKeys(names, id);
    return { id, name: nameOf(id, liveName(id)), defaultName: liveName(id), objects: [], source: null,
      cells: keys.map((k) => (k ? placed(k, { live: true }) : null)), pushes: fill([]), live: true, full: keys.every(Boolean) };
  });
  all.unshift(...lives);
  // the order: as you moved the pages, else LIVE first, then the clock and the sequencers, then the
  // rest; a page sharing its group says whose knobs are in its lower half; hidden ones go aside
  const order = idList(names, ORDER_KEY);
  const rank = (pg, i) => {
    const k = order.indexOf(pg.id);
    return k >= 0 ? k : order.length + 1000 * (pg.live ? 0 : FRONT.includes(pg.id) ? 1 + FRONT.indexOf(pg.id) : 10) + i;
  };
  const sorted = all.map((pg, i) => [pg, rank(pg, i)]).sort((a, b) => a[1] - b[1]).map(([pg]) => pg);
  for (const k of Object.keys(names)) {
    if (!k.startsWith('ec4:into:')) continue;
    const host = sorted.find((pg) => pg.id === names[k]);
    const guest = objects.find((o) => o.page === k.slice(9));
    if (host && guest) host.shared = { page: guest.page, name: guest.defaultName };
  }
  const hiddenIds = new Set(idList(names, HIDDEN_KEY));
  const shown = sorted.filter((pg) => !hiddenIds.has(pg.id));
  const hidden = sorted.filter((pg) => hiddenIds.has(pg.id));
  hidden.forEach((pg) => (pg.hidden = true));
  const pages = shown.slice(0, GROUPS);
  pages.forEach((pg, g) => (pg.group = g));
  const on = new Map();
  const unmapped = new Set();
  for (const pg of sorted) {
    const at = (c, index, push) => {
      if (!c) return;
      if (!on.has(c.key)) on.set(c.key, []);
      on.get(c.key).push({ page: pg.id, name: pg.name, index, push, hidden: !!pg.hidden });
    };
    pg.cells.forEach((c, i) => at(c, i, false));
    pg.pushes.forEach((c, i) => at(c, i, true));
  }
  // the pages past the 16th and the hidden ones too, so they can be opened and emptied; only the
  // ones on the EC4 need CCs
  for (const pg of sorted) {
    for (const c of [...pg.cells, ...pg.pushes]) {
      if (!c) continue;
      c.map = mapOf(c.key);
      c.lives = lives.filter((pg) => pg.cells.some((x) => x?.key === c.key)).map((pg) => pg.id);
      c.onLive = c.lives.length > 0;
      if (!c.map && !c.gone && pg.group != null) unmapped.add(c.key);
    }
  }
  return { pages, extra: shown.slice(GROUPS), hidden, objects, known, on, mapOf, channel: pagesChannels(view)[0] ?? null,
    unmapped: [...unmapped], lives: lives.map((pg) => ({ id: pg.id, name: pg.name, full: pg.full })), liveFull: !lives.length || lives.every((pg) => pg.full) };
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
    return [f('status', 0x30 | pool.channel), f('cc', got.cc), f('target', code.target), f('index', code.index)];
  }
}

// The relative knobs on the pages that Night Shift mapped (while 7-bit knobs were relative by
// default), and the changes that make them absolute: { keys, changes }.
export function toAbsolute(config, model, names) {
  const made = madeKeys(names);
  const cells = [...new Map(model.pages.flatMap((p) => p.cells.filter(Boolean)).map((c) => [c.key, c])).values()]; // once each, LIVE too
  const keys = cells.filter((c) => c.map?.relative && made.has(c.key)).map((c) => c.key);
  const changes = keys.map((k) => {
    const slot = model.mapOf(k).slot;
    return { dump: 'config', path: ['mapping', slot, 'target'], value: config.mapping[slot].target & ~32 };
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
  // a page sharing another's group: its settings go into that page's lower half
  const pageId = names[intoKey(o.page)] ?? o.page;
  const half = pageId !== o.page ? 8 : 0;
  const list = push ? pushKeys(names, pageId) : addedKeys(names, pageId);
  if (list.includes(key)) return { changes: [] };
  const raw = (push ? o.template.pushes : o.template.cells).indexOf(key);
  const tpl = raw >= 0 && raw + half < KNOBS ? raw + half : -1;
  const at = tpl >= 0 && !list[tpl] ? tpl : list.findIndex((k, i) => i >= half && !k);
  const pageName = names[pageNameKey(pageId)] ? fourChars(names[pageNameKey(pageId)]) : model.objects.find((x) => x.page === pageId)?.defaultName ?? o.defaultName;
  if (at < 0) return { error: `${pageName} is full` };
  list[at] = key;
  const changes = [listChange(push ? pushesKey(pageId) : knobsKey(pageId), list)];
  const cc = ccFor(config, view, names, model, key);
  if (!cc) return { error: 'No CC left for it' };
  changes.push(...cc);
  return { changes, where: { page: pageId, name: pageName, index: at, push } };
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

// Every setting of an object's own page (`id`: a source's id, e.g. 'euclid:0'): its knobs and
// its pushes' commands, for taking a removed source off the EC4.
export const objectKeys = (model, id) => model.objects.filter((o) => o.id === id).flatMap((o) => [...o.knobs, ...o.commands].map((c) => c.key));

// The settings of a jack's own layer: its level, smoothing and LFO.
export const jackKeys = (output, only = () => true) => LFO_PARAMS.filter(only).map((param) => settingKey({ kind: 'output', index: output, param }));

// Switches on everything of an object's template (or the page's objects') that isn't on yet.
export function wholePage(config, view, names, model, ownPage) {
  const objs = model.objects.filter((o) => o.page === ownPage);
  const pageId = names[intoKey(ownPage)] ?? ownPage; // sharing another's group: its lower half
  const half = pageId !== ownPage ? 8 : 0;
  const knobs = addedKeys(names, pageId);
  const pushes = pushKeys(names, pageId);
  const alloc = new Allocator(config, view);
  const made = madeKeys(names);
  const changes = [];
  let count = 0;
  for (const o of objs) {
    for (const [tpl, list] of [[o.template.cells, knobs], [o.template.pushes, pushes]]) {
      tpl.forEach((key, i) => {
        if (!key || list.includes(key) || model.on.has(key) && !model.on.get(key).every((w) => isLive(w.page))) return;
        const want = i + half;
        const at = want < KNOBS && !list[want] ? want : list.findIndex((k, n) => n >= half && !k);
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
// One mapping gone (from "Controlled by MIDI"): slot `slot`, for setting `key`; a setting on the
// EC4 comes off it too, since a knob without its CC does nothing.
export function dropMapping(names, model, slot, key) {
  const off = model.on.has(key) ? switchOff(names, model, key) : [];
  return off.some((c) => c.dump === 'config' && c.path[1] === slot) ? off : [...off, ...removeMappings(names, [{ slot, key }])];
}
export function removeMappings(names, stray) {
  const made = madeKeys(names);
  for (const s of stray) made.delete(s.key);
  return [...stray.map((s) => ({ dump: 'config', path: ['mapping', s.slot, 'status'], value: 0x7f })), madeChange(made)];
}

// ---- editing the pages: order, hiding, two in one group

// A page one place earlier (-1) or later (+1) among those on the EC4 (and past the 16th): the
// order is kept from then on.
export function movePage(names, model, id, delta) {
  const ids = [...model.pages, ...model.extra].map((pg) => pg.id);
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return [];
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return [{ dump: 'names', path: [ORDER_KEY], value: ids.join(',') }];
}

// A page off the EC4 (its knobs and CCs kept), or back.
export function hidePage(names, id, hide = true) {
  const ids = new Set(idList(names, HIDDEN_KEY));
  if (hide) ids.add(id);
  else ids.delete(id);
  return [{ dump: 'names', path: [HIDDEN_KEY], value: ids.size ? [...ids].join(',') : null }];
}

// Whether a page can share a group: an object's page using its top two rows only (knobs and pushes).
export const halfFree = (pg) => !pg.live && !pg.shared && [...pg.cells, ...pg.pushes].every((c, i) => !c || i % KNOBS < 8);

// Page `b`'s knobs and pushes into page `a`'s lower half: one group for both. { changes } or { error }.
export function sharePage(names, model, a, b) {
  const all = [...model.pages, ...model.extra, ...model.hidden];
  const [A, B] = [all.find((pg) => pg.id === a), all.find((pg) => pg.id === b)];
  if (!A || !B || a === b) return { error: 'No such page' };
  if (!halfFree(A) || !halfFree(B)) return { error: 'Both must use their top two rows only' };
  const [ka, pa, kb, pb] = [addedKeys(names, a), pushKeys(names, a), addedKeys(names, b), pushKeys(names, b)];
  for (let i = 0; i < 8; i++) {
    ka[8 + i] = kb[i];
    pa[8 + i] = pb[i];
  }
  return { changes: [listChange(knobsKey(a), ka), listChange(pushesKey(a), pa), listChange(knobsKey(b), fill([]).map(() => '')), listChange(pushesKey(b), fill([]).map(() => '')),
    { dump: 'names', path: [intoKey(b)], value: a }, ...(idList(names, HIDDEN_KEY).includes(b) ? hidePage(names, b, false) : [])] };
}

// The page sharing `a`'s group back on its own: its settings from `a`'s lower half to its own top.
export function splitPage(names, model, a) {
  const b = Object.keys(names).find((k) => k.startsWith('ec4:into:') && names[k] === a)?.slice(9);
  if (!b) return [];
  const own = new Set(model.objects.filter((o) => o.page === b).flatMap((o) => [...o.knobs, ...o.commands].map((c) => c.key)));
  const [ka, pa, kb, pb] = [addedKeys(names, a), pushKeys(names, a), addedKeys(names, b), pushKeys(names, b)];
  for (let i = 0; i < 8; i++) {
    if (own.has(ka[8 + i])) [kb[i], ka[8 + i]] = [ka[8 + i], ''];
    if (own.has(pa[8 + i])) [pb[i], pa[8 + i]] = [pa[8 + i], ''];
  }
  return [listChange(knobsKey(a), ka), listChange(pushesKey(a), pa), listChange(knobsKey(b), kb), listChange(pushesKey(b), pb), { dump: 'names', path: [intoKey(b)], value: null }];
}
