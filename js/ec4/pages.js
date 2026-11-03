// EC4 pages: one page (an EC4 group of 16 knobs) per source that has settings a knob can
// change, made from a template for its kind, plus the LIVE page you fill yourself from the
// others. Each knob controls one FH-2 setting through one CC mapping: the config's own mapping
// for that setting if it has one, else a CC that mapPages() adds on the pages channel. A
// setting on two pages (its own and LIVE) is one mapping and one CC, so the EC4 keeps both
// knobs on the same value.
//
// The pages are recomputed from the patch like everything else. Night Shift's own part (the
// LIVE page, page names) lives in the patch's names: `ec4:live` holds 16 setting keys
// separated by commas (empty where a knob is free), `ec4:page:<id>` a page's name.

import { encodeTarget, isUsed } from '../patch/mappings.js';
import { PARAM_NAMES } from '../patch/tables.js';
import { sanitizeName } from '../../vendor/lilypad/js/model.js';

export const SETUP = 14; // the EC4 setup Night Shift owns: setup 15 (16 is the MDMM's)
export const GROUPS = 16;
export const KNOBS = 16;
export const LIVE_KEY = 'ec4:live';
export const pageNameKey = (id) => `ec4:page:${id}`;

// The settings the FH-2 takes as 14-bit (CC n below 32 with n + 32 as the fine half).
export const HIRES = new Set(['directLevel', 'lfoSpeed', 'lfoLevel']);
// On/off settings, shown ON/OFF on the EC4.
export const SWITCHES = new Set(['arpLatch']);

export const settingKey = (t) => `${t.kind}:${t.index}:${t.param}`;
export function settingOf(key) {
  const [kind, index, param] = key.split(':');
  return { kind, index: Number(index), param };
}

// ---- templates: [EC4 name, parameter] per knob, in the EC4's 4 × 4 order; null is a free knob

const LFO = [['SYNC', 'lfoTempoBase'], ['MULT', 'lfoTempoMultiplier'], ['DPTH', 'lfoLevel'], ['OFFS', 'directLevel'],
  ['SINE', 'lfoSine'], ['TRI', 'lfoTriangle'], ['SAW', 'lfoSaw'], ['SQR', 'lfoSquare'],
  ['PW', 'lfoPulseWidth'], ['RAND', 'lfoRandom'], ['NOIS', 'lfoNoise'], ['SMTH', 'smoothing'],
  ['PHAS', 'lfoPhase'], ['FADE', 'lfoFade'], ['RATE', 'lfoSpeed'], null];
const EUCLID = [['PULS', 'pulses'], ['STEP', 'steps'], ['ROT', 'rotation'], ['RATE', 'rate'],
  ['GATE', 'gate'], ['ACNT', 'accent'], ['RSET', 'reset']];
const RANDOM = [['RAND', 'randomness'], ['LEN', 'length'], ['RATE', 'rate'], ['ATTN', 'attenuator'],
  ['SCAL', 'scale'], ['KEY', 'key'], ['GATE', 'gateLength'], ['DIR', 'direction']];
const ENVELOPE = [['ATK', 'envAttack'], ['DEC', 'envDecay'], ['SUS', 'envSustain'], ['REL', 'envRelease'],
  ['ENVD', 'envDepth'], ['VELD', 'envVelocityDepth'], ['ERNG', 'envRange']];
const ARP = [['ARP', 'arpMode'], ['ARNG', 'arpRange'], ['AGAT', 'arpGate'], ['ARAT', 'arpRate']];
const CLOCK = [['TEMP', 'tempo'], ['SWNG', 'swingAmount'], ['STYP', 'swingType']];
const SEQUENCER = [['RAT', 'rate'], ['RST', 'reset'], ['GAT', 'gateLength'], ['POS', 'position']];

