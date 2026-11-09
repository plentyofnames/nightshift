// The BCR32's names for what a control sends and how it turns (your call, 2026-11-09, with Rotary
// Club 0.28's screen and Eye of Providence): longer than the EC4's four letters, so they read without
// the manual. Each is [short (boxes, summaries), full (lists)]. The EC4 tab keeps the EC4's own.

import { decodeEncoder, decodePush, noteName } from '../../vendor/eyeofprovidence/js/model.js';

// by encoder type 0–8 (controlfrog's CCR1, CCR2, CCAb, PrgC, CCAh, PBnd, AftT, Note, NRPN)
export const TURN_TYPES = [
  ['CC rel', 'CC relative (1 up, 127 down)'], ['CC rel', 'CC relative (65 up, 63 down)'], ['CC', 'Control change (CC)'],
  ['Prog change', 'Program change'], ['CC 14-bit', 'CC 14-bit (n and n + 32)'], ['Pitch bend', 'Pitch bend'],
  ['Aftertouch', 'Aftertouch'], ['Note', 'Note (on / off)'], ['NRPN', 'NRPN'],
];

// by the EC4's mode name (ec4/feel.js MODE_NAMES)
export const MODES = {
  Div8: ['÷8', 'Divide by 8'], Div4: ['÷4', 'Divide by 4'], Div2: ['÷2', 'Divide by 2'],
  Acc0: ['no accel', 'No acceleration'], Acc1: ['accel low', 'Acceleration low'], Acc2: ['accel mid', 'Acceleration mid'], Acc3: ['accel max', 'Acceleration max'],
  LSp2: ['steps of 2', 'Steps of 2'], LSp4: ['steps of 4', 'Steps of 4'], LSp6: ['steps of 6', 'Steps of 6'],
};

// by push type 0–12 (Off, Note, CC, PrgC, PBnd, AftT, Grp, Set, Acc0, Acc3, LSp6, Min, Max)
export const PUSH_TYPES = [
  ['off', 'Off'], ['Note', 'Note'], ['CC', 'Control change (CC)'], ['Prog change', 'Program change'], ['Pitch bend', 'Pitch bend'],
  ['Aftertouch', 'Aftertouch'], ['Page', 'Page select'], ['Set', 'Set (does nothing)'], ['no accel held', 'No acceleration while held'],
  ['max accel held', 'Max acceleration while held'], ['steps of 6 held', 'Steps of 6 while held'], ['to lower', 'Set to lower value'], ['to upper', 'Set to upper value'],
];
export const PUSH_MODES = [['momentary', 'Momentary (key)'], ['toggle', 'Toggle']];

// What a cell's turn sends, in a few words: "CC 20 ch16", "CC 14-bit 1 ch16", "Note C3 ch16".
export function turnSummary(rec) {
  const e = decodeEncoder(rec);
  if (e.off) return 'off';
  const [t] = TURN_TYPES[e.type];
  const ch = `ch${e.channel + 1}`;
  if (e.type === 3 || e.type === 5 || e.type === 6) return `${t} ${ch}`;
  if (e.type === 7) return `${t} ${noteName(e.number)} ${ch}`;
  if (e.type === 8) return `${t} ${Math.min(e.numberHigh, 127)}:${e.number} ${ch}`;
  return `${t} ${e.number} ${ch}`;
}

// What a cell's push (or a key) sends: "Note C3 ch10", "CC 64 ch1 toggle", "Page 2". `key`: a key,
// whose push types that need an encoder read as off (as the firmware takes them).
export function pushSummary(rec, key = false) {
  const p = decodePush(rec, key);
  if (p.off) return 'off';
  const [t] = PUSH_TYPES[p.type];
  const ch = `ch${p.channel + 1}`;
  const toggle = p.mode ? ' toggle' : '';
  switch (p.type) {
    case 1: return `${t} ${noteName(p.number)} ${ch}${toggle}`;
    case 2: return `${t} ${p.number} ${ch}${toggle}`;
    case 3: return `${t} ${p.number} ${ch}`;
    case 4: case 5: return `${t} ${ch}`;
    case 6: return `${t} ${(p.channel & 3) + 1}`;
    default: return t;
  }
}

// A knob feel (an EC4 mode name) as the BCR32 tab shows it.
export const modeShort = (m) => MODES[m]?.[0] ?? m;
export const modeFull = (m) => MODES[m]?.[1] ?? m;
