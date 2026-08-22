#!/usr/bin/env node
/**
 * Renders every generative asset used by the profile README.
 *
 *   node art/render.js            # rebuild all assets with the committed seeds
 *   node art/render.js --seed 42  # explore a different signature
 *
 * Output is deterministic: a given seed always produces byte-identical SVG.
 *
 * The palette follows colemcintosh.io — paper, ink, one ember accent — so the
 * profile and the site read as the same object.
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
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const round = (n) => Math.round(n * 10) / 10;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── palettes ─────────────────────────────────────────────────────────────── */

const THEMES = {
  light: {
    background: '#ffffff',
    grid: '#9ca3af',
    gridOpacity: 0.09,
    trail: ['#f97316', '#eda06d', '#d3d8de', '#c2c8cf'],
    trailOpacity: 0.4,
    residue: '#9ca3af',
    letter: ['#f97316', '#dd8a4a', '#4b5563', '#111827'],
    text: '#9ca3af',
    signature: '#c8ced5',
    card: '#ffffff',
    border: '#e5e7eb',
    title: '#111827',
    caption: '#9ca3af',
    body: '#6b7280',
  },
  dark: {
    background: '#0d1117',
    grid: '#8b949e',
    gridOpacity: 0.08,
    trail: ['#f97316', '#c07a45', '#3f4650', '#4a515b'],
    trailOpacity: 0.42,
    residue: '#8b949e',
    letter: ['#f97316', '#dea06c', '#b6bec7', '#f0f6fc'],
    text: '#8b949e',
    signature: '#4d5560',
    card: '#0d1117',
    border: '#30363d',
    title: '#f0f6fc',
    caption: '#8b949e',
    body: '#9198a1',
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
  return `<g stroke="${theme.grid}" stroke-width="0.5" fill="none">${lines.join('')}</g>`;
}

/* ── the banner ───────────────────────────────────────────────────────────── */

function renderBanner({ seed, themeName, name, tagline }) {
  const theme = THEMES[themeName];
  const W = 1200;
  const H = 360;
  const CELL = 12;

  const mask = buildTextMask(name, { cell: CELL, centerX: W / 2, top: 108 });
  const field = simulate({
    seed,
    width: W,
    height: H,
    particles: 900,
    steps: 30,
    lifeDecay: 0.72,
    stepLength: 5.4,
    noiseScale: 0.0031,
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
    const width = round(0.6 + 0.8 * c);
    // Ink thins as certainty rises: the ordered half stays quiet enough to read.
    const opacity =
      round(theme.trailOpacity * (0.5 + 0.7 * trail.energy) * (1 - 0.76 * c) * 100) / 100;
    groups[i % GROUPS].push(
      `<path pathLength="1" d="${trailPath(
        trail.points
      )}" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`
    );
  });

  const trailLayer = groups
    .map((g, i) => `<g class="f f${i}" fill="none" stroke-linecap="round">${g.join('')}</g>`)
    .join('');

  const residue = [];
  const cells = [];
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
      // letters still burn while the last have already cooled into ink.
      const color = samplePalette(theme.letter, clamp(field.coherenceAt(x) * 0.86 + t * 0.24, 0, 1));
      const o = round((0.8 + 0.2 * t) * 100) / 100;
      const delay = round((0.5 + (x / W) * 0.8) * 100) / 100;
      cells.push(
        `<rect class="k" style="animation-delay:${delay}s" x="${round(x + CELL * 0.1)}" y="${round(
          y + CELL * 0.1
        )}" width="${round(CELL * 0.8)}" height="${round(
          CELL * 0.8
        )}" rx="1.5" fill="${color}" fill-opacity="${o}"/>`
      );
    } else {
      const o = round(Math.min(0.12, 0.03 + entry.hits * 0.022) * 100) / 100;
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
      )}" width="${round(CELL * 0.8)}" height="${round(
        CELL * 0.8
      )}" rx="1.5" fill-opacity="0.34"/>`
    );
  });

  const signature = `SCHEMA DRIFT / SEED ${String(seed).padStart(4, '0')} / ${
    field.trails.length
  } FILAMENTS`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(
    name
  )} — a particle field crystallising into the letters of the name">
