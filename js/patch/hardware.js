// Which expanders are installed, and how the FH-2 numbers outputs.
//
// Outputs as stored: 0–7 the FH-2, 8–63 the FHX-8CVs (8 per expander, addresses 1–7),
// 64–127 the FHX-8GTs (16 per address 0–3: 8 on the FHX-8GT, 8 on an attached ESX-8GT).
// Jacks are named after the module and its address, as Expert Sleepers' tool does:
// "3" on the FH-2, "C1·3" on CV expander 1, "G0·3" on gate expander 0.

export const DEFAULT_HARDWARE = { cv: [1, 2], gt: [0, 1], esx: [] };

export const isGate = (output) => output >= 64;

export function jackName(output) {
  if (output < 8) return String(output + 1);
  if (output < 64) return `C${output >> 3}·${(output & 7) + 1}`;
  const o = output - 64;
  return `G${o >> 4}·${(o & 15) + 1}`;
}

// The FH-2's own single number for the output, 1–128, as its menus show it.
export const outputNumber = (output) => output + 1;

export function moduleOf(output) {
  if (output < 8) return { kind: 'fh2', address: 0 };
  if (output < 64) return { kind: 'cv', address: output >> 3 };
  const o = output - 64;
  return { kind: (o & 15) < 8 ? 'gt' : 'esx', address: o >> 4 };
}

export function isPresent(hardware, output) {
  const m = moduleOf(output);
  if (m.kind === 'fh2') return true;
  if (m.kind === 'cv') return hardware.cv.includes(m.address);
  if (m.kind === 'gt') return hardware.gt.includes(m.address);
  return hardware.esx.includes(m.address);
}

// The modules in rack order: the FH-2, the CV expanders, then the gate expanders.
export function rack(hardware) {
  const out = [{ kind: 'fh2', address: 0, tag: 'FH-2', outputs: [0, 1, 2, 3, 4, 5, 6, 7] }];
  for (const a of [...hardware.cv].sort((x, y) => x - y)) {
    out.push({ kind: 'cv', address: a, tag: `C${a}`, outputs: Array.from({ length: 8 }, (_, j) => a * 8 + j) });
  }
  for (const a of [...hardware.gt].sort((x, y) => x - y)) {
    out.push({ kind: 'gt', address: a, tag: `G${a}`, outputs: Array.from({ length: 8 }, (_, j) => 64 + a * 16 + j) });
    if (hardware.esx.includes(a)) {
      out.push({ kind: 'esx', address: a, tag: `G${a}+`, outputs: Array.from({ length: 8 }, (_, j) => 64 + a * 16 + 8 + j) });
    }
  }
  return out;
}
