// Core tests: the byte layouts against Expert Sleepers' own encoders, dump round trips, and
// the client against a stand-in FH-2. To also check dumps from your own FH-2, put them in test/local/
// (tools/fh2dump.py writes config.syx and preset.syx there).

import { u7, s7, u14, s14, u28, name16, bits, decode, encode, getPath } from '../js/fh2/layout.js';
import { config, CONFIG_VERSION, BODY_SIZE } from '../js/fh2/config.js';
import { preset, PRESET_VERSION } from '../js/fh2/preset.js';
import { CMD, parseDump, buildDump, bodyOf, message } from '../js/fh2/sysex.js';
import { Fh2, TimeoutError } from '../js/fh2/client.js';
import { Fh2StandIn } from './standin.js';
import * as O from './official.js';
import { test, assert, eqBytes } from './harness.js';

const text = (bytes) => new TextDecoder().decode(bytes);

// ---------------------------------------------------------------- field types

test('field types write what they read', () => {
  const b = new Uint8Array(4);
  const cases = [[u7, [0, 1, 64, 127]], [s7, [-64, -1, 0, 63]], [u14, [0, 1, 128, 8191, 16383]],
    [s14, [-8192, -1, 0, 8191]], [u28, [0, 1200, 3000, 2 ** 28 - 1]], [bits(4, 3), [0, 5, 7]]];
  for (const [t, vs] of cases) {
    for (const v of vs) {
      t.write(b, 0, v);
      assert(t.read(b, 0) === v, `${v} came back as ${t.read(b, 0)}`);
      assert(b.every((x) => x < 0x80), 'a byte has bit 7 set');
    }
  }
  const nb = new Uint8Array(17);
  name16.write(nb, 0, 'Live set');
  assert(name16.read(nb, 0) === 'Live set' && nb[8] === 0x20 && nb[15] === 0x20 && nb[16] === 0, 'name: padded in the bytes, trimmed when read');
});

test('bit fields leave the rest of their byte alone', () => {
  const b = Uint8Array.of(0b0101010);
  bits(4, 1).write(b, 0, 1);
  assert(b[0] === 0b0111010, `got ${b[0].toString(2)}`);
  bits(0, 4).write(b, 0, 0);
  assert(b[0] === 0b0110000, `got ${b[0].toString(2)}`);
});

test('layouts fit the dumps, and only bit fields share a byte', () => {
  for (const [name, layout, addendum] of [['config', config, 48], ['preset', preset, 340]]) {
    const body = Math.max(...layout.fields.filter((f) => f.offset < BODY_SIZE).map((f) => f.offset + f.type.size));
    assert(body <= BODY_SIZE, `${name}: body fields run to ${body}`);
    assert(layout.size === BODY_SIZE + addendum, `${name}: layout is ${layout.size} bytes`);
    const seen = new Map();
    for (const f of layout.fields) {
      for (let i = 0; i < f.type.size; i++) {
        const prev = seen.get(f.offset + i);
        if (prev && !(prev.type.bit && f.type.bit)) throw new Error(`${name}: ${f.path.join('.')} overlaps ${prev.path.join('.')}`);
        seen.set(f.offset + i, f);
      }
    }
  }
});

// ---------------------------------------------------------------- against the official tools

async function officialDump(load, file, functions, rules, seed) {
  const html = text(await load('test/official/' + file));
  const f = O.form(rules, O.rng(seed));
  const make = O.officialEncoder(html, functions, f.getElementById);
  return { html, values: f.values, msg: Uint8Array.from(make()) };
}

function checkExpectations(decoded, expected, what) {
  let n = 0;
  for (const [path, want] of expected) {
    const got = getPath(decoded, path);
    if (got !== want) throw new Error(`${what}: ${path.join('.')} = ${JSON.stringify(got)}, the official tool wrote ${JSON.stringify(want)}`);
    n++;
  }
  return n;
}

function checkFullRewrite(layout, msg, decoded, what) {
  const body = bodyOf(msg);
  const rewritten = encode(layout, decoded, new Uint8Array(body.length));
  eqBytes(rewritten, body, `${what}: our encoder vs the official one`);
}

for (const seed of [1, 2, 3]) {
  test(`config fields match the official config tool (seed ${seed})`, async (load) => {
    const { html, values, msg } = await officialDump(load, 'fh2_config_tool.html', O.CONFIG_FUNCTIONS, O.configRules, seed);
    assert(msg.length === 8 + 4096 + 48 + 1, `official config is ${msg.length} bytes`);
    const d = parseDump(msg);
    assert(d.kind === 'config' && d.values.version === CONFIG_VERSION, 'version');
    const n = checkExpectations(d.values, O.expectations(O.configRules, values), 'config');
    assert(n > 2000, `only ${n} fields checked`);
    const used = d.values.mapping.filter((m) => m.status >> 4 === 3).map((m) => `${m.status}:${m.cc}:${m.target}:${m.index}`).sort();
    const want = O.mappingExpectations(values, html);
    assert(want.length > 20 && want.length < 384, `${want.length} mappings`);
    assert(used.join() === want.join(), `mappings differ: ${used.length} decoded, ${want.length} expected`);
    assert(d.values.mapping.slice(used.length).every((m) => m.status === 0x7f), 'unused mapping slots');
    checkFullRewrite(config, msg, d.values, 'config');
  });

  test(`preset fields match the official preset tool (seed ${seed})`, async (load) => {
    const { values, msg } = await officialDump(load, 'fh2_preset_tool.html', O.PRESET_FUNCTIONS, O.presetRules, seed);
    assert(msg.length === 8 + 4096 + 340 + 1, `official preset is ${msg.length} bytes`);
    const d = parseDump(msg);
    assert(d.kind === 'preset' && d.values.version === PRESET_VERSION, 'version');
    let n = checkExpectations(d.values, O.expectations(O.presetRules, values), 'preset');
    n += checkExpectations(d.values, O.presetCombinedExpectations(values), 'preset');
    assert(n > 2500, `only ${n} fields checked`);
    checkFullRewrite(preset, msg, d.values, 'preset');
  });
}

