// A short fingerprint of some bytes (FNV-1a, 32 bits, as 8 hex digits): enough to tell whether
// what Night Shift wrote to the FH-2's flash or the EC4 is still what you see.
export function fingerprint(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