<title>${esc(name)}</title>
<desc>Schema Drift, seed ${seed}. A coherence gradient rises from left to right; particle headings quantise to a lattice and their deposits reveal the name.</desc>
<style>
.f{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 2.6s cubic-bezier(.22,.61,.36,1) forwards}
.f1{animation-delay:.12s}.f2{animation-delay:.24s}.f3{animation-delay:.36s}.f4{animation-delay:.48s}.f5{animation-delay:.6s}
.k{opacity:0;animation:bloom .7s ease-out forwards}
.tx{opacity:0;animation:fade 1.2s ease-out 1.4s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes bloom{to{opacity:1}}
@keyframes fade{to{opacity:1}}
@media (prefers-reduced-motion:reduce){.f{stroke-dashoffset:0;animation:none}.k,.tx{opacity:1;animation:none}}
</style>
<defs>
<radialGradient id="scrim" cx="0.5" cy="0.5" r="0.5">
<stop offset="0" stop-color="${theme.background}" stop-opacity="0.92"/>
<stop offset="0.55" stop-color="${theme.background}" stop-opacity="0.7"/>
<stop offset="1" stop-color="${theme.background}" stop-opacity="0"/>
</radialGradient>
<linearGradient id="edge" x1="0" x2="1">
<stop offset="0" stop-color="${theme.background}" stop-opacity="0.95"/>
<stop offset="1" stop-color="${theme.background}" stop-opacity="0"/>
</linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="${theme.background}"/>
${latticeGrid(W, H, CELL, field.coherenceAt, theme)}
${trailLayer}
<g fill="${theme.residue}">${residue.join('')}</g>
<ellipse cx="${W / 2}" cy="${round(mask.y + mask.height / 2 + 22)}" rx="${round(
    mask.width * 0.62
  )}" ry="${round(mask.height * 1.45)}" fill="url(#scrim)"/>
<g class="k" style="animation-delay:.9s" fill="${samplePalette(theme.letter, 0.55)}">${ghost.join(
    ''
  )}</g>
${cells.join('')}
<rect width="130" height="${H}" fill="url(#edge)"/>
<rect x="${W}" y="0" width="130" height="${H}" fill="url(#edge)" transform="rotate(180 ${W} ${
    H / 2
  })"/>
<text class="tx" x="${W / 2}" y="238" fill="${
    theme.text
  }" font-family="${FONT}" font-size="14" letter-spacing="6.5" text-anchor="middle">${esc(
    tagline
  )}</text>
<text class="tx" x="${W / 2}" y="316" fill="${
    theme.signature
  }" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="9.5" letter-spacing="3.4" text-anchor="middle">${signature}</text>
</svg>
`;
}

/* ── the divider: a hairline that frays ───────────────────────────────────── */

function renderRule(seed) {
  const W = 1200;
  const H = 12;
  const field = simulate({
    seed,
    width: W,
    height: H,
    particles: 300,
    steps: 18,
    lifeDecay: 0.4,
    stepLength: 4.5,
    noiseScale: 0.008,
    octaves: 2,
    turbulence: 0.42,
    drift: 0.92,
    cell: 6,
    order: [0.04, 0.78],
    quantize: 1.4,
    mask: null,
  });

  const ticks = field.trails
    .map((trail) => {
      const c = trail.coherence;
      const color = samplePalette(['#f97316', '#d9975c', '#b6bcc4', '#a7aeb6'], c);
      const o = round((0.14 + 0.26 * trail.energy) * (1 - 0.35 * c) * 100) / 100;
      return `<path d="${trailPath(trail.points)}" stroke="${color}" stroke-width="0.6" opacity="${o}"/>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="presentation" aria-hidden="true">
<defs>
<linearGradient id="hair" x1="0" x2="1">
<stop offset="0" stop-color="#9ca3af" stop-opacity="0"/>
<stop offset="0.12" stop-color="#9ca3af" stop-opacity="0.45"/>
<stop offset="0.88" stop-color="#9ca3af" stop-opacity="0.45"/>
<stop offset="1" stop-color="#9ca3af" stop-opacity="0"/>
</linearGradient>
</defs>
<g fill="none" stroke-linecap="round">${ticks}</g>
<rect y="${H / 2}" width="${W}" height="0.7" fill="url(#hair)"/>
</svg>
`;
}

/* ── project cards ────────────────────────────────────────────────────────── */

/**
 * A card's mark: the banner's whole argument at 48 pixels. Four columns of a
 * lattice, entropy on the left as small ember specks, order on the right as solid
 * ink. Which rows fill is a pure function of the project's name.
 */
function latticeMark(label, size, theme) {
  const N = 4;
  const cell = size / N;
  const rng = createRng(hashString(label));
  const marks = [];

  for (let c = 0; c < N; c++) {
    const t = c / (N - 1);
    const count = 1 + (rng() < 0.7 ? 1 : 0);
    const rows = [];
    while (rows.length < count) {
      const r = Math.floor(rng() * N);
      if (!rows.includes(r)) rows.push(r);
    }
    rows.sort((a, b) => a - b);
    rows.forEach((r) => {
      const s = lerp(cell * 0.34, cell * 0.78, t);
      marks.push(
        `<rect x="${round(c * cell + (cell - s) / 2)}" y="${round(
          r * cell + (cell - s) / 2
        )}" width="${round(s)}" height="${round(s)}" rx="${round(
          Math.min(2, s / 4)
        )}" fill="${samplePalette(theme.letter, t)}" fill-opacity="${
          round(lerp(0.6, 1, t) * 100) / 100
        }"/>`
      );
    });
  }

  return marks.join('');
}

