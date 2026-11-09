// Hardware checks for the BCR32 with Rotary Club (checks.html, "BCR32 with Rotary Club"; the build
// plan's B9–B15): what the unit holds after Night Shift's Send, and the tracks 0.29 tells. They read
// over Rotary Club's protocol (Eye of Providence's framing) and never write: Night Shift's own
// BCR32 tab does the writing, as you use it. `rig` is the checks page's BCR32 rig (send, listen,
// next, log, ask, wait).

import { host, decodeReply, unframe } from '../../vendor/eyeofprovidence/js/proto.js';
import { SIZE, A as ADDR, pageNameAddr, locate } from '../../vendor/eyeofprovidence/js/model.js';
import { heldFromJson, knobAddrs, foreignKnobs, pageOnBcr32 } from './image.js';
import { parseTracks, trackLine, trackChanges, hasTracks, TRACKS_SPACE, TRACKS_LEN, TRACKS_CHANGED } from './tracks.js';

const HELD_KEY = 'nightshift.bcr32held'; // what Night Shift's BCR32 tab last stored on the unit (app.js)

async function request(rig, bytes, match, what, ms = 1500) {
  rig.send(bytes);
  const r = await rig.next((m) => {
    const d = decodeReply(m);
    return d && (d.type === 'error' || match(d)) ? d : null;
  }, ms);
  if (!r) throw new Error(`no answer to ${what} (Rotary Club on it? Eye of Providence closed?)`);
  if (r.type === 'error') throw new Error(`${what}: error ${r.code}`);
  return r;
}

const identify = (rig) => request(rig, host.identify(), (d) => d.type === 'identify', 'IDENTIFY');
const readSpace = async (rig, space, addr, len) =>
  (await request(rig, host.read(space, addr, len), (d) => d.type === 'read' && d.space === space && d.addr === addr, `READ ${space}:${addr}`)).data;

async function readImage(rig) {
  const img = new Uint8Array(SIZE);
  for (let a = 0; a < SIZE; a += 256) img.set(await readSpace(rig, 2, a, 256), a);
  return img;
}

function storedHeld() {
  try {
    return heldFromJson(JSON.parse(localStorage.getItem(HELD_KEY)));
  } catch {
    return heldFromJson(null);
  }
}

// The addresses Night Shift may change: its knobs before and after, the page names it gave, the
// sync header and, on a blank unit, the image's own header.
function ownAddresses(...helds) {
  const own = new Set();
  for (const held of helds) {
    for (const id of held.knobs.keys()) {
      const [p, i] = id.split(':').map(Number);
      knobAddrs(p, i).forEach((a) => own.add(a));
    }
    for (const p of held.names.keys()) for (let k = 0; k < 4; k++) own.add(pageNameAddr(p) + k);
  }
  for (let k = 0; k < 8; k++) own.add(ADDR.SYNC + k);
  for (let k = 0; k < 16; k++) own.add(k);
  return own;
}

const fwOf = (id) => `${id.fwMajor}.${id.fwMinor}`;

// Changed addresses as the places they belong to: "page 1 knob 5", "page 2 key 3", "page 1's name".
function places(addrs) {
  const out = new Set();
  for (const a of addrs) {
    const l = locate(a);
    if (l.cell != null) out.add(`page ${l.page + 1} ${l.cell < 32 ? `knob ${l.cell + 1}` : `key ${l.cell - 31}`}${l.sync ? ' (its sync entry)' : ''}`);
    else if (l.name) out.add(`page ${l.page + 1}’s name`);
    else if (l.outputs) out.add(`page ${l.page + 1}’s outputs`);
    else out.add(`0x${a.toString(16)}`);
  }
  return [...out];
}
const keysUsed = (img) => [0, 1, 2, 3].reduce((n, p) => n + pageOnBcr32(img, p).keys.filter((k) => k.sends).length, 0);

