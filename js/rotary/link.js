// The live link to a BCR32 running Rotary Club (0.23 on) while Night Shift is open, over Eye of
// Providence's Device: which page it shows and whether the controller is up (STATE 21: mode,
// page), which knob was touched (TOUCH 33), the value texts of Night Shift's knobs on the page in
// view (TEXT), their values as the CCs they send (MIDI in moves the BCR32's values: values belong
// to the MIDI address), and Night Shift's changes in its RAM before they are stored (EDIT). Only
// ever Night Shift's own knobs: another knob's text, value or record is never sent.
//
// Any of these messages switches the BCR32's own FH-2 sync off until its USB goes down (the
// firmware's rule): while Night Shift is linked, it keeps the values itself. The firmware's SysEx
// input holds 1 KB and a message is at most 320 bytes, so after 512 bytes without a reply Night
// Shift waits for one (GET_STATE) before sending more. No DOM here; app.js wires it up.

import { host } from '../../vendor/eyeofprovidence/js/proto.js';
import { KNOBS } from './pages.js';
import { ccBytes } from '../ec4/link.js';

export const CONTROLLER = 1; // STATE's mode: 0 the sequencer, 1 the controller
const VALUE = 1; // TEXT kind: a value text
const BURST = 512;

export class Bcr32Link extends EventTarget {
  // `device`: Eye of Providence's Device on the BCR32's port; `info`: its IDENTIFY reply.
  constructor(device, info) {
    super();
    this.device = device;
    this.info = info;
    this.mode = null;
    this.page = null;
    this.shown = new Map(); // what the page in view shows: knob → text
    this.sent = new Map(); // knob → the CC value sent
    this.edited = new Map(); // knob → the record put in its RAM (EDIT)
    this.burst = 0; // bytes sent since the last reply
    device.addEventListener('state', (e) => {
      this.burst = 0;
      this._state(e.detail);
    });
    device.addEventListener('touch', (e) => this._emit('touch', { kind: e.detail.kind, index: e.detail.index, page: e.detail.page }));
    // an EDIT for a page no longer in view (Rotary Club 0.27 answers 7F 2C 06; before, 01): ask where it is
    device.addEventListener('deviceerror', (e) => {
      if (e.detail.cmd === 0x2c && !this.closed) this.device.getState().then((s) => this._state(s)).catch(() => {});
    });
  }

  get controller() {
    return this.mode === CONTROLLER;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _state({ mode, page, solicited = true }) {
    const moved = page !== this.page;
    const up = mode === CONTROLLER && this.mode !== CONTROLLER;
    // a STATE the BCR32 sent by itself for the page it already shows: a T key for that page
    // (firmware 0.23 loads the page again then, dropping texts and RAM edits)
    const reloaded = !solicited && !moved && mode === this.mode && this.page != null;
    if (moved || reloaded) this.forget(); // the BCR32 drops texts and RAM edits on a page change
    if (up) this.sent.clear(); // values wait while the sequencer shows
    const changed = moved || mode !== this.mode || reloaded;
    this.mode = mode;
    this.page = page;
    if (changed) this._emit('state', { mode, page, moved });
  }

  // After RELOAD (the image read again) or a page change: nothing shown or edited is known.
  forget() {
    this.shown.clear();
    this.sent.clear();
    this.edited.clear();
  }

  async start() {
    this._state(await this.device.getState());
    this._state(await this.device.touchEvents(true));
  }

  // Shows page `page` (0–3) on the BCR32 (it stays in the mode it is in).
  async select(page) {
    if (page == null || page === this.page) return;
    this._state(await this.device.select(page));
  }

  // A message without a reply, paced: past BURST bytes, a GET_STATE's reply first.
  async _post(bytes) {
    if (this.burst + bytes.length > BURST) {
      await this.device.getState();
      this.burst = 0;
    }
    this.burst += bytes.length;
    await this.device.post(bytes);
  }

  // The page in view as Night Shift has it: per knob { text, cc: { channel, number, value, bits } }
  // for Night Shift's, null for the others (left alone). Sends only what changed; the values only
  // while the controller shows.
  async show(knobs) {
    if (this.page == null) return;
    if (this.controller) {
      for (let i = 0; i < KNOBS; i++) {
        const cc = knobs[i]?.cc;
        if (!cc || cc.value == null || this.sent.get(i) === `${cc.channel}:${cc.number}:${cc.value}`) continue;
        this.sent.set(i, `${cc.channel}:${cc.number}:${cc.value}`);
        await this._post(ccBytes(cc));
      }
    }
    // texts: each run of Night Shift's knobs, from its first change to its last
    for (let i = 0; i < KNOBS;) {
      if (!knobs[i]) {
        i++;
        continue;
      }
      let end = i;
      while (end < KNOBS && knobs[end]) end++;
      const texts = knobs.slice(i, end).map((k) => k.text ?? null);
      const changed = texts.map((t, k) => (this.shown.has(i + k) ? this.shown.get(i + k) : undefined) !== t);
      const first = changed.indexOf(true);
      if (first >= 0) {
        const last = changed.lastIndexOf(true);
        await this._post(this._text(i + first, texts.slice(first, last + 1)));
        texts.forEach((t, k) => this.shown.set(i + k, t));
      }
      i = end;
    }
  }

  // One knob's text while it is being turned.
  async showOne(i, text) {
    if (this.page == null || this.shown.get(i) === text) return;
    this.shown.set(i, text);
    await this._post(this._text(i, [text]));
  }

  _text(first, texts) {
    return host.text(VALUE, first, texts);
  }

  // Night Shift's knobs of the page in view into the BCR32's RAM (EDIT): `records` (Map knob →
  // 15 bytes) as they should be, `stored(i)` what the image has there. Sends only where they differ.
  async edit(records, stored) {
    if (this.page == null) return;
    for (const [i, r] of records) {
      const now = this.edited.get(i) ?? stored(i);
      if (now && r.every((b, k) => b === now[k])) continue;
      this.edited.set(i, r);
      await this._post(host.edit(this.page, i, r));
    }
  }

  close() {
    this.closed = true;
    this.device.close();
  }
}

