// FH-2 SysEx framing (FH-2 manual 2.0, "MIDI System Exclusive"):
// F0 00 21 27 2F <command> <payload> F7.

import { decode, encode } from './layout.js';
import { config, CONFIG_VERSION } from './config.js';
import { preset, PRESET_VERSION } from './preset.js';

export const HEADER = [0xF0, 0x00, 0x21, 0x27, 0x2F];

export const CMD = {
  SCREENSHOT: 0x01,
  DISPLAY_MESSAGE: 0x02,
  INSTALL_CONFIG: 0x10, // also the reply to REQUEST_CONFIG
  INSTALL_PRESET: 0x13, // also the reply to REQUEST_PRESET
  SAVE_CONFIG: 0x18,
  SAVE_PRESET: 0x19,
  REQUEST_CONFIG: 0x21,
  REQUEST_VERSION: 0x22,
  REQUEST_PRESET: 0x23,
  INSTALL_SCL: 0x11, // a Scala scale into one of 32 slots (1–32), as Expert Sleepers' Scala tool sends it
  INSTALL_KBM: 0x12, // a Scala keyboard mapping likewise
  REQUEST_SEQ_BANK: 0x14, // 0: the active bank, 1–8: a bank in flash; the reply is an INSTALL_SEQ_BANK
  INSTALL_SEQ_BANK: 0x15,
  REQUEST_DRUM_BANK: 0x16, // likewise for the drum sequencer
  INSTALL_DRUM_BANK: 0x17,
  MESSAGE: 0x32, // the reply to REQUEST_VERSION
  SCREENSHOT_REPLY: 0x33,
  REQUEST_SCREEN_TEXT: 0x41,
  SCREEN_TEXT: 0x42,
  REQUEST_ITEM_NAME: 0x43, // the name of the menu item open on the display
  REQUEST_ITEM_VALUE: 0x44, // and its value
  ITEM_NAME: 0x45,
  ITEM_VALUE: 0x46,
  TEXT_ENTRY: 0x47, // sets the open item to a string, if it is a name
  REMOTE: 0x48, // simulates the panel: see REMOTE_EVENTS
  REQUEST_CONFIG_NAME: 0x49, // the reply uses the same number
  REQUEST_PRESET_NAME: 0x4A, // likewise
};

export function isFh2(msg) {
  if (!msg || msg.length < 7 || msg[msg.length - 1] !== 0xF7) return false;
  for (let i = 0; i < HEADER.length; i++) if (msg[i] !== HEADER[i]) return false;
  return true;
}

export const commandOf = (msg) => (isFh2(msg) ? msg[5] : -1);

// 33H: the display as 128 × 32 pixels (Expert Sleepers' screenshot tool): after `… 33 00 00`, 512
// bytes as pairs of 7 bits (low first), four bytes per column, bit y the row y. Rows of 0/1.
export function screenshotOf(msg) {
  const data = msg.slice(8, -1);
  const bytes = Array.from({ length: 512 }, (_, i) => (data[2 * i] ?? 0) | ((data[2 * i + 1] ?? 0) << 7));
  const cols = Array.from({ length: 128 }, (_, x) => (bytes[4 * x] | (bytes[4 * x + 1] << 8) | (bytes[4 * x + 2] << 16) | (bytes[4 * x + 3] << 24)) >>> 0);
  return Array.from({ length: 32 }, (_, y) => cols.map((c) => (c >>> y) & 1));
}

// The other way round, for a stand-in.
export function screenshotMessage(rows) {
  const bytes = [];
  for (let x = 0; x < 128; x++) {
    let c = 0;
    for (let y = 0; y < 32; y++) if (rows[y]?.[x]) c |= 1 << y;
    bytes.push(c & 255, (c >>> 8) & 255, (c >>> 16) & 255, (c >>> 24) & 255);
  }
  return [...HEADER, CMD.SCREENSHOT_REPLY, 0, 0, ...bytes.flatMap((b) => [b & 127, b >> 7]), 0xF7];
}

export function message(cmd, payload = []) {
  return Uint8Array.from([...HEADER, cmd, ...payload, 0xF7]);
}

