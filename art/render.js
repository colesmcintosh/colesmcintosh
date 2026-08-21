#!/usr/bin/env node
/**
 * Renders every generative asset used by the profile README.
 *
 *   node art/render.js            # rebuild all assets with the committed seeds
 *   node art/render.js --seed 42  # explore a different signature
 *
 * Output is deterministic: a given seed always produces byte-identical SVG.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildTextMask,
  simulate,
  samplePalette,
  hashString,
  createRng,
  clamp,
  lerp,
} = require('./schema-drift');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets');

const round = (n) => Math.round(n * 10) / 10;

/* ── palettes ─────────────────────────────────────────────────────────────── */

const THEMES = {
  dark: {
    background: '#0b0e12',
    grid: '#7fe0cf',
    gridOpacity: 0.07,
    trail: ['#ef6f45', '#e0995a', '#59a5b4', '#7fe0cf'],
    trailOpacity: 0.34,
    residue: '#7fe0cf',
    cell: ['#3f8f97', '#7fe0cf', '#eafff9'],
    letter: ['#ff8a5c', '#f0bd76', '#6fe3cf', '#eafff9'],
    text: '#93a2af',
    signature: '#5c6b78',
  },
  light: {
    background: '#fbfaf7',
    grid: '#16697a',
    gridOpacity: 0.09,
    trail: ['#c8532a', '#bd8b3c', '#2f7d8c', '#14615c'],
    trailOpacity: 0.38,
    residue: '#16697a',
    cell: ['#5c9aa2', '#1c6f76', '#0d2b32'],
    letter: ['#c2481f', '#a8742a', '#1c7f86', '#0d2b32'],
    text: '#5d6b74',
    signature: '#8d99a1',
  },
};

/* ── shared drawing helpers ───────────────────────────────────────────────── */

function trailPath(points) {
  // Relative deltas: the steps are short, so this halves the byte cost of a filament
  // without losing a tenth of a unit of precision.
  let px = round(points[0][0]);
  let py = round(points[0][1]);
  let d = `M${px} ${py}`;
  for (let i = 1; i < points.length; i++) {
    const x = round(points[i][0]);
    const y = round(points[i][1]);
    d += `l${round(x - px)} ${round(y - py)}`;
    px = x;
    py = y;
  }
  return d;
}

function latticeGrid(width, height, cell, coherenceAt, theme) {
  const lines = [];
  for (let x = 0; x <= width; x += cell * 2) {
    const o = theme.gridOpacity * (0.15 + 0.85 * coherenceAt(x));
    if (o < 0.012) continue;
    lines.push(`<path d="M${x} 0V${height}" opacity="${round(o * 100) / 100}"/>`);
  }
  for (let y = 0; y <= height; y += cell * 2) {
    lines.push(
      `<path d="M${round(width * 0.34)} ${y}H${width}" opacity="${
        round(theme.gridOpacity * 0.55 * 100) / 100
      }"/>`
    );
  }
  return `<g stroke="${theme.grid}" stroke-width="0.5" fill="none">${lines.join('')}</g>`;
}

/* ── the banner ───────────────────────────────────────────────────────────── */

