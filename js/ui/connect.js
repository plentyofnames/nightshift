// Talking to an FH-2 over Web MIDI: pulling its config and preset, sending them back into
// its RAM, and saving them to its flash.

import { midiAccess, midiTransport, portPairs, EC4_NAME } from '../../vendor/lilypad/js/midi.js';
import { Device } from '../../vendor/lilypad/js/device.js';
import { Device as RcDevice } from '../../vendor/eyeofprovidence/js/device.js';
import { BCR32_NAME } from '../../vendor/eyeofprovidence/js/midi.js';
import { Fh2 } from '../fh2/client.js';
import { readSettings, readCalibrations, loadCalibration, setStartupCalibration } from '../fh2/menu.js';

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
// back. The values are copied first, so edits made meanwhile wait for the next send.
// Returns { sent: values by dump, off: the fields that came back different, by dump }.
export function sendToFh2(pair, { config, preset }, log) {
  return withClient(pair, log, async (client) => {
    const sent = {};
    const off = {};
    for (const d of [config, preset].filter(Boolean)) {
      const values = structuredClone(d.values);
      await client.install(d, values);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      off[d.kind] = await client.verifyInstall(d, values);
      sent[d.kind] = values;
    }
    return { sent, off };
  });
}

// Stores the FH-2's current config and preset in flash: in `configSlot` and `presetSlot` (1–30),
// or with 0 in the slots they were last loaded from or saved to.
export function saveToFlash(pair, { configSlot = 0, presetSlot = 0 } = {}, log) {
  return withClient(pair, log, async (client) => {
    await client.saveConfigToFlash(configSlot);
    await settle(); // let it finish writing flash
    await client.savePresetToFlash(presetSlot);
    await settle();
  });
}

const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

// Saves a whole project to flash: the config into `configSlot`, then each scene's preset into
// its slot (each is sent first, as the FH-2 saves what it holds), then sends `back` (the scene
// in view) so the module ends up holding it. Returns what the FH-2 holds afterwards.
export function saveAllToFlash(pair, { config, configSlot, scenes, back }, log) {
  return withClient(pair, log, async (client) => {
    await client.install(config);
    await settle();
    await client.saveConfigToFlash(configSlot);
    await settle();
    for (const s of scenes) {
      await client.install(s.dump);
      await settle();
      await client.savePresetToFlash(s.slot);
      await settle();
    }
    if (back) {
      await client.install(back);
      await settle();
    }
    return { config: await client.pullConfig(), preset: await client.pullPreset() };
  });
}

// ---- learning a knob: the next CC from any MIDI input of this computer

// { channel 0–15, cc, value } for a control change, or null (channel mode messages 120–127
// aren't knobs).
export function ccOf(bytes) {
  if (!bytes || bytes.length < 3 || (bytes[0] & 0xf0) !== 0xb0 || bytes[1] >= 120) return null;
  return { channel: bytes[0] & 15, cc: bytes[1], value: bytes[2] };
}

// Waits for the next CC on any input and says where it came from. A controller plugged into
// the FH-2's USB A can't be heard here; for those, set the channel and CC by hand (or wait
// for hardware check 5, reading them from the FH-2's screen).
export async function learnCc(timeoutMs = 15000) {
  const acc = await midiAccess();
  const inputs = [...acc.inputs.values()].filter((i) => i.state !== 'disconnected');
  if (!inputs.length) throw new Error('no MIDI inputs on this computer');
  return new Promise((resolve, reject) => {
    const done = (v, err) => {
      clearTimeout(timer);
      for (const i of inputs) i.removeEventListener('midimessage', on);
      err ? reject(err) : resolve(v);
    };
    const on = (e) => {
      const cc = ccOf(e.data);
      if (cc) done({ ...cc, port: e.target.name });
    };
    const timer = setTimeout(() => done(null, new Error('no knob turned')), timeoutMs);
    for (const i of inputs) i.addEventListener('midimessage', on);
  });
}

// Reads the FH-2's own settings by walking its menus (menu.js); changes nothing.
export function readFh2Settings(pair, onStep, log) {
  return withClient(pair, log, (client) => readSettings(client, { onStep }));
}

export function readFh2Calibrations(pair, outputs, onStep, log) {
  return withClient(pair, log, (client) => readCalibrations(client, { outputs, onStep }));
}

export function loadFh2Calibration(pair, slot, output, log) {
  return withClient(pair, log, (client) => loadCalibration(client, { slot, output }));
}

// An FH-2 client open for as long as `work(client)` runs (the auto-calibration dialog).
export function withFh2Client(pair, work, log) {
  return withClient(pair, log, work);
}

export function setFh2StartupCalibration(pair, output, slot, log) {
  return withClient(pair, log, (client) => setStartupCalibration(client, { output, slot }));
}

