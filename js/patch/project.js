// Night Shift project files: one config, its scenes (presets), Night Shift's own names and the
// rack, in one JSON file. The dumps are kept as the FH-2's own bytes (base64 of the whole SysEx
// message), so a project opens exactly as it was saved, bytes Night Shift doesn't model included.

import { buildDump, parseDump } from '../fh2/sysex.js';
import { validHardware } from './hardware.js';

export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.nightshift.json';

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// `scenes` are parsed preset dumps; `scene` the one in view. `slots` are the flash slots
// (1–30) for the config and for each scene, null where none is chosen; `scenesOnly` the switch
// that keeps the config as it is; `held` what Night Shift last wrote to the FH-2's flash and the
// EC4, as fingerprints (patch/gig.js), for the pre-gig checklist.
export function projectToJson({ config, scenes, scene, names, hardware, slots = null, scenesOnly = false, held = {} }) {
  return JSON.stringify({
    nightshift: PROJECT_VERSION,
    saved: new Date().toISOString(),
    hardware,
    config: toBase64(buildDump(config)),
    scenes: scenes.map((s) => toBase64(buildDump(s))),
    marks: scenes.map((s) => s.marks ?? {}), // each scene's keep marks (edit.js keep)
    scene,
    names,
    slots,
    scenesOnly,
    held,
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
  // the keep marks, per scene; a project from before they were (they sat among the names, and so
  // showed in every scene) keeps that: its marks go onto every scene
  const isMark = (k) => /^keep:(lfo|level):\d+$/.test(k);
  const marksFrom = (m) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([k, v]) => isMark(k) && v === '1'));
  const old = Object.fromEntries(Object.entries(names).filter(([k]) => isMark(k)));
  for (const k of Object.keys(old)) delete names[k];
  scenes.forEach((s, i) => { s.marks = { ...old, ...marksFrom(j.marks?.[i]) }; });
  const slot = (v) => (Number.isInteger(v) && v >= 1 && v <= 30 ? v : null);
  return {
    config, scenes, names,
    scene: Number.isInteger(j.scene) && j.scene >= 0 && j.scene < scenes.length ? j.scene : 0,
    hardware: validHardware(j.hardware) ?? null,
    slots: { config: slot(j.slots?.config), scenes: scenes.map((_, i) => slot(j.slots?.scenes?.[i])) },
    scenesOnly: j.scenesOnly === true,
    held: heldFrom(j.held),
  };
}

// `held` as stored, keeping only well-formed parts: { flash: { at, configs: { slot: fp },
// presets: { slot: fp } }, ec4: { at, fp, fw: [major, minor] } }.
function heldFrom(j) {
  const out = {};
  const fps = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => /^\d+$/.test(k) && typeof v === 'string'));
  if (j?.flash && typeof j.flash.at === 'string') out.flash = { at: j.flash.at, configs: fps(j.flash.configs), presets: fps(j.flash.presets) };
  const e = j?.ec4;
  if (e && typeof e.at === 'string' && typeof e.fp === 'string') out.ec4 = { at: e.at, fp: e.fp, fw: Array.isArray(e.fw) && e.fw.length === 2 && e.fw.every(Number.isInteger) ? e.fw : null };
  return out;
}