function renderBanner({ seed, themeName, name, tagline }) {
  const theme = THEMES[themeName];
  const W = 1200;
  const H = 400;
  const CELL = 12;

  const mask = buildTextMask(name, { cell: CELL, centerX: W / 2, top: 126 });
  const field = simulate({
    seed,
    width: W,
    height: H,
    particles: 1050,
    steps: 30,
    lifeDecay: 0.72,
    stepLength: 5.4,
    noiseScale: 0.0029,
    octaves: 4,
    turbulence: 1.4,
    drift: 0.46,
    cell: CELL,
    order: [0.1, 0.86],
    quantize: 1.7,
    mask,
    maskBias: 0.44,
    residueThreshold: 0.42,
  });

  const GROUPS = 6;
  const groups = Array.from({ length: GROUPS }, () => []);
  field.trails.forEach((trail, i) => {
    const c = trail.coherence;
    const color = samplePalette(theme.trail, c);
    const width = round(0.65 + 0.95 * c);
    // Ink thins as certainty rises: the ordered half must stay quiet enough to read.
    const opacity =
      round(theme.trailOpacity * (0.5 + 0.7 * trail.energy) * (1 - 0.62 * c) * 100) / 100;
    groups[i % GROUPS].push(
      `<path pathLength="1" d="${trailPath(trail.points)}" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`
    );
  });

  const trailLayer = groups
    .map((g, i) => `<g class="f f${i}" fill="none" stroke-linecap="round">${g.join('')}</g>`)
    .join('');

  const residue = [];
  const cells = [];
  const bloom = [];
  let maxHits = 1;
  field.deposits.forEach((d) => {
    if (d.masked) maxHits = Math.max(maxHits, d.hits);
  });

  field.deposits.forEach((entry, key) => {
    const [cx, cy] = key.split(',').map(Number);
    const x = cx * CELL;
    const y = cy * CELL;
    if (entry.masked) {
      const t = clamp(entry.hits / Math.max(3, maxHits * 0.55), 0, 1);
      // The name is coloured by the same gradient that governs the field, so the first
      // letters still burn while the last have already cooled into lattice.
      const color = samplePalette(theme.letter, clamp(field.coherenceAt(x) * 0.86 + t * 0.24, 0, 1));
      const o = round((0.68 + 0.32 * t) * 100) / 100;
      const delay = round((0.55 + (x / W) * 0.85) * 100) / 100;
      if (t > 0.35) {
        bloom.push(
          `<rect x="${round(x)}" y="${round(y)}" width="${CELL}" height="${CELL}" rx="3"/>`
        );
      }
      cells.push(
        `<rect class="k" style="animation-delay:${delay}s" x="${round(x + CELL * 0.1)}" y="${round(
          y + CELL * 0.1
        )}" width="${round(CELL * 0.8)}" height="${round(CELL * 0.8)}" rx="1.6" fill="${color}" fill-opacity="${o}"/>`
      );
    } else {
      const o = round(Math.min(0.2, 0.05 + entry.hits * 0.035) * 100) / 100;
      residue.push(
        `<rect x="${round(x + CELL * 0.32)}" y="${round(y + CELL * 0.32)}" width="${round(
          CELL * 0.36
        )}" height="${round(CELL * 0.36)}" fill-opacity="${o}"/>`
      );
    }
  });

  // Unvisited mask cells still hold the constraint — drawn faint so the figure never breaks.
  const ghost = [];
  mask.cells.forEach((key) => {
    if (field.deposits.has(key)) return;
    const [cx, cy] = key.split(',').map(Number);
    ghost.push(
      `<rect x="${round(cx * CELL + CELL * 0.1)}" y="${round(
        cy * CELL + CELL * 0.1
      )}" width="${round(CELL * 0.8)}" height="${round(CELL * 0.8)}" rx="1.6" fill-opacity="0.42"/>`
    );
  });

  const signature = `SCHEMA DRIFT / SEED ${String(seed).padStart(4, '0')} / ${field.trails.length} FILAMENTS`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${name} — generative banner: a turbulent particle field crystallising into the letters of the name">
<title>${name}</title>
<desc>Schema Drift, seed ${seed}. A coherence gradient rises from left to right; particle headings quantise to a lattice and their deposits reveal the name.</desc>
<style>
.f{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 2.6s cubic-bezier(.22,.61,.36,1) forwards}
.f1{animation-delay:.12s}.f2{animation-delay:.24s}.f3{animation-delay:.36s}.f4{animation-delay:.48s}.f5{animation-delay:.6s}
.k{opacity:0;animation:bloom .7s ease-out forwards}
.tx{opacity:0;animation:fade 1.2s ease-out 1.5s forwards}
.sw{animation:sweep 11s linear 3s infinite}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes bloom{from{opacity:0}to{opacity:1}}
@keyframes fade{to{opacity:1}}
@keyframes sweep{0%{transform:translateX(-260px);opacity:0}12%{opacity:.5}88%{opacity:.5}100%{transform:translateX(${W}px);opacity:0}}
@media (prefers-reduced-motion:reduce){.f{stroke-dashoffset:0;animation:none}.k,.tx{opacity:1;animation:none}.sw{display:none}}
</style>
<defs>
<radialGradient id="scrim" cx="0.5" cy="0.5" r="0.5">
<stop offset="0" stop-color="${theme.background}" stop-opacity="0.92"/>
<stop offset="0.55" stop-color="${theme.background}" stop-opacity="0.72"/>
<stop offset="1" stop-color="${theme.background}" stop-opacity="0"/>
</radialGradient>
<linearGradient id="edge" x1="0" x2="1">
<stop offset="0" stop-color="${theme.background}" stop-opacity="0.95"/>
<stop offset="1" stop-color="${theme.background}" stop-opacity="0"/>
</linearGradient>
<filter id="bloom" x="-20%" y="-40%" width="140%" height="180%">
<feGaussianBlur stdDeviation="5.5"/>
</filter>
<linearGradient id="sweep" x1="0" x2="1">
<stop offset="0" stop-color="${theme.grid}" stop-opacity="0"/>
<stop offset="0.5" stop-color="${theme.grid}" stop-opacity="0.1"/>
<stop offset="1" stop-color="${theme.grid}" stop-opacity="0"/>
</linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="${theme.background}"/>
${latticeGrid(W, H, CELL, field.coherenceAt, theme)}
${trailLayer}
<g fill="${theme.residue}">${residue.join('')}</g>
<ellipse cx="${W / 2}" cy="${round(mask.y + mask.height / 2 + 26)}" rx="${round(
    mask.width * 0.62
  )}" ry="${round(mask.height * 1.5)}" fill="url(#scrim)"/>
<g filter="url(#bloom)" opacity="0.38" fill="${samplePalette(theme.letter, 0.82)}"><g class="k" style="animation-delay:1.05s">${bloom.join('')}</g></g>
<g class="k" style="animation-delay:.95s" fill="${samplePalette(theme.letter, 0.5)}">${ghost.join('')}</g>
${cells.join('')}
<rect width="130" height="${H}" fill="url(#edge)"/>
<rect x="${W}" y="0" width="130" height="${H}" fill="url(#edge)" transform="rotate(180 ${W} ${
    H / 2
  })"/>
