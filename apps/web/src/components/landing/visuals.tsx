import {
  Camera,
  Check,
  Flame,
  Hand,
  House,
  Moon,
  NotebookPen,
  Ruler,
  Scale,
  User,
  Utensils,
} from "lucide-react";

import { Ring } from "@/components/kit/ring";
import { fmtInt, fmtKg } from "@/lib/format";

/*
 * Landing visuals are built from the app's own components and tokens, so
 * they stay crisp, theme-aware and weightless (no screenshots to download).
 * Every number here is an example day and is captioned as such.
 */

const EXAMPLE = { target: 1650, eaten: 410 } as const;

/** Real catalog entries from packages/api/src/lib/ideas.ts. */
const IDEAS = [
  { name: "Soto ayam bening + nasi ½", kcal: 330, proteinG: 22 },
  { name: "Pepes ikan + nasi ½ + lalapan", kcal: 360, proteinG: 28 },
] as const;

const SCAN_ITEMS = [
  { name: "Ayam geprek", portion: "1 potong paha", kcal: 350 },
  { name: "Nasi putih", portion: "1 centong, 150 g", kcal: 195 },
  { name: "Sambal bawang", portion: "1 sdm", kcal: 40 },
] as const;

/* Real cutouts from the developer's own scans (R2 sticker crops), served
 * locally from /food/*.webp. Numbers are what his diary actually saved. */
const REAL_DISHES = [
  {
    name: "Bakso",
    img: "/food/bakso.webp",
    w: 320,
    h: 275,
    alt: "Foto bakso: pentol, bakso goreng, tahu, dan lontong",
    portion: "1 mangkok",
    kcal: 380,
  },
  {
    name: "Nasi putih",
    img: "/food/nasi.webp",
    w: 320,
    h: 308,
    alt: "Foto nasi putih bungkus daun dengan sambal",
    portion: "150 g",
    kcal: 195,
  },
  {
    name: "Ayam bumbu kuning",
    img: "/food/ayam-bumbu-kuning.webp",
    w: 320,
    h: 300,
    alt: "Foto ayam bumbu kuning dengan potongan wortel",
    portion: "1 potong",
    kcal: 250,
  },
] as const;