const label = (param) => {
  const n = (PARAM_NAMES[param] ?? param).replace(/^LFO /, '');
  return n.charAt(0).toUpperCase() + n.slice(1);
};
const cellOf = (short, kind, index, param, source) => ({ short, label: label(param), setting: { kind, index, param }, key: settingKey({ kind, index, param }), source });
const fill = (cells) => Array.from({ length: KNOBS }, (_, i) => cells[i] ?? null);

// A voice: its envelope if it has an envelope output, glide where it glides (mono voices and
// unison), the arpeggiator, transpose, random depth with a random output.
function voiceCells(s) {
  const cv = s.raw;
  const out = [];
  const add = (list) => list.forEach(([short, p]) => out.push(cellOf(short, 'converter', s.index, p, s.id)));
  if (cv.envelopeOut) add(ENVELOPE);
  if (cv.type === 0 || cv.allocation === 2 || cv.allocation === 3) add([['GLID', 'portamento']]);
  while (out.length % 4) out.push(null);
  add(ARP);
  add([['TRNS', 'transpose'], ['LTCH', 'arpLatch'], ['ARST', 'arpReset']]);
  if (cv.randomOut) add([['RNDD', 'randomDepth']]);
  return out.slice(0, KNOBS);
}

// "CV2·1" → "C2.1", "5" → "OUT5", "GT1·3" → "G1.3": a jack in four characters.
export function jackShort(jack) {
  const j = String(jack).replace('·', '.');
  if (/^\d+$/.test(j)) return `OUT${j}`.slice(0, 4);
  return (j.charAt(0) + j.replace(/^[A-Za-z]+/, '')).slice(0, 4);
}

// A page name in the EC4's four characters: "Voice 1" → "VOI1", "Euclid 12" → "EU12", "Wobble" → "WOBB".
export function shortName(name) {
  const clean = String(name).replace('·', '.').replace(/[^0-9A-Za-z .\/-]/g, '').trim();
  const m = clean.match(/^(.*?)\s*(\d+)$/);
  if (m && m[1] && m[2].length <= 3) return fourChars(m[1].replace(/\s+/g, '').toUpperCase().slice(0, 4 - m[2].length) + m[2]);
  return fourChars(clean.replace(/\s+/g, '').toUpperCase());
}
// Up to four characters the EC4 can show (padded with spaces only when written).
export const fourChars = (text) => sanitizeName(text).trimEnd();

// The template pages for the patch, in the order sources are shown, then the sequencers and
// the clock. Every page holds at most 16 knobs; a "CC → CV" source with more gets several.
function templatePages(view) {
  const pages = [];
  const page = (id, name, source, cells) => pages.push({ id, name, defaultName: shortName(name), source, cells: fill(cells) });
  for (const s of view.sources) {
    if (s.parked) continue;
    if (s.kind === 'voice') page(s.id, s.name, s.id, voiceCells(s));
    else if (s.kind === 'euclid') page(s.id, s.name, s.id, EUCLID.map(([short, p]) => cellOf(short, 'euclid', s.index, p, s.id)));
    else if (s.kind === 'random') page(s.id, s.name, s.id, RANDOM.map(([short, p]) => cellOf(short, 'srr', s.index, p, s.id)));
    else if (s.kind === 'lfo') page(s.id, s.name, s.id, LFO.map((c) => c && { ...cellOf(c[0], 'output', s.index, c[1], s.id), ...(c[1] === 'directLevel' && { label: 'Centre' }) }));
    else if (s.kind === 'knobs') {
      const ports = s.ports.filter((p) => p.output < 64);
      for (let k = 0; k < ports.length; k += KNOBS) {
        const part = ports.slice(k, k + KNOBS).map((p) => ({ ...cellOf(jackShort(p.jack), 'output', p.output, 'directLevel', s.id), label: `Level of ${p.jack}` }));
        page(k ? `${s.id}:${k / KNOBS}` : s.id, k ? `${s.name} ${k / KNOBS + 1}` : s.name, s.id, part);
        if (!s.defaultName) pages.at(-1).defaultName = shortName(`CC ${s.channel + 1}${k ? String.fromCharCode(65 + k / KNOBS) : ''}`);
      }
    }
  }
  const seqs = view.players.filter((p) => p.kind === 'sequencer');
  if (seqs.length) {
    page('sequencers', 'Sequencers', null, seqs.flatMap((q) => SEQUENCER.map(([short, p]) => ({
      ...cellOf(`${short}${q.index + 1}`, 'noteSequencer', q.index, p, q.id), label: `${q.name}: ${PARAM_NAMES[p]}` }))));
    Object.assign(pages.at(-1), { defaultName: 'SEQ', sub: 'Note sequencers' });
  }
  page('clock', 'Clock', 'clocks', CLOCK.map(([short, p]) => cellOf(short, 'global', 0, p, view.sources.some((s) => s.id === 'clocks') ? 'clocks' : null)));
  Object.assign(pages.at(-1), { defaultName: 'CLK', sub: 'Tempo, swing' });
  return pages;
}

