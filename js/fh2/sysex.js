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
  MESSAGE: 0x32, // the reply to REQUEST_VERSION
  REQUEST_SCREEN_TEXT: 0x41,
  SCREEN_TEXT: 0x42,
  REQUEST_CONFIG_NAME: 0x49, // the reply uses the same number
  REQUEST_PRESET_NAME: 0x4A, // likewise
};

export function isFh2(msg) {
  if (!msg || msg.length < 7 || msg[msg.length - 1] !== 0xF7) return false;
  for (let i = 0; i < HEADER.length; i++) if (msg[i] !== HEADER[i]) return false;
  return true;
}

export const commandOf = (msg) => (isFh2(msg) ? msg[5] : -1);

export function message(cmd, payload = []) {
  return Uint8Array.from([...HEADER, cmd, ...payload, 0xF7]);
}

const ascii = (s) => [...s].map((c) => c.charCodeAt(0) & 0x7f);

export const displayMessage = (text) => message(CMD.DISPLAY_MESSAGE, [...ascii(text), 0]);
export const saveConfig = (slot = 0) => message(CMD.SAVE_CONFIG, [slot]); // 0 = the slot last loaded or saved
export const savePreset = (slot = 0) => message(CMD.SAVE_PRESET, [slot]);

// Text replies (32H, 49H, 4AH): ASCII after the command, up to a 0 or the F7.
export function textOf(msg, skip = 0) {
  let s = '';
  for (let i = 6 + skip; i < msg.length - 1 && msg[i] !== 0; i++) s += String.fromCharCode(msg[i]);
  return s;
}

// 42H: display mode, then 4 lines of 32 characters.
export function screenTextOf(msg) {
  const mode = msg[6];
  const text = textOf(msg, 1).padEnd(128, ' ');
  const lines = [0, 1, 2, 3].map((i) => text.slice(32 * i, 32 * i + 32));
  return { mode, lines };
}

// Config and preset dumps: 8 header bytes (… cmd 00 00), the body, F7.

export const DUMPS = {
  [CMD.INSTALL_CONFIG]: { kind: 'config', layout: config, version: CONFIG_VERSION },
  [CMD.INSTALL_PRESET]: { kind: 'preset', layout: preset, version: PRESET_VERSION },
};

export function bodyOf(msg) {
  return msg.slice(8, msg.length - 1);
}

export function dumpMessage(cmd, body) {
  return Uint8Array.from([...HEADER, cmd, 0x00, 0x00, ...body, 0xF7]);
}

// A parsed dump keeps its body, so encoding writes over it and leaves unknown bytes alone.
export function parseDump(msg) {
  const d = DUMPS[commandOf(msg)];
  if (!d) throw new Error('not an FH-2 config or preset dump');
  const body = bodyOf(msg);
  const values = decode(d.layout, body);
  return { kind: d.kind, cmd: commandOf(msg), body, values, versionOk: values.version === d.version };
}

export function buildDump(dump, values = dump.values) {
  const d = DUMPS[dump.cmd];
  return dumpMessage(dump.cmd, encode(d.layout, values, dump.body));
}
