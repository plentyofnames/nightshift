// What Get and Send compare (docs/build-plan.md, "One Get and one Send", your design 2026-11-09):
// the FH-2 as Night Shift last knew it, read or sent (the base), as it is now (theirs), and what you
// see (mine). No DOM, no MIDI.

import { diff, getPath } from '../fh2/layout.js';

// Get: the module's changes since `base`, as edits of `mine`. A field changed there and left as it was
// here comes in (`take`: [{ path, value }]); one changed on both sides keeps yours (`kept`: [path]).
export function mergeFromModule(layout, base, mine, theirs) {
  const take = [];
  const kept = [];
  for (const d of diff(layout, base, theirs)) {
    const m = getPath(mine, d.path);
    if (m === d.from) take.push({ path: d.path, value: d.to });
    else if (m !== d.to) kept.push(d.path);
  }
  return { take, kept };
}

// Send: what changed in the module since `base`, field by field ([{ path, from, to }]), leaving out
// what it changed to what you have anyway.
export const changedOutside = (layout, base, mine, theirs) =>
  diff(layout, base, theirs).filter((d) => getPath(mine, d.path) !== d.to);

const OBJECTS = {
  converter: (i) => `voice ${i + 1}`, trigger: (i) => `trigger ${i + 1}`, mapping: (i) => `CC mapping ${i + 1}`, euclid: (i) => `Euclid ${i + 1}`,
  srr: (i) => `shift register ${i + 1}`, clock: (i) => `clock ${i + 1}`, noteSequencer: (i) => `note sequencer ${i + 1}`,
  drumSequencer: () => 'drum sequencer', cvMidi: (i) => `input ${'XY'[i] ?? i + 1}`, output: (i) => `output ${i + 1}`, lfoReset: (i) => `LFO restart ${i + 1}`,
};

// Where a field sits, in a few words: "voice 3", "CC mapping 13", "the name", "tempoMin".
export function fieldPlace(path) {
  const [head, i] = path;
  if (head === 'name') return 'the name';
  if (typeof i === 'number') return OBJECTS[head]?.(i) ?? `${head} ${i + 1}`;
  return head;
}

// Fields as the places they sit in, each once: "voice 3, CC mapping 13 and 2 more".
export function placesText(paths, max = 4) {
  const places = [...new Set(paths.map(fieldPlace))];
  return places.length > max ? `${places.slice(0, max).join(', ')} and ${places.length - max} more` : places.join(', ');
}
