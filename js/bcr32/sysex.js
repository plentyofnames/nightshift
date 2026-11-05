// The Behringer BCR32's stock firmware over SysEx, as far as Night Shift uses it so far: which
// firmware it runs, and its working preset read as BCL text. Both are reads. The framing and
// commands are from the community's reverse-engineered protocol (github.com/TheLazyGeekGuy/
// bcr32-studio, MIT; docs/BCR32-PROTOCOL-1.0.2.md), where these two were checked on a unit,
// and Behringer's own update protocol (github.com/MusicTribeOpenSource/0715-AAW).
//
// Never sent from here: STORE (72H), the bootloader (77H), the exports 07H–09H (one froze a
// unit), global settings (writing them froze one too).
//
// It also reads what the knobs send: which half of a 14-bit pair comes first, and which code a
// relative mode sends for one notch each way (hardware checks on checks.html).

export const MAKER = [0x00, 0x20, 0x32]; // Behringer
export const MODEL = 0x64; // BCR32
const ANY = 0x7f; // device byte of a request: any device

const frame = (cmd, ...data) => [0xf0, ...MAKER, ANY, MODEL, cmd, ...data, 0xf7];

export const productQuery = () => frame(0x00);
// The working preset (7FH) or slot 0–63, streamed back as BCL lines up to `$end`. The BCR32
// answers only in controller mode with the sequencer stopped.
export const presetRead = (slot = 0x7f) => frame(0x40, slot);

export const isBcr32 = (b) => b.length >= 8 && b[0] === 0xf0 && b[1] === MAKER[0] && b[2] === MAKER[1] && b[3] === MAKER[2]
  && b[5] === MODEL && b[b.length - 1] === 0xf7;

// The product reply: F0 00 20 32 <device> 64 00 01 xx xx <major> <minor> <patch> F7.
export function productOf(b) {
  if (!isBcr32(b) || b[6] !== 0x00 || b.length !== 14) return null;
  return { device: b[4], version: [b[10], b[11], b[12]], text: `${b[10]}.${b[11]}.${b[12]}` };
}

// One BCL line: F0 00 20 32 <device> 64 20 <hi> <lo> <ASCII…> F7, line number hi × 128 + lo.
export function bclLineOf(b) {
  if (!isBcr32(b) || b[6] !== 0x20 || b.length < 10) return null;
  return { index: b[7] * 128 + b[8], text: String.fromCharCode(...b.slice(9, -1)) };
}

// The name in a preset's BCL (`.name 'Night Shift'`), or ''.
export function presetName(lines) {
  for (const l of lines) {
    const m = /^\s*\.name\s+['"]?(.*?)['"]?\s*$/.exec(l);
    if (m) return m[1].trim();
  }
  return '';
}

// ---- what the knobs send

const isCc = (m) => m.length === 3 && (m[0] & 0xf0) === 0xb0;

// From CCs as they came ([[status, cc, value], …]): for each 14-bit pair seen (CC n below 32 and
// n + 32 on the same channel, one right after the other), which half came first.
// { msbFirst, lsbFirst, pairs: [{ channel, cc }] }.
export function pairOrder(messages) {
  let msbFirst = 0;
  let lsbFirst = 0;
  const pairs = new Map();
  const ccs = messages.filter(isCc);
  for (let k = 1; k < ccs.length; k++) {
    const [a, b] = [ccs[k - 1], ccs[k]];
    if ((a[0] & 15) !== (b[0] & 15)) continue;
    const ch = a[0] & 15;
    if (a[1] < 32 && b[1] === a[1] + 32) {
      msbFirst++;
      pairs.set(`${ch}:${a[1]}`, { channel: ch, cc: a[1] });
      k++;
    } else if (b[1] < 32 && a[1] === b[1] + 32) {
      lsbFirst++;
      pairs.set(`${ch}:${b[1]}`, { channel: ch, cc: b[1] });
      k++;
    }
  }
  return { msbFirst, lsbFirst, pairs: [...pairs.values()] };
}

// What a relative knob sends for one notch right (`up`) and one left (`down`), and whether the
// FH-2 takes it: it reads both 1/127 (two's complement) and 65/63 (64 ± n) by itself.
export function relativeCode(up, down) {
  if (up >= 1 && up <= 63 && down >= 65) return { code: '1/127', fh2: true, text: `${up} up, ${down} down: two’s complement, the FH-2 takes it` };
  // 64 ± n puts a notch down just below 64; a sign bit (64 + n up, n down) puts it near 0
  if (up >= 65 && down >= 32 && down <= 63) return { code: '65/63', fh2: true, text: `${up} up, ${down} down: 64 ± n, the FH-2 takes it` };
  if (up >= 65 && down >= 1 && down < 32) return { code: 'sign', fh2: false, text: `${up} up, ${down} down: a sign bit, the FH-2 reads the way down wrong` };
  return { code: 'other', fh2: false, text: `${up} up, ${down} down: not a code the FH-2 knows` };
}
