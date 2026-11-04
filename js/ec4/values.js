// A knob's FH-2 setting as the EC4 shows it and sends it: the stored value (from the patch),
// four characters for the EC4's display in FH-2 units (2.50 V as "2.50", a sixteenth note as
// "1/16", the arp mode as "UP"), and the CC value that puts the EC4's knob where the setting is.
//
// The FH-2 takes most settings' CC values as they are (0–127), and the 14-bit ones (levels,
// LFO rate and depth) as 0–16383. "In other cases the MIDI CC range of 0-127 is scaled to map
// onto the range of the controlled parameter" (manual, "Mappings"): measured in hardware check
// 19 (BANDS below), and the tempo CC in check 18.

import { arpModeOf, levelToVolts, lfoHz } from '../patch/tables.js';
import { settingOf, HIRES } from './pages.js';

// Where a setting's value is kept in the preset, or null for one that keeps none (commands,
// positions, the display).
export function pathOf(t) {
  switch (t.kind) {
    case 'output':
    case 'converter':
    case 'euclid':
    case 'srr':
      return [t.kind, t.index, t.param];
    case 'noteSequencer':
      return t.param === 'position' ? null : ['noteSequencer', t.index, t.param];
    case 'drumSequencer':
      return t.param === 'reset' ? ['drumSequencer', 0, 'reset'] : null;
    case 'drumLane':
      return t.param === 'rate' ? ['drumSequencer', 0, 'lane', t.index, 'rate'] : null;
    case 'global':
      return ['tempo', 'swingType', 'swingAmount'].includes(t.param) ? [t.param] : null;
    default:
      return null;
  }
}

export function valueOf(preset, key) {
  const path = preset && pathOf(settingOf(key));
  if (!path) return null;
  let v = preset;
  for (const k of path) v = v?.[k];
  return typeof v === 'number' ? v : null;
}

// Settings a CC reaches in bands (hardware check 19, 2026-11-04): CC 0–127 is cut into `n` even
// bands of 128/n, counted from `from`, then held at the setting's lowest value `min`. Euclid
// patterns take 0–32 (steps can't go below 1), the arp range 1–3, latch off and on, and the swing
// type only 0–2 (off, 16th, 8th): a CC can't reach the tuplet swings.
const BANDS = {
  'euclid:pulses': { from: 0, n: 33 }, 'euclid:steps': { from: 0, n: 33, min: 1 }, 'euclid:rotation': { from: 0, n: 33 },
  'euclid:reset': { from: 0, n: 33 }, 'converter:arpRange': { from: 1, n: 3 }, 'converter:arpLatch': { from: 0, n: 2 },
  'global:swingType': { from: 0, n: 3 },
  // the shift register's (not measured yet: assumed to follow the same rule over the preset
  // tool's ranges; check 19 measures them on Random 16)
  'srr:direction': { from: 0, n: 3 }, 'srr:length': { from: 1, n: 32 }, 'srr:scale': { from: 0, n: 19 }, 'srr:key': { from: 0, n: 25 },
};
export const bandsOf = (t) => BANDS[`${t.kind}:${t.param}`] ?? null;

// The tempo CC (check 18, with the config's tempoMin and tempoMax both 59): CC n is tempoMin + 1 + n
// BPM, 60–187 here. What tempoMax does is still open. The preset keeps the tempo in tenths.
const tempoBase = (ctx) => (ctx.tempoMin == null ? null : ctx.tempoMin + 1);

// The CC value (0–127, or 0–16383 for a 14-bit knob) that stands for stored value `v`: for a
// banded setting, the middle of its band. `ctx`: { tempoMin } from the config.
export function ccFor(key, v, bits = 7, ctx = {}) {
  const t = settingOf(key);
  if (v == null) return null;
  if (t.kind === 'global' && t.param === 'tempo') return tempoBase(ctx) == null ? null : Math.max(0, Math.min(127, Math.round(v / 10 - tempoBase(ctx))));
  if (HIRES.has(t.param)) return bits === 14 ? Math.max(0, Math.min(16383, v)) : Math.max(0, Math.min(127, v >> 7));
  const b = bandsOf(t);
  if (b) return Math.min(127, Math.floor((Math.max(0, Math.min(b.n - 1, v - b.from)) * 128 + 64) / b.n));
  return Math.max(0, Math.min(127, v));
}

// The other way round: what the FH-2 makes of a CC value.
export function fromCc(key, cc, bits = 7, ctx = {}) {
  const t = settingOf(key);
  if (t.kind === 'global' && t.param === 'tempo') return tempoBase(ctx) == null ? null : (tempoBase(ctx) + cc) * 10;
  if (HIRES.has(t.param)) return bits === 14 ? cc : cc << 7;
  const b = bandsOf(t);
  if (b) return Math.max(b.min ?? b.from, b.from + Math.floor((cc * b.n) / 128));
  return cc;
}

