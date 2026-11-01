// Tests for derive(): the example patch from the mockups must come out as the mockups show
// it, and the converter output order must follow the manual.

import { test, assert, eq } from './harness.js';
import { derive } from '../js/patch/derive.js';
import { examplePatch } from '../js/patch/example.js';
import { blankConfig, blankPreset } from '../js/patch/blank.js';
import { jackName, internalName, rack, DEFAULT_HARDWARE } from '../js/patch/hardware.js';
import { buildDump, parseDump } from '../js/fh2/sysex.js';
import * as O from './official.js';

const text = (bytes) => new TextDecoder().decode(bytes);
const exampleView = () => {
  const { config, preset } = examplePatch();
  return derive(config.values, preset.values);
};
const portsOf = (view, id) => view.sources.find((s) => s.id === id).ports.map((p) => [p.name, p.jack]);

test('jacks are named after the modules in the rack', () => {
  const hw = DEFAULT_HARDWARE;
  eq([0, 7, 8, 13, 16, 64, 71, 72, 79].map((o) => jackName(o, hw)), ['1', '8', 'CV1·1', 'CV1·6', 'CV2·1', 'GT1·1', 'GT1·8', 'GT2·1', 'GT2·8']);
  eq([24, 63, 80, 127].map((o) => jackName(o, hw)), ['3/1', '7/8', 'GT1/1', 'GT3/16'], 'outputs outside the rack keep their internal names');
  eq(rack(hw).map((m) => `${m.name}=${m.internal}`), ['FH-2=1–8', 'CV1=1/1–8', 'CV2=2/1–8', 'GT1=GT0/1–8', 'GT2=GT0/9–16']);
  const chained = { ...hw, gt: [0, 2] }; // two FHX-8GTs, jumpered to addresses 0 and 1
  eq([64, 80].map((o) => jackName(o, chained)), ['GT1·1', 'GT2·1']);
  eq(internalName(75), 'GT0/12');
});

test('blank dumps decode as empty', () => {
  const v = derive(blankConfig().values, blankPreset().values);
  eq(v.sources.length, 0, 'sources');
  eq(v.problems, [], 'problems');
  eq(v.mappings.length, 0, 'mappings');
});

test('the example patch survives a trip through bytes', () => {
  const { config, preset } = examplePatch();
  const again = derive(parseDump(buildDump(config)).values, parseDump(buildDump(preset)).values);
  eq(again.sources.map((s) => s.id), exampleView().sources.map((s) => s.id));
});

test('example: voices come out where the mockup shows them', () => {
  const v = exampleView();
  eq(portsOf(v, 'converter:0'), [['Pitch', '1'], ['Gate', '2'], ['Velocity', '3'], ['Envelope', '4']], 'Lead');
  eq(portsOf(v, 'converter:1'), [['Pitch 1', 'CV1·6'], ['Pitch 2', 'CV1·7'], ['Pitch 3', 'CV1·8'], ['Gate 1', 'GT2·6'], ['Gate 2', 'GT2·7'], ['Gate 3', 'GT2·8']], 'Pad');
  eq(portsOf(v, 'converter:2'), [['Pitch', 'CV1·1'], ['Velocity', 'CV1·2'], ['Gate', 'GT1·1']], 'Bass');
  eq(v.sources.find((s) => s.id === 'converter:1').mode, 'poly');
});

test('example: timing, triggers, Euclid and random', () => {
  const v = exampleView();
  eq(portsOf(v, 'clocks'), [['Clock 1/16', 'GT1·7'], ['Run gate', 'GT1·8'], ['Clock 1 bar', 'GT2·1']], 'clocks');
  eq(portsOf(v, 'triggers:14').map((p) => p[1]), ['GT1·2', 'GT1·3', 'GT1·4', 'GT1·5', 'GT1·6'], 'drum triggers');
  eq(portsOf(v, 'triggers:14')[0][0], 'C2 (36)', 'kick note');
  eq(portsOf(v, 'euclid:0'), [['Pulses', 'GT2·2']], 'euclid');
  eq(v.sources.find((s) => s.id === 'euclid:0').pattern.pulses, 5);
  eq(portsOf(v, 'srr:0'), [['CV', 'CV1·5'], ['Change', 'GT2·4'], ['Trigger', 'GT2·5']], 'random');
});

test('example: LFOs, knobs and stored levels', () => {
  const v = exampleView();
  eq(portsOf(v, 'lfo:4'), [['LFO', '5']], 'wobble');
  eq(v.sources.find((s) => s.id === 'lfo:4').lfo.rate, '1 bar');
  eq(portsOf(v, 'lfo:5'), [['LFO', '6']], 'drift');
  assert(v.outputs[0].lfo && !v.outputs[0].lfo.alone, 'vibrato should be a layer on jack 1');
  eq(portsOf(v, 'knobs:1'), [['CC 12', 'CV2·1'], ['CC 13', 'CV2·2'], ['CC 14', 'CV2·3'], ['CC 15', 'CV2·4']], 'knobs');
  eq(portsOf(v, 'levels'), [['Level 12288', 'CV2·8']], 'stored level');
  eq(v.outputs[23].range, '±5 V');
});