// ---------------------------------------------------------------- dumps

async function sampleDumps(load) {
  const c = await officialDump(load, 'fh2_config_tool.html', O.CONFIG_FUNCTIONS, O.configRules, 7);
  const p = await officialDump(load, 'fh2_preset_tool.html', O.PRESET_FUNCTIONS, O.presetRules, 7);
  return { config: c.msg, preset: p.msg };
}

test('an unchanged dump rebuilds byte for byte', async (load) => {
  const { config: c, preset: p } = await sampleDumps(load);
  for (const msg of [c, p]) eqBytes(buildDump(parseDump(msg)), msg, 'rebuilt dump');
});

test('bytes we do not model survive an edit', async (load) => {
  const { config: msg } = await sampleDumps(load);
  const noisy = Uint8Array.from(msg);
  for (let i = 8 + 3812; i < 8 + 4096; i++) noisy[i] = i & 0x7f; // the unused tail of the body
  const d = parseDump(noisy);
  const channel = (d.values.converter[2].channel + 1) & 15;
  d.values.converter[2].channel = channel;
  const out = buildDump(d);
  let changed = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== noisy[i]) changed++;
  assert(changed === 1, `${changed} bytes changed`);
  assert(parseDump(out).values.converter[2].channel === channel, 'edit lost');
});

test('changing one field changes only its bytes', async (load) => {
  const { preset: msg } = await sampleDumps(load);
  const d = parseDump(msg);
  d.values.output[5].directLevel = (d.values.output[5].directLevel + 1000) & 0x3fff;
  d.values.noteSequencer[3].step[31].gatesHigh ^= 1;
  const out = buildDump(d);
  let changed = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== msg[i]) changed++;
  assert(changed >= 2 && changed <= 3, `${changed} bytes changed`);
});

test('dumps from your FH-2 round-trip (test/local)', async (load) => {
  const found = [];
  for (const file of ['config.syx', 'preset.syx']) {
    const msg = await load('test/local/' + file);
    if (!msg) continue;
    const d = parseDump(msg);
    assert(d.versionOk, `${file}: version ${d.values.version} is not the one these layouts are for`);
    eqBytes(buildDump(d), msg, file);
    found.push(file);
  }
  return found.length ? `checked ${found.join(', ')}` : 'skipped: no dumps in test/local/';
});

// ---------------------------------------------------------------- client

test('client pulls, installs and verifies', async (load) => {
  const fh2 = new Fh2StandIn(await sampleDumps(load));
  const client = new Fh2(fh2.transport());
  assert((await client.version()) === 'v2.0', 'version');
  const c = await client.pullConfig();
  const p = await client.pullPreset();
  assert(c.kind === 'config' && p.kind === 'preset', 'kinds');
  c.values.clock[0].base = 12;
  await client.install(c);
  assert(fh2.config[5] === CMD.INSTALL_CONFIG, 'config not installed');
  assert((await client.verifyInstall(c)).length === 0, 'install did not stick');
  c.values.clock[0].base = 24;
  const d = await client.verifyInstall(c);
  assert(d.length === 1 && d[0].path.join('.') === 'clock.0.base', 'verify should report the one field');
  await client.saveConfigToFlash(3);
  assert(fh2.saved.length === 1 && fh2.saved[0][0] === CMD.SAVE_CONFIG && fh2.saved[0][1] === 3, 'save to flash');
});

test('a renamed config reads back equal after an install: names are trimmed, the module pads', async (load) => {
  const b = new Uint8Array(17);
  name16.write(b, 0, 'Verse');
  assert(b[5] === 0x20 && b[15] === 0x20 && b[16] === 0 && name16.read(b, 0) === 'Verse', 'padded on write, trimmed on read');
  const fh2 = new Fh2StandIn(await sampleDumps(load));
  const client = new Fh2(fh2.transport());
  const c = await client.pullConfig();
  c.values.name = 'Live set';
  await client.install(c);
  assert((await client.verifyInstall(c)).length === 0, 'verify must not report the name');
  assert((await client.pullConfig()).values.name === 'Live set', 'the name comes back as edited');
});

test('client requests go one at a time', async (load) => {
  const fh2 = new Fh2StandIn(await sampleDumps(load));
  const client = new Fh2(fh2.transport());
  const [v, c, p] = await Promise.all([client.version(), client.pullConfig(), client.pullPreset()]);
  assert(v === 'v2.0' && c.kind === 'config' && p.kind === 'preset', 'replies mixed up');
});

test('client times out and carries on', async (load) => {
  const fh2 = new Fh2StandIn({ ...(await sampleDumps(load)), silent: true });
  const client = new Fh2(fh2.transport(), { timeout: 20 });
  let err = null;
  await client.version().catch((e) => { err = e; });
  assert(err instanceof TimeoutError, 'expected a timeout');
  fh2.silent = false;
  assert((await client.version()) === 'v2.0', 'no recovery after a timeout');
});

test('client ignores other MIDI', async (load) => {
  const fh2 = new Fh2StandIn(await sampleDumps(load));
  const port = fh2.transport();
  const client = new Fh2(port);
  const pending = client.version();
  port.onmessage(Uint8Array.of(0xB0, 7, 100));
  port.onmessage(message(0x40, [1, 0]));
  assert((await pending) === 'v2.0', 'version');
});
