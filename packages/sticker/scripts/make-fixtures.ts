// Generates the synthetic photos used by goldens (no real people or food photos in the repo).
// Run: bun packages/sticker/scripts/make-fixtures.ts
import { join } from "node:path";
import sharp from "sharp";

const OUT = join(import.meta.dir, "../fixtures");

const meal = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
<defs>
<linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b4a2f"/><stop offset="1" stop-color="#3a2616"/></linearGradient>
<radialGradient id="p" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stop-color="#fbf7ee"/><stop offset="1" stop-color="#d9d2c3"/></radialGradient>
<radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#d9893b"/><stop offset="1" stop-color="#a85f1d"/></radialGradient>
</defs>
<rect width="1200" height="1600" fill="url(#t)"/>
<g opacity="0.18" stroke="#000" stroke-width="3"><path d="M0 220H1200M0 520H1200M0 820H1200M0 1120H1200M0 1420H1200"/></g>
<ellipse cx="600" cy="760" rx="520" ry="500" fill="#00000040" transform="translate(14 26)"/>
<ellipse cx="600" cy="760" rx="520" ry="500" fill="url(#p)"/>
<ellipse cx="600" cy="760" rx="400" ry="385" fill="#ece6d8"/>
<ellipse cx="590" cy="780" rx="300" ry="250" fill="url(#r)"/>
<g fill="#7a3f12" opacity="0.7"><circle cx="500" cy="700" r="26"/><circle cx="660" cy="760" r="32"/><circle cx="560" cy="860" r="22"/><circle cx="700" cy="680" r="20"/><circle cx="470" cy="800" r="18"/></g>
<g fill="#5f9b3c"><circle cx="640" cy="640" r="30"/><circle cx="520" cy="860" r="24"/><circle cx="720" cy="820" r="22"/><circle cx="450" cy="690" r="20"/></g>
<ellipse cx="760" cy="640" rx="110" ry="80" fill="#fff6d8"/><ellipse cx="760" cy="640" rx="46" ry="38" fill="#f2b400"/>
<g fill="#c8372d"><circle cx="420" cy="900" r="26"/><circle cx="440" cy="930" r="20"/></g>
<rect x="0" y="1180" width="1200" height="420" fill="#00000030"/>
</svg>`;

const portrait = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800">
<defs>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#274b6e"/><stop offset="0.55" stop-color="#e58a4f"/><stop offset="1" stop-color="#2b2236"/></linearGradient>
</defs>
<rect width="1200" height="1800" fill="url(#s)"/>
<circle cx="860" cy="760" r="150" fill="#ffd8a3" opacity="0.9"/>
<path d="M0 1120 C 260 980 480 1060 700 940 C 900 840 1040 900 1200 820 V1800 H0Z" fill="#1d2433"/>
<path d="M0 1320 C 300 1220 520 1300 760 1190 C 940 1110 1060 1160 1200 1100 V1800 H0Z" fill="#141a26"/>
<g fill="#0c1018"><rect x="170" y="1010" width="26" height="420"/><circle cx="183" cy="990" r="86"/><rect x="900" y="1060" width="22" height="360"/><circle cx="911" cy="1040" r="70"/></g>
</svg>`;

const cutout = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000" viewBox="0 0 1200 1000">
<defs><radialGradient id="p" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stop-color="#fbf7ee"/><stop offset="1" stop-color="#d9d2c3"/></radialGradient>
<radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#d9893b"/><stop offset="1" stop-color="#a85f1d"/></radialGradient></defs>
<ellipse cx="600" cy="520" rx="560" ry="430" fill="url(#p)"/><ellipse cx="600" cy="520" rx="440" ry="330" fill="#ece6d8"/>
<ellipse cx="590" cy="530" rx="330" ry="215" fill="url(#r)"/>
<g fill="#7a3f12" opacity="0.7"><circle cx="500" cy="470" r="26"/><circle cx="680" cy="530" r="32"/><circle cx="560" cy="620" r="22"/></g>
<g fill="#5f9b3c"><circle cx="650" cy="430" r="30"/><circle cx="520" cy="610" r="24"/><circle cx="740" cy="590" r="22"/></g>
<ellipse cx="770" cy="430" rx="110" ry="70" fill="#fff6d8"/><ellipse cx="770" cy="430" rx="44" ry="34" fill="#f2b400"/></svg>`;
await sharp(Buffer.from(cutout)).png().toFile(join(OUT, "cutout.png"));
await sharp(Buffer.from(meal)).jpeg({ quality: 82 }).toFile(join(OUT, "meal.jpg"));
await sharp(Buffer.from(portrait)).jpeg({ quality: 82 }).toFile(join(OUT, "portrait.jpg"));
console.log("fixtures written to", OUT);
