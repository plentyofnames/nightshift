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

// The used slots, decoded.
export function mappingsOf(config) {
  const out = [];
  config.mapping.forEach((slot, n) => {
    if (!isUsed(slot)) return;
    out.push({ slot: n, channel: slot.status & 15, cc: slot.cc, relative: !!(slot.target & 32), target: targetOf(slot) });
  });
  return out;
}
