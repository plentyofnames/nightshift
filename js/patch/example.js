// The example patch from the design mockups, built as a real config and preset, for an
// FH-2 with CV expanders 1 and 2 and gate expanders 0 and 1. It is the test material for
// derive() until real dumps exist, and what "Try the example" opens.

import { blankConfig, blankPreset } from './blank.js';

// Stored output numbers for the jacks used below.
const jack = (j) => j - 1; // FH-2 jacks 1–8
const C1 = (j) => 8 + j - 1;
const C2 = (j) => 16 + j - 1;
const G0 = (j) => 64 + j - 1;
const G1 = (j) => 80 + j - 1;

function map(config, channel, cc, target, index) {
  const slot = config.mapping.find((m) => m.status === 0x7f);
  Object.assign(slot, { status: 0x30 | channel, cc, target, index });
}

// Returns { config, preset } as parsed dumps (see sysex.js parseDump), ready for derive() or buildDump().
export function examplePatch() {
  const config = blankConfig('Live set Oct');
  const preset = blankPreset('Verse');
  const c = config.values;
  const p = preset.values;

  // Voice 1 "Lead": mono, ch 1, C3 and up: pitch, gate, velocity, envelope on jacks 1–4
  Object.assign(c.converter[0], { enable: 1, type: 0, channel: 0, minNote: 48, maxNote: 108, baseOutput: jack(1),
    cvOut: 1, gateOut: 1, velocityOut: 1, envelopeOut: 1 });
  c.outputRange[jack(1)].value = 1;
  Object.assign(p.converter[0], { portamento: 20, envAttack: 2, envDecay: 40, envSustain: 76, envRelease: 50 });
  // vibrato: an LFO on the pitch jack, depth on the mod wheel
  Object.assign(p.output[jack(1)], { lfoSine: 127, lfoLevel: 1300, lfoSpeed: 14320 });
  map(c, 0, 1, 2, jack(1));

  // Voice 2 "Pad": poly 3, ch 1 below C3; pitches on C1·6–8, gates on G1·6–8
  Object.assign(c.converter[1], { enable: 1, type: 1, voices: 3, channel: 0, minNote: 0, maxNote: 47, baseOutput: C1(6),
    baseGate: G1(6), cvOut: 1, gateOut: 1, allocation: 0 });
  map(c, 1, 19, 9, 1 * 8 + 0); // arp mode, from the EC4

  // Voice 3 "Bass": mono, ch 16, played by note sequencer 1; pitch and velocity on C1·1–2, gate on G0·1
  Object.assign(c.converter[2], { enable: 1, type: 0, channel: 15, baseOutput: C1(1), baseGate: G0(1),
    cvOut: 1, gateOut: 1, velocityOut: 1 });
  Object.assign(c.noteSequencer[0], { channel: 15, toInternal: 1, toDin: 1 });

  // Drums: drum sequencer on ch 15, five triggers on G0·2–6
  Object.assign(c.drumSequencer[0], { channel: 14, toInternal: 1 });
  [36, 38, 42, 46, 39, 37, 49, 51].forEach((note, i) => { c.drumSequencer[0].laneNote[i].value = note; });
  [36, 38, 42, 46, 39].forEach((note, i) => {
    Object.assign(c.trigger[i], { type: 1, channel: 14, note, anyNote: 0, output: G0(2 + i) });
  });

  // Clock & transport: 16ths, run gate, a bar pulse
  Object.assign(c.clock[0], { type: 1, base: 6, multiplier: 1, length: 10, output: G0(7) });
  Object.assign(c.clock[1], { type: 2, base: 24, multiplier: 1, output: G0(8) });
  Object.assign(c.clock[2], { type: 1, base: 96, multiplier: 1, length: 10, output: G1(1) });

  // Euclid 1: 5 of 16 on G1·2; pulses and rotation on EC4 ch 2
  Object.assign(c.euclid[0], { output: G1(2), outputHigh: 0 });
  Object.assign(p.euclid[0], { pulses: 5, steps: 16, rotation: 2, rate: 6 });
  map(c, 1, 16, 10, 0);
  map(c, 1, 17, 10, 2);

  // Wobble: a synced triangle LFO on jack 5, centred on 0 V; input X sets its rate multiplier
  c.outputRange[jack(5)].value = 1;
  Object.assign(p.output[jack(5)], { directLevel: 8192, lfoTriangle: 127, lfoSynced: 1, lfoTempoBase: 96, lfoTempoMultiplier: 1, lfoLevel: 9830 });
  Object.assign(c.cvMidi[0], { enable: 1, toInternal: 1, type: 0, channel: 13, number: 20 });
  map(c, 13, 20, 8, jack(5));

  // Drift: a slow sine-and-random LFO on jack 6, smoothed
  c.outputRange[jack(6)].value = 1;
  Object.assign(p.output[jack(6)], { directLevel: 8192, lfoSine: 90, lfoRandom: 40, lfoSpeed: 500, lfoLevel: 16383, smoothing: 45 });

  // Melody box: a shift register; CV on C1·5, change and trigger on G1·4–5; randomness on the EC4
  Object.assign(c.srr[0], { cvOutput: C1(5) + 1, changeOutput: G1(4), changeOutputHigh: 0, triggerOutput: G1(5), triggerOutputHigh: 0 });
  Object.assign(p.srr[0], { direction: 1, length: 8, randomness: 20, rate: 12, scale: 14, key: 2 });
  map(c, 1, 18, 15, 2);

  // EC4 knobs: four levels on C2·1–4, CC 12–15 on ch 2
  [0, 1, 2, 3].forEach((k) => {
    map(c, 1, 12 + k, 0, C2(1 + k));
    p.output[C2(1 + k)].directLevel = [10158, 3277, 0, 8192][k];
  });

  // A stored level of +2.5 V on C2·8 (±5 V range)
  c.outputRange[C2(8)].value = 1;
  p.output[C2(8)].directLevel = 12288;

  // Tempo on the EC4
  map(c, 1, 20, 69, 0);

  return { config, preset };
}
