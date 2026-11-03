// Finding room in the FH-2 for a new source: free clock, Euclid and mapping slots, and CCs
// that nothing uses yet. Reads config values only; edit.js does the writing.

import { isUsed, mappingsOf } from './mappings.js';
import { isPresent } from './hardware.js';

const LFO_RESET_CLOCK = 6;
const LFO_RESET_EUCLID = 7;

const restartsFrom = (config, type) => new Set(config.lfoReset.filter((r) => r.type === type).map((r) => r.number));

// A clock slot with no type. A clock with a type stays taken even if its output is outside
// the rack: it may only be there to restart an LFO.
export function freeClock(config) {
  const restarts = restartsFrom(config, LFO_RESET_CLOCK);
  return config.clock.findIndex((c, i) => !c.type && !restarts.has(i));
}

// A Euclid pattern with no outputs; failing that, one parked on jacks outside the rack (the
// Init config parks all 16 on GT3/16) that no LFO restarts from.
export function freeEuclid(config, hardware) {
  const restarts = restartsFrom(config, LFO_RESET_EUCLID);
  const outs = (e) => [e.outputHigh ? null : e.output, e.offOutputHigh ? null : e.offOutput].filter((o) => o != null);
  const unused = config.euclid.findIndex((e, i) => !restarts.has(i) && outs(e).length === 0);
  if (unused >= 0) return unused;
  return config.euclid.findIndex((e, i) => !restarts.has(i) && outs(e).every((o) => !isPresent(hardware, o)));
}

export const freeMapping = (config) => config.mapping.findIndex((m) => !isUsed(m));

// CCs a knob shouldn't use: bank select, data entry, sustain and sostenuto (converters
// listen to them), (N)RPN, and the channel mode messages.
const RESERVED = new Set([0, 6, 32, 38, 64, 66, 96, 97, 98, 99, 100, 101, 120, 121, 122, 123, 124, 125, 126, 127]);

// The CCs on `channel` (0–15) that no mapping uses, as [{ cc, fine }]. The FH-2 pairs CC n
// (below 32) with n + 32 as the fine half of a 14-bit value, unless n + 32 is mapped to
// something else; `fine` says the pair is free, so the knob can be 14-bit.
export function freeCcs(config, channel) {
  const used = new Set(mappingsOf(config).filter((m) => m.channel === channel).map((m) => m.cc));
  const out = [];
  for (let cc = 0; cc < 128; cc++) {
    if (used.has(cc) || RESERVED.has(cc)) continue;
    if (cc >= 32 && cc < 64 && used.has(cc - 32)) continue; // the fine half of a used CC
    out.push({ cc, fine: cc < 32 && !used.has(cc + 32) });
  }
  return out;
}

// The CC to offer first: 14-bit if possible, as the EC4 pages will want.
export function suggestCc(config, channel) {
  const free = freeCcs(config, channel);
  return (free.find((c) => c.fine) ?? free[0])?.cc ?? null;
}