<rect class="sw" x="-260" y="0" width="260" height="${H}" fill="url(#sweep)"/>
<g class="tx" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" text-anchor="middle">
<text x="${W / 2}" y="268" fill="${theme.text}" font-size="15" letter-spacing="6.5">${tagline}</text>
</g>
<text class="tx" x="${W / 2}" y="346" fill="${theme.signature}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="9.5" letter-spacing="3.4" text-anchor="middle">${signature}</text>
</svg>
`;
}

/* ── the divider ──────────────────────────────────────────────────────────── */

function renderRule(seed) {
  const W = 1200;
  const H = 18;
  const CELL = 6;
  const field = simulate({
    seed,
    width: W,
    height: H,
    particles: 430,
    steps: 22,
    stepLength: 4,
    noiseScale: 0.006,
    octaves: 3,
    turbulence: 0.55,
    drift: 0.88,
    lifeDecay: 0.35,
    cell: CELL,
    order: [0.05, 0.8],
    quantize: 1.5,
    mask: null,
  });

  const paths = field.trails
    .map((trail) => {
      const c = trail.coherence;
      const color = samplePalette(['#d97757', '#c98a5a', '#3f9aa6', '#4fb9ad'], c);
      const o = round((0.3 + 0.45 * trail.energy) * 100) / 100;
      return `<path d="${trailPath(trail.points)}" stroke="${color}" stroke-width="${round(
        0.5 + 0.6 * c
      )}" opacity="${o}"/>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="presentation" aria-hidden="true">
