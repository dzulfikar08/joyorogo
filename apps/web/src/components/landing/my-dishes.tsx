import { fmtInt } from "@joyorogo/i18n";
import { MYFCD_DISHES, type MyDish } from "@joyorogo/api/lib/myfcd-dishes";

import { ListGroup, ListRow } from "@/components/kit/surface";

/**
 * Dish rows come straight from MYFCD_DISHES (the dataset the scan calibrates against), looked up by exact name, so a
 * renamed or removed dish drops out of the page instead of showing a number nobody can trace. kcal is the dataset's
 * own arithmetic: typical portion x kcal per 100 g.
 */
type DishRow = { dish: MyDish; label: string; kcal: number };

const SOURCE_LABEL: Record<MyDish["source"]["db"], string> = {
  hpb: "HPB SG FoodID",
  derived: "Dikira daripada entri HPB SG FoodID",
  usda: "USDA FoodData Central",
  published: "Terbitan berpetik",
  myfcd: "MyFCD",
};

const byName = new Map(MYFCD_DISHES.map((dish) => [dish.name, dish]));

function rowsFor(names: readonly string[]): DishRow[] {
  return names.flatMap((name) => {
    const dish = byName.get(name);
    if (!dish) return [];
    return [
      {
        dish,
        label: name.charAt(0).toUpperCase() + name.slice(1),
        kcal: Math.round((dish.typicalPortionG * dish.kcalPer100g) / 100),
      },
    ];
  });
}

const kcalText = (kcal: number) => `${fmtInt(kcal, "ms")} kcal`;

/** The hero's example plate: a nasi lemak, a teh tarik and a kuih, the order of a mamak breakfast. */
const SCAN_NAMES = ["nasi lemak", "teh tarik", "kuih seri muka"] as const;

/** The rows of the source table, mixed across rice, noodles, bread, drinks and sweets. */
const TABLE_NAMES = [
  "nasi lemak",
  "roti canai",
  "mee goreng mamak",
  "char kuey teow",
  "laksa",
  "satay ayam",
  "karipap",
  "kuih seri muka",
  "cendol",
  "teh tarik",
  "milo ais",
] as const;

/**
 * Live HTML rendition of a scan result in the app's own list style. It is labelled as an example because the plate is
 * composed for the page; every row and number is a real dataset row, with its source label under it.
 */
export function ContohImbasan() {
  const rows = rowsFor(SCAN_NAMES);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.kcal, 0);
  return (
    <figure className="reveal-in rounded-[1.75rem] bg-card p-5 shadow-float md:p-6">
      <figcaption className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">Hasil imbasan</p>
          <p className="mt-1 text-[2.75rem] leading-none font-extrabold tracking-tighter tabular-nums">
            {fmtInt(total, "ms")}
            <span className="ml-1.5 text-base font-semibold tracking-normal text-muted-foreground">kcal</span>
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          Contoh
        </span>
      </figcaption>
      <ListGroup className="mt-5 bg-muted/50">
        {rows.map(({ dish, label, kcal }) => (
          <ListRow
            key={dish.name}
            wrapTitle
            title={label}
            subtitle={`${dish.typicalPortionG} g · ${SOURCE_LABEL[dish.source.db]}`}
            value={kcalText(kcal)}
          />
        ))}
      </ListGroup>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Contoh, bukan imbasan sebenar: pinggan ini disusun untuk laman ini, dan setiap baris ialah satu hidangan
        biasa daripada pangkalan data HPB (
        <a
          href="#sumber"
          className="rounded-sm font-semibold text-primary underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          sumber dan notis
        </a>
        ). Hasil sebenar ialah anggaran dan boleh anda sunting sebelum menyimpan.
      </p>
    </figure>
  );
}

/**
 * The cited table: portion, kcal and where the figure comes from, each row linking to its source entry. Reflows to
 * stacked rows on a phone instead of a scrolling table.
 */
export function JadualSumber() {
  const rows = rowsFor(TABLE_NAMES);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-[1.75rem] bg-card p-2 md:p-3">
      <p className="px-3 pt-3 pb-1 text-sm font-semibold text-muted-foreground md:px-4">
        Contoh hidangan dalam jadual, satu hidangan biasa setiap baris
      </p>
      <ul className="divide-y divide-border/70">
        {rows.map(({ dish, label, kcal }) => (
          <li key={dish.name} className="px-3 py-2 md:px-4">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-bold">{label}</p>
              <p className="shrink-0 font-bold tabular-nums">{kcalText(kcal)}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 text-sm">
              <p className="text-muted-foreground tabular-nums">
                {dish.typicalPortionG} g · {dish.kcalPer100g} kcal setiap 100 g
              </p>
              {dish.source.url ? (
                <a
                  href={dish.source.url}
                  target="_blank"
                  rel="noopener"
                  className="-my-1 inline-flex min-h-11 items-center rounded-md font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  {SOURCE_LABEL[dish.source.db]}
                </a>
              ) : (
                <span className="text-muted-foreground">{SOURCE_LABEL[dish.source.db]}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
