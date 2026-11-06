// How the EC4's knobs feel (Polish, your idea 2026-11-06): a full sweep of any setting should take
// about the same turn, whatever its number of values, and be slower than one value per detent.
//
// controlfrog's encoder modes (docs/control.md in the firmware repo), per quadrature edge ("event";
// a detent is likely four):
// - 7-bit: Div8/4/2 one CC step every 8/4/2 events (no acceleration), Acc0 one per event, Acc1–3 one
//   to six by turning speed, LSp2/4/6 a fixed 2/4/6;
// - 14-bit: Div and Acc0 one of 16383 per event (a full sweep would take 16383 events), Acc1 half the
//   speed-scaled base step, Acc2 the base, Acc3 four times it, LSp2/4/6 250/500/750.
// So a 7-bit setting gets the slowest fixed mode whose full sweep (CC 0–127) fits the speed you pick,
// as long as one of its values takes at most about four detents (settings with few values, arp range
// or latch, would crawl otherwise); a 14-bit one stays accelerated, gentler than before (Acc1).

import { settingOf } from './pages.js';
import { bandsOf } from './values.js';

export const MODE_NAMES = ['Div8', 'Div4', 'Div2', 'Acc0', 'Acc1', 'Acc2', 'Acc3', 'LSp2', 'LSp4', 'LSp6']; // the EC4's mode numbers
export const SPEEDS = [['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']];
const SWEEP = { slow: 512, medium: 256, fast: 128 }; // events for CC 0–127
const EVENTS_PER_CC = { Div8: 8, Div4: 4, Div2: 2, Acc0: 1, LSp2: 1 / 2, LSp4: 1 / 4, LSp6: 1 / 6 };
const FIXED = ['Div8', 'Div4', 'Div2', 'Acc0', 'LSp2', 'LSp4', 'LSp6']; // from the slowest
const MAX_PER_VALUE = 16; // events, about four detents

const SPEED_KEY = 'ec4:speed';
const feelKey = (key) => `ec4:feel:${key}`;
export const speedOf = (names) => (SWEEP[names?.[SPEED_KEY]] ? names[SPEED_KEY] : 'medium');
export const speedChange = (speed) => ({ dump: 'names', path: [SPEED_KEY], value: speed === 'medium' ? null : speed });

// The mode a knob gets by default: setting `key`, mapped with `bits`, at `speed`.
export function defaultFeel(key, bits, speed = 'medium') {
  if (bits === 14) return speed === 'fast' ? 'Acc2' : 'Acc1';
  const bands = bandsOf(settingOf(key));
  const n = bands ? bands.n : 128; // the values a CC 0–127 reaches
  if (speed === 'fast' && n > 8) return 'Acc1'; // as before: accelerated
  const fits = FIXED.find((m) => 128 * EVENTS_PER_CC[m] <= SWEEP[speed] && (128 / n) * EVENTS_PER_CC[m] <= MAX_PER_VALUE);
  return fits ?? 'LSp6';
}

// A knob's mode: yours if you picked one on the EC4 tab, else the default. `names` as the project's.
export function feelOf(names, key, bits) {
  const mine = names?.[feelKey(key)];
  return MODE_NAMES.includes(mine) ? mine : defaultFeel(key, bits, speedOf(names));
}
export const feelChange = (key, mode) => ({ dump: 'names', path: [feelKey(key)], value: mode ?? null });
export const feelIsMine = (names, key) => MODE_NAMES.includes(names?.[feelKey(key)]);

// How long a full sweep of a 7-bit setting is in a fixed mode, in events (null for accelerated ones).
export const sweepOf = (mode) => (EVENTS_PER_CC[mode] ? Math.round(128 * EVENTS_PER_CC[mode]) : null);
