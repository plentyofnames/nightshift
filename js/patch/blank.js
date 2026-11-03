// An empty config and preset, for tests and the example patch. Every output that can be
// "none" is none, every mapping slot unused, every LFO off.
//
// These are not the FH-2's factory defaults (those come from a reset module) and are not
// meant to be sent to one yet.

import { encode } from '../fh2/layout.js';
import { config, CONFIG_VERSION, BODY_SIZE } from '../fh2/config.js';
import { preset, PRESET_VERSION } from '../fh2/preset.js';
import { CMD, dumpMessage, parseDump } from '../fh2/sysex.js';

const n = (count, f) => Array.from({ length: count }, (_, i) => f(i));

export function blankConfig(name = 'Empty') {
  const values = {
    version: CONFIG_VERSION, name, triggerLength: 10, transpose: 0, legatoVelocity: 0, extClockMultiplier: 24,
    extClockRunControl: 0, presetProgramChannel: 0, softTakeover: 0,
    outputRange: n(64, () => ({ value: 0 })),
    converter: n(16, () => ({ enable: 0, channel: 0, minNote: 0, maxNote: 127, type: 0, voices: 1, bendRange: 2,
      stride: 0, lastMpeChannel: 15, baseGate: 0 })),
    mapping: n(384, () => ({ status: 0x7f, cc: 0, target: 0, index: 0 })),
    gateLevel: n(64, () => ({ low: 0, high: 8192 })),
    euclid: n(16, () => ({ output: 127, outputHigh: 1, offOutput: 127, offOutputHigh: 1 })),
    srr: n(16, () => ({ cvOutput: 0, changeOutput: 127, changeOutputHigh: 1, triggerOutput: 127, triggerOutputHigh: 1 })),
    tempoMin: 40, tempoMax: 127,
  };
  return parseDump(dumpMessage(CMD.INSTALL_CONFIG, encode(config, values, new Uint8Array(BODY_SIZE + 48))));
}

export function blankPreset(name = 'Empty') {
  const values = {
    version: PRESET_VERSION, name, tempo: 1200,
    output: n(64, () => ({ directLevel: 0, lfoLevel: 16383, lfoSpeed: 8192, lfoTempoBase: 24, lfoTempoMultiplier: 1,
      lfoPulseWidth: 64, lfoSaw: 64 })),
    euclid: n(16, () => ({ pulses: 0, steps: 16, rate: 6, gate: 64 })),
    // as in the FH-2's Init preset: 64 is the middle (no transpose, linear shapes)
    converter: n(16, () => ({ transpose: 64, envAttack: 64, envDecay: 64, envSustain: 64, envRelease: 64, envRange: 2, envDepth: 127,
      envVelocityDepth: 64, envAttackShape: 64, envDecayShape: 64, envReleaseShape: 64, randomDepth: 127,
      arpRange: 1, arpGate: 64, arpRate: 12 })),
    noteSequencer: n(4, (i) => ({ rate: [24, 6, 12, 24][i] })),
  };
  return parseDump(dumpMessage(CMD.INSTALL_PRESET, encode(preset, values, new Uint8Array(BODY_SIZE + 340))));
}