// B9: Send beside another app's knobs. The unit before and after a Send from Night Shift's BCR32 tab:
// every byte that isn't Night Shift's as it was, Night Shift's knobs as it holds them; then after a
// power cycle, all of it again (stored).
export async function rcStored(rig, { heldNow = storedHeld } = {}) { // heldNow: what Night Shift holds (its tab's, else a test's)
  const id = await identify(rig);
  rig.log(`Rotary Club ${fwOf(id)}`);
  // step by step, so nothing changes on the unit between the two readings but Night Shift's Send
  if (await rig.ask('1. In Eye of Providence, give a knob or two and a key some MIDI (another app’s), Send there, and close it. Then:', ['Done', 'Stop']) === 'Stop') {
    return { summary: 'Stopped before the first reading', lines: [] };
  }
  const before = await readImage(rig);
  const heldBefore = heldNow();
  const others = foreignKnobs(before, heldBefore);
  rig.log(`Before: ${others.size} knobs of another app (${[...others.keys()].slice(0, 4).map((k) => { const [p, i] = k.split(':').map(Number); return `page ${p + 1} knob ${i + 1}`; }).join(', ')}), ${keysUsed(before)} keys in use, ${heldBefore.knobs.size} of Night Shift’s`);
  if (!others.size) throw new Error('no other app’s knob on the BCR32: step 1 first');
  if (await rig.ask('2. In Night Shift’s BCR32 tab, put a setting on one of those knobs (shown dimmed) and one on a free knob, then Send in its bar: it asks about the first, answer Write over. Then:', ['Sent', 'Stop']) === 'Stop') {
    return { summary: 'Stopped before the Send', lines: [] };
  }
  const after = await readImage(rig);
  const held = heldNow();
  const own = ownAddresses(heldBefore, held);
  const moved = [];
  for (let a = 0; a < SIZE; a++) if (!own.has(a) && after[a] !== before[a]) moved.push(a);
  const mine = [...held.knobs].filter(([id, b]) => {
    const [p, i] = id.split(':').map(Number);
    return knobAddrs(p, i).every((a, k) => after[a] === b[k]);
  }).length;
  const lines = [`Night Shift’s knobs as it wrote them: ${mine} of ${held.knobs.size}`,
    moved.length ? `Changed, not Night Shift’s: ${places(moved).join(', ')}` : 'Every other byte as it was (other knobs, keys, page outputs)'];
  lines.forEach((l) => rig.log(l));
  let stored = 'not checked';
  if (await rig.ask('3. Power the BCR32 off and on, wait until it shows its screen, then:', ['Done', 'Skip']) === 'Done') {
    await rig.wait(1500);
    try {
      await identify(rig);
      const again = await readImage(rig);
      const same = again.every((b, a) => b === after[a]);
      stored = same ? 'all of it after the power cycle' : `${again.filter((b, a) => b !== after[a]).length} bytes differ after the power cycle`;
    } catch (e) {
      stored = `no answer after the power cycle (${e.message}): run the check again`;
    }
    lines.push(`Stored: ${stored}`);
    rig.log(`Stored: ${stored}`);
  }
  const ok = mine === held.knobs.size && !moved.length;
  return { summary: `${ok ? 'Only Night Shift’s bytes changed' : 'Something else changed'}; ${mine}/${held.knobs.size} knobs; stored: ${stored}`, lines };
}

// B15: the tracks (Rotary Club 0.29 on): read, then a change made at the unit arrives as 35 and reads back.
export async function rcTracks(rig) {
  const id = await identify(rig);
  if (!hasTracks(id)) throw new Error(`Rotary Club ${fwOf(id)}: the tracks come with 0.29`);
  const read = async () => parseTracks(Uint8Array.from([...await readSpace(rig, TRACKS_SPACE, 0, 256), ...await readSpace(rig, TRACKS_SPACE, 256, TRACKS_LEN - 256)]));
  const first = await read();
  rig.log(`Rotary Club ${fwOf(id)}: ${first.tracks.length} tracks, counter ${first.counter}`);
  first.tracks.forEach((t) => rig.log(trackLine(t)));
  const events = [];
  const stop = rig.listen((m) => {
    const f = unframe(m);
    if (f && f.cmd === TRACKS_CHANGED) events.push(f.body[0]);
  });
  try {
    if (await rig.ask('Change one track on the BCR32 (its machine or channel in EDIT), then:', ['Changed it', 'Skip']) === 'Skip') {
      return { summary: `${first.tracks.length} tracks read (no change tried)`, lines: first.tracks.map(trackLine) };
    }
    for (let k = 0; k < 20 && !events.length; k++) await rig.wait(100); // it says so within about a second
    const second = await read();
    const changes = trackChanges(first, second);
    changes.forEach((c) => rig.log(c));
    const told = events.length ? `came as 35 ${events.at(-1)}` : 'no 35 came';
    return { summary: `${first.tracks.length} tracks read; the change ${told}, ${changes.length ? `${changes.length} track${changes.length === 1 ? '' : 's'} differ` : 'nothing differs'}`,
      lines: [...changes, ...second.tracks.map(trackLine)] };
  } finally {
    stop();
  }
}