test('example: players, controls and the channel map', () => {
  const v = exampleView();
  eq(v.sources.find((s) => s.id === 'converter:2').players.map((p) => p.name), ['Note sequencer 1'], 'bass is played by sequencer 1');
  eq(v.sources.find((s) => s.id === 'triggers:14').players.map((p) => p.name), ['Drum sequencer'], 'drums');
  eq(v.sources.find((s) => s.id === 'converter:0').players, [], 'lead is played from outside');
  eq(v.sources.find((s) => s.id === 'euclid:0').controls.map((m) => [m.channel, m.cc, m.target.param]), [[1, 16, 'pulses'], [1, 17, 'rotation']]);
  eq(v.sources.find((s) => s.id === 'lfo:4').controls.map((m) => m.target.param), ['lfoTempoMultiplier'], 'input X on the wobble');
  eq(v.outputs[0].controls.map((m) => [m.channel, m.cc, m.target.param]), [[0, 1, 'lfoLevel']], 'mod wheel on vibrato');
  eq(v.players.map((p) => p.id), ['noteSequencer:0', 'drumSequencer', 'cvMidi:0']);
  eq(v.channels[0].listeners.map((l) => l.name), ['Voice 1', 'Voice 2', 'CC 1']);
  eq(v.problems, [], 'problems');
  eq(v.resources.converters, [3, 16]);
  eq(v.resources.mappings, [11, 384]);
});

test('converter outputs follow the manual (poly, stride, shared, MPE, bend)', () => {
  const c = blankConfig().values;
  Object.assign(c.converter[0], { enable: 1, type: 1, voices: 2, baseOutput: 0, stride: 3, cvOut: 1, gateOut: 1,
    aftertouchOut: 1, paraGateOut: 1, bendOut: 2 });
  Object.assign(c.converter[1], { enable: 1, type: 2, voices: 2, channel: 1, lastMpeChannel: 4, baseOutput: 16, mpeYcc: 74,
    cvOut: 1, pressureOut: 1, triggerOut: 1, baseGate: 64 });
  const v = derive(c, null);
  eq(portsOf(v, 'converter:0').map((p) => p.join('@')),
    ['Pitch 1@1', 'Gate 1@2', 'Pitch 2@4', 'Gate 2@5', 'Aftertouch@7', 'Para gate@8', 'Bend up@CV1·1', 'Bend down@CV1·2'], 'poly with stride');
  eq(portsOf(v, 'converter:1').map((p) => p.join('@')),
    ['Pitch 1@CV2·1', 'Pressure 1@CV2·2', 'MPE Y 1@CV2·3', 'Pitch 2@CV2·4', 'Pressure 2@CV2·5', 'MPE Y 2@CV2·6', 'Trigger 1@GT1·1', 'Trigger 2@GT1·2'], 'MPE with gates on the expander');
  eq(v.sources.find((s) => s.id === 'converter:1').channels, [1, 2, 3, 4], 'MPE channels');
});

test('with a base gate, trigger-like outputs go to the gates and the CV-like ones close up', () => {
  const c = blankConfig().values;
  Object.assign(c.converter[0], { enable: 1, type: 1, voices: 2, baseOutput: 0, baseGate: 64, cvOut: 1, gateOut: 1,
    velocityOut: 1, triggerOut: 1, envelopeOut: 1, aftertouchOut: 1, paraGateOut: 1 });
  const v = derive(c, null);
  eq(portsOf(v, 'converter:0').map((p) => p.join('@')),
    ['Pitch 1@1', 'Velocity 1@2', 'Envelope 1@3', 'Pitch 2@4', 'Velocity 2@5', 'Envelope 2@6', 'Aftertouch@7',
      'Gate 1@GT1·1', 'Trigger 1@GT1·2', 'Gate 2@GT1·3', 'Trigger 2@GT1·4', 'Para gate@GT1·5']);
  eq(v.problems, [], 'problems');
});

test('collisions and gate-only outputs are reported', () => {
  const c = blankConfig().values;
  Object.assign(c.converter[0], { enable: 1, baseOutput: 0, cvOut: 1, gateOut: 1 });
  Object.assign(c.clock[0], { type: 1, base: 24, multiplier: 1, output: 1 });
  Object.assign(c.srr[0], { cvOutput: 65 + 1 });
  const v = derive(c, null);
  eq(v.problems.map((p) => p.kind), ['collision', 'gate-only']);
});

for (const seed of [1, 2]) {
  test(`derive copes with a random config (seed ${seed})`, async (load) => {
    const html = text(await load('test/official/fh2_config_tool.html'));
    const f = O.form(O.configRules, O.rng(seed));
    const msg = Uint8Array.from(O.officialEncoder(html, O.CONFIG_FUNCTIONS, f.getElementById)());
    const v = derive(parseDump(msg).values, null);
    assert(v.sources.length > 10 && v.outputs.length === 128, 'too few sources');
  });
}
