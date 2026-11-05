// A minimal FH-2 for the tests: it holds one config and one preset dump, answers the
// requests the client makes, and keeps what is installed. Replies arrive asynchronously,
// as they would over MIDI.

import { CMD, commandOf, message, screenshotMessage } from '../js/fh2/sysex.js';

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
      case CMD.SCREENSHOT: { // `picture` null: an FH-2 that doesn't answer
        const rows = this.menu.picture();
        return rows ? this._reply(port, screenshotMessage(rows)) : undefined;
      }
      case CMD.REQUEST_ITEM_NAME: return this._reply(port, text(CMD.ITEM_NAME, this.menu.itemName()));
      case CMD.REQUEST_ITEM_VALUE: return this._reply(port, message(CMD.ITEM_VALUE, [this.menu.level === 'name' ? 1 : 0, ...[...this.menu.itemValue()].map((c) => c.charCodeAt(0)), 0]));
      default: return;
    }
  }
}

// A small model of the FH-2's menus (fh2-notes.md, walked 2026-11-03): the main menu, Settings
// with its General pages, MIDI Forwarding, History Inclusion, USB Device Name and USB Device
// Settings. As on the module, turning while something is open changes it: `changes` counts
// changes to settings (choosing which route or type to look at isn't one), and `pressed`
// records every Settings item pressed, so tests can catch a careless walk. MIDI Forwarding and
// History Inclusion remember their cursor and editing state between visits (`forwarding`,
// `historyIncl`), as the module does. Calibrations (walked 2026-11-05): Load calibration turns
// through 70 slots and loads one on a press (`loaded`); Settings › Calibration › Startup shows
// each output's startup slot, and a turn on its Calibration field changes it (a change).
const PORTS = ['DIN', 'USB A', 'USB C', 'SEL'];
const TYPES = ['Note On/Off', 'CC', 'Pitch Bend', 'Real Time', 'Aftertouch'];
export const DEVICES = ['Generic', 'Launch Control', 'Launch Control XL', 'Launchpad Mini', 'Launchpad Pro', 'Launchpad Mini Mk3', 'Launchpad X', 'Launchpad Pro Mk3'];

const CAL_ITEMS = ['Auto-calibrate', 'Tuner', 'Load calibration', 'Save calibration', 'Reset calibration', 'Name calibration', 'View calibration'];

export class MenuModel {
  constructor({ pages, calibrations, startup } = {}) {
    this.main = ['Presets', 'Configurations', 'Sequencer Banks', 'Calibrations', 'Settings', 'Misc', 'Resets'];
    this.settings = ['General page 1', 'General page 2', 'General page 3', 'Calibration', 'MIDI Forwarding', 'History Inclusion',
      'USB Device Name', 'USB Device Settings', 'Reset Settings'];
    this.pages = pages ?? {
      'General page 1': [['Contrast', '127'], ['Enable DIN MIDI out', '0'], ['Menu wrap', '1']],
      'General page 2': [['Wake on MIDI', '1'], ['Local off USB A', '0']],
      'General page 3': [['Send CCs on preset ld', '1'], ['14 bit CC byte order', '0']],
    };
    for (const d of DEVICES) this.pages[d] ??= [['Echo MIDI', '0'], ['Takeover', d === 'Launchpad Mini Mk3' ? '1' : '0']];
    this.routes = Object.fromEntries(PORTS.flatMap((s) => PORTS.filter((d) => d !== s).map((d) => [`${s}>${d}`, s === 'USB A' && d === 'DIN' ? 'On' : 'Off'])));
    this.history = Object.fromEntries(TYPES.map((t) => [t, 'On']));
    this.name = '';
    this.level = 'overview';
    this.i = 0; // cursor in the current list
    this.page = null;
    this.parent = null; // the list a page was opened from: { level, i }
    this.screenState = null; // the open one of the two below
    this.forwarding = { field: 0, editing: false, a: 0, b: 0 }; // field 0 from, 1 to, 2 the route's On/Off
    this.historyIncl = { field: 0, editing: false, a: 0 }; // field 0 the type, 1 its On/Off
    this.changes = 0;
    this.pressed = [];
    // 70 slots: { output (0-based), name } or null; yours, as walked: 1–4 for outputs 1–4
    this.calibrations = calibrations ?? Array.from({ length: 70 }, (_, k) => (k < 4 ? { output: k, name: '' } : null));
    this.startup = startup ?? Array.from({ length: 64 }, (_, o) => (o < 4 ? o + 1 : 0)); // slot per output, 0 none
    this.loaded = []; // slots a press in Load calibration loaded
    this.slot = 0;
    this.startupState = { field: 0, editing: false, output: 0 };
  }

  list() {
    if (this.level === 'calibrations') return CAL_ITEMS;
    if (this.level === 'setcal') return ['Basic', 'Startup'];
    return this.level === 'main' ? this.main : this.level === 'settings' ? this.settings : this.level === 'devices' ? DEVICES : this.pages[this.page].map(([n]) => n);
  }

  dsts(src) {
    return PORTS.filter((d) => d !== PORTS[src]);
  }

