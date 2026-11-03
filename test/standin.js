// A minimal FH-2 for the tests: it holds one config and one preset dump, answers the
// requests the client makes, and keeps what is installed. Replies arrive asynchronously,
// as they would over MIDI.

import { CMD, commandOf, message } from '../js/fh2/sysex.js';

export class Fh2StandIn {
  constructor({ config, preset, version = 'v2.0', silent = false } = {}) {
    this.config = config;
    this.preset = preset;
    this.versionText = version;
    this.silent = silent; // never answers: for timeout tests
    this.received = [];
    this.saved = [];
    this.menu = new MenuModel();
  }

  transport() {
    const port = {
      name: 'FH-2 (stand-in)',
      onmessage: null,
      send: (bytes) => this._receive(Uint8Array.from(bytes), port),
      close() {},
    };
    return port;
  }

  _reply(port, bytes) {
    if (!this.silent) setTimeout(() => port.onmessage?.(bytes), 0);
  }

  _receive(bytes, port) {
    this.received.push(bytes);
    const text = (cmd, s) => message(cmd, [...[...s].map((c) => c.charCodeAt(0)), 0]);
    switch (commandOf(bytes)) {
      case CMD.REQUEST_VERSION: return this._reply(port, text(CMD.MESSAGE, this.versionText));
      case CMD.REQUEST_CONFIG: return this._reply(port, this.config);
      case CMD.REQUEST_PRESET: return this._reply(port, this.preset);
      case CMD.INSTALL_CONFIG: this.config = bytes; return;
      case CMD.INSTALL_PRESET: this.preset = bytes; return;
      case CMD.SAVE_CONFIG: case CMD.SAVE_PRESET: this.saved.push([bytes[5], bytes[6]]); return;
      case CMD.REMOTE: this.menu.event(bytes[6]); return;
      case CMD.REQUEST_SCREEN_TEXT: {
        const { mode, lines } = this.menu.screen();
        const chars = lines.map((l) => l.padEnd(32, ' ').slice(0, 32)).join('');
        return this._reply(port, message(CMD.SCREEN_TEXT, [mode, ...[...chars].map((c) => (c === ' ' ? 0 : c.charCodeAt(0)))]));
      }
      case CMD.REQUEST_ITEM_NAME: return this._reply(port, text(CMD.ITEM_NAME, this.menu.itemName()));
      case CMD.REQUEST_ITEM_VALUE: return this._reply(port, message(CMD.ITEM_VALUE, [0, ...[...this.menu.itemValue()].map((c) => c.charCodeAt(0)), 0]));
      default: return;
    }
  }
}

// A small model of the FH-2's menus (fh2-notes.md): the main menu, Settings and three pages of
// settings. As on the module, a turn while a setting is open changes it; `changes` counts that,
// and `pressed` records every item pressed, so tests can catch a careless walk.
export class MenuModel {
  constructor({ pages } = {}) {
    this.main = ['Presets', 'Configurations', 'Sequencer Banks', 'Calibrations', 'Settings', 'Misc', 'Resets'];
    this.settings = ['General page 1', 'General page 2', 'General page 3', 'Calibration', 'MIDI Forwarding', 'History Inclusion',
      'USB Device Name', 'USB Device Settings', 'Reset Settings'];
    this.pages = pages ?? {
      'General page 1': [['Contrast', '127'], ['Enable DIN MIDI out', '0'], ['Menu wrap', '1']],
      'General page 2': [['Wake on MIDI', '1'], ['Local off USB A', '0']],
      'General page 3': [['Send CCs on preset ld', '1'], ['14 bit CC byte order', '0']],
    };
    this.level = 'overview';
    this.i = 0; // cursor in the current list
    this.page = null;
    this.changes = 0;
    this.pressed = [];
  }

  list() {
    return this.level === 'main' ? this.main : this.level === 'settings' ? this.settings : this.pages[this.page].map(([n]) => n);
  }

  event(e) {
    const wrap = (k) => (k + this.list().length) % this.list().length;
    if (e === 5) return Object.assign(this, { level: 'overview', i: 0 });
    switch (this.level) {
      case 'overview':
        if (e === 1) Object.assign(this, { level: 'main', i: 0 });
        return;
      case 'main':
        if (e === 2 || e === 3) this.i = wrap(this.i + (e === 2 ? 1 : -1));
        else if (e === 1 && this.main[this.i] === 'Settings') Object.assign(this, { level: 'settings', i: 0 });
        else if (e === 4) Object.assign(this, { level: 'overview', i: 0 });
        return;
      case 'settings':
        if (e === 2 || e === 3) this.i = wrap(this.i + (e === 2 ? 1 : -1));
        else if (e === 1) {
          this.pressed.push(this.settings[this.i]);
          if (this.pages[this.settings[this.i]]) Object.assign(this, { level: 'page', page: this.settings[this.i], back: this.i, i: 0 });
        } else if (e === 4) Object.assign(this, { level: 'main', i: this.main.indexOf('Settings') });
        return;
      case 'page':
        if (e === 2 || e === 3) this.i = wrap(this.i + (e === 2 ? 1 : -1));
        else if (e === 1) this.level = 'open';
        else if (e === 4) Object.assign(this, { level: 'settings', i: this.back });
        return;
      case 'open':
        if (e === 2 || e === 3) this.changes++;
        else if (e === 1 || e === 4) this.level = 'page';
        return;
    }
  }

  screen() {
    const item = () => this.list()[this.i];
    switch (this.level) {
      case 'overview': return { mode: 0, lines: ['          Clk: None', 'CI        120.0bpm', '', ''] };
      case 'main': return { mode: 1, lines: ['', '', item(), ''] };
      case 'settings': return { mode: 1, lines: ['Settings', '', item(), ''] };
      case 'page': return { mode: 1, lines: [this.page, '', item(), ''] };
      default: return { mode: 1, lines: [this.pages[this.page][this.i][0], '', this.pages[this.page][this.i][1], ''] };
    }
  }

  itemName() {
    return this.level === 'open' ? this.pages[this.page][this.i][0] : 'Sorry';
  }

  itemValue() {
    return this.level === 'open' ? this.pages[this.page][this.i][1] : '';
  }
}
