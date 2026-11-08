// Runs the encoders of Expert Sleepers' own config and preset tools (test/official/, MIT)
// against a stand-in `document` filled with random values, so the tests can check that our
// layouts decode every field to what the official tool wrote. The rules below say, for each
// control id the tools read, how to make a random value and where we expect it to land.

const TABLES = ['ac', 'acc', 'aco', 'arpControls', 'mcvCommands', 'mcvMappable2Controls', 'mcvMappable3Controls',
  'eucControls', 'srrControls', 'seqControls', 'dseqControls', 'dseqlControls'];

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`official tool: no function ${name}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`official tool: unbalanced ${name}`);
}

function extractTables(src) {
  return TABLES.map((t) => {
    const m = src.match(new RegExp(`var ${t} = (\\[[^\\]]*\\]);`));
    return m ? `var ${t} = ${m[1]};` : '';
  }).join('\n');
}

// Returns makeSysEx() of the tool in `html`, reading its controls through getElementById.
export function officialEncoder(html, functions, getElementById) {
  const code = extractTables(html) + '\n' + functions.map((n) => extractFunction(html, n)).join('\n') + '\nreturn makeSysEx;';
  // Sloppy mode on purpose: the tool's loops use undeclared variables.
  return new Function('document', 'log', code)({ getElementById }, () => {});
}

export const CONFIG_FUNCTIONS = ['sysexSafeShort', 'sysexSafeSignedChar', 'makeSysExMcv', 'makeSysExMappings',
  'makeSysExClocks', 'makeSysExTriggers', 'makeSysEx'];
export const PRESET_FUNCTIONS = ['makeSysEx'];

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = (lo, hi) => (r) => String(lo + Math.floor(r() * (hi - lo + 1)));
const CB = (r) => r() < 0.5;
const NAME = (r) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -';
  let s = '';
  for (let i = 0, n = 1 + Math.floor(r() * 16); i < n; i++) s += chars[Math.floor(r() * chars.length)];
  return s;
};
const num = (v) => (typeof v === 'boolean' ? Number(v) : Number(v));
const padName = (v) => (v + ' '.repeat(16)).slice(0, 16);
const trimName = (v) => padName(v).replace(/ +$/, ''); // what name16.read gives
const hi = (v) => (num(v) & 0x80 ? 1 : 0);

// A stand-in document: values are made on first read by the matching rule, and remembered.
export function form(rules, r) {
  const values = new Map();
  const getElementById = (id) => {
    if (!values.has(id)) {
      const rule = rules.find(([re]) => re.test(id));
      if (!rule) throw new Error(`no test rule for control "${id}"`);
      values.set(id, rule[1](r, id.match(rule[0])));
    }
    const v = values.get(id);
    return typeof v === 'boolean' ? { checked: v, value: v ? 'on' : 'off' } : { value: v, checked: false };
  };
  return { values, getElementById };
}

// [path, expected] pairs for every control that was read.
export function expectations(rules, values) {
  const out = [];
  for (const [id, v] of values) {
    const rule = rules.find(([re]) => re.test(id));
    if (rule[2]) out.push(...rule[2](id.match(rule[0]), v));
  }
  return out;
}

// ---------------------------------------------------------------- config

const MCV = {
  enable: [CB, 'enable'], ch: [R(1, 16), 'channel', -1], min: [R(0, 127), 'minNote'], max: [R(0, 127), 'maxNote'],
  type: [R(0, 2), 'type'], voices: [R(1, 16), 'voices'], bend: [R(0, 64), 'bendRange'], scheme: [R(0, 6), 'allocation'],
  stealing: [CB, 'noStealing'], GA: [CB, 'gatedAftertouch'], SUS: [R(0, 3), 'sustain'], base: [R(0, 63), 'baseOutput'],
  stride: [R(1, 32), 'stride'], lastMPE: [R(2, 16), 'lastMpeChannel', -1], A: [CB, 'aftertouchOut'], G: [CB, 'paraGateOut'],
  VC: [CB, 'cvOut'], VG: [CB, 'gateOut'], VVG: [CB, 'velGateOut'], VV: [R(0, 2), 'velocityOut'], VR: [R(0, 2), 'releaseVelocityOut'],
  VT: [CB, 'triggerOut'], VP: [CB, 'pressureOut'], VY: [R(0, 127), 'mpeYcc'], VE: [CB, 'envelopeOut'],
  basegate: [(r) => (r() < 0.3 ? '0' : R(64, 127)(r)), 'baseGate'], MT: [CB, 'monoRetrigger'], IG: [CB, 'interruptGate'],
  ZS: [CB, 'envZeroStart'], benddown: [R(0, 65), 'bendDown'], PB: [R(0, 2), 'bendOut'], VRND: [CB, 'randomOut'],
};
const CLK = { type: [R(0, 8), 'type'], base: [R(1, 96), 'base'], mult: [R(1, 127), 'multiplier'], len: [R(0, 127), 'length'],
  output: [R(0, 127), 'output'], shift: [R(0, 127), 'shift'] };
const DESTS = { int: 'toInternal', c: 'toUsbC', a: 'toUsbA', d: 'toDin', s: 'toSelect' };
const GLOBALS = {
  glb_triglen: [R(1, 100), 'triggerLength'], glb_transpose: [R(-48, 48), 'transpose'], glb_legvel: [CB, 'legatoVelocity'],
  glb_extclkmult: [R(1, 96), 'extClockMultiplier'], glb_extclkrun: [R(0, 1), 'extClockRunControl'],
  glb_presetprogch: [R(0, 16), 'presetProgramChannel'], glb_softtakeover: [CB, 'softTakeover'],
  glb_taptype: [R(0, 2), 'tapType'], glb_tapch: [R(0, 16), 'tapChannel'], glb_tapcc: [R(0, 127), 'tapNumber'],
  glb_eucaccent: [R(0, 127), 'euclidAccent'], glb_starttype: [R(0, 6), 'startStopType'],
  glb_startch: [R(0, 16), 'startStopChannel'], glb_startcc: [R(0, 127), 'startStopNumber'],
  glb_tempo_min: [R(0, 127), 'tempoMin'], glb_tempo_max: [R(0, 127), 'tempoMax'],
};
const MAPPABLE = '(arpeg\\d+_[A-Z]+|mcvcom\\d+_[A-Z]+|mcvm[23]_\\d+_[A-Z]+|euc_\\d+_[A-Z]+|srr_\\d+_[A-Z]+|seq\\d_[A-Z]+|dseq0_[A-Z]+|dseq0_\\d_[A-Z]+|glb_tempo|dispmode|dispitem|glb_swing_type|glb_swing_amount|nudgefaster|nudgeslower|inctempo|dectempo)';
const MAP_CH = (r) => (r() < 0.08 ? R(1, 16)(r) : '-1');

export const configRules = [
  [/^config_name$/, NAME, (m, v) => [[['name'], trimName(v)]]],
  [new RegExp(`^(${Object.keys(GLOBALS).join('|')})$`), (r, m) => GLOBALS[m[1]][0](r), (m, v) => [[[GLOBALS[m[1]][1]], num(v)]]],
  [/^rng_(\d+)$/, R(0, 4), (m, v) => [[['outputRange', m[1] - 1, 'value'], num(v)]]],
  [/^mcv_(\w+)_(\d+)$/, (r, m) => MCV[m[1]][0](r), (m, v) => [[['converter', m[2] - 1, MCV[m[1]][1]], num(v) + (MCV[m[1]][2] || 0)]]],
  [/^clk_(\d+)_(\w+)$/, (r, m) => CLK[m[2]][0](r), (m, v) => [[['clock', m[1] - 1, CLK[m[2]][1]], num(v)]]],
  [/^out_gt_(\d+)_(lo|hi)$/, R(0, 16383), (m, v) => [[['gateLevel', +m[1], m[2] === 'lo' ? 'low' : 'high'], num(v)]]],
  [/^trg_(\d+)_(type|ch|note|output|env)$/, (r, m) => ({ type: R(0, 10), ch: R(1, 16), note: R(-1, 127), output: R(0, 127), env: R(1, 16) })[m[2]](r),
    (m, v) => {
      const p = (k) => ['trigger', m[1] - 1, k];
      const n = num(v);
      switch (m[2]) {
        case 'type': return [[p('type'), n]];
        case 'ch': return [[p('channel'), n - 1]];
        case 'note': return [[p('anyNote'), n < 0 ? 1 : 0], [p('note'), n < 0 ? 0 : n]];
        case 'output': return [[p('output'), n]];
        case 'env': return [[p('envSetHigh'), (n - 1) >> 1], [p('envSetLow'), (n - 1) & 1]];
      }
    }],
  [/^euc_(off)?output_(\d+)$/, R(-1, 127), (m, v) => {
    const k = m[1] ? 'offOutput' : 'output';
    return [[['euclid', m[2] - 1, k], num(v) & 0x7f], [['euclid', m[2] - 1, k + 'High'], hi(v)]];
  }],
  [/^hid_(\d+)_(usage|output|scale|offset)$/, (r, m) => (m[2] === 'scale' || m[2] === 'offset' ? R(-8192, 8191) : R(0, 127))(r),
    (m, v) => [[['gamepad', m[1] - 1, m[2]], num(v)]]],
  [/^kbd_(\d+)_(type|output|key|value0|value1)$/, (r, m) => (m[2].startsWith('value') ? R(0, 16383) : m[2] === 'type' ? R(0, 2) : R(0, 127))(r),
    (m, v) => [[['keyboard', m[1] - 1, m[2]], num(v)]]],
  [/^lfotrig_(type|ch|cc)_(\d+)$/, (r, m) => ({ type: R(0, 7), ch: R(0, 15), cc: R(0, 127) })[m[1]](r),
    (m, v) => [[['lfoReset', m[2] - 1, { type: 'type', ch: 'channel', cc: 'number' }[m[1]]], num(v)]]],
  [/^cvm_(en|outI|outA|outC|outD|outS)_(\d)$/, CB, (m, v) => [[['cvMidi', +m[2], { en: 'enable', outI: 'toInternal', outA: 'toUsbA', outC: 'toUsbC', outD: 'toDin', outS: 'toSelect' }[m[1]]], num(v)]]],
  [/^cvm_(type|ch|cc|0v|5v)_(\d)$/, (r, m) => ({ type: R(0, 4), ch: R(1, 16), cc: R(0, 127), '0v': R(-8192, 8191), '5v': R(-8192, 8191) })[m[1]](r),
    (m, v) => [[['cvMidi', +m[2], { type: 'type', ch: 'channel', cc: 'number', '0v': 'level0v', '5v': 'level5v' }[m[1]]], num(v) - (m[1] === 'ch' ? 1 : 0)]]],
  [/^seqn_(\d)_(ch|clk|int|c|a|d|s)$/, (r, m) => (m[2] === 'ch' ? R(1, 16)(r) : m[2] === 'clk' ? R(0, 127)(r) : CB(r)),
    (m, v) => [[['noteSequencer', +m[1], m[2] === 'ch' ? 'channel' : m[2] === 'clk' ? 'clock' : DESTS[m[2]]], num(v) - (m[2] === 'ch' ? 1 : 0)]]],
  [/^seqd_0_(ch|int|c|a|d|s)$/, (r, m) => (m[1] === 'ch' ? R(1, 16)(r) : CB(r)),
    (m, v) => [[['drumSequencer', 0, m[1] === 'ch' ? 'channel' : DESTS[m[1]]], num(v) - (m[1] === 'ch' ? 1 : 0)]]],
  [/^seqd_0_n_(\d)$/, R(0, 127), (m, v) => [[['drumSequencer', 0, 'laneNote', +m[1], 'value'], num(v)]]],
  [/^arp_(\d+)_clk$/, R(0, 127), (m, v) => [[['converter', m[1] - 1, 'arpClock'], num(v)]]],
  [/^arp_out_(\d+)_(ch|c|a|d)$/, (r, m) => (m[2] === 'ch' ? R(1, 16)(r) : CB(r)),
    (m, v) => [[['converter', m[1] - 1, { ch: 'arpChannel', c: 'arpToUsbC', a: 'arpToUsbA', d: 'arpToDin' }[m[2]]], num(v) - (m[2] === 'ch' ? 1 : 0)]]],
  [/^srr_output_(\d+)$/, R(-1, 63), (m, v) => [[['srr', m[1] - 1, 'cvOutput'], num(v) + 1]]],
  [/^srr_(change|trigger)_(\d+)$/, R(-1, 127), (m, v) => [[['srr', m[2] - 1, m[1] + 'Output'], num(v) & 0x7f], [['srr', m[2] - 1, m[1] + 'OutputHigh'], hi(v)]]],
  [/^srr_clk_(\d+)$/, R(0, 127), (m, v) => [[['srr', m[1] - 1, 'clock'], num(v)]]],
  [/^srr_nch_(\d+)$/, R(-1, 16), (m, v) => [[['srr', m[1] - 1, 'notesChannel'], Math.max(num(v), 0)]]],
  [/^srr_ch_(\d+)$/, R(1, 16), (m, v) => [[['srr', m[1] - 1, 'channel'], num(v) - 1]]],
  [/^srr_(int|c|a|d|s)_(\d+)$/, CB, (m, v) => [[['srr', m[2] - 1, DESTS[m[1]]], num(v)]]],
  // CC mappings: checked as a whole by mappingExpectations()
  [/^out_[A-Z]+_ch_\d+$/, MAP_CH],
  [/^out_[A-Z]+_cc_\d+$/, R(0, 127)],
  [/^out_[A-Z]+_cc_\d+_rel$/, CB],
  [new RegExp(`^${MAPPABLE}_ch$`), MAP_CH],
  [new RegExp(`^${MAPPABLE}_cc$`), R(0, 127)],
  [new RegExp(`^${MAPPABLE}_cc_rel$`), CB],
];

// The used mapping slots the official tool should have written, as sorted "status:cc:target:index".
export function mappingExpectations(values, html) {
  const T = new Function(extractTables(html) + `\nreturn { ${TABLES.join(', ')} };`)();
  const GLOBAL_TARGET = { glb_tempo: 69, dispmode: 71, dispitem: 72, glb_swing_type: 74, glb_swing_amount: 75,
    nudgefaster: 76, nudgeslower: 77, inctempo: 78, dectempo: 79 };
  const out = [];
  for (const [id, v] of values) {
    let base, ccId, m;
    if ((m = id.match(/^out_([A-Z]+)_ch_(\d+)$/))) {
      base = null;
      ccId = `out_${m[1]}_cc_${m[2]}`;
    } else if ((m = id.match(new RegExp(`^${MAPPABLE}_ch$`)))) {
      base = m[1];
      ccId = `${base}_cc`;
    } else continue;
    if (num(v) < 0) continue;
    const cc = num(values.get(ccId));
    const rel = values.get(ccId + '_rel') ? 32 : 0;
    let target, index, k;
    if (base === null) {
      const j = T.ac.indexOf(m[1]);
      target = T.acc[j] + rel;
      index = +m[2] + T.aco[j];
    } else if ((k = base.match(/^arpeg(\d+)_(\w+)$/))) [target, index] = [9 + rel, (k[1] - 1) * 8 + T.arpControls.indexOf(k[2])];
    else if ((k = base.match(/^mcvcom(\d+)_(\w+)$/))) [target, index] = [11 + rel, (k[1] - 1) * 8 + T.mcvCommands.indexOf(k[2])];
    else if ((k = base.match(/^mcvm2_(\d+)_(\w+)$/))) [target, index] = [12 + rel, (k[1] - 1) * 8 + T.mcvMappable2Controls.indexOf(k[2])];
    else if ((k = base.match(/^mcvm3_(\d+)_(\w+)$/))) [target, index] = [16 + rel, (k[1] - 1) * 8 + T.mcvMappable3Controls.indexOf(k[2])];
    else if ((k = base.match(/^euc_(\d+)_(\w+)$/))) [target, index] = [10 + rel, (k[1] - 1) * 8 + T.eucControls.indexOf(k[2])];
    else if ((k = base.match(/^srr_(\d+)_(\w+)$/))) [target, index] = [15 + rel, (k[1] - 1) * 8 + T.srrControls.indexOf(k[2])];
    else if ((k = base.match(/^seq(\d)_(\w+)$/))) [target, index] = [13 + rel, +k[1] * 16 + T.seqControls.indexOf(k[2])];
    else if ((k = base.match(/^dseq0_([A-Z]+)$/))) [target, index] = [13 + rel, 4 * 16 + T.dseqControls.indexOf(k[1])];
    else if ((k = base.match(/^dseq0_(\d)_(\w+)$/))) [target, index] = [14 + rel, +k[1] * 16 + T.dseqlControls.indexOf(k[2])];
    else [target, index] = [GLOBAL_TARGET[base] + (GLOBAL_TARGET[base] < 76 ? rel : 0), 0];
    out.push(`${0x30 | (num(v) - 1)}:${cc}:${target}:${index}`);
  }
  return out.sort();
}

// ---------------------------------------------------------------- preset

const LFO = { MLT: ['lfoLevel', R(0, 16383)], LFO: ['lfoSpeed', R(0, 16383)], CLK: ['lfoTempoBase'], CLKM: ['lfoTempoMultiplier'],
  SIN: ['lfoSine'], SQR: ['lfoSquare'], TRI: ['lfoTriangle'], PW: ['lfoPulseWidth'], SAW: ['lfoSaw'], RND: ['lfoRandom'],
  NSE: ['lfoNoise'], FAD: ['lfoFade'], MUS: ['lfoSynced', CB], PHS: ['lfoPhase'] };
const ARP = { M: 'arpMode', R: 'arpRange', G: 'arpGate', L: 'arpLatch', T: 'arpRate', P: 'portamento', S: 'arpReset', E: 'transpose' };
const EUC = { P: 'pulses', S: 'steps', R: 'rotation', T: 'rate', G: 'gate', A: 'accent', E: 'reset' };
const ENV = { A: 'envAttack', D: 'envDecay', S: 'envSustain', R: 'envRelease', N: 'envRange', P: 'envDepth', V: 'envVelocityDepth', RND: 'randomDepth' };
const SEQ = { A: 'start', E: 'end', T: 'rate', G: 'gateLength', S: 'reset', N: 'rootNote', D: 'direction', P: 'permutation' };
const LANE = { A: 'start', E: 'end', T: 'rate', S: 'reset' };
const SRR = { D: 'direction', L: 'length', R: 'randomness', T: 'rate', A: 'attenuator', S: 'scale', K: 'key', G: 'gateLength' };
const SHAPE = { AS: 'envAttackShape', DS: 'envDecayShape', RS: 'envReleaseShape' };

export const presetRules = [
  [/^config_name$/, NAME, (m, v) => [[['name'], trimName(v)]]],
  [/^swing_(type|amount)$/, R(0, 10), (m, v) => [[[m[1] === 'type' ? 'swingType' : 'swingAmount'], num(v)]]],
  [/^swing_pos([123])$/, R(0, 127), (m, v) => [[['swingPosition' + m[1]], num(v)]]],
  [/^tempo$/, (r) => (R(200, 3000)(r) / 10).toFixed(1), (m, v) => [[['tempo'], Math.round(num(v) * 10)]]],
  [/^out_(\d+)_DC$/, R(0, 16383), (m, v) => [[['output', +m[1], 'directLevel'], num(v)]]],
  [/^out_(\d+)_SMO$/, R(0, 127), (m, v) => [[['output', +m[1], 'smoothing'], num(v)]]],
  [/^out_(\d+)_([A-Z]+)$/, (r, m) => (LFO[m[2]][1] || R(0, 127))(r), (m, v) => [[['output', +m[1], LFO[m[2]][0]], num(v)]]],
  [/^arpeg(\d+)_([A-Z])$/, R(0, 127), (m, v) => [[['converter', +m[1], ARP[m[2]]], num(v)]]],
  [/^euc_(\d+)_([A-Z])$/, R(0, 127), (m, v) => [[['euclid', +m[1], EUC[m[2]]], num(v)]]],
  [/^mcvm2_(\d+)_([A-Z]+)$/, R(0, 127), (m, v) => [[['converter', +m[1], ENV[m[2]]], num(v)]]],
  [/^mcvm3_(\d+)_([A-Z]+)$/, R(0, 127), (m, v) => [[['converter', +m[1], SHAPE[m[2]]], num(v)]]],
  [/^scala_(\d+)_(enable|scl|kbm)$/, (r, m) => (m[2] === 'enable' ? R(0, 2) : R(0, 31))(r),
    (m, v) => [[['converter', +m[1], { enable: 'scalaEnable', scl: 'scalaScl', kbm: 'scalaKbm' }[m[2]]], num(v)]]],
  [/^seq_(\d)_(active|mute)$/, CB, (m, v) => [[[(m[2] === 'active' ? 'noteSequencerActive' : 'noteSequencerMute') + m[1]], num(v)]]],
  [/^dseq_0_(active|mute)$/, CB, (m, v) => [[[m[1] === 'active' ? 'drumSequencerActive' : 'drumSequencerMute'], num(v)]]],
  [/^seq_(\d)_(\d+)_[0-7]$/, R(0, 3)], // gates: see stepGateExpectations()
  [/^seq_(\d)_(\d+)_(degree|octave|length|ratchet|reset|skip|mute)$/,
    (r, m) => ({ degree: R(0, 15), octave: R(0, 7), length: R(0, 7), mute: R(0, 7) })[m[3]]?.(r) ?? CB(r),
    (m, v) => [[['noteSequencer', +m[1], 'step', +m[2], m[3]], num(v)]]],
  [/^seq_(\d)_([A-Z])$/, R(0, 127), (m, v) => [[['noteSequencer', +m[1], SEQ[m[2]]], num(v)]]],
  [/^dseq[ha]0_(\d)_(\d+)$/, CB], // hits and accents: see drumExpectations()
  [/^dseq0_(\d)_([AETS])$/, R(0, 127), (m, v) => [[['drumSequencer', 0, 'lane', +m[1], LANE[m[2]]], num(v)]]],
  [/^dseq0_(\d)_M$/, CB, (m, v) => [[['drumSequencer', 0, 'lane', +m[1], 'mute'], num(v)]]],
  [/^dseq0_S$/, R(0, 127), (m, v) => [[['drumSequencer', 0, 'reset'], num(v)]]],
  [/^srr_(\d+)_([A-Z])$/, R(0, 127), (m, v) => [[['srr', +m[1], SRR[m[2]]], num(v)]]],
  [/^trig_(\d+)$/, CB, (m, v) => [[['triggerState', m[1] >> 2, 'bit' + (m[1] & 3)], num(v)]]],
];

// Expectations that combine several controls into one stored value.
export function presetCombinedExpectations(values) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 32; j++) {
      let g = 0;
      for (let k = 0; k < 8; k++) g |= (num(values.get(`seq_${i}_${j}_${k}`)) & 3) << (2 * k);
      out.push([['noteSequencer', i, 'step', j, 'gatesLow'], g & 0x3fff], [['noteSequencer', i, 'step', j, 'gatesHigh'], (g >> 14) & 3]);
    }
  }
  for (let j = 0; j < 8; j++) {
    for (const [kind, low, high] of [['h', 'hitsLow', 'hitsHigh'], ['a', 'accentsLow', 'accentsHigh']]) {
      for (let m = 0; m < 4; m++) {
        let lo = 0;
        let hi4 = 0;
        for (let n = 0; n < 4; n++) {
          lo |= num(values.get(`dseq${kind}0_${j}_${m * 8 + n}`)) << n;
          hi4 |= num(values.get(`dseq${kind}0_${j}_${m * 8 + 4 + n}`)) << n;
        }
        out.push([['drumSequencer', 0, 'lane', j, low, m, 'value'], lo], [['drumSequencer', 0, 'lane', j, high, m, 'value'], hi4]);
      }
    }
  }
  return out;
}