  event(e) {
    const turn = e === 2 ? 1 : e === 3 ? -1 : 0;
    const wrap = (k, n) => (k + n) % n;
    if (e === 5) return Object.assign(this, { level: 'overview', i: 0 });
    const st = this.screenState;
    switch (this.level) {
      case 'overview':
        if (e === 1) Object.assign(this, { level: 'main', i: 0 });
        return;
      case 'main':
        if (turn) this.i = wrap(this.i + turn, this.main.length);
        else if (e === 1 && this.main[this.i] === 'Settings') Object.assign(this, { level: 'settings', i: 0 });
        else if (e === 1 && this.main[this.i] === 'Calibrations') Object.assign(this, { level: 'calibrations', i: 0 });
        else if (e === 4) Object.assign(this, { level: 'overview', i: 0 });
        return;
      case 'settings': {
        if (turn) return void (this.i = wrap(this.i + turn, this.settings.length));
        if (e === 4) return void Object.assign(this, { level: 'main', i: this.main.indexOf('Settings') });
        if (e !== 1) return;
        const item = this.settings[this.i];
        this.pressed.push(item);
        const back = { level: 'settings', i: this.i };
        if (/^General/.test(item)) Object.assign(this, { level: 'page', page: item, parent: back, i: 0 });
        else if (item === 'MIDI Forwarding') Object.assign(this, { level: 'forwarding', parent: back, screenState: this.forwarding });
        else if (item === 'History Inclusion') Object.assign(this, { level: 'historyIncl', parent: back, screenState: this.historyIncl });
        else if (item === 'USB Device Name') Object.assign(this, { level: 'name', parent: back });
        else if (item === 'USB Device Settings') Object.assign(this, { level: 'devices', parent: back, i: 0 });
        else if (item === 'Calibration') Object.assign(this, { level: 'setcal', i: 0 });
        return;
      }
      case 'calibrations': {
        if (turn) return void (this.i = wrap(this.i + turn, CAL_ITEMS.length));
        if (e === 4) return void Object.assign(this, { level: 'main', i: this.main.indexOf('Calibrations') });
        if (e !== 1) return;
        this.pressed.push(CAL_ITEMS[this.i]);
        if (CAL_ITEMS[this.i] === 'Load calibration') this.level = 'loadcal'; // where it was left (your FH-2 may reopen there)
        else this.changes++; // anything else here could start, save or reset something
        return;
      }
      case 'loadcal':
        if (turn) this.slot = wrap(this.slot + turn, 70);
        else if (e === 1) this.loaded.push(this.slot + 1);
        else if (e === 4) Object.assign(this, { level: 'calibrations', i: CAL_ITEMS.indexOf('Load calibration') });
        return;
      case 'setcal': {
        if (turn) return void (this.i = wrap(this.i + turn, 2));
        if (e === 4) return void Object.assign(this, { level: 'settings', i: this.settings.indexOf('Calibration') });
        if (e !== 1) return;
        this.pressed.push(['Basic', 'Startup'][this.i]);
        if (this.i === 1) this.level = 'startup'; // its cursor, an open field and the output shown stay as they were left (your FH-2)
        else this.changes++; // Basic sets an output's voltage as the cursor moves
        return;
      }
      case 'startup': {
        const t = this.startupState;
        if (e === 4) return void Object.assign(this, { level: 'setcal', i: 1 }); // from editing too
        if (e === 1) return void (t.editing = !t.editing);
        if (!turn) return;
        if (!t.editing) return void (t.field = Math.max(0, Math.min(1, t.field + turn)));
        if (t.field === 0) t.output = wrap(t.output + turn, 64);
        else {
          this.startup[t.output] = wrap(this.startup[t.output] + turn, 71);
          this.changes++;
        }
        return;
      }
      case 'devices':
        if (turn) this.i = wrap(this.i + turn, DEVICES.length);
        else if (e === 1) Object.assign(this, { level: 'page', page: DEVICES[this.i], parent: { level: 'devices', i: this.i }, i: 0 });
        else if (e === 4) Object.assign(this, this.parentOf('settings'));
        return;
      case 'page':
        if (turn) this.i = wrap(this.i + turn, this.pages[this.page].length);
        else if (e === 1) this.level = 'open';
        else if (e === 4) Object.assign(this, { level: this.parent.level, i: this.parent.i, parent: this.parent.level === 'devices' ? { level: 'settings', i: this.settings.indexOf('USB Device Settings') } : null });
        return;
      case 'open':
        if (turn) this.changes++;
        else if (e === 1 || e === 4) this.level = 'page';
        return;
      case 'forwarding': {
        if (e === 4) return void Object.assign(this, { level: 'settings', i: this.parent.i, screenState: null });
        if (e === 1) return void (st.editing = !st.editing);
        if (!turn) return;
        if (!st.editing) return void (st.field = Math.max(0, Math.min(2, st.field + turn)));
        if (st.field === 0) Object.assign(st, { a: wrap(st.a + turn, PORTS.length), b: 0 });
        else if (st.field === 1) st.b = wrap(st.b + turn, 3);
        else this.changes++; // the route's On/Off
        return;
      }
      case 'historyIncl': {
        if (e === 4) return void Object.assign(this, { level: 'settings', i: this.parent.i, screenState: null });
        if (e === 1) return void (st.editing = !st.editing);
        if (!turn) return;
        if (!st.editing) return void (st.field = Math.max(0, Math.min(1, st.field + turn)));
        if (st.field === 0) st.a = wrap(st.a + turn, TYPES.length);
        else this.changes++;
        return;
      }
      case 'name':
        if (turn) this.changes++;
        else if (e === 4) Object.assign(this, { level: 'settings', i: this.parent.i });
        return;
    }
  }