/** Real scan results with the numbers the diary actually saved. */
export function ScanExample() {
  return (
    <figure className="mt-4">
      <div className="grid grid-cols-3 gap-3">
        {REAL_DISHES.map((dish) => (
          <div key={dish.name} className="rounded-2xl bg-card p-2.5 shadow-float">
            <img
              src={dish.img}
              alt={dish.alt}
              width={dish.w}
              height={dish.h}
              loading="lazy"
              decoding="async"
              className="h-auto w-full"
            />
            <p className="mt-1.5 truncate text-xs font-bold">{dish.name}</p>
            <p className="text-[0.6875rem] text-muted-foreground">{dish.portion}</p>
            <p className="mt-1.5 inline-flex rounded-full bg-makan-soft px-2 py-0.5 text-[0.6875rem] font-bold tabular-nums text-makan-ink">
              ±{dish.kcal} kkal
            </p>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-center text-xs text-muted-foreground">
        Foto asli dari diary pengembangnya, lengkap dengan angkanya.
      </figcaption>
    </figure>
  );
}

function MiniTile({
  tone,
  icon,
  label,
  value,
  unit,
}: {
  tone: "bakar" | "tidur" | "makan";
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
}) {
  const tint = {
    makan: "bg-makan-soft text-makan-ink",
    bakar: "bg-bakar-soft text-bakar-ink",
    tidur: "bg-tidur-soft text-tidur-ink",
  }[tone];
  return (
    <div className={`rounded-2xl px-2.5 py-2.5 ${tint}`}>
      {icon}
      <p className="mt-1.5 text-[0.6875rem] font-semibold">{label}</p>
      <p className="text-base leading-tight font-extrabold text-foreground tabular-nums">
        {value}
        <span className="ml-0.5 text-[0.625rem] font-semibold text-muted-foreground">{unit}</span>
      </p>
    </div>
  );
}

/** Phone showing a Beranda morning, with the lunch scan card floating beside it. */
export function HeroPhone() {
  const remaining = EXAMPLE.target - EXAMPLE.eaten;
  const lunch = SCAN_ITEMS.reduce((sum, item) => sum + item.kcal, 0);
  return (
    <figure className="relative mx-auto w-full max-w-[22rem] md:max-w-[26rem]">
      {/* Solid stage behind the device: grounds it without a glow. Real
          food cutouts peek from its corners; decorative, so no alt text. */}
      <div
        aria-hidden
        className="absolute inset-x-4 top-10 bottom-6 rounded-[2.5rem] bg-makan-soft md:inset-x-0"
      />
      <img
        src="/food/nasi.webp"
        alt=""
        width={320}
        height={308}
        decoding="async"
        className="absolute -top-5 right-1 w-20 rotate-6 md:-right-4 md:top-6 md:w-28"
      />
      <img
        src="/food/ayam-bumbu-kuning.webp"
        alt=""
        width={320}
        height={300}
        decoding="async"
        className="absolute -right-2 bottom-16 hidden w-24 -rotate-6 md:-right-14 md:bottom-24 md:block md:w-32 md:animate-drift"
      />

      <div className="relative mx-auto w-[16.5rem] rounded-[2.6rem] bg-[oklch(0.22_0.01_85)] p-[7px] shadow-float md:w-[17.5rem]">
        <div
          className="overflow-hidden rounded-[2.2rem] bg-background"
          role="img"
          aria-label={`Contoh layar Beranda: masih boleh makan ${fmtInt(remaining)} kcal dari target ${fmtInt(EXAMPLE.target)} kcal.`}
        >
          <div className="flex items-center justify-between px-6 pt-3 text-[0.625rem] font-bold tabular-nums">
            <span>07.42</span>
            <span className="h-4 w-16 rounded-full bg-[oklch(0.22_0.01_85)]" />
            <span className="w-7" />
          </div>

          <div className="px-4 pt-3 pb-2">
            <p className="text-[0.6875rem] font-semibold text-muted-foreground">Selamat pagi</p>
            <p className="text-lg leading-tight font-extrabold tracking-tight">
              Selasa, 13 Oktober
            </p>

            <div className="mt-3 rounded-[1.25rem] bg-card p-3.5">
              <div className="flex justify-center">
                <Ring
                  metric="makan"
                  value={EXAMPLE.eaten}
                  max={EXAMPLE.target}
                  size={138}
                  stroke={11}
                  label="Contoh"
                >
                  <div>
                    <p className="text-[0.625rem] font-semibold text-muted-foreground">
                      Masih boleh
                    </p>
                    <p className="text-[2rem] leading-none font-extrabold tracking-tighter tabular-nums">
                      {fmtInt(remaining)}
                    </p>
                    <p className="text-[0.625rem] font-semibold text-muted-foreground">kcal</p>
                  </div>
                </Ring>
              </div>
              <p className="mt-3 text-[0.6875rem] font-bold">Masih muat</p>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {IDEAS.map((idea) => (
                  <div key={idea.name} className="rounded-xl bg-makan-soft px-2 py-1.5">
                    <p className="line-clamp-2 text-[0.625rem] leading-snug font-semibold">
                      {idea.name}
                    </p>
                    <p className="mt-0.5 text-[0.5625rem] font-semibold text-makan-ink tabular-nums">
                      {idea.kcal} kcal · {idea.proteinG} g protein
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <MiniTile
                tone="bakar"
                icon={<Flame className="size-3.5" aria-hidden />}
                label="Bakar"
                value="120"
                unit="/300"
              />
              <MiniTile
                tone="tidur"
                icon={<Moon className="size-3.5" aria-hidden />}
                label="Tidur"
                value="7,5"
                unit="jam"
              />
              <MiniTile
                tone="makan"
                icon={<Scale className="size-3.5" aria-hidden />}
                label="Tren"
                value="82,4"
                unit="kg"
              />
            </div>
          </div>

          <div className="mt-1 flex items-center justify-around border-t border-border/70 px-3 pt-2 pb-4 text-muted-foreground">
            <House className="size-4 text-primary" aria-hidden />
            <Utensils className="size-4" aria-hidden />
            <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Camera className="size-4" aria-hidden />
            </span>
            <Scale className="size-4" aria-hidden />
            <User className="size-4" aria-hidden />
          </div>
        </div>
      </div>

      {/* The scan result that would come next: lunch, one photo. Static
          below the phone on small screens (absolute would cover the mock),
          floating beside it with a gentle bob from md up. */}
      <div
        className="relative z-10 mx-auto -mt-4 w-[13.5rem] rounded-[1.25rem] bg-card p-3.5 shadow-float md:absolute md:bottom-6 md:-left-20 md:mx-0 md:mt-0 md:w-60 md:animate-drift"
        role="img"
        aria-label={`Contoh hasil foto makan siang: ${fmtInt(lunch)} kcal.`}
      >
        <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold text-muted-foreground">
          <Camera className="size-3.5" aria-hidden />
          Hasil foto makan siang
        </p>
        <ul className="mt-2 space-y-1.5">
          {SCAN_ITEMS.map((item) => (
            <li key={item.name} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{item.name}</span>
                <span className="block truncate text-[0.625rem] text-muted-foreground">
                  {item.portion}
                </span>
              </span>
              <span className="text-xs font-bold tabular-nums">{item.kcal}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-baseline justify-between border-t border-border/70 pt-2">
          <span className="text-[0.6875rem] font-semibold text-muted-foreground">Total</span>
          <span className="text-lg leading-none font-extrabold tabular-nums">
            {lunch}{" "}
            <span className="text-[0.625rem] font-semibold text-muted-foreground">kcal</span>
          </span>
        </p>
      </div>

      <figcaption className="relative mt-4 text-center text-xs text-muted-foreground">
        Contoh tampilan aplikasi. Angka hanya ilustrasi.
      </figcaption>
    </figure>
  );
}

// Example 4 weeks: about -0.45 kg/week underneath ±0.6 kg of daily water noise.
const NOISE = [
  0.3, -0.2, 0.5, 0.1, -0.4, 0.6, 0.2, -0.1, 0.4, -0.5, 0.0, 0.5, -0.3, 0.2, 0.6, -0.2, -0.4, 0.3,
  0.1, -0.6, 0.4, 0.0, -0.2, 0.5, -0.3, 0.2, -0.1, 0.1,
];
const SCALE_KG = NOISE.map((n, day) => 84.2 - day * 0.065 + n);
const TREND_KG = SCALE_KG.reduce<number[]>((acc, kg, i) => {
  acc.push(i === 0 ? kg : acc[i - 1] + 0.3 * (kg - acc[i - 1]));
  return acc;
}, []);
const GOAL_KG = 80;

/** Daily scale readings as dots, the smoothed trend as the line. */
export function WeightTrendDemo() {
  const w = 320;
  const h = 150;
  const pad = 10;
  const all = [...SCALE_KG, ...TREND_KG];
  const min = Math.min(...all) - 0.2;
  const max = Math.max(...all) + 0.2;
  const x = (i: number) => pad + (i / (SCALE_KG.length - 1)) * (w - pad * 2);
  const y = (kg: number) => pad + ((max - kg) / (max - min)) * (h - pad * 2);
  const line = TREND_KG.map(
    (kg, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(kg).toFixed(1)}`,
  ).join(" ");
  const latest = TREND_KG[TREND_KG.length - 1];
  const weeklyRate = TREND_KG[TREND_KG.length - 1] - TREND_KG[TREND_KG.length - 8];
  const weeksLeft = Math.round((latest - GOAL_KG) / Math.abs(weeklyRate));
  const lastScale = SCALE_KG[SCALE_KG.length - 1];

  return (
    <figure className="rounded-[1.75rem] bg-card p-5 shadow-float md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Berat tren</p>
          <p className="text-[2rem] leading-tight font-extrabold tracking-tight tabular-nums">
            {fmtKg(latest)}
            <span className="ml-1 text-base font-semibold text-muted-foreground">kg</span>
          </p>
          <p className="text-sm font-semibold text-makan-ink">
            Turun {fmtKg(Math.abs(weeklyRate))} kg/minggu
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-muted-foreground">Timbangan pagi ini</p>
          <p className="text-lg font-bold text-muted-foreground tabular-nums">
            {fmtKg(lastScale)} kg
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-4 h-auto w-full"
        role="img"
        aria-label="Contoh grafik 4 minggu: titik timbangan harian naik turun, garis tren turun stabil."
      >
        <path
          d={`${line} L${x(TREND_KG.length - 1)},${h} L${x(0)},${h} Z`}
          className="fill-makan-soft"
        />
        {SCALE_KG.map((kg, i) => (
          <circle key={i} cx={x(i)} cy={y(kg)} r={2.6} className="fill-muted-foreground/45" />
        ))}
        <path
          d={line}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-makan"
        />
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/45" aria-hidden />
          Timbangan harian
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-4 rounded-full bg-makan" aria-hidden />
          Berat tren
        </span>
      </div>

      {/* Lingkar perut rides along in the same figure: the second progress
          number, with the cutoffs the app actually uses. */}
      <div className="mt-3 flex items-start gap-3 border-t border-border/70 pt-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tidur-soft text-tidur-ink">
          <Ruler className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-bold">
            Lingkar perut 82 cm
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[0.625rem] font-semibold text-muted-foreground">
              Contoh
            </span>
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Rasio perut terhadap tinggi 0,49 — di bawah batas 0,5. Batas aman: pria 90 cm, wanita
            80 cm.
          </p>
        </div>
      </div>

      <figcaption className="mt-3 border-t border-border/70 pt-3 text-sm text-muted-foreground">
        Dengan ritme ini, target {GOAL_KG} kg tercapai sekitar{" "}
        <strong className="font-semibold text-foreground">{weeksLeft} minggu lagi</strong>. Contoh
        data.
      </figcaption>
    </figure>
  );
}

/* Example group the same way the app renders one: rows, not tiles. */
const GROUP_FEED = [
  {
    initial: "R",
    name: "Rani",
    note: "Soto ayam, dicatat 08.12",
    chip: "Rapi",
    chipIcon: Check,
    chipClass: "bg-makan-soft text-makan-ink",
    ringClass: "bg-makan-soft text-makan-ink",
  },
  {
    initial: "B",
    name: "Bagus",
    note: "2 hari belum catat apa-apa",
    chip: "Colek",
    chipIcon: Hand,
    chipClass: "bg-bakar-soft text-bakar-ink",
    ringClass: "bg-bakar-soft text-bakar-ink",
  },
  {
    initial: "W",
    name: "Wulan",
    note: "Gym bareng nanti sore, jangan batal",
    chip: "Catatan",
    chipIcon: NotebookPen,
    chipClass: "bg-tidur-soft text-tidur-ink",
    ringClass: "bg-tidur-soft text-tidur-ink",
  },
] as const;

/** Example group feed: member rows, a colek chip, and the VAR teaser card. */
export function GroupPeek() {
  return (
    <figure className="relative mx-auto w-full max-w-[24rem] md:max-w-[26rem]">
      {/* Solid stage behind the card, same trick as the hero phone. */}
      <div
        aria-hidden
        className="absolute inset-x-4 top-8 bottom-10 rounded-[2.5rem] bg-tidur-soft md:inset-x-0"
      />

      <div className="relative rounded-[1.75rem] bg-card p-4 shadow-float md:p-5">
        <p className="flex items-center justify-between gap-3 text-sm font-extrabold tracking-tight">
          Grup Pemalas Sejagat
          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-muted-foreground">
            3 anggota
          </span>
        </p>
        <ul className="mt-2 divide-y divide-border/70">
          {GROUP_FEED.map((member) => (
            <li key={member.name} className="flex items-center gap-3 py-3">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${member.ringClass}`}
                aria-hidden
              >
                {member.initial}
              </span>
              <span className="min-w-0 max-w-[10.5rem]">
                <span className="block truncate text-[0.9375rem] font-bold">{member.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {member.note}
                </span>
              </span>
              <span
                className={`ml-auto flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${member.chipClass}`}
              >
                <member.chipIcon className="size-3" aria-hidden />
                {member.chip}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* The VAR reveal: what VAR Check surfaces about a friend's day. */}
      <div
        className="relative z-10 mx-auto mt-4 ml-auto mr-2 w-48 rounded-[1.25rem] bg-card p-3.5 shadow-float md:absolute md:-right-8 md:-bottom-14 md:mx-0 md:mt-0 md:w-52 md:animate-drift"
        role="img"
        aria-label="Contoh kartu VAR: catatan makanan Bagus hari ini terlihat lewat VAR."
      >
        <p className="inline-block rounded-md border-2 border-bakar-ink px-1.5 py-0.5 text-[0.5625rem] font-black uppercase italic tracking-[0.18em] text-bakar-ink">
          VAR Check
        </p>
        <p className="mt-1.5 text-xs leading-snug font-semibold">
          Isi perut Bagus hari ini: nasi padang + es teh. Colek balik?
        </p>
      </div>

      <figcaption className="relative mt-4 text-center text-xs text-muted-foreground md:pr-44">
        Contoh tampilan grup.
      </figcaption>
    </figure>
  );
}
