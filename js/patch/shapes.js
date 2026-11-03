// What an LFO's shape mix and a Euclidean pattern look like, for drawing them. The FH-2's own
// curves aren't documented, so these are close approximations: the shapes are mixed in
// proportion to their amounts, and the Euclid pattern is the usual even spread of pulses.

// A repeatable random value in [−1, 1] for an integer, so drawings don't flicker on redraw.
const rnd = (k) => {
  let x = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return ((x >>> 0) / 0xffffffff) * 2 - 1;
};

// `n` samples over `cycles` cycles of the LFO whose preset fields are `raw` (derive's lfoRaw),
// each in [−1, 1] scaled by the depth (lfoLevel). All zeros when no shape is turned up.
export function lfoSamples(raw, n = 240, cycles = 2) {
  const saw = Math.max(-1, Math.min(1, (raw.lfoSaw - 64) / 63)); // above 64 rises, below falls
  const w = { sine: raw.lfoSine / 127, square: raw.lfoSquare / 127, triangle: raw.lfoTriangle / 127, saw,
    random: raw.lfoRandom / 127, noise: raw.lfoNoise / 127 };
  const total = Object.values(w).reduce((a, x) => a + Math.abs(x), 0);
  const depth = raw.lfoLevel / 16383;
  const pw = raw.lfoPulseWidth / 127;
  const phase = raw.lfoPhase / 128;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!total) {
      out.push(0);
      continue;
    }
    const t = (i / n) * cycles + phase;
    const c = Math.floor(t);
    const f = t - c;
    const v = w.sine * Math.sin(2 * Math.PI * f)
      + w.square * (f < pw ? 1 : -1)
      + w.triangle * (f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4)
      + w.saw * (2 * f - 1)
      + w.random * rnd(c)
      + w.noise * rnd(i * 7919);
    out.push((v / total) * depth);
  }
  return out;
}

// The steps of a Euclidean pattern as booleans: `pulses` spread as evenly as possible over
// `steps`, starting with a pulse, then rotated by `rotation` steps.
export function euclidPattern(pulses, steps, rotation = 0) {
  if (steps < 1) return [];
  const p = Math.max(0, Math.min(pulses, steps));
  const base = Array.from({ length: steps }, (_, i) => (i * p) % steps < p);
  return base.map((_, i) => base[(i + rotation) % steps]);
}