const ascii = (s) => [...s].map((c) => c.charCodeAt(0) & 0x7f);

export const displayMessage = (text) => message(CMD.DISPLAY_MESSAGE, [...ascii(text), 0]);
// 11H / 12H: a .scl or .kbm file's text into slot 1–32 (there is no message to read one back).
export const sclMessage = (slot, text) => message(CMD.INSTALL_SCL, [slot, ...ascii(text)]);
export const kbmMessage = (slot, text) => message(CMD.INSTALL_KBM, [slot, ...ascii(text)]);
// 47H: the open item, if it is a name, set to `text` (as the manual gives it: no 0 at the end)
export const textEntry = (text) => message(CMD.TEXT_ENTRY, ascii(text));
export const saveConfig = (slot = 0) => message(CMD.SAVE_CONFIG, [slot]); // 0 = the slot last loaded or saved

// 48H: an encoder press or turn, or a left-button press or long hold.
export const REMOTE_EVENTS = { press: 1, cw: 2, ccw: 3, left: 4, home: 5 };
export const remote = (event) => message(CMD.REMOTE, [REMOTE_EVENTS[event]]);
export const savePreset = (slot = 0) => message(CMD.SAVE_PRESET, [slot]);

// Text replies (32H, 49H, 4AH): ASCII after the command, up to a 0 or the F7.
export function textOf(msg, skip = 0) {
  let s = '';
  for (let i = 6 + skip; i < msg.length - 1 && msg[i] !== 0; i++) s += String.fromCharCode(msg[i]);
  return s;
}

// 42H: display mode, then 4 lines of 32 characters. Blank characters come as 0 bytes, so this
// reads all 128, not up to the first 0.
export function screenTextOf(msg) {
  const mode = msg[6];
  let text = '';
  for (let i = 7; i < msg.length - 1 && i < 7 + 128; i++) text += msg[i] ? String.fromCharCode(msg[i]) : ' ';
  text = text.padEnd(128, ' ');
  const lines = [0, 1, 2, 3].map((i) => text.slice(32 * i, 32 * i + 32));
  return { mode, lines };
}

// 46H: whether the item is a name, then its value as text.
export const itemValueOf = (msg) => ({ isName: !!msg[6], text: textOf(msg, 1).trim() });

// Config and preset dumps: 8 header bytes (… cmd 00 00), the body, F7.

export const DUMPS = {
  [CMD.INSTALL_CONFIG]: { kind: 'config', layout: config, version: CONFIG_VERSION },
  [CMD.INSTALL_PRESET]: { kind: 'preset', layout: preset, version: PRESET_VERSION },
};

// A .syx file may hold several messages; returns each F0…F7 run.
export function splitSysex(bytes) {
  const out = [];
  let start = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0xF0) start = i;
    else if (bytes[i] === 0xF7 && start >= 0) {
      out.push(bytes.slice(start, i + 1));
      start = -1;
    }
  }
  return out;
}

export function bodyOf(msg) {
  return msg.slice(8, msg.length - 1);
}

export function dumpMessage(cmd, body) {
  return Uint8Array.from([...HEADER, cmd, 0x00, 0x00, ...body, 0xF7]);
}

// A parsed dump keeps its body, so encoding writes over it and leaves unknown bytes alone.
// A body byte with bit 7 set (the official config tool writes a gamepad's or keyboard's "None"
// output as FF, fh2-notes.md) is a status byte with no place in SysEx: it is masked, and
// `masked` counts them, so the module is never sent one.
export function parseDump(msg) {
  const d = DUMPS[commandOf(msg)];
  if (!d) throw new Error('not an FH-2 config or preset dump');
  const body = bodyOf(msg);
  let masked = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] & 0x80) {
      body[i] &= 0x7f;
      masked++;
    }
  }
  const values = decode(d.layout, body);
  return { kind: d.kind, cmd: commandOf(msg), body, values, versionOk: values.version === d.version, masked };
}

export function buildDump(dump, values = dump.values) {
  const d = DUMPS[dump.cmd];
  return dumpMessage(dump.cmd, encode(d.layout, values, dump.body));
}
