// Byte layouts for the FH-2's config and preset dumps, and a codec built from them.
//
// A layout is a list of entries placed one after another from offset 0 of the dump body
// (the bytes between the 8-byte header and the F7). Values stay as the FH-2 stores them
// (channels 0–15, outputs 0–127, …); what they mean is decided elsewhere.
//
// encode() only writes fields whose value differs from the base body, so bytes we don't
// model, or model loosely (padding of names, unused mapping slots), come back unchanged.

export const u7 = {
  min: 0,
  max: 127,
  size: 1,
  read: (b, o) => b[o],
  write: (b, o, v) => { b[o] = v & 0x7f; },
};

// Signed, two's complement in 7 bits (transpose).
export const s7 = {
  min: -64,
  max: 63,
  size: 1,
  read: (b, o) => (b[o] & 0x40 ? b[o] - 128 : b[o]),
  write: (b, o, v) => { b[o] = v & 0x7f; },
};

// 14 bits as two 7-bit bytes, low first (the official tools' sysexSafeShort).
export const u14 = {
  min: 0,
  max: 16383,
  size: 2,
  read: (b, o) => b[o] | (b[o + 1] << 7),
  write: (b, o, v) => { b[o] = v & 0x7f; b[o + 1] = (v >> 7) & 0x7f; },
};

export const s14 = {
  min: -8192,
  max: 8191,
  size: 2,
  read: (b, o) => {
    const v = b[o] | (b[o + 1] << 7);
    return v & 0x2000 ? v - 16384 : v;
  },
  write: (b, o, v) => { b[o] = v & 0x7f; b[o + 1] = (v >> 7) & 0x7f; },
};

// 28 bits as four 7-bit bytes, low first (versions, tempo × 10).
export const u28 = {
  min: 0,
  max: 0xfffffff,
  size: 4,
  read: (b, o) => b[o] | (b[o + 1] << 7) | (b[o + 2] << 14) | (b[o + 3] << 21),
  write: (b, o, v) => { for (let i = 0; i < 4; i++) b[o + i] = (v >> (7 * i)) & 0x7f; },
};

// 16 characters and a terminating zero. The official tools pad names with spaces; read drops
// that padding, so a name edited here (trimmed) reads back equal after a send.
export const name16 = {
  size: 17,
  read: (b, o) => {
    let s = '';
    for (let i = 0; i < 16 && b[o + i]; i++) s += String.fromCharCode(b[o + i]);
    return s.replace(/ +$/, '');
  },
  write: (b, o, v) => {
    const s = (v + ' '.repeat(16)).slice(0, 16);
    for (let i = 0; i < 16; i++) {
      const c = s.charCodeAt(i);
      b[o + i] = c >= 0x20 && c < 0x7f ? c : 0x20;
    }
    b[o + 16] = 0;
  },
};

// `width` bits from bit `shift` of one byte. Bit fields of one byte go in byte().
export const bits = (shift, width) => {
  const mask = ((1 << width) - 1) << shift;
  return {
    min: 0,
    max: (1 << width) - 1,
    size: 1,
    bit: true,
    read: (b, o) => (b[o] & mask) >> shift,
    write: (b, o, v) => { b[o] = (b[o] & ~mask & 0x7f) | ((v << shift) & mask); },
  };
};

// Layout entries.
export const f = (name, type) => ({ kind: 'field', name, type });
export const byte = (...fields) => ({ kind: 'byte', fields });
export const pad = (n) => ({ kind: 'pad', n });
export const rep = (name, count, stride, entries) => ({ kind: 'rep', name, count, stride, entries });
export const at = (offset) => ({ kind: 'at', offset });

// Flattens a layout into [{ path, offset, type }] and checks that repeated blocks fit their stride.
export function compile(layout) {
  const fields = [];
  function walk(entries, base, start, prefix) {
    let c = start;
    for (const e of entries) {
      if (e.kind === 'field') {
        fields.push({ path: [...prefix, e.name], offset: base + c, type: e.type });
        c += e.type.size;
      } else if (e.kind === 'byte') {
        for (const b of e.fields) fields.push({ path: [...prefix, b.name], offset: base + c, type: b.type });
        c += 1;
      } else if (e.kind === 'pad') {
        c += e.n;
      } else if (e.kind === 'at') {
        if (e.offset < c) throw new Error(`layout: at(${e.offset}) is behind the cursor (${c})`);
        c = e.offset;
      } else if (e.kind === 'rep') {
        for (let i = 0; i < e.count; i++) {
          const used = walk(e.entries, base + c + i * e.stride, 0, [...prefix, e.name, i]);
          if (used > e.stride) throw new Error(`layout: ${e.name} uses ${used} bytes, stride is ${e.stride}`);
        }
        c += e.count * e.stride;
      }
    }
    return c;
  }
  const size = walk(layout, 0, 0, []);
  return { fields, size };
}

export function getPath(obj, path) {
  let o = obj;
  for (const k of path) {
    if (o == null) return undefined;
    o = o[k];
  }
  return o;
}

export function setPath(obj, path, v) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (o[k] == null) o[k] = typeof path[i + 1] === 'number' ? [] : {};
    o = o[k];
  }
  o[path[path.length - 1]] = v;
}

export function decode(compiled, body) {
  if (body.length < compiled.size) throw new Error(`dump body too short: ${body.length} bytes, need ${compiled.size}`);
  const out = {};
  for (const fd of compiled.fields) setPath(out, fd.path, fd.type.read(body, fd.offset));
  return out;
}

// Writes `values` over a copy of `base`, field by field, where they differ from what base holds.
export function encode(compiled, values, base) {
  const body = Uint8Array.from(base);
  for (const fd of compiled.fields) {
    const v = getPath(values, fd.path);
    if (v === undefined) continue;
    if (fd.type.read(body, fd.offset) !== v) fd.type.write(body, fd.offset, v);
  }
  return body;
}

// Fields whose values differ between two decoded dumps, as [{ path, from, to }].
export function diff(compiled, a, b) {
  const out = [];
  for (const fd of compiled.fields) {
    const x = getPath(a, fd.path);
    const y = getPath(b, fd.path);
    if (x !== y) out.push({ path: fd.path, from: x, to: y });
  }
  return out;
}
