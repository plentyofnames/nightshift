// What Night Shift's BCR32 thru passes on to the FH-2 while the BCR32 is on the Mac (your call,
// 2026-11-14): everything on a channel the FH-2 listens to (its voices, triggers and CC mappings,
// and its scene program changes), so the tracks play it as they would from its USB A; and Night
// Shift's knobs, wherever they send. Never SysEx (Rotary Club's protocol, Night Shift's own) nor the
// clock and transport (the FH-2 has its own clock master). No MIDI here.

// The channels (0–15) the FH-2 listens to, from derive()'s view and the config's values.
export function fh2Channels(view, config) {
  const out = new Set((view?.channels ?? []).filter((c) => c.listeners.length).map((c) => c.channel));
  if (config?.presetProgramChannel) out.add(config.presetProgramChannel - 1);
  return out;
}

// Whether message `bytes` goes on to the FH-2. `channels` from fh2Channels; `knobs`: Night Shift's
// knobs on the BCR32 as 'channel:cc' (a 14-bit knob's LSB too).
export function passes(bytes, channels, knobs) {
  const st = bytes[0];
  if (st < 0x80 || st >= 0xf0) return false;
  const ch = st & 15;
  return channels.has(ch) || ((st & 0xf0) === 0xb0 && knobs.has(`${ch}:${bytes[1]}`));
}