<g fill="none" stroke-linecap="round">${paths}</g>
</svg>
`;
}

/* ── project sigils ───────────────────────────────────────────────────────── */

function renderSigil(label) {
  const S = 48;
  const CELL = 8; // a 6 x 6 lattice: small enough to read as a mark at 32px
  const seed = hashString(label);
  const field = simulate({
    seed,
    width: S,
    height: S,
    particles: 17,
    steps: 20,
    stepLength: 3.2,
    wrap: true,
    noiseScale: 0.03,
    octaves: 2,
    turbulence: 1.15,
    drift: 0.34,
    cell: CELL,
    order: [0.04, 0.7],
    quantize: 1.3,
    lifeDecay: 0.3,
    mask: { cells: new Set(), x: 0, y: 0, width: S, height: S },
    maskBias: 0,
    residueThreshold: 0.2,
  });

  // Mid-tones only: one file has to hold up on GitHub's light and dark themes alike.
  const palette = ['#d9663c', '#c08a45', '#2f9aa8', '#1f8891'];

  const paths = field.trails
    .map((trail) => {
      const c = trail.coherence;
      return `<path d="${trailPath(trail.points)}" stroke="${samplePalette(
        palette,
        c
      )}" stroke-width="${round(0.6 + 0.35 * c)}" opacity="${
        round((0.26 + 0.3 * trail.energy) * 100) / 100
      }"/>`;
    })
    .join('');

  // Only the cells with real evidence behind them survive into the mark.
  const found = [];
  field.deposits.forEach((entry, key) => {
    const [cx, cy] = key.split(',').map(Number);
    if (cx < 0 || cy < 0 || cx * CELL >= S || cy * CELL >= S) return;
    found.push({ cx, cy, hits: entry.hits });
  });
  found.sort((a, b) => b.hits - a.hits || a.cx - b.cx || a.cy - b.cy);

  const nodes = found.slice(0, 8).map(({ cx, cy, hits }, i) => {
    const t = clamp(hits / 5, 0, 1);
    const size = lerp(CELL * 0.4, CELL * 0.78, Math.max(t, 1 - i / 9));
    return `<rect x="${round(cx * CELL + (CELL - size) / 2)}" y="${round(
      cy * CELL + (CELL - size) / 2
    )}" width="${round(size)}" height="${round(size)}" rx="1.4" fill="${samplePalette(
      palette,
      clamp(0.35 + (cx / (S / CELL)) * 0.75, 0, 1)
    )}" fill-opacity="${round((0.7 + 0.3 * t) * 100) / 100}"/>`;
  });

  const clipId = `c${(seed % 100000).toString(36)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Generative sigil for ${label}">
<defs><clipPath id="${clipId}"><rect x="1" y="1" width="${S - 2}" height="${S - 2}" rx="7"/></clipPath></defs>
<rect x="1" y="1" width="${S - 2}" height="${S - 2}" rx="7" fill="#7f8f9a" fill-opacity="0.07"/>
<g clip-path="url(#${clipId})">
<g fill="none" stroke-linecap="round">${paths}</g>
${nodes.join('')}
</g>
<rect x="1.5" y="1.5" width="${S - 3}" height="${S - 3}" rx="6.5" fill="none" stroke="#7f8f9a" stroke-opacity="0.22"/>
</svg>
`;
}

/* ── entry point ──────────────────────────────────────────────────────────── */

const NAME = 'COLE MCINTOSH';
const TAGLINE = 'STRUCTURE OUT OF ENTROPY';
const BANNER_SEED = Number(
  (process.argv.includes('--seed') && process.argv[process.argv.indexOf('--seed') + 1]) || 2317
);

const SIGILS = [
  ['openextract', 'OpenExtract'],
  ['langchain-salesforce', 'LangChain Salesforce'],
  ['pdfmd', 'pdfmd'],
  ['vector-vault', 'Vector Vault'],
  ['pycuda-numpy-vector-ops', 'PyCUDA NumPy Vector Ops'],
];

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  const kb = (Buffer.byteLength(contents) / 1024).toFixed(1);
  console.log(`  ${path.relative(ROOT, file).padEnd(38)} ${kb.padStart(7)} KB`);
}

console.log(`Schema Drift — rendering assets (banner seed ${BANNER_SEED})`);
['dark', 'light'].forEach((themeName) => {
  write(
    path.join(OUT, `banner-${themeName}.svg`),
    renderBanner({ seed: BANNER_SEED, themeName, name: NAME, tagline: TAGLINE })
  );
});
write(path.join(OUT, 'rule.svg'), renderRule(BANNER_SEED + 31));
SIGILS.forEach(([slug, label]) => write(path.join(OUT, `sigil-${slug}.svg`), renderSigil(label)));
