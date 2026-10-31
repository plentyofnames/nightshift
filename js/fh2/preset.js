// The FH-2 preset dump, version 8 (firmware 1.24 and 2.0).
//
// Transcribed from makeSysEx() / parsePresetDump() in Expert Sleepers' preset tool
// (github.com/expertsleepersltd/FH-2_tools, MIT). The comment after a field is the id of
// the matching control in that tool; test/official.test.js checks every one of them
// against the tool's own encoder.

import { u7, u14, u28, name16, bits, f, byte, pad, rep, at, compile } from './layout.js';

export const PRESET_VERSION = 8;
export const BODY_SIZE = 4096; // the addendum follows

const stepBits = (name, n) => Array.from({ length: n }, (_, i) => f(name + i, bits(i, 1)));

export const presetLayout = [
  f('version', u28),
  f('name', name16), // config_name

  f('swingType', u7), // swing_type
  f('swingAmount', u7), // swing_amount
  pad(1),

  rep('output', 64, 2, [f('directLevel', u14)]), // out_*_DC: 0–16383

  // One LFO per output, out_*_…
  rep('output', 64, 16, [
    f('lfoLevel', u14), // MLT
    f('lfoSpeed', u14), // LFO
    f('lfoTempoBase', u7), // CLK
    f('lfoTempoMultiplier', u7), // CLKM
    f('lfoSine', u7), // SIN
    f('lfoSquare', u7), // SQR
    f('lfoTriangle', u7), // TRI
    f('lfoPulseWidth', u7), // PW
    f('lfoSaw', u7), // SAW: 64 = none
    f('lfoRandom', u7), // RND
    f('lfoNoise', u7), // NSE
    f('lfoFade', u7), // FAD
    f('lfoSynced', u7), // MUS ("use musical")
    f('lfoPhase', u7), // PHS
  ]),

  rep('output', 64, 1, [f('smoothing', u7)]), // out_*_SMO

  // Per converter, arpeg*_…
  rep('converter', 16, 8, [
    f('arpMode', u7), // M
    f('arpRange', u7), // R
    f('arpGate', u7), // G
    f('arpLatch', u7), // L
    f('arpRate', u7), // T
    f('portamento', u7), // P
    f('arpReset', u7), // S
    f('transpose', u7), // E
  ]),

  f('tempo', u28), // tempo × 10

  // euc_*_…
  rep('euclid', 16, 8, [
    f('pulses', u7), // P
    f('steps', u7), // S
    f('rotation', u7), // R
    f('rate', u7), // T
    f('gate', u7), // G
    f('accent', u7), // A
    f('reset', u7), // E
  ]),

  // mcvm2_*_…: envelope and random depth, per converter
  rep('converter', 16, 8, [
    f('envAttack', u7), // A
    f('envDecay', u7), // D
    f('envSustain', u7), // S
    f('envRelease', u7), // R
    f('envRange', u7), // N
    f('envDepth', u7), // P
    f('envVelocityDepth', u7), // V
    f('randomDepth', u7), // RND
  ]),

  // scala_*_…
  rep('converter', 16, 4, [
    f('scalaEnable', u7), // enable
    f('scalaScl', u7), // scl
    f('scalaKbm', u7), // kbm
  ]),

  byte(...stepBits('noteSequencerActive', 4)), // seq_*_active
  byte(...stepBits('noteSequencerMute', 4)), // seq_*_mute
  byte(f('drumSequencerActive', bits(0, 1))), // dseq_0_active
  byte(f('drumSequencerMute', bits(0, 1))), // dseq_0_mute
  pad(8), // the trigger states are in the addendum

  // seq_*: 32 steps, then the sequence settings
  rep('noteSequencer', 4, 136, [
    rep('step', 32, 4, [
      f('gatesLow', u14), // 8 × 2-bit gates (seq_*_*_0…7), low 14 bits; gatesHigh in the addendum
      byte(f('degree', bits(0, 4)), f('octave', bits(4, 3))), // seq_*_*_degree, _octave
      byte(f('length', bits(0, 3)), f('ratchet', bits(3, 1)), f('reset', bits(4, 1))), // _length, _ratchet, _reset
    ]),
    f('start', u7), // A
    f('end', u7), // E
    f('rate', u7), // T
    f('gateLength', u7), // G
    f('reset', u7), // S
    f('rootNote', u7), // N
    f('direction', u7), // D
  ]),

  // dseq0_*: eight lanes of 32 steps; each byte holds 4 steps, the other half is in the addendum
  rep('drumSequencer', 1, 144, [
    rep('lane', 8, 16, [
      rep('hitsLow', 4, 1, [f('value', bits(0, 4))]), // dseqh0_lane_(m·8 + 0…3)
      rep('accentsLow', 4, 1, [f('value', bits(0, 4))]), // dseqa0_lane_(m·8 + 0…3)
      f('start', u7), // A
      f('end', u7), // E
      f('rate', u7), // T
      f('reset', u7), // S
      f('mute', u7), // M
    ]),
    f('reset', u7), // dseq0_S
  ]),

  // srr_*_…
  rep('srr', 16, 8, [
    f('direction', u7), // D
    f('length', u7), // L
    f('randomness', u7), // R
    f('rate', u7), // T
    f('attenuator', u7), // A
    f('scale', u7), // S
    f('key', u7), // K
    f('gateLength', u7), // G
  ]),

  f('swingPosition1', u7), // swing_pos1
  f('swingPosition2', u7), // swing_pos2
  f('swingPosition3', u7), // swing_pos3
  pad(1),

  // mcvm3_*_…: envelope shapes, per converter
  rep('converter', 16, 8, [
    f('envAttackShape', u7), // AS
    f('envDecayShape', u7), // DS
    f('envReleaseShape', u7), // RS
  ]),

  at(BODY_SIZE),
  rep('triggerState', 16, 1, [byte(...stepBits('bit', 4))]), // trig_(4i + 0…3)
  rep('noteSequencer', 4, 65, [
    f('permutation', u7), // seq_*_P
    rep('step', 32, 2, [
      f('gatesHigh', bits(0, 2)),
      byte(f('skip', bits(0, 1)), f('mute', bits(1, 3))), // seq_*_*_skip, _mute
    ]),
  ]),
  rep('drumSequencer', 1, 64, [
    rep('lane', 8, 8, [
      rep('hitsHigh', 4, 1, [f('value', bits(0, 4))]), // dseqh0_lane_(m·8 + 4…7)
      rep('accentsHigh', 4, 1, [f('value', bits(0, 4))]), // dseqa0_lane_(m·8 + 4…7)
    ]),
  ]),
];

export const preset = compile(presetLayout);
