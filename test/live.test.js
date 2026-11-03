// Tests for live editing: when a send goes out, the FH-2's own changes coming into your patch,
// another patch on the FH-2 stopping it, music playing holding it, and a send keeping what it
// sent when you edit meanwhile.

import { test, assert, eq } from './harness.js';
import { examplePatch } from '../js/patch/example.js';
import { DUMPS } from '../js/fh2/sysex.js';
import { diff } from '../js/fh2/layout.js';
import { dueIn, fromModule, anotherPatch, Transport, QUIET_MS, MAX_WAIT_MS } from '../js/fh2/live.js';
import { sendToFh2 } from '../js/ui/connect.js';
import { Fh2StandIn } from './standin.js';
import { buildDump } from '../js/fh2/sysex.js';

test('a send goes out a moment after the last edit, and at most a few seconds after the first', () => {
  eq(dueIn(1000, 1000, 1000), QUIET_MS);
  eq(dueIn(2500, 1000, 2500), QUIET_MS, 'another edit: wait again');
  eq(dueIn(5000, 1000, 5000), 1000 + MAX_WAIT_MS - 5000, 'editing on: no later than MAX_WAIT_MS after the first edit');
  eq(dueIn(9000, 1000, 1200), 0);
});

test('the FH-2’s own changes come into your patch; where you changed it too, yours wins', () => {
  const { config, preset } = examplePatch();
  const layout = DUMPS[preset.cmd].layout;
  const base = structuredClone(preset.values);
  const mine = structuredClone(base);
  const theirs = structuredClone(base);
  theirs.output[3].directLevel = 1234; // turned on the FH-2
  theirs.euclid[0].pulses = 5; // changed there and here
  mine.euclid[0].pulses = 7;
  mine.tempo = 1300; // only here
  eq(fromModule(layout, base, mine, theirs), [{ path: ['output', 3, 'directLevel'], value: 1234 }]);
  eq(fromModule(layout, base, mine, base), [], 'nothing changed there');
  const c = { config: config.values, preset: base };
  assert(!anotherPatch(c, { config: config.values, preset: theirs }), 'same names: the same patch');
  assert(anotherPatch(c, { config: config.values, preset: { ...theirs, name: 'Other' } }), 'another preset loaded there');
  assert(anotherPatch(c, { config: { ...config.values, name: 'Other' }, preset: theirs }), 'another config loaded there');
});

test('what the FH-2 held survives being kept in the browser', () => {
  const { config, preset } = examplePatch();
  for (const d of [config, preset]) eq(diff(DUMPS[d.cmd].layout, d.values, JSON.parse(JSON.stringify(d.values))).length, 0, d.kind);
});

test('music is playing while a clock runs, or between Start and Stop', () => {
  const t = new Transport();
  eq(t.playing(0), false);
  // Logic-like: clock only while playing, no transport messages seen
  for (let ms = 0; ms <= 2000; ms += 20) t.take('logic', 0xf8, ms);
  eq(t.playing(2100), true);
  eq(t.playing(3100), false, 'the clock stopped a second ago');
  // Elektron-like: clock all the time, Start and Stop for the transport
  const e = new Transport();
  e.take('rytm', 0xf8, 0);
  eq(e.playing(10), true, 'ticks from a source that never sent Start count as playing');
  e.take('rytm', 0xfa, 100);
  e.take('rytm', 0xf8, 120);
  eq(e.playing(130), true);
  e.take('rytm', 0xfc, 200);
  e.take('rytm', 0xf8, 220);
  eq(e.playing(230), false, 'stopped, though its clock goes on');
  e.take('rytm', 0xfb, 300);
  eq(e.playing(310), true, 'continue');
  eq(e.playing(300 + 6000), false, 'started, but no clock for seconds: unplugged');
  e.take('logic', 0xf8, 6400);
  eq(e.playing(6410), true, 'any input playing counts');
  e.drop('logic');
  eq(e.playing(6410), false);
});

// a MIDI port pair on the stand-in, as connect.js gets it from Web MIDI
function pairFor(fh2) {
  const input = { onmidimessage: null };
  const port = fh2.transport();
  port.onmessage = (bytes) => input.onmidimessage?.({ data: bytes });
  return { name: 'FH-2', in: input, out: { name: 'FH-2', send: (b) => port.send(b) } };
}

test('a send keeps what it sent when you edit meanwhile', async () => {
  const { config, preset } = examplePatch();
  const fh2 = new Fh2StandIn({ config: buildDump(config), preset: buildDump(preset) });
  const dump = structuredClone(preset);
  dump.values.tempo = 1111;
  const sending = sendToFh2(pairFor(fh2), { preset: dump });
  await new Promise((r) => setTimeout(r, 100));
  dump.values.tempo = 1222; // an edit while the FH-2 settles
  const r = await sending;
  eq(r.off.preset, [], 'what was sent came back');
  eq(r.sent.preset.tempo, 1111, 'the edit waits for the next send');
  eq(r.sent.config, undefined, 'only what was asked for');
});
