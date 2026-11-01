// Tests for derive(): the example patch from the mockups must come out as the mockups show
// it, and the converter output order must follow the manual.

import { test, assert, eq } from './harness.js';
import { derive } from '../js/patch/derive.js';
import { examplePatch } from '../js/patch/example.js';
import { blankConfig, blankPreset } from '../js/patch/blank.js';
import { jackName, rack, DEFAULT_HARDWARE } from '../js/patch/hardware.js';
import { buildDump, parseDump } from '../js/fh2/sysex.js';
import * as O from './official.js';

const text = (bytes) => new TextDecoder().decode(bytes);
const exampleView = () => {
  const { config, preset } = examplePatch();
  return derive(config.values, preset.values);
};
const portsOf = (view, id) => view.sources.find((s) => s.id === id).ports.map((p) => [p.name, p.jack]);

test('jack names follow the expander addresses', () => {
  eq([0, 7, 8, 13, 63, 64, 71, 72, 85, 127].map(jackName), ['1', '8', 'C1·1', 'C1·6', 'C7·8', 'G0·1', 'G0·8', 'G0·9', 'G1·6', 'G3·16']);
  eq(rack(DEFAULT_HARDWARE).map((m) => m.tag), ['FH-2', 'C1', 'C2', 'G0', 'G1']);
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
  eq(portsOf(v, 'converter:1'), [['Pitch 1', 'C1·6'], ['Pitch 2', 'C1·7'], ['Pitch 3', 'C1·8'], ['Gate 1', 'G1·6'], ['Gate 2', 'G1·7'], ['Gate 3', 'G1·8']], 'Pad');
  eq(portsOf(v, 'converter:2'), [['Pitch', 'C1·1'], ['Velocity', 'C1·2'], ['Gate', 'G0·1']], 'Bass');
  eq(v.sources.find((s) => s.id === 'converter:1').mode, 'poly');
});

test('example: timing, triggers, Euclid and random', () => {
  const v = exampleView();
  eq(portsOf(v, 'clocks'), [['Clock 1/16', 'G0·7'], ['Run gate', 'G0·8'], ['Clock 1 bar', 'G1·1']], 'clocks');
  eq(portsOf(v, 'triggers:14').map((p) => p[1]), ['G0·2', 'G0·3', 'G0·4', 'G0·5', 'G0·6'], 'drum triggers');
  eq(portsOf(v, 'triggers:14')[0][0], 'C2 (36)', 'kick note');
  eq(portsOf(v, 'euclid:0'), [['Pulses', 'G1·2']], 'euclid');
  eq(v.sources.find((s) => s.id === 'euclid:0').pattern.pulses, 5);
  eq(portsOf(v, 'srr:0'), [['CV', 'C1·5'], ['Change', 'G1·4'], ['Trigger', 'G1·5']], 'random');
});

test('example: LFOs, knobs and stored levels', () => {
  const v = exampleView();
  eq(portsOf(v, 'lfo:4'), [['LFO', '5']], 'wobble');
  eq(v.sources.find((s) => s.id === 'lfo:4').lfo.rate, '1 bar');
  eq(portsOf(v, 'lfo:5'), [['LFO', '6']], 'drift');
  assert(v.outputs[0].lfo && !v.outputs[0].lfo.alone, 'vibrato should be a layer on jack 1');
  eq(portsOf(v, 'knobs:1'), [['CC 12', 'C2·1'], ['CC 13', 'C2·2'], ['CC 14', 'C2·3'], ['CC 15', 'C2·4']], 'knobs');
  eq(portsOf(v, 'levels'), [['Level 12288', 'C2·8']], 'stored level');
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
    ['Pitch 1@1', 'Gate 1@2', 'Pitch 2@4', 'Gate 2@5', 'Aftertouch@7', 'Para gate@8', 'Bend up@C1·1', 'Bend down@C1·2'], 'poly with stride');
  eq(portsOf(v, 'converter:1').map((p) => p.join('@')),
    ['Pitch 1@C2·1', 'Pressure 1@C2·2', 'MPE Y 1@C2·3', 'Pitch 2@C2·4', 'Pressure 2@C2·5', 'MPE Y 2@C2·6', 'Trigger 1@G0·1', 'Trigger 2@G0·2'], 'MPE with gates on the expander');
  eq(v.sources.find((s) => s.id === 'converter:1').channels, [1, 2, 3, 4], 'MPE channels');
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
