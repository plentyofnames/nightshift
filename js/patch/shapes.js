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

// One note's envelope as [x, y] points, x in 0–1 across attack, decay, a held sustain and
// release, y in −1–1 (depth is bipolar around 64). The times are drawn in proportion to their
// settings; the FH-2's time range and curves aren't documented, so this is the shape only.
// Shapes at 64 are straight lines; below bends one way, above the other.
export function envelopePoints(env, n = 24) {
  const width = (v) => 0.15 + v / 127;
  const a = width(env.attack), d = width(env.decay), hold = 0.8, r = width(env.release);
  const total = a + d + hold + r;
  const s = env.sustain / 127;
  const pts = [[0, 0]];
  const ramp = (x0, w, y0, y1, shape = 64) => {
    const e = Math.pow(2, (64 - shape) / 32);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      pts.push([(x0 + w * t) / total, y0 + (y1 - y0) * Math.pow(t, e)]);
    }
  };
  ramp(0, a, 0, 1, env.attackShape);
  ramp(a, d, 1, s, env.decayShape);
  pts.push([(a + d + hold) / total, s]);
  ramp(a + d + hold, r, s, 0, env.releaseShape);
  const depth = Math.max(-1, Math.min(1, (env.depth - 64) / 63));
  return pts.map(([x, y]) => [x, y * depth]);
}
