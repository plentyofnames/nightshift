// Names for the FH-2's stored values, as Expert Sleepers' config tool and manual use them.

export const RANGES = ['0–10 V', '±5 V', '0–1 V', '0–5 V', '0–8 V'];
export const RANGE_VOLTS = [[0, 10], [-5, 5], [0, 1], [0, 5], [0, 8]];

// A 14-bit DAC code (direct level, gate levels) as volts in an output's range, and back.
// Linear over the range; the module's calibration may shift it slightly.
export function levelToVolts(level, range) {
  const [lo, hi] = RANGE_VOLTS[range] ?? RANGE_VOLTS[0];
  return lo + (level / 16383) * (hi - lo);
}
export function voltsToLevel(volts, range) {
  const [lo, hi] = RANGE_VOLTS[range] ?? RANGE_VOLTS[0];
  return Math.max(0, Math.min(16383, Math.round(((volts - lo) / (hi - lo)) * 16383)));
}
export const CONVERTER_TYPES = ['mono', 'poly', 'MPE'];
export const ALLOCATIONS = ['Round robin', 'Lowest voice', 'Unison', 'Unison 2', 'Note range', 'Alternating', 'Random'];
export const SUSTAIN = ['Off', 'Sustain', 'Sostenuto', 'Sustain + sostenuto'];
export const CLOCK_TYPES = ['', 'Clock', 'Run gate', 'Stop gate', 'Start/continue pulse', 'Stop pulse',
  'Start/continue/stop pulse', 'Start pulse', 'Start/stop pulse'];
export const TRIGGER_TYPES = ['', 'Trigger', 'Gate', 'Velocity trigger', 'Velocity gate', 'Accent trigger', 'Accent gate',
  'Toggle', 'On/off trigger', 'Envelope', 'Velocity'];
export const ACCENT_TRIGGER_TYPES = new Set([5, 6]);
// Arpeggiator modes: the preset value is a range (manual, "Arpeggiators"); these are their starts.
export const ARP_MODES = [[0, 'Off'], [11, 'Up'], [22, 'Down'], [32, 'Alt'], [43, 'Alt 2'], [54, 'Step up'], [64, 'Step down'],
  [75, 'Step play'], [86, 'Random'], [96, 'Random 2'], [107, 'Random 3'], [118, 'As played']];
export const arpModeOf = (v) => ARP_MODES.filter(([start]) => start <= v).at(-1);
export const LFO_RESET_TYPES = ['', 'CC', 'Note', 'Any note', 'Paraphonic gate', 'Poly voice', 'Clock', 'Euclid'];
export const CVMIDI_TYPES = ['CC', 'Trigger', 'Note', 'Program change', 'Aftertouch'];
export const TAP_TYPES = ['', 'Note', 'CC'];
export const START_STOP_TYPES = ['', 'Note toggle', 'CC toggle', 'Note gate', 'CC gate', 'Y toggle', 'Y gate'];

// USB gamepad usages and keyboard keys, as the official tool names them (HID usage codes).
const GAMEPAD_AXES = { 20: 'X', 21: 'Y', 22: 'Z', 23: 'Rx', 24: 'Ry', 25: 'Rz', 26: 'Slider', 27: 'Dial', 28: 'Wheel',
  29: 'Hat', 30: 'Hat up', 31: 'Hat down', 32: 'Hat left', 33: 'Hat right' };
export const gamepadUsage = (u) => GAMEPAD_AXES[u] ?? (u >= 1 && u <= 19 ? `Button ${u}` : `usage ${u}`);
const KEYS = { 40: 'Return', 41: 'Escape', 42: 'Delete', 43: 'Tab', 44: 'Space', 79: 'Right', 80: 'Left', 81: 'Down', 82: 'Up' };
export function keyName(k) {
  if (k >= 4 && k <= 29) return String.fromCharCode(61 + k); // A–Z
  if (k >= 30 && k <= 39) return String((k - 29) % 10); // 1–9, 0
  if (k >= 58 && k <= 69) return `F${k - 57}`;
  return KEYS[k] ?? `key ${k}`;
}