  parentOf(level) {
    return { level, i: this.settings.indexOf('USB Device Settings'), parent: null };
  }

  screen() {
    const item = () => this.list()[this.i];
    const st = this.screenState;
    switch (this.level) {
      case 'overview': return { mode: 0, lines: ['          Clk: None', 'CI        120.0bpm', '', ''] };
      case 'main': return { mode: 1, lines: ['', '', item(), ''] };
      case 'settings': return { mode: 1, lines: ['Settings', '', item(), ''] };
      case 'devices': return { mode: 1, lines: ['USB Device Settings', '', item(), ''] };
      case 'page': return { mode: 1, lines: [this.page, '', item(), ''] };
      case 'forwarding': {
        const src = PORTS[st.a];
        const dst = this.dsts(st.a)[st.b];
        return { mode: 1, lines: ['MIDI Forwarding', `from   ${src}`, `to     ${dst.padEnd(6)} ${this.routes[`${src}>${dst}`]}`, ''] };
      }
      case 'historyIncl': return { mode: 1, lines: ['Include in history', `${TYPES[st.a].padEnd(13)}${this.history[TYPES[st.a]]}`, '', ''] };
      case 'name': return { mode: 1, lines: ['USB Device Name', '', '', ''] };
      case 'calibrations': return { mode: 1, lines: ['Calibrations', '', item(), ''] };
      case 'setcal': return { mode: 1, lines: ['Calibration', '', item(), ''] };
      case 'loadcal': {
        const c = this.calibrations[this.slot];
        return { mode: 1, lines: [`Load calibration ${this.slot + 1}`, c?.name ?? '', c ? `For output ${c.output + 1}` : '<Empty>', ''] };
      }
      case 'startup': {
        const o = this.startupState.output;
        const k = this.startup[o];
        const match = k ? (this.calibrations[k - 1]?.output === o ? 'Match!' : '') : '(None)';
        return { mode: 1, lines: [`Output      ${o + 1}`, `Calibration ${k}  ${match}`, '', ''] };
      }
      default: return { mode: 1, lines: [this.pages[this.page][this.i][0], '', this.pages[this.page][this.i][1], ''] };
    }
  }

  // The display's pixels, as far as a walk looks at them: on Startup the box round the field the
  // cursor is on, dotted while it is closed and solid while it is open, where your FH-2 draws it
  // (Output rows 0–10, Calibration 10–20, or 12–22 when open; columns 71–84).
  picture() {
    const rows = Array.from({ length: 32 }, () => new Array(128).fill(0));
    if (this.level !== 'startup') return rows;
    const t = this.startupState;
    const [top, bottom] = t.field === 0 ? [0, 10] : t.editing ? [12, 22] : [10, 20];
    for (let x = 72; x <= 83; x++) {
      rows[top][x] = rows[bottom][x] = t.editing || x % 2 === 1 ? 1 : 0;
    }
    for (let y = top + 1; y < bottom; y++) rows[y][71] = rows[y][84] = t.editing || y % 2 === 0 ? 1 : 0;
    return rows;
  }

  itemName() {
    const st = this.screenState;
    if (this.level === 'open') return this.pages[this.page][this.i][0];
    if (this.level === 'forwarding') return ['MIDI Forwarding from', 'MIDI Forwarding to', `MIDI Forwarding from ${PORTS[st.a]} to ${this.dsts(st.a)[st.b]}`][st.field];
    if (this.level === 'historyIncl') return ['Include in history', TYPES[st.a]][st.field];
    if (this.level === 'name') return 'USB Device Name';
    if (this.level === 'loadcal') return 'Load calibration';
    if (this.level === 'startup') return ['Output', 'Calibration'][this.startupState.field];
    return 'Sorry';
  }

  itemValue() {
    const st = this.screenState;
    if (this.level === 'open') return this.pages[this.page][this.i][1];
    if (this.level === 'forwarding') return st.field === 0 ? PORTS[st.a] : this.dsts(st.a)[st.b];
    if (this.level === 'historyIncl') return TYPES[st.a];
    if (this.level === 'name') return `${this.name.padEnd(8)}\x01: cursor at 0 :  `;
    if (this.level === 'loadcal') return String(this.slot + 1);
    // a calibration of 0 comes back as text, not as a number (your FH-2, 2026-11-05)
    if (this.level === 'startup') return this.startupState.field ? (this.startup[this.startupState.output] ? String(this.startup[this.startupState.output]) : '(None)') : String(this.startupState.output + 1);
    return '';
  }
}
