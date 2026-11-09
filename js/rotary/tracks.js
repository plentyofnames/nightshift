// The BCR32's sequencer tracks as Rotary Club tells them (0.29 on): a read-only space 3 of 272 bytes,
// a head and 16 bytes per track (bcr32-fw docs/controller-protocol.md, "The tracks"). Night Shift reads
// it to offer each track as a source on the FH-2 (docs/build-plan.md, "The BCR32's tracks on the FH-2");
// `35 counter` from the unit says it changed. No MIDI here.

export const TRACKS_SPACE = 3;
export const TRACKS_LEN = 272; // two READs: 0 +256, 256 +16
export const TRACKS_CHANGED = 0x35; // the event: 35 counter
export const MACHINES = ['M303', 'TD-3', 'Generic', 'Plaits']; // as the setup stores them
export const OUTPUTS = ['USB', 'DIN A', 'DIN B'];
export const SENDERS = ['off', 'CC', 'PC', 'AT', 'PB']; // CTRL α / β: off, a CC, program change, aftertouch, pitch bend

export const hasTracks = (info) => !!info && (info.fwMajor > 0 || info.fwMinor >= 29);
const signed = (b) => (b > 127 ? b - 256 : b);

// The tracks from the 272 bytes: { version, counter, tracks: [{ index, channel (0–15), machine,
// machineId, output, a, b ({ type, cc }), muted, plaits ({ chordCc, chordTrim, timbreCc or null,
// timbreTrim }) or null, m303 ({ slide, accent } notes) or null }] }.
export function parseTracks(img) {
  if (img.length < 16) throw new Error('the tracks: too short');
  if (img[0] !== 1) throw new Error(`the tracks’ version ${img[0]}: Night Shift knows 1`);
  const [n, size] = [img[1], img[2]];
  if (size < 14 || img.length < 16 + n * size) throw new Error(`the tracks: ${img.length} bytes for ${n} of ${size}`);
  const tracks = Array.from({ length: n }, (_, t) => {
    const r = img.subarray(16 + size * t, 16 + size * (t + 1));
    return {
      index: t, channel: r[0] & 15, machine: MACHINES[r[1]] ?? `machine ${r[1]}`, machineId: r[1], output: OUTPUTS[r[2]] ?? `output ${r[2]}`,
      a: { type: SENDERS[r[3]] ?? `sender ${r[3]}`, cc: r[4] }, b: { type: SENDERS[r[5]] ?? `sender ${r[5]}`, cc: r[6] }, muted: r[7] === 1,
      plaits: r[1] === 3 ? { chordCc: r[8], chordTrim: signed(r[9]), timbreCc: r[10] === 128 ? null : r[10], timbreTrim: signed(r[11]) } : null,
      m303: r[1] === 0 ? { slide: r[12], accent: r[13] } : null,
    };
  });
  return { version: img[0], counter: img[3], tracks };
}

const sender = (s) => (s.type === 'CC' ? `CC ${s.cc}` : s.type);
// "TR3 ch 8 Plaits → USB · α CC 30 · β PB"
export const trackLine = (t) => `TR${t.index + 1} ch ${t.channel + 1} ${t.machine} → ${t.output}${t.muted ? ' (muted)' : ''} · α ${sender(t.a)} · β ${sender(t.b)}`;

// What differs between two readings, track by track, in words.
export function trackChanges(before, after) {
  return after.tracks.map((t, i) => [trackLine(before.tracks[i] ?? t), trackLine(t)]).filter(([a, b]) => a !== b).map(([a, b]) => `${a}  →  ${b.replace(/^TR\d+ /, '')}`);
}
