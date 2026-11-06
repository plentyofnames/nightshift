// Tunings: each voice can use a Scala scale (.scl) with a keyboard mapping (.kbm), or MTS, the one
// tuning of the whole FH-2 that arrives over MIDI (MTS-ESP, say). The choice is in the preset
// (per scene): scalaEnable, scalaScl, scalaKbm. The files sit in the FH-2's flash, 32 slots of each
// kind, installed by SysEx (11H, 12H; slots 1–32); no message reads one back, so Night Shift keeps
// what it installed in the project's names: `scala:scl:<slot>` and `scala:kbm:<slot>`, each
// { name, text } as JSON.
//
// Not measured yet (check T1): what scalaEnable's values mean (taken as 0 off, 1 Scala, 2 MTS), and
// whether scalaScl / scalaKbm count the slots from 0 (taken so: 0 is slot 1).

export const SLOTS = 32;
export const TUNINGS = [[0, 'Off'], [1, 'Scala'], [2, 'MTS']];
export const SLOT_FROM_PRESET = (v) => v + 1; // until T1 says otherwise
export const PRESET_FROM_SLOT = (slot) => slot - 1;

const key = (kind, slot) => `scala:${kind}:${slot}`;

// The files Night Shift knows in the 32 slots of `kind` ('scl' or 'kbm'): [{ slot, name, text }]
// or null where it doesn't know.
export function scalaFiles(names, kind) {
  return Array.from({ length: SLOTS }, (_, i) => {
    const raw = names?.[key(kind, i + 1)];
    if (!raw) return null;
    try {
      const f = JSON.parse(raw);
      return { slot: i + 1, name: String(f.name ?? ''), text: String(f.text ?? '') };
    } catch {
      return null;
    }
  });
}

// The change that records (or, with null, forgets) a file in a slot.
export const fileChange = (kind, slot, file) => ({ dump: 'names', path: [key(kind, slot)], value: file ? JSON.stringify({ name: file.name, text: file.text }) : null });

// The FH-2 takes the text as ASCII: other characters (in comments, mostly) become '?'.
export const asciiText = (text) => text.replace(/\r\n?/g, '\n').replace(/[^\t\n\x20-\x7e]/g, '?');

// A .scl file (huygens-fokker.org/scala/scl_format.html): comment lines start with '!'; the first
// other line is the description, the next the number of notes, then one pitch per line (cents with
// a '.', or a ratio, or a whole number), the last being the octave. { ok, description, count,
// error }.
export function parseScl(text) {
  const lines = asciiText(text).split('\n').filter((l) => !l.startsWith('!'));
  if (lines.length < 2) return { ok: false, error: 'no description and note count' };
  const description = lines[0].trim();
  const count = Number.parseInt(lines[1].trim(), 10);
  if (!Number.isFinite(count) || count < 0) return { ok: false, description, error: 'no note count' };
  const pitches = lines.slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  if (pitches.length < count) return { ok: false, description, count, error: `${count} notes, but ${pitches.length} given` };
  const bad = pitches.slice(0, count).find((p) => !/^(-?\d+\.\d*|-?\d*\.\d+|\d+\/\d+|\d+)$/.test(p));
  if (bad) return { ok: false, description, count, error: `“${bad}” is no pitch` };
  return { ok: true, description, count };
}

// A .kbm file (the same page): after comments, the map size, first and last note, middle note,
// reference note, its frequency, the formal octave's degree, then the map. { ok, size, reference,
// frequency, error }.
export function parseKbm(text) {
  const lines = asciiText(text).split('\n').filter((l) => !l.startsWith('!')).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 7) return { ok: false, error: 'fewer than its 7 numbers' };
  const n = lines.slice(0, 7).map((l) => Number(l.split(/\s+/)[0]));
  if (n.some((x) => !Number.isFinite(x))) return { ok: false, error: 'its first 7 lines aren’t all numbers' };
  const [size, first, last, middle, reference, frequency] = n;
  const map = lines.slice(7, 7 + size);
  if (map.length < size || map.some((m) => !/^(x|\d+)$/.test(m.split(/\s+/)[0]))) return { ok: false, error: `a map of ${size} keys expected` };
  if (first > last || middle < 0 || middle > 127 || reference < 0 || reference > 127) return { ok: false, error: 'notes out of range' };
  return { ok: true, size, reference, frequency };
}

// What a slot holds, for a list: "19-EDO (19 notes)" or "slot 5".
export function slotLabel(files, slot) {
  const f = files[slot - 1];
  return f ? `${slot}: ${f.name}` : `${slot}`;
}

// A voice's tuning as the preset holds it: { enable, scl (slot 1–32), kbm }.
export const voiceTuning = (c) => ({ enable: c.scalaEnable, scl: SLOT_FROM_PRESET(c.scalaScl), kbm: SLOT_FROM_PRESET(c.scalaKbm) });
// The changes for converter `i`'s tuning: any of enable, scl, kbm (slots 1–32).
export function setTuning(i, { enable, scl, kbm }) {
  const out = [];
  const p = (f, v) => out.push({ dump: 'preset', path: ['converter', i, f], value: v });
  if (enable != null) p('scalaEnable', enable);
  if (scl != null) p('scalaScl', PRESET_FROM_SLOT(scl));
  if (kbm != null) p('scalaKbm', PRESET_FROM_SLOT(kbm));
  return out;
}
