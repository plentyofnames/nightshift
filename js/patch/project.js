// Night Shift project files: one config, its scenes (presets), Night Shift's own names and the
// rack, in one JSON file. The dumps are kept as the FH-2's own bytes (base64 of the whole SysEx
// message), so a project opens exactly as it was saved, bytes Night Shift doesn't model included.

import { buildDump, parseDump } from '../fh2/sysex.js';
import { validHardware } from './hardware.js';

export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.nightshift.json';

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// `scenes` are parsed preset dumps; `scene` the one in view.
export function projectToJson({ config, scenes, scene, names, hardware }) {
  return JSON.stringify({
    nightshift: PROJECT_VERSION,
    saved: new Date().toISOString(),
    hardware,
    config: toBase64(buildDump(config)),
    scenes: scenes.map((s) => toBase64(buildDump(s))),
    scene,
    names,
  }, null, 2);
}

export function projectFromJson(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('not a Night Shift project (no JSON)');
  }
  if (!j || typeof j.nightshift !== 'number') throw new Error('not a Night Shift project');
  if (j.nightshift > PROJECT_VERSION) throw new Error(`made by a newer Night Shift (project version ${j.nightshift})`);
  const config = parseDump(fromBase64(j.config));
  if (config.kind !== 'config') throw new Error('its config is not a config dump');
  const scenes = (j.scenes ?? []).map((s) => parseDump(fromBase64(s)));
  if (scenes.some((s) => s.kind !== 'preset')) throw new Error('one of its scenes is not a preset dump');
  const names = j.names && typeof j.names === 'object' ? Object.fromEntries(Object.entries(j.names).filter(([, v]) => typeof v === 'string')) : {};
  return {
    config, scenes, names,
    scene: Number.isInteger(j.scene) && j.scene >= 0 && j.scene < scenes.length ? j.scene : 0,
    hardware: validHardware(j.hardware) ?? null,
  };
}
