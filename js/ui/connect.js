// Talking to an FH-2 over Web MIDI: pulling its config and preset, sending them back into
// its RAM, and saving them to its flash.

import { midiAccess, midiTransport } from '../../vendor/lilypad/js/midi.js';
import { Fh2 } from '../fh2/client.js';

const FH2_NAME = /fh-?2/i;
const SETTLE_MS = 500; // after an install, before reading it back (as tools/fh2dump.py does)

export async function fh2Ports() {
  const acc = await midiAccess();
  const live = (p) => p.state !== 'disconnected';
  const outs = [...acc.outputs.values()].filter(live);
  const ins = [...acc.inputs.values()].filter(live);
  const pairs = outs.map((o) => ({ name: o.name, out: o, in: ins.find((i) => i.name === o.name) })).filter((p) => p.in);
  pairs.sort((a, b) => Number(FH2_NAME.test(b.name)) - Number(FH2_NAME.test(a.name)));
  return pairs;
}

export const looksLikeFh2 = (pair) => FH2_NAME.test(pair.name);

async function withClient(pair, log, work) {
  const client = new Fh2(midiTransport(pair.in, pair.out), { log });
  try {
    return await work(client);
  } finally {
    client.close();
  }
}

// Only asks for data: nothing on the module changes.
export function pullFromFh2(pair, log) {
  return withClient(pair, log, async (client) => {
    const version = await client.version();
    const config = await client.pullConfig();
    const preset = await client.pullPreset();
    return { version, config, preset };
  });
}

// Makes `config` (and `preset`, if given) the FH-2's current ones, in RAM, then reads each
// back. Returns the fields that came back different, by dump: { config: [...], preset: [...] }.
export function sendToFh2(pair, { config, preset }, log) {
  return withClient(pair, log, async (client) => {
    const out = {};
    for (const d of [config, preset].filter(Boolean)) {
      await client.install(d);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      out[d.kind] = await client.verifyInstall(d);
    }
    return out;
  });
}

// Stores the FH-2's current config and preset in flash, in the slots they were last loaded
// from or saved to.
export function saveToFlash(pair, log) {
  return withClient(pair, log, async (client) => {
    await client.saveConfigToFlash(0);
    await new Promise((r) => setTimeout(r, SETTLE_MS)); // let it finish writing flash
    await client.savePresetToFlash(0);
  });
}