/** Greedy wrap for the card's single line of prose. */
function wrapText(text, max) {
  const lines = [];
  let line = '';
  text.split(' ').forEach((word) => {
    if ((line + ' ' + word).trim().length > max) {
      lines.push(line.trim());
      line = word;
    } else {
      line += ' ' + word;
    }
  });
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function renderCard({ label, tagline, description, themeName }) {
  const theme = THEMES[themeName];
  const W = 460;
  const H = 236;
  const MARK = 56;
  const mark = latticeMark(label, MARK, theme);
  const lines = wrapText(description, 54);

  const prose = lines
    .map(
      (line, i) =>
        `<text x="${W / 2}" y="${182 + i * 19}" fill="${
          theme.body
        }" font-family="${FONT}" font-size="13" text-anchor="middle">${esc(line)}</text>`
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(
    label
  )} — ${esc(description)}">
<rect x="0.5" y="0.5" width="${W - 1}" height="${
    H - 1
  }" rx="14" fill="${theme.card}" stroke="${theme.border}"/>
<g transform="translate(${round((W - MARK) / 2)} 28)">${mark}</g>
<text x="${W / 2}" y="128" fill="${
    theme.title
  }" font-family="${FONT}" font-size="26" font-weight="700" text-anchor="middle">${esc(label)}</text>
<text x="${W / 2}" y="156" fill="${
    theme.caption
  }" font-family="${FONT}" font-size="11" letter-spacing="2.8" text-anchor="middle">${esc(
    tagline.toUpperCase()
  )}</text>
${prose}
</svg>
`;
}

/* ── entry point ──────────────────────────────────────────────────────────── */

const NAME = 'COLE MCINTOSH';
const TAGLINE = 'STRUCTURE OUT OF ENTROPY';
const BANNER_SEED = Number(
  (process.argv.includes('--seed') && process.argv[process.argv.indexOf('--seed') + 1]) || 2317
);

const PROJECTS = [
  [
    'openextract',
    'OpenExtract',
    'Structured extraction',
    'Documents, images, audio, and video into validated Pydantic models.',
  ],
  [
    'langchain-salesforce',
    'LangChain Salesforce',
    'CRM integration',
    'SOQL queries, schema inspection, and CRUD operations for LangChain.',
  ],
  ['pdfmd', 'pdfmd', 'PDF to Markdown', 'PDF files converted to Markdown by a fast Rust pipeline.'],
  [
    'vector-vault',
    'Vector Vault',
    'Vector search',
    'Approximate vector search in Go, via locality-sensitive hashing.',
  ],
  [
    'pycuda-numpy-vector-ops',
    'PyCUDA NumPy Vector Ops',
    'GPU acceleration',
    'NumPy vector operations accelerated with PyCUDA kernels.',
  ],
];

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  const kb = (Buffer.byteLength(contents) / 1024).toFixed(1);
  console.log(`  ${path.relative(ROOT, file).padEnd(42)} ${kb.padStart(7)} KB`);
}

console.log(`Schema Drift — rendering assets (banner seed ${BANNER_SEED})`);
['light', 'dark'].forEach((themeName) => {
  write(
    path.join(OUT, `banner-${themeName}.svg`),
    renderBanner({ seed: BANNER_SEED, themeName, name: NAME, tagline: TAGLINE })
  );
});
write(path.join(OUT, 'rule.svg'), renderRule(BANNER_SEED + 31));
PROJECTS.forEach(([slug, label, tagline, description]) => {
  ['light', 'dark'].forEach((themeName) => {
    write(
      path.join(OUT, `card-${slug}-${themeName}.svg`),
      renderCard({ label, tagline, description, themeName })
    );
  });
});
