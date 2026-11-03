// A knob's FH-2 setting as the EC4 shows it and sends it: the stored value (from the patch),
// four characters for the EC4's display in FH-2 units (2.50 V as "2.50", a sixteenth note as
// "1/16", the arp mode as "UP"), and the CC value that puts the EC4's knob where the setting is.
//
// The FH-2 takes most settings' CC values as they are (0–127), and the 14-bit ones (levels,
// LFO rate and depth) as 0–16383. "In other cases the MIDI CC range of 0-127 is scaled to map
// onto the range of the controlled parameter" (manual, "Mappings"): how it rounds isn't
// documented, so those are estimates (SCALED below) until a hardware check says more.

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

// Settings whose range isn't 0–127 (as far as Night Shift knows): [lowest, highest].
const SCALED = {
  'euclid:pulses': [0, 32], 'euclid:steps': [1, 32], 'euclid:rotation': [0, 32], 'euclid:reset': [0, 32],
  'global:swingType': [0, 7], 'converter:arpRange': [1, 3], 'converter:arpLatch': [0, 1],
};
const rangeOf = (t) => SCALED[`${t.kind}:${t.param}`] ?? null;

// The CC value (0–127, or 0–16383 for a 14-bit knob) that stands for stored value `v`.
export function ccFor(key, v, bits = 7) {
  const t = settingOf(key);
  if (v == null || t.kind === 'global' && t.param === 'tempo') return null; // tempo's CC range is the config's (check 18)
  if (HIRES.has(t.param)) return bits === 14 ? Math.max(0, Math.min(16383, v)) : Math.max(0, Math.min(127, v >> 7));
  const r = rangeOf(t);
  if (r) return Math.max(0, Math.min(127, Math.round(((v - r[0]) * 127) / (r[1] - r[0]))));
  return Math.max(0, Math.min(127, v));
}

// The other way round: what the FH-2 makes of a CC value (an estimate where it scales).
export function fromCc(key, cc, bits = 7) {
  const t = settingOf(key);
  if (HIRES.has(t.param)) return bits === 14 ? cc : cc << 7;
  const r = rangeOf(t);
  if (r) return r[0] + Math.round((cc * (r[1] - r[0])) / 127);
  return cc;
}

// ---- four characters for the EC4's display

const SWING = ['OFF', '16TH', '8TH', 'PENT', 'SEXT', 'SEPT', 'OCT', 'NON'];
const ARP = { Off: 'OFF', Up: 'UP', Down: 'DOWN', Alt: 'ALT', 'Alt 2': 'ALT2', 'Step up': 'STUP', 'Step down': 'STDN', 'Step play': 'STPL',
  Random: 'RND', 'Random 2': 'RND2', 'Random 3': 'RND3', 'As played': 'PLAY' };
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
