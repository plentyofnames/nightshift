// What a config mapping slot controls. The encoding follows makeSysExMappings() and
// parseConfigDump() in Expert Sleepers' config tool: status 0x30 | channel, the CC number,
// a target type (+ 32 when relative) and an index whose meaning depends on the type.

import { OUTPUT_TARGETS_LOW, OUTPUT_TARGETS_HIGH, ARP_PARAMS, COMMANDS, ENV_PARAMS, SHAPE_PARAMS, EUCLID_PARAMS,
  SRR_PARAMS, SEQ_PARAMS, DRUM_PARAMS, LANE_PARAMS, GLOBAL_TARGETS } from './tables.js';

export const isUsed = (slot) => slot.status >> 4 === 3;

// { kind, index, param } for a slot's target, or { kind: 'unknown' }.
export function targetOf(slot) {
  const t = slot.target & ~32;
  const i = slot.index;
  if (t <= 8) {
    if (i < 64) return { kind: 'output', index: i, param: OUTPUT_TARGETS_LOW[t] };
    if (OUTPUT_TARGETS_HIGH[t] && i < 128) return { kind: 'output', index: i - 64, param: OUTPUT_TARGETS_HIGH[t] };
    return { kind: 'unknown' };
  }
  const by = (kind, params, shift = 3) => {
    const p = params[i & ((1 << shift) - 1)];
    return p ? { kind, index: i >> shift, param: p } : { kind: 'unknown' };
  };
  switch (t) {
    case 9: return by('converter', ARP_PARAMS);
    case 10: return by('euclid', EUCLID_PARAMS);
    case 11: return by('converter', COMMANDS);
    case 12: return by('converter', ENV_PARAMS);
    case 13: return i >> 4 < 4 ? by('noteSequencer', SEQ_PARAMS, 4) : { ...by('drumSequencer', DRUM_PARAMS, 4), index: 0 };
    case 14: return by('drumLane', LANE_PARAMS, 4);
    case 15: return by('srr', SRR_PARAMS);
    case 16: return by('converter', SHAPE_PARAMS);
    default:
      return GLOBAL_TARGETS[t] ? { kind: 'global', index: 0, param: GLOBAL_TARGETS[t] } : { kind: 'unknown' };
  }
}

// The other way round: { target, index } for a mapping slot that controls `t` ({ kind, index,
// param } as targetOf gives it), or null if no mapping can. The index is 7-bit, so a target past
// it (a ninth drum lane, say) has none.
export function encodeTarget(t) {
  const code = encode(t);
  return code && code.index <= 127 ? code : null;
}

function encode(t) {
  const at = (list) => list.indexOf(t.param);
  if (t.kind === 'output') {
    const low = at(OUTPUT_TARGETS_LOW);
    if (low >= 0) return { target: low, index: t.index };
    const high = Object.entries(OUTPUT_TARGETS_HIGH).find(([, p]) => p === t.param);
    return high ? { target: Number(high[0]), index: 64 + t.index } : null;
  }
  const by = (target, list, shift = 3) => (at(list) >= 0 ? { target, index: (t.index << shift) | at(list) } : null);
  switch (t.kind) {
    case 'converter':
      return by(9, ARP_PARAMS) ?? by(11, COMMANDS) ?? by(12, ENV_PARAMS) ?? by(16, SHAPE_PARAMS);
    case 'euclid': return by(10, EUCLID_PARAMS);
    case 'noteSequencer': return by(13, SEQ_PARAMS, 4);
    case 'drumSequencer': return at(DRUM_PARAMS) >= 0 ? { target: 13, index: (4 << 4) | at(DRUM_PARAMS) } : null;
    case 'drumLane': return by(14, LANE_PARAMS, 4);
    case 'srr': return by(15, SRR_PARAMS);
    case 'global': {
      const g = Object.entries(GLOBAL_TARGETS).find(([, p]) => p === t.param);
      return g ? { target: Number(g[0]), index: 0 } : null;
    }
    default:
      return null;
  }
}

// The used slots, decoded.
export function mappingsOf(config) {
  const out = [];
  config.mapping.forEach((slot, n) => {
    if (!isUsed(slot)) return;
    out.push({ slot: n, channel: slot.status & 15, cc: slot.cc, relative: !!(slot.target & 32), target: targetOf(slot) });
  });
  return out;
}