// ---- four characters for the EC4's display

const SWING = ['OFF', '16TH', '8TH', 'PENT', 'SEXT', 'SEPT', 'OCT', 'NON'];
const ARP = { Off: 'OFF', Up: 'UP', Down: 'DOWN', Alt: 'ALT', 'Alt 2': 'ALT2', 'Step up': 'STUP', 'Step down': 'STDN', 'Step play': 'STPL',
  Random: 'RND', 'Random 2': 'RND2', 'Random 3': 'RND3', 'As played': 'PLAY' };
const SRR_DIR = ['BACK', 'STOP', 'FWD'];
const SRR_SCALE = ['OFF', 'CHRO', 'MAJ', 'MIN', 'TRI', 'MTRI', '5TH', 'TR+6', 'MT+6', 'TR+7', 'MT+7', '5+6', '5+7', 'PENT', 'MPEN', 'NMIN', 'HMIN', 'MIDO', 'MIDX'];
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DIVISION = { 96: '1/1', 48: '1/2', 24: '1/4', 16: '1/4T', 12: '1/8', 8: '1/8T', 6: '1/16', 4: '16T', 3: '1/32', 2: '32T', 1: '24PQ' };

const four = (s) => String(s).slice(0, 4);
const pct = (v, max = 127) => `${Math.round((v / max) * 100)}%`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const bipolar = (v) => signed(Math.round(((v - 64) / 63) * 100));
const division = (pulses, zero = 'EXT') => (pulses === 0 ? zero : DIVISION[pulses] ?? String(pulses));
function volts(level, range) {
  const v = levelToVolts(level, range);
  return Math.abs(v) >= 10 || v < 0 ? v.toFixed(1) : v.toFixed(2);
}
function hz(v) {
  const f = lfoHz(v);
  return f < 1 ? f.toFixed(2) : f < 10 ? f.toFixed(1) : String(Math.round(f));
}

// `ctx`: { range(output) } for the volts of a jack's level.
export function valueText(key, v, ctx = {}) {
  if (v == null) return null;
  const t = settingOf(key);
  if (t.kind === 'srr') {
    switch (t.param) {
      case 'direction': return SRR_DIR[v] ?? four(v);
      case 'scale': return SRR_SCALE[v] ?? four(v);
      case 'key': return KEYS[v % 12]; // the MIDI scales take it as a transposition; the knob's own page shows that
      case 'randomness': return v >= 127 ? 'LOCK' : v <= 0 ? 'INV' : four(pct(127 - v));
      case 'attenuator': return four(pct(v));
      case 'gateLength': return four(v ? pct(v) : 'TRIG');
      case 'rate': return four(division(v));
      default: return four(v);
    }
  }
  switch (t.param) {
    case 'directLevel': return four(volts(v, ctx.range?.(t.index) ?? 0));
    case 'lfoLevel': return four(pct(v, 16383));
    case 'lfoSpeed': return four(hz(v));
    case 'lfoTempoBase': return four(division(v));
    case 'lfoTempoMultiplier': return four(`x${v}`);
    case 'lfoSine': case 'lfoSquare': case 'lfoTriangle': case 'lfoPulseWidth': case 'lfoRandom': case 'lfoNoise': case 'envSustain':
      return four(pct(v));
    case 'lfoSaw': return four(signed(Math.round(((v - 64) / 64) * 100)));
    case 'lfoPhase': return four(`${Math.round((v / 128) * 360)}`);
    case 'lfoFade': case 'portamento': return four(v ? String(v) : 'OFF');
    case 'transpose': return four(signed(v - 64));
    case 'envDepth': case 'envVelocityDepth': return four(bipolar(v));
    case 'envAttackShape': case 'envDecayShape': case 'envReleaseShape': return four(v === 64 ? 'LIN' : signed(v - 64));
    case 'arpMode': return four(ARP[arpModeOf(v)?.[1]] ?? v);
    case 'arpRange': return four(`${v}OCT`);
    case 'arpGate': return four(v ? pct(v, 128) : 'TRIG');
    case 'arpLatch': return v ? 'ON' : 'OFF';
    case 'arpRate': return four(division(v));
    case 'arpReset': return four(v ? String(v) : 'OFF');
    case 'tempo': return four(v / 10 < 100 ? (v / 10).toFixed(1) : Math.round(v / 10));
    case 'swingType': return SWING[v] ?? four(v);
    case 'swingAmount': return four(v ? String(v) : 'OFF');
    case 'rate': return four(division(v));
    case 'reset': case 'accent': return four(v ? String(v) : 'OFF');
    default: return four(v);
  }
}
