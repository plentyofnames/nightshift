// How the EC4's knobs feel (js/ec4/feel.js): the same sweep for every 7-bit setting, a limit per
// value for the ones with few values, gentler 14-bit knobs, and your own choice per knob.

import { test, assert, eq } from './harness.js';
import { derive } from '../js/patch/derive.js';
import { examplePatch } from '../js/patch/example.js';
import { apply } from '../js/patch/edit.js';
import { pagesOf, wholePage, settingKey, SETUP } from '../js/ec4/pages.js';
import { defaultFeel, feelOf, speedChange, feelChange, sweepOf, MODE_NAMES } from '../js/ec4/feel.js';
import { setupImage, encoderOf } from '../js/ec4/setup.js';
import * as M from '../vendor/lilypad/js/model.js';

const key = (kind, index, param) => settingKey({ kind, index, param });

test('defaults: the same full sweep for 7-bit settings, few-valued ones not crawling, 14-bit accelerated', () => {
  const at = (k, bits, speed) => defaultFeel(k, bits, speed);
  const attack = key('converter', 0, 'envAttack'); // 0–127
  const pulses = key('euclid', 0, 'pulses'); // 33 bands
  const scale = key('srr', 0, 'scale'); // 19 bands
  const range = key('converter', 0, 'arpRange'); // 3 bands
  const latch = key('converter', 0, 'arpLatch'); // 2
  const level = key('output', 3, 'directLevel');
  eq([attack, pulses, scale, range, latch].map((k) => at(k, 7, 'medium')), ['Div2', 'Div2', 'Div2', 'LSp4', 'LSp4']);
  eq([attack, pulses, scale, range].map((k) => at(k, 7, 'slow')), ['Div4', 'Div4', 'Div2', 'LSp4'], 'slow: longer sweeps, still at most ~4 detents a value');
  eq([attack, pulses, range].map((k) => at(k, 7, 'fast')), ['Acc1', 'Acc1', 'LSp4'], 'fast: accelerated as before');
  eq([at(level, 14, 'medium'), at(level, 14, 'fast')], ['Acc1', 'Acc2']);
  eq([sweepOf('Div2'), sweepOf('Div4'), sweepOf('Acc1')], [256, 512, null]);
});

test('your speed and your choice per knob go into the knob’s mode on the EC4', () => {
  const { config, preset } = examplePatch();
  const p = { config, preset, names: {} };
  const view = () => derive(p.config.values, p.preset.values, undefined, p.names);
  const model = () => pagesOf(view(), p.names);
  apply(p, wholePage(p.config.values, view(), p.names, model(), 'euclid:0').changes);
  const modeOf = (k) => {
    const m = model();
    const g = m.pages.findIndex((pg) => pg.cells.some((c) => c?.key === k));
    const i = m.pages[g].cells.findIndex((c) => c?.key === k);
    const img = setupImage(new Uint8Array(65536), m.pages, view(), m.channel, { format: 2 });
    return MODE_NAMES[M.readEncoder(img, SETUP, g, i).mode];
  };
  const pulses = key('euclid', 0, 'pulses');
  eq(modeOf(pulses), 'Div2');
  apply(p, [speedChange('slow')]);
  eq(modeOf(pulses), 'Div4');
  apply(p, [feelChange(pulses, 'LSp2')]);
  eq([modeOf(pulses), feelOf(p.names, pulses, 7), model().pages[0].cells[0].feelMine], ['LSp2', 'LSp2', true]);
  apply(p, [feelChange(pulses, null), speedChange('medium')]);
  eq([modeOf(pulses), p.names['ec4:speed'] ?? null], ['Div2', null], 'back to the default, and medium needs no note');
  // a relative knob keeps its own mode
  eq(encoderOf({ map: { relative: true, channel: 0, cc: 20 }, short: 'X', setting: { param: 'pulses' } }, view(), 1).mode, 4);
});
