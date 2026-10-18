import type { BrandMarks, LogoItem } from "../core/resolve";

/** Same geometry as apps/native/components/logo-mark.tsx and apps/web/public/brand/logo-mark.svg. */
const J =
  "M29.20 102.27L25.06 102.27L25.06 89.39L29.20 89.39Q33.34 89.39 35.87 87.04Q38.40 84.70 38.40 80.83L38.40 33.73L52.66 33.73L52.66 80.19Q52.66 86.81 49.81 91.78Q46.96 96.75 41.67 99.51Q36.38 102.27 29.20 102.27";
const R =
  "M62.92 102.27L48.66 102.27L48.66 33.73L74.88 33.73Q81.96 33.73 87.44 36.21Q92.91 38.70 96.04 43.57Q99.17 48.45 99.17 55.63Q99.17 62.62 95.950 67.54Q92.73 72.46 87.30 74.95L102.94 102.27L86.93 102.27L70 72L79.20 77.43L62.92 77.43L62.92 102.27M62.92 46.15L62.92 65.01L74.97 65.01Q78.01 65.01 80.22 63.81Q82.42 62.62 83.67 60.50Q84.91 58.39 84.91 55.63Q84.91 52.77 83.67 50.66Q82.42 48.54 80.22 47.35Q78.01 46.15 74.97 46.15";
const LEAF = "M0 0 C6 -14 22 -22 38 -20 C36 -4 22 8 0 0 Z";
const VEIN = "M2 -1 C12 -7 22 -12 32 -17";

const LEAF_GREEN = "#6CBF45";

function logoItems(tone: "light" | "dark" | "mono"): LogoItem[] {
  const jColor = tone === "light" ? "#E6F2DF" : tone === "dark" ? "#14693A" : "$fg";
  const rColor = tone === "mono" ? "$fg" : LEAF_GREEN;
  const vein = tone === "light" ? "#1A2E1F" : tone === "dark" ? "#14693A" : "$bg";
  const leafTransform = { x: 49.66, y: 31.73, scale: 0.55, rotate: -10 };
  return [
    { d: R, fill: rColor },
    { d: J, fill: jColor },
    { d: LEAF, fill: rColor, transform: leafTransform },
    { d: VEIN, stroke: { color: vein, width: 2.4, cap: "round" }, transform: leafTransform },
  ];
}

export const rogoBrand: BrandMarks = {
  name: "JoyoRogo",
  link: "joyorogo.com",
  logo: (tone) => ({ viewBox: [20, 12, 88, 98], items: logoItems(tone) }),
};
