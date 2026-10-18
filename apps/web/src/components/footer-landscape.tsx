/**
 * Painted panorama under the public footer: Malang's hills at the turn of the
 * day. Arjuno-Welirang on the left, Semeru smoking on the right, terraced
 * sawah below the wordmark. The three daily numbers live in the scene: the
 * warung (makan), the runner on the path (bakar, the JoyoFit nod) and the
 * mascot napping under the moon (tidur).
 *
 * Every colour is a --scape-* variable from index.css, so dark mode turns the
 * same drawing into night. The brush look comes from SVG filters (displaced
 * edges plus a streaky canvas overlay); no raster besides the mascot.
 */

const W = 1600;
const H = 520;

/** Deterministic PRNG so server and client draw the same strokes. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Dirt path centre and half-width at a given height, used to keep rice and grass off it. */
function pathSpan(y: number): [number, number] {
  const t = Math.min(1, Math.max(0, (y - 360) / 160));
  const centre = 828 + 20 * Math.sin(t * 3.4) - 30 * t * t;
  const half = 7 + 100 * t * t;
  return [centre - half, centre + half];
}

const HILL_TOP =
  "M0,334 C150,302 300,314 420,320 C560,328 640,298 760,302 C900,307 1000,332 1120,320 C1260,306 1420,292 1600,312";

function buildRice() {
  const rand = rng(11);
  const rows: { d: string; w: number }[] = [];
  for (let r = 0; r < 9; r++) {
    const y = 424 + r * 5 + r * r * 0.75;
    const h = 3 + r * 1.1;
    const gap = 9 + r * 2.6;
    const [pl, pr] = pathSpan(y);
    let d = "";
    for (let x = (r % 2) * gap * 0.5; x < W; x += gap) {
      if (x > pl - 6 && x < pr + 6) continue;
      const jx = x + (rand() - 0.5) * gap * 0.4;
      const jy = y + (rand() - 0.5) * 2;
      d += `M${r1(jx)},${r1(jy)}l${r1((rand() - 0.5) * 2)},${r1(-h)}`;
    }
    rows.push({ d, w: 1.4 + r * 0.22 });
  }
  return rows;
}

function buildGrass() {
  const rand = rng(29);
  const blades = ["", "", ""];
  for (let i = 0; i < 420; i++) {
    const x = rand() * W;
    const y = 478 + rand() * 50;
    const [pl, pr] = pathSpan(Math.min(y, 520));
    if (x > pl - 4 && x < pr + 4) continue;
    const h = 10 + rand() * 26;
    const lean = (rand() - 0.4) * 16;
    blades[i % 3] +=
      `M${r1(x)},${r1(y)}Q${r1(x + lean * 0.3)},${r1(y - h * 0.6)} ${r1(x + lean)},${r1(y - h)}`;
  }
  const flowers: { x: number; y: number; r: number; tone: number }[] = [];
  for (let i = 0; i < 46; i++) {
    const x = rand() * W;
    const y = 486 + rand() * 30;
    const [pl, pr] = pathSpan(y);
    if (x > pl - 8 && x < pr + 8) continue;
    flowers.push({ x: r1(x), y: r1(y), r: r1(1.8 + rand() * 2.2), tone: i % 3 });
  }
  return { blades, flowers };
}

function buildStars() {
  const rand = rng(5);
  return Array.from({ length: 34 }, () => ({
    x: r1(900 + rand() * 700),
    y: r1(20 + rand() * 200),
    r: r1(0.6 + rand() * 1.4),
  }));
}

type Palm = { x: number; y: number; h: number; lean: number };

const PALMS: Palm[] = [
  { x: 128, y: 400, h: 128, lean: -16 },
  { x: 214, y: 388, h: 98, lean: 12 },
  { x: 470, y: 380, h: 116, lean: 18 },
  { x: 1088, y: 412, h: 110, lean: -14 },
  { x: 1428, y: 378, h: 132, lean: 20 },
  { x: 1512, y: 382, h: 96, lean: -10 },
];

