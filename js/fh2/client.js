// Talks to an FH-2 over a transport ({ send(bytes), onmessage, close() }, as in Lilypad's
// midi.js). Requests go one at a time; each waits for its reply or times out.
// Installs (10H, 13H) and saves to flash (18H, 19H) have no reply: check an install by
// pulling the dump again (verifyInstall).

import { CMD, DUMPS, message, commandOf, parseDump, buildDump, textOf, screenTextOf, itemValueOf, remote, saveConfig, savePreset, displayMessage , screenshotOf } from './sysex.js';
import { diff } from './layout.js';

export class TimeoutError extends Error {
  name = 'TimeoutError';
}

export class Fh2 extends EventTarget {
  constructor(transport, { log, timeout = 5000 } = {}) {
    super();
    this.transport = transport;
    this.log = log || (() => {});
    this.timeout = timeout;
    this.pending = null;
    this.chain = Promise.resolve();
    transport.onmessage = (bytes) => this._onMessage(bytes);
  }

  _onMessage(bytes) {
    const cmd = commandOf(bytes);
    if (cmd < 0) return; // not FH-2 SysEx: ordinary MIDI, or another device
    this.log('rx', bytes);
    const p = this.pending;
    if (p && p.reply === cmd) {
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve(bytes);
    } else {
      this.dispatchEvent(new CustomEvent('message', { detail: bytes }));
    }
  }

  // Queues `bytes`; resolves with the next message with command `reply`, or right away if none is expected.
  _request(bytes, reply = null) {
    const run = () => new Promise((resolve, reject) => {
      this.log('tx', bytes);
      if (reply === null) {
        this.transport.send(bytes);
        return resolve(null);
      }
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new TimeoutError(`no reply to FH-2 command ${commandOf(bytes).toString(16).toUpperCase()}H`));
      }, this.timeout);
      this.pending = { reply, resolve, timer };
      this.transport.send(bytes);
    });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async version() {
    return textOf(await this._request(message(CMD.REQUEST_VERSION), CMD.MESSAGE));
  }

  async pullConfig() {
    return parseDump(await this._request(message(CMD.REQUEST_CONFIG), CMD.INSTALL_CONFIG));
  }

  async pullPreset() {
    return parseDump(await this._request(message(CMD.REQUEST_PRESET), CMD.INSTALL_PRESET));
  }

  async configName() {
    return textOf(await this._request(message(CMD.REQUEST_CONFIG_NAME), CMD.REQUEST_CONFIG_NAME));
  }

  async presetName() {
    return textOf(await this._request(message(CMD.REQUEST_PRESET_NAME), CMD.REQUEST_PRESET_NAME));
  }

  async screenText() {
    return screenTextOf(await this._request(message(CMD.REQUEST_SCREEN_TEXT), CMD.SCREEN_TEXT));
  }

  // the display as 128 × 32 pixels (rows of 0/1)
  async screenshot() {
    return screenshotOf(await this._request(message(CMD.SCREENSHOT), CMD.SCREENSHOT_REPLY));
  }

  // The menu item open on the display: its name ("Sorry" when none is) and value.
  async itemName() {
    return textOf(await this._request(message(CMD.REQUEST_ITEM_NAME), CMD.ITEM_NAME)).trim();
  }

  async itemValue() {
    return itemValueOf(await this._request(message(CMD.REQUEST_ITEM_VALUE), CMD.ITEM_VALUE));
  }

  // Presses or turns like a person at the panel (sysex.js REMOTE_EVENTS). No reply.
  remote(event) {
    return this._request(remote(event));
  }

  // Makes `dump` (from parseDump, possibly with edited values) the FH-2's current config or preset.
  install(dump, values = dump.values) {
    return this._request(buildDump(dump, values));
  }

  // Pulls the dump again and lists the fields that differ from what was installed.
  async verifyInstall(dump, values = dump.values) {
    const now = dump.kind === 'config' ? await this.pullConfig() : await this.pullPreset();
    return diff(DUMPS[dump.cmd].layout, values, now.values);
  }

  saveConfigToFlash(slot = 0) {
    return this._request(saveConfig(slot));
  }

  savePresetToFlash(slot = 0) {
    return this._request(savePreset(slot));
  }

  showMessage(text) {
    return this._request(displayMessage(text));
  }

  close() {
    this.transport.close();
  }
}