// ---- the EC4, through controlfrog's protocol (Lilypad's device.js)

export async function ec4Port() {
  return portPairs(await midiAccess()).find((p) => EC4_NAME.test(p.name)) ?? null;
}

// Opens the EC4 for `work(device, info)`; controlfrog has to answer IDENTIFY first.
export async function withEc4(pair, work, log) {
  const device = new Device(midiTransport(pair.in, pair.out), { log });
  try {
    let info;
    try {
      info = await device.identify({ busyMs: 3000 });
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? 'no answer (controlfrog on it? Lilypad closed?)' : e.message);
    }
    return await work(device, info);
  } finally {
    device.close();
  }
}

// Opens the EC4 and keeps it open (for the live link): { device, info }. Its channel messages
// (the knobs) go to `onMidi`; controlfrog's own replies and events to the device.
export async function openEc4(pair, onMidi, log) {
  const transport = midiTransport(pair.in, pair.out);
  const device = new Device(transport, { log });
  const forDevice = transport.onmessage;
  transport.onmessage = (bytes) => {
    forDevice(bytes);
    if (bytes[0] !== 0xf0) onMidi(bytes);
  };
  try {
    return { device, info: await device.identify({ busyMs: 3000 }) };
  } catch (e) {
    device.close();
    throw new Error(e.name === 'TimeoutError' ? 'no answer (controlfrog on it? Lilypad closed?)' : e.message);
  }
}

// The FH-2's output port, for passing the EC4's knobs on (Night Shift's thru), or null.
export async function fh2Output() {
  return (await fh2Ports()).find(looksLikeFh2)?.out ?? null;
}

// Only the preset: what the knobs change.
export function pullPresetFromFh2(pair, log) {
  return withClient(pair, log, (client) => client.pullPreset());
}

// Calls `onChange('connected' | 'disconnected')` when a port named like the EC4 comes or goes.
export async function watchEc4(onChange) {
  const acc = await midiAccess();
  acc.addEventListener('statechange', (e) => {
    if (EC4_NAME.test(e.port.name ?? '') && e.port.type === 'output') onChange(e.port.state);
  });
}

// Calls `onChange('connected' | 'disconnected')` when a port named like the FH-2 comes or goes.
export async function watchFh2(onChange) {
  const acc = await midiAccess();
  acc.addEventListener('statechange', (e) => {
    if (FH2_NAME.test(e.port.name ?? '')) onChange(e.port.state);
  });
}

// ---- the BCR32 under Rotary Club, through its protocol (Eye of Providence's device.js)

const RC = [0x52, 0x43]; // "RC": Rotary Club's IDENTIFY info
const rcOk = (info) => info.info?.[0] === RC[0] && info.info?.[1] === RC[1] && (info.fwMajor > 0 || info.fwMinor >= 23);
const rcAnswer = async (device) => {
  let info;
  try {
    info = await device.identify({ timeout: 800, retries: 1 });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'no answer (Rotary Club on it?)' : e.message);
  }
  if (!rcOk(info)) throw new Error(`Rotary Club ${info.fwMajor}.${info.fwMinor}: the controller needs 0.23`);
  return info;
};

export async function bcr32Port() {
  return portPairs(await midiAccess(), BCR32_NAME).find((p) => BCR32_NAME.test(p.name)) ?? null;
}

// Opens the BCR32 for `work(device, info)`; Rotary Club 0.23 or later has to answer IDENTIFY first.
export async function withBcr32(pair, work, log) {
  const device = new RcDevice(midiTransport(pair.in, pair.out), { log });
  try {
    return await work(device, await rcAnswer(device));
  } finally {
    device.close();
  }
}

// Opens the BCR32 and keeps it open (for the live link): { device, info }. Its channel messages
// (its knobs, keys and sequencer tracks) go to `onMidi`; Rotary Club's replies and events to the device.
export async function openBcr32(pair, onMidi, log) {
  const transport = midiTransport(pair.in, pair.out);
  const device = new RcDevice(transport, { log });
  const forDevice = transport.onmessage;
  transport.onmessage = (bytes) => {
    forDevice(bytes);
    if (bytes[0] !== 0xf0) onMidi(bytes);
  };
  try {
    return { device, info: await rcAnswer(device) };
  } catch (e) {
    device.close();
    throw e;
  }
}

// Calls `onChange('connected' | 'disconnected')` when a port named like the BCR32 comes or goes.
export async function watchBcr32(onChange) {
  const acc = await midiAccess();
  acc.addEventListener('statechange', (e) => {
    if (BCR32_NAME.test(e.port.name ?? '') && e.port.type === 'output') onChange(e.port.state);
  });
}
