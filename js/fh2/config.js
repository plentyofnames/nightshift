// The FH-2 configuration dump, version 11 (firmware 2.0).
//
// Transcribed from makeSysEx() / parseConfigDump() in Expert Sleepers' config tool
// (github.com/expertsleepersltd/FH-2_tools, MIT). The comment after a field is the id of
// the matching control in that tool; test/official.test.js checks every one of them
// against the tool's own encoder.
//
// Conventions as stored: MIDI channels 0–15; outputs 0–63 (FH-2 and FHX-8CV) and 64–127
// (FHX-8GT); "none" depends on the field (see the comments).

import { u7, s7, u14, s14, u28, name16, bits, f, byte, pad, rep, at, compile } from './layout.js';

export const CONFIG_VERSION = 11;
export const BODY_SIZE = 4096; // the addendum follows

export const configLayout = [
  f('version', u28),
  f('name', name16), // config_name

  f('triggerLength', u7), // glb_triglen
  f('transpose', s7), // glb_transpose
  f('legatoVelocity', u7), // glb_legvel
  f('extClockMultiplier', u7), // glb_extclkmult
  f('extClockRunControl', u7), // glb_extclkrun
  f('presetProgramChannel', u7), // glb_presetprogch: 0 = off, else 1–16
  f('softTakeover', u7), // glb_softtakeover

  rep('outputRange', 64, 1, [f('value', u7)]), // rng_1…64

  // MIDI/CV converters, mcv_*_1…16
  rep('converter', 16, 32, [
    f('enable', u7), // mcv_enable
    f('channel', u7), // mcv_ch − 1
    f('minNote', u7), // mcv_min
    f('maxNote', u7), // mcv_max
    f('type', u7), // mcv_type: 0 mono, 1 poly, 2 MPE
    f('voices', u7), // mcv_voices
    f('bendRange', u7), // mcv_bend
    f('allocation', u7), // mcv_scheme
    f('noStealing', u7), // mcv_stealing
    f('gatedAftertouch', u7), // mcv_GA
    f('sustain', u7), // mcv_SUS
    f('baseOutput', u7), // mcv_base: 0–63
    f('stride', u7), // mcv_stride
    f('lastMpeChannel', u7), // mcv_lastMPE − 1
    f('aftertouchOut', u7), // mcv_A
    f('paraGateOut', u7), // mcv_G
    f('cvOut', u7), // mcv_VC
    f('gateOut', u7), // mcv_VG
    f('velGateOut', u7), // mcv_VVG
    f('velocityOut', u7), // mcv_VV: 0 off, 1 on, 2 inverted
    f('releaseVelocityOut', u7), // mcv_VR: as velocityOut
    f('triggerOut', u7), // mcv_VT
    f('pressureOut', u7), // mcv_VP
    f('mpeYcc', u7), // mcv_VY: 0 = off
    f('envelopeOut', u7), // mcv_VE
    f('baseGate', u7), // mcv_basegate: 0 = gates on CV outputs, else 64–127
    f('monoRetrigger', u7), // mcv_MT
    f('interruptGate', u7), // mcv_IG
    f('envZeroStart', u7), // mcv_ZS
    f('bendDown', u7), // mcv_benddown: 0 = same as bend range, else depth + 1
    f('bendOut', u7), // mcv_PB: 0 off, 1 one output, 2 up and down
    f('randomOut', u7), // mcv_VRND
  ]),

  // CC mappings. A used slot has status 0x30 | channel; an unused one 0x7f.
  // target & 32 is the relative flag; see mappings.js for what target/index address.
  rep('mapping', 384, 4, [
    f('status', u7),
    f('cc', u7),
    f('target', u7),
    f('index', u7),
  ]),

  // clk_1…32
  rep('clock', 32, 8, [
    f('type', u7), // clk_type
    f('base', u7), // clk_base
    f('multiplier', u7), // clk_mult
    f('length', u7), // clk_len
    f('output', u7), // clk_output: 0–127
    f('shift', u7), // clk_shift
  ]),

  // out_gt_0…63: DAC codes 0–16383
  rep('gateLevel', 64, 4, [
    f('low', u14), // out_gt_lo
    f('high', u14), // out_gt_hi
  ]),

  // trg_1…64. The envelope set (trg_env − 1, 0–15) is split over two bytes.
  rep('trigger', 64, 4, [
    byte(f('type', bits(0, 4)), f('envSetHigh', bits(4, 3))), // trg_type, (env − 1) >> 1
    byte(f('channel', bits(0, 4)), f('envSetLow', bits(4, 1)), f('anyNote', bits(5, 1))), // trg_ch − 1, (env − 1) & 1, trg_note < 0
    f('note', u7), // trg_note (0 when any note)
    f('output', u7), // trg_output: 0–127
  ]),

  // euc_output_1…16, low 7 bits; outputHigh in the addendum. 127 + high = none.
  rep('euclid', 16, 1, [f('output', u7)]),

  f('tapType', u7), // glb_taptype: 0 none, 1 note, 2 CC
  f('tapChannel', u7), // glb_tapch
  f('tapNumber', u7), // glb_tapcc
  f('euclidAccent', u7), // glb_eucaccent
  f('startStopType', u7), // glb_starttype
  f('startStopChannel', u7), // glb_startch
  f('startStopNumber', u7), // glb_startcc
  pad(1),

  rep('euclid', 16, 1, [f('offOutput', u7)]), // euc_offoutput_1…16, as output

  // hid_1…32
  rep('gamepad', 32, 8, [
    f('usage', u7), // hid_usage
    f('output', u7), // hid_output
    f('scale', s14), // hid_scale
    f('offset', s14), // hid_offset
  ]),

  // kbd_1…32
  rep('keyboard', 32, 8, [
    f('type', u7), // kbd_type
    f('output', u7), // kbd_output
    f('key', u7), // kbd_key
    pad(1),
    f('value0', u14), // kbd_value0
    f('value1', u14), // kbd_value1
  ]),

  // lfotrig_*_1…64
  rep('lfoReset', 64, 2, [
    byte(f('channel', bits(0, 4)), f('type', bits(4, 3))), // lfotrig_ch, lfotrig_type
    f('number', u7), // lfotrig_cc
  ]),

  // cvm_*_0…1: inputs X and Y
  rep('cvMidi', 2, 8, [
    byte(
      f('enable', bits(0, 1)), // cvm_en
      f('toInternal', bits(1, 1)), // cvm_outI
      f('toUsbA', bits(2, 1)), // cvm_outA
      f('toUsbC', bits(3, 1)), // cvm_outC
      f('toDin', bits(4, 1)), // cvm_outD
      f('toSelect', bits(5, 1)), // cvm_outS
    ),
    byte(f('channel', bits(0, 4)), f('type', bits(4, 3))), // cvm_ch − 1, cvm_type
    f('number', u7), // cvm_cc
    pad(1),
    f('level0v', s14), // cvm_0v
    f('level5v', s14), // cvm_5v
  ]),

  f('tempoMin', u7), // glb_tempo_min
  f('tempoMax', u7), // glb_tempo_max
  pad(2),

  // seqn_*: note sequencers
  rep('noteSequencer', 4, 4, [
    f('channel', u7), // seqn_ch − 1
    byte(
      f('toInternal', bits(0, 1)), // seqn_int
      f('toUsbC', bits(1, 1)), // seqn_c
      f('toUsbA', bits(2, 1)), // seqn_a
      f('toDin', bits(3, 1)), // seqn_d
      f('toSelect', bits(4, 1)), // seqn_s
    ),
    f('clock', u7), // seqn_clk
  ]),

  // seqd_0_*: drum sequencer
  rep('drumSequencer', 1, 12, [
    f('channel', u7), // seqd_ch − 1
    byte(
      f('toInternal', bits(0, 1)), // seqd_int
      f('toUsbC', bits(1, 1)), // seqd_c
      f('toUsbA', bits(2, 1)), // seqd_a
      f('toDin', bits(3, 1)), // seqd_d
      f('toSelect', bits(4, 1)), // seqd_s
    ),
    pad(2),
    rep('laneNote', 8, 1, [f('value', u7)]), // seqd_n_0…7
  ]),

  // arp_*_1…16: arpeggiator clock and MIDI out, per converter
  rep('converter', 16, 4, [
    f('arpClock', u7), // arp_clk
    byte(
      f('arpChannel', bits(0, 4)), // arp_out_ch − 1
      f('arpToUsbC', bits(4, 1)), // arp_out_c
      f('arpToUsbA', bits(5, 1)), // arp_out_a
      f('arpToDin', bits(6, 1)), // arp_out_d
    ),
  ]),

  // srr_*_1…16: shift register random generators
  rep('srr', 16, 7, [
    f('cvOutput', u7), // srr_output + 1: 0 = none
    f('changeOutput', u7), // srr_change, low 7 bits; changeOutputHigh in the addendum
    f('triggerOutput', u7), // srr_trigger, likewise
    f('clock', u7), // srr_clk
    f('notesChannel', u7), // srr_nch (0 when none)
    f('channel', u7), // srr_ch − 1
    byte(
      f('toInternal', bits(0, 1)), // srr_int
      f('toUsbC', bits(1, 1)), // srr_c
      f('toUsbA', bits(2, 1)), // srr_a
      f('toDin', bits(3, 1)), // srr_d
      f('toSelect', bits(4, 1)), // srr_s
    ),
  ]),

  // Addendum: the high bit of outputs that can be "none".
  at(BODY_SIZE),
  rep('euclid', 16, 1, [f('outputHigh', u7)]),
  rep('euclid', 16, 1, [f('offOutputHigh', u7)]),
  rep('srr', 16, 1, [byte(f('changeOutputHigh', bits(0, 1)), f('triggerOutputHigh', bits(1, 1)))]),
];

export const config = compile(configLayout);
