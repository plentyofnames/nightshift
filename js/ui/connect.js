// Pulling the config and preset from an FH-2 over Web MIDI. Only asks for data: nothing
// on the module changes.

import { midiAccess, midiTransport } from '../../vendor/lilypad/js/midi.js';
import { Fh2 } from '../fh2/client.js';

const FH2_NAME = /fh-?2/i;

export async function fh2Ports() {
  const acc = await midiAccess();
  const live = (p) => p.state !== 'disconnected';
  const outs = [...acc.outputs.values()].filter(live);
  const ins = [...acc.inputs.values()].filter(live);
  const pairs = outs.map((o) => ({ name: o.name, out: o, in: ins.find((i) => i.name === o.name) })).filter((p) => p.in);
  pairs.sort((a, b) => Number(FH2_NAME.test(b.name)) - Number(FH2_NAME.test(a.name)));
  return pairs;
}

export async function pullFromFh2(pair, log) {
  const client = new Fh2(midiTransport(pair.in, pair.out), { log });
  try {
    const version = await client.version();
    const config = await client.pullConfig();
    const preset = await client.pullPreset();
    return { version, config, preset };
  } finally {
    client.close();
  }
}
