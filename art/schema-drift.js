/**
 * Schema Drift — the generative engine behind the artwork in this profile.
 *
 * One idea, expressed as a field: a coherence gradient rises across the canvas.
 * Where it is low, particles follow layered Perlin noise and draw organic filaments.
 * Where it is high, headings are interpolated toward the cardinal axes and steps snap
 * to a lattice pitch. Particles that cross a masked lattice cell deposit energy there,
 * so the figure in the artwork is never drawn — it is what survives the constraints.
 *
 * Every output is a pure function of its seed. Same seed, same artwork, forever.
 */

'use strict';

const TAU = Math.PI * 2;

/* ── deterministic randomness ─────────────────────────────────────────────── */

function createRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ── seeded Perlin noise ──────────────────────────────────────────────────── */

function createNoise(seed) {
  const rng = createRng(seed ^ 0x9e3779b9);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (hash, x, y) => {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  };

  return function noise2(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.5;
  };
}

function fbm(noise, x, y, octaves, gain, lacunarity) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/* ── easing and small math ────────────────────────────────────────────────── */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Interpolate between two angles the short way around the circle. */
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/* ── colour ───────────────────────────────────────────────────────────────── */

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb) {
  return '#' + rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');
}

/** Sample a multi-stop palette at t in [0,1]. The temperature of certainty. */
function samplePalette(stops, t) {
  const c = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(Math.floor(c), stops.length - 2);
  const f = c - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return rgbToHex([lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)]);
}

/* ── a 5×7 lattice font — the constraint the field is tested against ──────── */

const GLYPHS = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.###.',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '#####|..#..|..#..|..#..|..#..|..#..|#####',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
};

const GLYPH_W = 5;
const GLYPH_H = 7;

/**
 * Build the lattice mask for a line of text.
 * Returns cell coordinates (in lattice units) plus the block's pixel bounds.
 */
function buildTextMask(text, { cell, centerX, top, tracking = 1 }) {
  const chars = text.toUpperCase().split('');
  const widthCells = chars.length * GLYPH_W + (chars.length - 1) * tracking;
  const originCol = Math.round(centerX / cell - widthCells / 2);
  const originRow = Math.round(top / cell);
  const cells = new Set();

  chars.forEach((ch, index) => {
    const rows = (GLYPHS[ch] || GLYPHS[' ']).split('|');
    const colOffset = originCol + index * (GLYPH_W + tracking);
    rows.forEach((row, r) => {
      for (let c = 0; c < GLYPH_W; c++) {
        if (row[c] === '#') cells.add(`${colOffset + c},${originRow + r}`);
      }
    });
  });

  return {
    cells,
    cols: widthCells,
    rows: GLYPH_H,
    x: originCol * cell,
    y: originRow * cell,
    width: widthCells * cell,
    height: GLYPH_H * cell,
  };
}

/* ── the field ────────────────────────────────────────────────────────────── */

/**
 * Run the coherence field.
 *
 * Left of the gradient, heading comes straight from fractal noise. Right of it,
 * heading eases toward the nearest cardinal axis and step length snaps to the
 * lattice pitch. Everything a particle touches is recorded: filaments as polylines,
 * lattice visits as deposits.
 */
