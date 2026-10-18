import roadmap from "../../../../../docs/roadmap.json";

type Group = { id: string; title: string; items: string[] };

const groups = roadmap.groups as Group[];

/**
 * Public roadmap. The data is docs/roadmap.json, the same file the README
 * section is generated from (scripts/roadmap-sync.ts), so one edit updates both.
 * No dates: the order inside a group is not a schedule.
 */
export function Roadmap({ fitUrl }: { fitUrl: string }) {
  const doing = groups.find((g) => g.id === "doing");
  const rest = groups.filter((g) => g.id !== "doing");

  return (
    <section
      id="roadmap"
      data-section="roadmap"
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-20 md:px-6 md:pb-28"
    >
      <div className="max-w-2xl">
        <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Yang sedang dan akan kami kerjakan
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Daftar ini belum bisa kamu pakai. Tanpa tanggal rilis, dan urutannya di tiap kelompok
          bukan jadwal.
        </p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-[1.25fr_1fr]">
        {doing && (
          <article className="rounded-[1.75rem] bg-makan-soft p-6 md:p-8">
            <h3 className="text-xl font-extrabold tracking-tight text-makan-ink">{doing.title}</h3>
            <ul className="mt-5 space-y-3.5">
              {doing.items.map((item) => (
                <li key={item} className="text-[0.9375rem] leading-relaxed text-makan-ink/90">
                  {item}
                </li>
              ))}
            </ul>
          </article>
        )}

        <div className="divide-y divide-border/70 rounded-[1.75rem] bg-card">
          {rest.map((group) => (
            <div key={group.id} className="p-6 md:p-8">
              <h3 className="text-lg font-extrabold tracking-tight">{group.title}</h3>
              <ul className="mt-4 space-y-3">
                {group.items.map((item) => (
                  <li key={item} className="text-[0.9375rem] leading-relaxed text-muted-foreground">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-5 text-sm text-muted-foreground">
        Diperbarui{" "}
        {new Date(`${roadmap.updated}T00:00:00Z`).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })}
        . Roadmap aplikasi latihan ada di{" "}
        <a
          href={`${fitUrl}/#roadmap`}
          target="_blank"
          rel="noopener"
          className="font-semibold text-foreground underline underline-offset-4"
          data-revklik-goal="roadmap_joyofit_click"
          data-revklik-goal-location="roadmap"
        >
          halaman JoyoFit
        </a>
        .
      </p>
    </section>
  );
}
