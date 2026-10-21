import { fmtInt } from "@joyorogo/i18n";
import { MYFCD_DISHES, type MyDish } from "@joyorogo/api/lib/myfcd-dishes";

import { ListGroup, ListRow } from "@/components/kit/surface";
import { SG_DISH_LABEL } from "@/lib/landing-sg";

/**
 * Dish rows come straight from MYFCD_DISHES (the dataset the scan calibrates against, HPB SG FoodID), looked up by
 * exact name, so a renamed or removed dish drops out of the page instead of showing a number nobody can trace. kcal is
 * the dataset's own arithmetic: typical portion x kcal per 100 g.
 */
type DishRow = { dish: MyDish; label: string; kcal: number };

const SOURCE_LABEL: Record<MyDish["source"]["db"], string> = {
  hpb: "HPB SG FoodID",
  derived: "Computed from HPB SG FoodID entries",
  usda: "USDA FoodData Central",
  published: "Published source",
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
        label: SG_DISH_LABEL[name] ?? name.charAt(0).toUpperCase() + name.slice(1),
        kcal: Math.round((dish.typicalPortionG * dish.kcalPer100g) / 100),
      },
    ];
  });
}

const kcalText = (kcal: number) => `${fmtInt(kcal, "en")} kcal`;

/** The hero's example plate: the kopitiam breakfast, kaya toast and a kopi. */
const SCAN_NAMES = ["roti bakar kaya", "kopi"] as const;

/** The rows of the source table, mixed across rice, noodles, bread, drinks and sides. */
const TABLE_NAMES = [
  "nasi ayam",
  "nasi lemak",
  "char kuey teow",
  "laksa",
  "hokkien mee",
  "roti canai",
  "roti bakar kaya",
  "satay ayam",
  "kopi",
  "teh",
  "bubble tea",
] as const;

/**
 * Live HTML rendition of a scan result in the app's own list style. It is labelled as an example because the plate is
 * composed for the page; every row and number is a real dataset row, with its source label under it.
 */
export function SampleScan() {
  const rows = rowsFor(SCAN_NAMES);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.kcal, 0);
  return (
    <figure className="reveal-in rounded-[1.75rem] bg-card p-5 shadow-float md:p-6">
      <figcaption className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">Scan result</p>
          <p className="mt-1 text-[2.75rem] leading-none font-extrabold tracking-tighter tabular-nums">
            {fmtInt(total, "en")}
            <span className="ml-1.5 text-base font-semibold tracking-normal text-muted-foreground">kcal</span>
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          Example
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
        An example, not a real scan: the plate is put together for this page, and each row is one ordinary serving
        from the HPB database (
        <a
          href="#sources"
          className="rounded-sm font-semibold text-primary underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          sources and notice
        </a>
        ). A real result is an estimate and you can edit it before saving.
      </p>
    </figure>
  );
}

/**
 * The cited table: portion, kcal and where the figure comes from, each row linking to its source entry. Reflows to
 * stacked rows on a phone instead of a scrolling table.
 */
export function SourceTable() {
  const rows = rowsFor(TABLE_NAMES);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-[1.75rem] bg-card p-2 md:p-3">
      <p className="px-3 pt-3 pb-1 text-sm font-semibold text-muted-foreground md:px-4">
        Dishes from the table, one ordinary serving per row
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
                {dish.typicalPortionG} g · {dish.kcalPer100g} kcal per 100 g
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
