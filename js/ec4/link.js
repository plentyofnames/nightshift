// The live link to the EC4 while Night Shift is open (controlfrog's protocol, docs/protocol.md
// in the firmware repo): which setup and page the EC4 is on (STATE), which knob was touched
// (TOUCH), the value texts of the page in view (TEXT, firmware 0.10), and the CCs its knobs
// send. Night Shift also sends the FH-2's values back to the EC4 as CCs, so its absolute
// knobs start where the settings are and don't jump.
//
// It only ever acts on setup 15: on any other setup (the MDMM's, your own) it does nothing,
// and it never turns the EC4 to setup 15 by itself. No DOM here; app.js wires it up.

import { frame } from '../../vendor/lilypad/js/proto.js';
import { SETUP, KNOBS } from './pages.js';

const TEXT = 0x28;
const VALUE = 1; // TEXT kind: a value text (0 would be a label)

// TEXT for cells `first`… of the current group: 4 printable characters each; null removes one.
export function textMessage(kind, first, texts) {
  const chars = texts.flatMap((t) => (t == null ? [0, 0, 0, 0]
    : [...String(t).padEnd(4).slice(0, 4)].map((c) => { const n = c.charCodeAt(0); return n >= 0x20 && n <= 0x7e ? n : 0x20; })));
  return frame(TEXT, [kind, first, texts.length, ...chars]);
}

// What a channel message from the EC4 is: { channel, cc, value } for a CC, else null.
// 14-bit knobs (CCAh) send MSB on n, then LSB on n + 32; `Cc14` joins them.
export class Cc14 {
  constructor() {
    this.msb = new Map();
  }
  // Returns [{ channel, cc, value, bits }] for each knob value this message completes.
  take(bytes, isHires) {
    if (bytes.length < 3 || (bytes[0] & 0xf0) !== 0xb0) return [];
    const channel = bytes[0] & 15;
    const [cc, v] = [bytes[1], bytes[2]];
    if (cc < 32 && isHires(channel, cc)) {
      this.msb.set(`${channel}:${cc}`, v);
      return [];
    }
    if (cc >= 32 && cc < 64 && isHires(channel, cc - 32)) {
      const msb = this.msb.get(`${channel}:${cc - 32}`) ?? 0;
      return [{ channel, cc: cc - 32, value: (msb << 7) | v, bits: 14 }];
    }
    return [{ channel, cc, value: v, bits: 7 }];
  }
}

export class Ec4Link extends EventTarget {
  // `device`: Lilypad's Device on the EC4's ports; `info`: its IDENTIFY reply.
  constructor(device, info) {
    super();
    this.device = device;
    this.info = info;
    this.texts = info.fwMajor > 0 || info.fwMinor >= 10; // TEXT is new in controlfrog 0.10
    this.setup = null;
    this.group = null;
    this.shown = new Map(); // what this group shows now: knob → text, and knob → CC value sent
    this.sent = new Map();
    device.addEventListener('state', (e) => this._state(e.detail));
    device.addEventListener('touch', (e) => this.setup === SETUP && this._emit('touch', e.detail));
  }

  get ours() {
    return this.setup === SETUP;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _state({ setup, group }) {
    const moved = setup !== this.setup || group !== this.group;
    this.setup = setup;
    this.group = group;
    if (moved) {
      this.shown.clear(); // the EC4 drops its texts on every group change
      this.sent.clear();
    }
    this._emit('state', { setup, group, moved });
  }

  async start() {
    this._state(await this.device.getState());
    await this.device.touchEvents(true);
  }

  // Turns the EC4 to page `group` of setup 15, only if it is on setup 15 already.
  async select(group) {
    if (!this.ours || group === this.group || group == null) return;
    this._state(await this.device.select(SETUP, group));
  }

  // Sends after the request in flight, as controlfrog wants (TEXT has no reply of its own).
  _send(bytes) {
    const p = this.device.chain.then(() => this.device.transport.send(bytes));
    this.device.chain = p.catch(() => {});
    return p;
  }

  // The page in view as it should look: per knob { text, cc: { channel, number, value, bits } }
  // or null. Sends only what changed since the last call for this page.
  async show(knobs) {
    if (!this.ours) return;
    for (let i = 0; i < KNOBS; i++) {
      const k = knobs[i];
      const cc = k?.cc;
      if (cc && cc.value != null && this.sent.get(i) !== `${cc.channel}:${cc.number}:${cc.value}`) {
        this.sent.set(i, `${cc.channel}:${cc.number}:${cc.value}`);
        await this._send(ccBytes(cc));
      }
    }
    if (!this.texts) return;
    const texts = Array.from({ length: KNOBS }, (_, i) => knobs[i]?.text ?? null);
    const changed = texts.map((t, i) => (this.shown.get(i) ?? null) !== t); // a new page shows no texts
    if (!changed.some(Boolean)) return;
    const first = changed.indexOf(true);
    const last = changed.lastIndexOf(true);
    await this._send(textMessage(VALUE, first, texts.slice(first, last + 1)));
    texts.forEach((t, i) => this.shown.set(i, t));
  }

  // One knob's text while it is being turned (the rest of the page stays as it is).
  async showOne(i, text) {
    if (!this.ours || !this.texts || (this.shown.get(i) ?? null) === text) return;
    this.shown.set(i, text);
    await this._send(textMessage(VALUE, i, [text]));
  }

  close() {
    this.device.close();
  }
}

// A knob's value as the CC message(s) the EC4 takes it from: MSB then LSB for 14 bits.
export function ccBytes({ channel, number, value, bits }) {
  if (bits === 14) return Uint8Array.from([0xb0 | channel, number, (value >> 7) & 0x7f, 0xb0 | channel, number + 32, value & 0x7f]);
  return Uint8Array.from([0xb0 | channel, number, value & 0x7f]);
}
