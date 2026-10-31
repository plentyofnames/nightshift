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
      default: return;
    }
  }
}
