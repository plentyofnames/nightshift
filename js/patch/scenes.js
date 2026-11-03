// Scenes: one config, several presets. The FH-2 doesn't tie presets to configs (a preset is
// values per slot: output 5's LFO, Euclid 3's pattern, converter 2's envelope), so Night Shift
// says what a scene changes against another, and what in a preset this config doesn't use.

import { diff } from '../fh2/layout.js';
import { DUMPS } from '../fh2/sysex.js';
import { jackName } from './hardware.js';

// What `b` changes against `a` (two presets' values), in a few words per part, in order:
// ['jack 5 (LFO)', 'Euclid 2', 'Voice 1 (arp)', 'tempo'].
export function sceneDifferences(a, b, hardware) {
  const parts = new Map();
  const add = (key, what) => {
    if (!parts.has(key)) parts.set(key, new Set());
    if (what) parts.get(key).add(what);
  };
  for (const { path } of diff(DUMPS[0x13].layout, a, b)) {
    const [area, i, field] = path;
    if (area === 'name' || area === 'version') continue;
    if (area === 'output') add(`jack ${jackName(i, hardware)}`, field === 'directLevel' ? 'level' : field === 'smoothing' ? 'smoothing' : 'LFO');
    else if (area === 'euclid') add(`Euclid ${i + 1}`);
    else if (area === 'converter') add(`Voice ${i + 1}`, /^arp/.test(field) ? 'arp' : /^env/.test(field) ? 'envelope' : field === 'portamento' ? 'glide' : field === 'transpose' ? 'transpose' : 'settings');
    else if (area === 'noteSequencer') add(`sequence ${i + 1}`);
    else if (area === 'drumSequencer') add('drum pattern');
    else if (area === 'srr') add(`Random ${i + 1}`);
    else if (/^noteSequencer(Active|Mute)\d$/.test(area)) add(`sequence ${Number(area.slice(-1)) + 1}`, /Active/.test(area) ? 'running' : 'mute');
    else if (area === 'triggerState') add('trigger states');
    else if (/^drumSequencer/.test(area)) add('drum pattern');
    else if (/^swing/.test(area)) add('swing');
    else add(area);
  }
  return [...parts].map(([k, s]) => (s.size ? `${k} (${[...s].join(', ')})` : k));
}

// What preset `preset` sets that config view `view` (derive's result) has no use for: a hint
// that the preset was made for another config. Each as a short sentence.
export function fitProblems(view, config, preset) {
  const out = [];
  const euclidUsed = (i) => view.sources.some((s) => s.id === `euclid:${i}` && !s.parked && (!s.jackless || s.used))
    || view.players.some((p) => p.clock === i + 1)
    || view.outputs.some((o) => o.lfoReset?.typeIndex === 7 && o.lfoReset.number === i);
  preset.euclid.forEach((e, i) => {
    if (e.pulses > 0 && !euclidUsed(i)) out.push(`Euclid ${i + 1} has a pattern, but no jack and nothing it clocks`);
  });
  preset.converter.forEach((c, i) => {
    if (c.arpMode > 10 && !config.converter[i].enable) out.push(`Voice ${i + 1}’s arpeggiator is on, but there’s no Voice ${i + 1}`);
  });
  const sends = (q) => q.toInternal || q.toUsbC || q.toUsbA || q.toDin || q.toSelect;
  config.noteSequencer.forEach((q, j) => {
    if (preset['noteSequencerActive' + j] && !sends(q)) out.push(`Note sequencer ${j + 1} is running, but sends nowhere`);
  });
  if (preset.drumSequencerActive && !sends(config.drumSequencer[0])) out.push('The drum sequencer is running, but sends nowhere');
  view.outputs.forEach((o) => {
    if (o.lfo && !o.present) out.push(`An LFO on ${o.jack}, which isn’t in your rack`);
  });
  return out;
}

// Flash slots: 1–30 for configs and presets each.
export const SLOTS = Array.from({ length: 30 }, (_, i) => i + 1);