function palmPaths({ x, y, h, lean }: Palm) {
  const cx = x + lean;
  const cy = y - h;
  const trunk = `M${x},${y}Q${r1(x + lean * 0.15)},${r1(y - h * 0.55)} ${cx},${cy}`;
  const L = h * 0.46;
  let fronds = "";
  for (const deg of [-172, -146, -118, -90, -62, -34, -8, 196]) {
    const a = (deg * Math.PI) / 180;
    const ex = cx + Math.cos(a) * L;
    const ey = cy + Math.sin(a) * L * 0.55 + L * 0.42;
    const mx = cx + Math.cos(a) * L * 0.55;
    const my = cy + Math.sin(a) * L * 0.55 - L * 0.12;
    fronds += `M${r1(cx)},${r1(cy)}Q${r1(mx)},${r1(my)} ${r1(ex)},${r1(ey)}`;
  }
  return { trunk, fronds, cx, cy };
}

const RICE = buildRice();
const GRASS = buildGrass();
const STARS = buildStars();
const PALM_PATHS = PALMS.map(palmPaths);

export function FooterLandscape() {
  return (
    <div
      aria-hidden
      className="scape relative h-[clamp(240px,32.5vw,560px)] w-full overflow-hidden select-none"
      style={{
        maskImage: "linear-gradient(to bottom, transparent 0, #000 26%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 26%)",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 size-full"
        role="presentation"
      >
        <defs>
          <linearGradient id="scape-sky" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--scape-sky-a)" />
            <stop offset="0.5" stopColor="var(--scape-sky-b)" />
            <stop offset="1" stopColor="var(--scape-sky-c)" />
          </linearGradient>
          <radialGradient id="scape-glow" cx="260" cy="196" r="320" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--scape-sun)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--scape-sun)" stopOpacity="0" />
          </radialGradient>
          <linearGradient
            id="scape-word"
            x1="0"
            x2="0"
            y1="150"
            y2="330"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="var(--scape-word-a)" />
            <stop offset="1" stopColor="var(--scape-word-b)" />
          </linearGradient>
          <mask id="scape-moon-cut">
            <rect width={W} height={H} fill="#fff" />
            <circle cx="1374" cy="110" r="27" fill="#000" />
          </mask>
          <clipPath id="scape-hill-clip">
            <path d={`${HILL_TOP} L${W},${H} L0,${H}Z`} />
          </clipPath>
          {/* Wobbly, bristly edges. */}
          <filter id="scape-paint" x="-2%" y="-2%" width="104%" height="104%">
            <feTurbulence type="fractalNoise" baseFrequency="0.028 0.07" numOctaves="2" seed="3" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="9"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          {/* Lighter wobble for the letters: dry-brush edges without tearing the glyphs. */}
          <filter id="scape-ink" x="-2%" y="-4%" width="104%" height="108%">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="12" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="4"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <filter id="scape-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          {/* Horizontal brush streaks laid over everything like canvas. */}
          <filter id="scape-canvas" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.004 0.11" numOctaves="3" seed="8" />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.25" />
          </filter>
          <filter id="scape-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="2" />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 0.9" />
          </filter>
        </defs>

        {/* Sky, sun, moon, stars, clouds. */}
        <rect width={W} height={H} fill="url(#scape-sky)" />
        <rect
          width={W}
          height={H}
          fill="url(#scape-glow)"
          style={{ opacity: "var(--scape-sun-op)" }}
        />
        <circle
          cx="260"
          cy="196"
          r="50"
          fill="var(--scape-sun)"
          filter="url(#scape-paint)"
          style={{ opacity: "var(--scape-sun-op)" }}
        />
        <g style={{ opacity: "var(--scape-star-op)" }} fill="var(--scape-moon)">
          {STARS.map((s, i) => (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              className="scape-twinkle"
              style={{ animationDelay: `${(i % 7) * 0.7}s` }}
            />
          ))}
        </g>
        <circle
          cx="1360"
          cy="118"
          r="30"
          fill="var(--scape-moon)"
          mask="url(#scape-moon-cut)"
          style={{ opacity: "var(--scape-moon-op)" }}
        />
        <g fill="var(--scape-cloud)" filter="url(#scape-soft)" className="scape-drift">
          <ellipse cx="520" cy="118" rx="120" ry="16" />
          <ellipse cx="580" cy="104" rx="70" ry="14" />
          <ellipse cx="1240" cy="206" rx="140" ry="14" />
          <ellipse cx="1500" cy="70" rx="90" ry="11" />
        </g>

        {/* Arjuno-Welirang ridge on the left, Semeru's cone on the right. */}
        <g filter="url(#scape-paint)">
          <path
            fill="var(--scape-mtn-far)"
            d="M0,300 C80,262 140,252 200,234 C260,216 300,172 360,152 C400,140 430,152 470,176 C520,202 560,192 610,206 C680,226 740,250 820,250 C880,250 960,206 1040,148 C1076,122 1098,110 1112,106 L1134,106 C1150,110 1170,122 1200,145 C1290,214 1400,252 1600,272 L1600,520 L0,520Z"
          />
          <g fill="var(--scape-mtn-shade)">
            <path d="M1126,108 L1134,106 C1150,110 1170,122 1200,145 C1260,190 1320,222 1390,246 L1176,266 C1158,200 1140,150 1126,108Z" />
            <path d="M362,152 C400,140 430,152 470,176 C520,202 560,192 610,206 L540,284 C450,244 404,200 362,152Z" />
          </g>
          <g
            stroke="var(--scape-mtn-light)"
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
            opacity="0.55"
          >
            <path d="M1118,112 C1110,150 1086,190 1052,226" />
            <path d="M1126,112 C1128,160 1130,200 1124,248" />
            <path d="M1132,112 C1150,150 1182,186 1224,214" />
            <path d="M360,156 C350,186 330,212 300,236" />
            <path d="M372,156 C392,186 420,206 456,220" />
          </g>
          <path
            fill="var(--scape-mtn-mid)"
            d="M0,336 C120,300 220,288 330,298 C420,306 480,278 560,282 C660,288 720,312 820,306 C930,300 1010,270 1110,268 C1240,266 1330,300 1460,296 C1520,294 1570,290 1600,292 L1600,520 L0,520Z"
          />
        </g>
        <g fill="var(--scape-smoke)" filter="url(#scape-soft)" className="scape-smoke">
          <circle cx="1128" cy="92" r="12" />
          <circle cx="1150" cy="74" r="17" />
          <circle cx="1182" cy="58" r="21" />
          <circle cx="1220" cy="48" r="24" />
          <circle cx="1262" cy="44" r="22" />
        </g>

        {/* The wordmark, half sunk behind the terraces. */}
        <text
          x="800"
          y="338"
          textAnchor="middle"
          fontSize="196"
          fontWeight="800"
          letterSpacing="-6"
          fill="url(#scape-word)"
          filter="url(#scape-ink)"
          className="scape-word"
          style={{ fontFamily: "inherit" }}
        >
          JoyoRogo
        </text>

        {/* Terraced hill in front of the letters. */}
        <g filter="url(#scape-paint)">
          <path d={`${HILL_TOP} L${W},${H} L0,${H}Z`} fill="var(--scape-hill-1)" />
          <g
            clipPath="url(#scape-hill-clip)"
            fill="none"
            stroke="var(--scape-terrace)"
            strokeWidth="3"
            opacity="0.6"
          >
            {[12, 25, 39, 54, 70].map((dy) => (
              <path key={dy} d={HILL_TOP} transform={`translate(0 ${dy})`} />
            ))}
          </g>
          <path
            fill="var(--scape-hill-2)"
            d="M0,384 C120,352 260,346 380,362 C470,373 540,394 640,414 L640,520 L0,520Z"
          />
          <path
            fill="var(--scape-hill-2)"
            d="M960,424 C1060,384 1200,354 1340,356 C1450,358 1530,370 1600,378 L1600,520 L960,520Z"
          />
          <path fill="var(--scape-paddy)" d="M0,420 C400,402 1200,402 1600,420 L1600,520 L0,520Z" />
        </g>
        <g stroke="var(--scape-rice)" strokeLinecap="round" fill="none">
          {RICE.map((row, i) => (
            <path key={i} d={row.d} strokeWidth={row.w} />
          ))}
        </g>

        {/* Warung on the left hill (makan). */}
        <g filter="url(#scape-paint)">
          <rect x="302" y="334" width="72" height="26" fill="var(--scape-wall)" />
          <rect x="314" y="342" width="16" height="10" fill="var(--scape-window)" />
          <rect x="342" y="342" width="22" height="10" fill="var(--scape-window)" />
          <path d="M290,338 L312,314 L364,314 L386,338Z" fill="var(--scape-roof)" />
          <path d="M318,314 L338,302 L358,314Z" fill="var(--scape-roof-dark)" />
          {/* Gubuk on stilts in the right field. */}
          <path d="M1232,372 l0,22 M1270,372 l0,22" stroke="var(--scape-trunk)" strokeWidth="3" />
          <rect x="1228" y="364" width="46" height="9" fill="var(--scape-wall)" />
          <path d="M1218,366 L1251,344 L1284,366Z" fill="var(--scape-roof)" />
        </g>

        {/* Dirt path up into the hills, with a runner on it (bakar, JoyoFit). */}
        <path
          filter="url(#scape-paint)"
          fill="var(--scape-path)"
          d="M690,520 C744,470 808,452 820,424 C832,398 806,382 822,362 L836,362 C828,384 860,400 852,426 C842,458 836,484 904,520Z"
        />
        <g className="scape-runner" transform="translate(842 432)">
          <g stroke="var(--scape-runner)" strokeLinecap="round" fill="none">
            <path d="M0,-14 L-6,-6 L-12,-1" strokeWidth="3.2" />
            <path d="M0,-14 L5,-6 L4,0" strokeWidth="3.2" />
            <path d="M1,-27 L-5,-20 L-8,-15" strokeWidth="2.6" />
            <path d="M1,-27 L7,-22 L10,-26" strokeWidth="2.6" />
          </g>
          <path
            d="M2,-29 L-1,-14"
            stroke="var(--scape-shirt)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <circle cx="3" cy="-34" r="4" fill="var(--scape-runner)" />
          <circle cx="9.5" cy="-25.5" r="1.6" fill="var(--scape-watch)" />
        </g>

        {/* Palms. */}
        <g filter="url(#scape-paint)" fill="none" strokeLinecap="round">
          {PALM_PATHS.map((p, i) => (
            <g key={i}>
              <path d={p.trunk} stroke="var(--scape-trunk)" strokeWidth="5" />
              <path d={p.fronds} stroke="var(--scape-palm)" strokeWidth="6" />
              <path d={p.fronds} stroke="var(--scape-palm-light)" strokeWidth="2" opacity="0.7" />
              <circle cx={p.cx} cy={p.cy + 4} r="4" fill="var(--scape-trunk)" stroke="none" />
            </g>
          ))}
        </g>

        {/* Foreground banks and grass. */}
        <g filter="url(#scape-paint)">
          <path
            fill="var(--scape-fg-1)"
            d="M0,470 C200,452 420,462 600,478 C690,486 712,500 700,520 L0,520Z"
          />
          <path
            fill="var(--scape-fg-1)"
            d="M920,520 C940,492 1050,472 1200,464 C1350,456 1500,462 1600,452 L1600,520Z"
          />
        </g>
        <g fill="none" strokeLinecap="round" strokeWidth="2.6">
          <path d={GRASS.blades[0]} stroke="var(--scape-grass-a)" />
          <path d={GRASS.blades[1]} stroke="var(--scape-grass-b)" />
          <path d={GRASS.blades[2]} stroke="var(--scape-grass-c)" />
        </g>
        {GRASS.flowers.map((f, i) => (
          <circle
            key={i}
            cx={f.x}
            cy={f.y}
            r={f.r}
            fill={
              ["var(--scape-flower-a)", "var(--scape-flower-b)", "var(--scape-flower-c)"][f.tone]
            }
          />
        ))}

        {/* The mascot napping on a tikar (tidur). */}
        <g filter="url(#scape-paint)">
          <path d="M956,502 L1112,494 L1146,510 L984,518Z" fill="var(--scape-tikar)" />
          <path
            d="M990,500 L1014,517 M1026,498 L1052,516 M1062,497 L1090,514 M1098,495 L1126,511"
            stroke="var(--scape-roof)"
            strokeWidth="2"
            opacity="0.35"
          />
        </g>
        <image href="/mascot/relax.webp" x="968" y="372" width="150" height="150" />

        {/* Canvas texture over the whole painting. */}
        <rect
          width={W}
          height={H}
          filter="url(#scape-canvas)"
          style={{ mixBlendMode: "soft-light", opacity: "var(--scape-canvas-op)" }}
        />
        <rect
          width={W}
          height={H}
          filter="url(#scape-grain)"
          style={{ mixBlendMode: "multiply", opacity: 0.18 }}
        />
      </svg>
    </div>
  );
}
