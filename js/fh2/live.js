// Live editing: Night Shift sends your edits to the FH-2's RAM by itself (never to its flash),
// a few seconds after you make them, and only while music isn't playing (an install
// interrupts what plays). No DOM or MIDI here; app.js wires it up.
//
// - In step: Night Shift only sends while it knows what the FH-2 holds. It remembers the
//   FH-2's dumps as last sent or read (the "base"). Before each send it reads the FH-2 again:
//   what changed there since the base (its panel, knobs plugged into it, Logic's automation)
//   comes into your patch first, so a send doesn't undo it. If the FH-2 holds another config
//   or preset by name, or more changes than MERGE_MAX, it isn't in step any more, and nothing
//   is sent until Get or Send. When the FH-2 comes back (plugged in, Night Shift opened), it
//   has to be exactly the base for edits made meanwhile to go out.
// - Playing: a MIDI clock runs on some input of this computer (Transport).
// - Pace: QUIET_MS after the last edit, at most MAX_WAIT_MS after the first one waiting.

import { diff, getPath } from './layout.js';

export const QUIET_MS = 2000;
export const MAX_WAIT_MS = 5000;

// More of the FH-2's own changes than this at once came from loading something there (a power
// cycle loads its startup config and preset, often under the same name), not from knobs or its
// panel, so they aren't merged.
export const MERGE_MAX = 32;

// How long until the send: `first` and `last` are when the oldest and newest unsent edits were made.
export const dueIn = (now, first, last) => Math.max(0, Math.min(last + QUIET_MS, first + MAX_WAIT_MS) - now);

// The FH-2's own changes since `base`, as edits of `mine`: the fields that changed there and
// that you left as they were (where you changed one too, yours wins). `layout` is the dump's.
export function fromModule(layout, base, mine, theirs) {
  return diff(layout, base, theirs).filter((d) => getPath(mine, d.path) === d.from).map((d) => ({ path: d.path, value: d.to }));
}

// Whether the FH-2 holds another config or preset than `base` (by name): then it was loaded
// there, and the fields can't be merged. `base` and `theirs` are { config, preset } values.
export const anotherPatch = (base, theirs) => base.config.name !== theirs.config.name || (base.preset && theirs.preset && base.preset.name !== theirs.preset.name);

// Is music playing? Per input: after Start or Continue until Stop where the source sends those
// (an Elektron box sends clock while stopped), else while its clock ticks.
const TICK_MS = 1000; // no tick for that long: the clock stopped
const STALE_MS = 5000; // started, but no tick for that long: unplugged mid-song

export class Transport {
  constructor() {
    this.ports = new Map();
  }

  // A real-time byte (F8 clock, FA start, FB continue, FC stop) from input `port` at `now` (ms).
  take(port, byte, now) {
    let s = this.ports.get(port);
    if (!s) this.ports.set(port, (s = { transport: false, running: false, tick: -Infinity }));
    if (byte === 0xfa || byte === 0xfb) Object.assign(s, { transport: true, running: true, tick: now });
    else if (byte === 0xfc) Object.assign(s, { transport: true, running: false });
    else if (byte === 0xf8) s.tick = now;
  }

  playing(now) {
    for (const s of this.ports.values()) {
      if (s.transport ? s.running && now - s.tick < STALE_MS : now - s.tick < TICK_MS) return true;
    }
    return false;
  }

  drop(port) {
    this.ports.delete(port);
  }
}
