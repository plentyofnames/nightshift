// Which expanders are installed, what they are called, and how the FH-2 numbers outputs.
//
// Inside the FH-2, outputs are numbered 0–127: 0–7 the FH-2 itself, 8–63 the FHX-8CVs
// (8 per jumper address 1–7), 64–127 the gate outputs, 16 per gate address 0–3: an
// FHX-8GT gives 1–8 of its address and whatever is attached to it (an ESX-8GT) 9–16.
// Expert Sleepers' tool writes these as "1".."8", "1/1".."7/8" and "GT0/1".."GT3/16".
//
// People see their rack: the CV expanders as CV1, CV2… and the gate modules as GT1,
// GT2…, in rack order, each with jacks 1–8. The hardware setup says which internal
// block of 8 outputs each module is, so "GT2·3" can be GT0/11 in one rack and GT1/3 in
// another.

export const HARDWARE_VERSION = 2;

// cv: FHX-8CV jumper addresses, in rack order (CV1, CV2…).
// gt: gate blocks of 8, in rack order (GT1, GT2…); block b = internal GT(b >> 1)/(8·(b & 1) + 1…+8).
// controllers: the ones Night Shift makes pages for, 'ec4' and 'bcr32' (your call, 2026-11-08:
// switched on and off beside the expanders); a rack kept from before has both.
// The default: one FHX-8CV, and an FHX-8GT with an ESX-8GT on it (your rack, 2026-11-03).
export const CONTROLLERS = [['ec4', 'EC4'], ['bcr32', 'BCR32']];
export const DEFAULT_HARDWARE = { version: HARDWARE_VERSION, cv: [1], gt: [0, 1], controllers: ['ec4', 'bcr32'] };
// The rack the example patch is made for: two FHX-8CVs. Also what derive() assumes when it is
// given no rack (the tests).
export const EXAMPLE_HARDWARE = { version: HARDWARE_VERSION, cv: [1, 2], gt: [0, 1] };

export const isGate = (output) => output >= 64;

// Whether Night Shift makes pages for controller `id` ('ec4', 'bcr32').
export const hasController = (hardware, id) => !Array.isArray(hardware?.controllers) || hardware.controllers.includes(id);

// Expert Sleepers' name for an output, as in their tool and the FH-2's menus.
export function internalName(output) {
  if (output < 8) return String(output + 1);
  if (output < 64) return `${output >> 3}/${(output & 7) + 1}`;
  const o = output - 64;
  return `GT${o >> 4}/${(o & 15) + 1}`;
}

// The FH-2's own single number for the output, 1–128.
export const outputNumber = (output) => output + 1;

export const blockName = (b) => `GT${b >> 1}/${(b & 1) * 8 + 1}–${(b & 1) * 8 + 8}`;

// The modules in rack order: the FH-2, the CV expanders, then the gate modules.
export function rack(hardware) {
  const out = [{ kind: 'fh2', name: 'FH-2', internal: '1–8', outputs: range8(0) }];
  hardware.cv.forEach((a, k) => out.push({ kind: 'cv', name: `CV${k + 1}`, address: a, internal: `${a}/1–8`, outputs: range8(8 * a) }));
  hardware.gt.forEach((b, k) => out.push({ kind: 'gt', name: `GT${k + 1}`, block: b, internal: blockName(b), outputs: range8(64 + 8 * b) }));
  return out;
}

const range8 = (first) => Array.from({ length: 8 }, (_, j) => first + j);

// "3" on the FH-2, "CV1·3", "GT2·3" on the expanders; Expert Sleepers' name for an output
// that is not in the rack.
export function jackName(output, hardware = DEFAULT_HARDWARE) {
  if (output < 8) return String(output + 1);
  for (const m of rack(hardware)) {
    const j = m.outputs.indexOf(output);
    if (j >= 0) return `${m.name}·${j + 1}`;
  }
  return internalName(output);
}

export function isPresent(hardware, output) {
  return output < 8 || rack(hardware).some((m) => m.outputs.includes(output));
}

// Hardware settings from older versions or elsewhere: keep them only if they make sense.
export function validHardware(hw) {
  const ok = hw && hw.version === HARDWARE_VERSION && Array.isArray(hw.cv) && Array.isArray(hw.gt)
    && hw.cv.every((a) => Number.isInteger(a) && a >= 1 && a <= 7) && hw.gt.every((b) => Number.isInteger(b) && b >= 0 && b <= 7)
    && (hw.controllers === undefined || (Array.isArray(hw.controllers) && hw.controllers.every((c) => CONTROLLERS.some(([id]) => id === c))));
  return ok ? hw : null;
}