// The LIVE page as stored: 16 setting keys or ''.
export function liveKeys(names) {
  const keys = (names?.[LIVE_KEY] ?? '').split(',');
  return Array.from({ length: KNOBS }, (_, i) => keys[i] ?? '');
}
// The change that stores `keys` as the LIVE page (cleared when all are free).
export function setLive(keys) {
  const value = keys.some(Boolean) ? keys.map((k) => k ?? '').join(',').replace(/,+$/, '') : null;
  return [{ dump: 'names', path: [LIVE_KEY], value }];
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
  return setLive(keys);
}

// The pages channel: ch 2, unless a voice, a trigger or one of the FH-2's players uses it;
// then the first channel nothing but CC mappings uses.
export function pagesChannels(view) {
  const ok = (c) => !c.senders.length && !c.listeners.some((l) => l.source);
  const free = view.channels.filter(ok).map((c) => c.channel);
  return free.includes(1) ? [1, ...free.filter((c) => c !== 1)] : free;
}

// Every page with its knobs' CCs: { pages, extra (pages past the 16th), channel, unmapped }.
// A knob's `map` is { channel, cc, relative, bits, slot } or null while it has no mapping.
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

  const all = templatePages(view);
  const cells = new Map();
  for (const pg of all) {
    pg.name = names[pageNameKey(pg.id)] ? fourChars(names[pageNameKey(pg.id)]) : pg.defaultName;
    for (const c of pg.cells) if (c) {
      c.map = mapOf(c.key);
      cells.set(c.key, c);
    }
  }
  // LIVE: settings from the other pages; one that no longer exists shows as gone
  const live = liveKeys(names).map((key) => {
    if (!key) return null;
    const c = cells.get(key);
    if (c) return { ...c, live: true };
    return { short: '?', label: 'Gone from the patch', key, setting: settingOf(key), source: null, map: mapOf(key), gone: true };
  });
  if (live.some(Boolean)) all.unshift({ id: 'live', name: names[pageNameKey('live')] ? fourChars(names[pageNameKey('live')]) : 'LIVE', defaultName: 'LIVE', source: null, cells: live, live: true });
  const pages = all.slice(0, GROUPS);
  pages.forEach((pg, g) => (pg.group = g));
  const unmapped = new Set();
  for (const pg of pages) for (const c of pg.cells) if (c && !c.map && !c.gone) unmapped.add(c.key);
  const onLive = new Set(liveKeys(names).filter(Boolean));
  for (const pg of pages) for (const c of pg.cells) if (c) c.onLive = onLive.has(c.key);
  return { pages, extra: all.slice(GROUPS), channel: pagesChannels(view)[0] ?? null, unmapped: [...unmapped], liveFull: onLive.size >= KNOBS };
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

// The changes that give every unmapped knob a mapping: absolute, on the pages channel (the
// next free channel once it's full). The 14-bit settings go first, so the 7-bit ones don't
// take the fine halves they need. { changes, mapped: count, left: keys that found no CC or
// no mapping slot }.
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