// Mapping targets, as encoded in the config's mapping slots (see mappings.js).
export const OUTPUT_TARGETS_LOW = ['directLevel', 'lfoSpeed', 'lfoLevel', 'lfoSine', 'lfoSquare', 'lfoTriangle', 'lfoPulseWidth', 'lfoTempoBase', 'lfoTempoMultiplier'];
export const OUTPUT_TARGETS_HIGH = { 3: 'lfoSaw', 4: 'lfoRandom', 5: 'lfoNoise', 6: 'smoothing', 7: 'lfoPhase', 8: 'lfoFade' };
export const ARP_PARAMS = ['arpMode', 'arpRange', 'arpGate', 'arpLatch', 'arpRate', 'portamento', 'arpReset', 'transpose'];
export const COMMANDS = ['arpAdd', 'arpRemove', 'arpRest', 'arpTruncate', 'arpTranspose', 'arpTransposeInKey', 'arpSetRoot'];
export const ENV_PARAMS = ['envAttack', 'envDecay', 'envSustain', 'envRelease', 'envRange', 'envDepth', 'envVelocityDepth', 'randomDepth'];
export const SHAPE_PARAMS = ['envAttackShape', 'envDecayShape', 'envReleaseShape'];
export const EUCLID_PARAMS = ['pulses', 'steps', 'rotation', 'rate', 'gate', 'accent', 'reset'];
export const SRR_PARAMS = ['direction', 'length', 'randomness', 'rate', 'attenuator', 'scale', 'key', 'gateLength'];
export const SEQ_PARAMS = ['rate', 'reset', 'gateLength', 'position'];
export const DRUM_PARAMS = ['reset', 'position'];
export const LANE_PARAMS = ['rate', 'reset', 'position'];
export const GLOBAL_TARGETS = { 69: 'tempo', 71: 'displayMode', 72: 'displayItem', 74: 'swingType', 75: 'swingAmount',
  76: 'nudgeFaster', 77: 'nudgeSlower', 78: 'tempoUp', 79: 'tempoDown' };

// Readable names for parameter keys, used in labels.
export const PARAM_NAMES = {
  directLevel: 'level', lfoSpeed: 'LFO rate', lfoLevel: 'LFO depth', lfoSine: 'LFO sine', lfoSquare: 'LFO square',
  lfoTriangle: 'LFO triangle', lfoPulseWidth: 'LFO pulse width', lfoTempoBase: 'LFO synced rate', lfoTempoMultiplier: 'LFO rate multiplier',
  lfoSaw: 'LFO saw', lfoRandom: 'LFO random', lfoNoise: 'LFO noise', smoothing: 'smoothing', lfoPhase: 'LFO phase', lfoFade: 'LFO fade',
  arpMode: 'arp mode', arpRange: 'arp range', arpGate: 'arp gate', arpLatch: 'arp latch', arpRate: 'arp rate', portamento: 'glide',
  arpReset: 'arp reset', transpose: 'transpose', arpAdd: 'arp add', arpRemove: 'arp remove', arpRest: 'arp rest',
  arpTruncate: 'arp truncate', arpTranspose: 'arp transpose', arpTransposeInKey: 'arp transpose in key', arpSetRoot: 'arp set root',
  envAttack: 'attack', envDecay: 'decay', envSustain: 'sustain', envRelease: 'release', envRange: 'envelope range',
  envDepth: 'envelope depth', envVelocityDepth: 'velocity depth', randomDepth: 'random depth', envAttackShape: 'attack shape',
  envDecayShape: 'decay shape', envReleaseShape: 'release shape', pulses: 'pulses', steps: 'steps', rotation: 'rotation',
  rate: 'rate', gate: 'gate', accent: 'accent', reset: 'reset', direction: 'direction', length: 'length', randomness: 'randomness',
  attenuator: 'attenuator', scale: 'scale', key: 'key', gateLength: 'gate length', position: 'position', tempo: 'tempo',
  displayMode: 'display mode', displayItem: 'display item', swingType: 'swing type', swingAmount: 'swing amount',
  nudgeFaster: 'nudge faster', nudgeSlower: 'nudge slower', tempoUp: 'tempo +0.1', tempoDown: 'tempo −0.1',
};

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`; // 60 = C4

// A duration in 24 ppqn pulses, as a musical value where there is one.
const DURATIONS = { 3: '1/32', 4: '1/16T', 6: '1/16', 8: '1/8T', 9: '1/16.', 12: '1/8', 16: '1/4T', 18: '1/8.', 24: '1/4',
  32: '1/2T', 36: '1/4.', 48: '1/2', 72: '1/2.', 96: '1 bar', 192: '2 bars', 384: '4 bars' };
export const durationName = (pulses) => DURATIONS[pulses] || `${pulses}/24 beat`;

// The manual: LFO speed runs from 0.1 Hz to 10 Hz on a logarithmic scale over the 14-bit value.
// The exact curve is not documented, so this is an approximation.
export const lfoHz = (v) => 0.1 * Math.pow(100, v / 16383);
export const hzToLfo = (hz) => Math.max(0, Math.min(16383, Math.round((16383 * Math.log(hz / 0.1)) / Math.log(100))));

// Note values a clock, a Euclid pattern or a synced LFO can run at, in 24 ppqn pulses.
export const DIVISIONS = [[96, '1/1'], [48, '1/2'], [24, '1/4'], [16, '1/4T'], [12, '1/8'], [8, '1/8T'], [6, '1/16'],
  [4, '1/16T'], [3, '1/32'], [2, '1/32T'], [1, '24 ppqn']];