function simulate(options) {
  const o = Object.assign(
    {
      seed: 1,
      width: 1200,
      height: 400,
      particles: 900,
      steps: 26,
      stepLength: 5.2,
      noiseScale: 0.0032,
      octaves: 4,
      turbulence: 1.35,
      drift: 0.42,
      cell: 13,
      order: [0.12, 0.92],
      quantize: 1.7,
      mask: null,
      maskBias: 0.42,
      residueThreshold: 0.5,
      lifeDecay: 0.5,
      wrap: false,
    },
    options
  );

  const rng = createRng(o.seed);
  const noise = createNoise(o.seed);
  const coherenceAt = (x) => smoothstep(o.order[0] * o.width, o.order[1] * o.width, x);

  const trails = [];
  const deposits = new Map();

  const deposit = (x, y, masked) => {
    const key = `${Math.floor(x / o.cell)},${Math.floor(y / o.cell)}`;
    const entry = deposits.get(key);
    if (entry) entry.hits++;
    else deposits.set(key, { hits: 1, masked });
  };

  for (let i = 0; i < o.particles; i++) {
    let x;
    let y;
    // Most particles seed uniformly; a share seeds inside the constrained band so the
    // masked cells accumulate enough evidence to surface.
    if (o.mask && rng() < o.maskBias) {
      x = o.mask.x - o.cell * 2 + rng() * (o.mask.width + o.cell * 4);
      y = o.mask.y - o.cell * 1.5 + rng() * (o.mask.height + o.cell * 3);
    } else {
      x = -o.stepLength * 6 + rng() * (o.width + o.stepLength * 12);
      y = -o.stepLength * 4 + rng() * (o.height + o.stepLength * 8);
    }

    // Certainty is short-lived: settled particles travel less, so the ordered region
    // reads as ticks of evidence rather than long rivers of ink.
    const life = Math.max(
      3,
      Math.round(o.steps * (0.55 + rng() * 0.85) * (1 - o.lifeDecay * coherenceAt(x)))
    );
    const pts = [[x, y]];
    const segments = [];
    let heading = null;
    let coherence = coherenceAt(x);

    for (let s = 0; s < life; s++) {
      coherence = coherenceAt(x);
      const flow =
        fbm(noise, x * o.noiseScale, y * o.noiseScale, o.octaves, 0.5, 2.03) * TAU * o.turbulence;
      // A rightward drift that strengthens with certainty: the field has a direction of travel.
      let theta = lerpAngle(flow, 0, o.drift * (0.45 + 0.55 * coherence));

      if (coherence > 0.001) {
        const snapped = Math.round(theta / (Math.PI / 2)) * (Math.PI / 2);
        theta = lerpAngle(theta, snapped, Math.pow(coherence, o.quantize));
      }
      if (heading !== null) theta = lerpAngle(heading, theta, 0.72);
      heading = theta;

      const step = lerp(o.stepLength, o.cell, Math.pow(coherence, 2.2));
      x += Math.cos(theta) * step;
      y += Math.sin(theta) * step;

      if (o.wrap) {
        // A closed field: a particle leaving one edge re-enters at the opposite one,
        // so a small tile fills edge to edge instead of draining into its margins.
        const wrapped = x < 0 || x > o.width || y < 0 || y > o.height;
        if (wrapped) {
          x = ((x % o.width) + o.width) % o.width;
          y = ((y % o.height) + o.height) % o.height;
          if (pts.length > 2) segments.push(pts.slice());
          pts.length = 0;
          pts.push([x, y]);
          heading = null;
          continue;
        }
      } else if (x < -60 || x > o.width + 60 || y < -60 || y > o.height + 60) {
        break;
      }

      pts.push([x, y]);

      if (o.mask) {
        const key = `${Math.floor(x / o.cell)},${Math.floor(y / o.cell)}`;
        if (o.mask.cells.has(key)) deposit(x, y, true);
        else if (coherence > o.residueThreshold && rng() < coherence * 0.18) deposit(x, y, false);
      }
    }

    if (pts.length > 2) segments.push(pts);
    const energy = rng();
    segments.forEach((segment) => {
      trails.push({
        points: segment,
        coherence: coherenceAt(segment[Math.floor(segment.length / 2)][0]),
        energy,
      });
    });
  }

  return { trails, deposits, coherenceAt, cell: o.cell, rng };
}

module.exports = {
  TAU,
  createRng,
  createNoise,
  hashString,
  fbm,
  clamp,
  lerp,
  lerpAngle,
  smoothstep,
  samplePalette,
  hexToRgb,
  rgbToHex,
  GLYPHS,
  GLYPH_W,
  GLYPH_H,
  buildTextMask,
  simulate,
};
