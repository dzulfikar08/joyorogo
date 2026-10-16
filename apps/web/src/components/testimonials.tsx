import type { Testimonial } from "@/lib/testimonials";

/** Fewer quotes than this and a looping strip would just repeat itself: show a static list. */
const MIN_FOR_MARQUEE = 4;

function ThreadsMark() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <path d="M17.5 9.5C16.7 6.6 14.6 5 12 5c-3.3 0-5.5 2.6-5.5 7s2.2 7 5.5 7c2.7 0 4.5-1.4 4.5-3.3 0-2-1.8-3.1-4.2-3.1-1.8 0-3 .8-3 2 0 1 .9 1.7 2.1 1.7 2 0 3.1-1.6 3.1-4.3" />
      </svg>
      Threads
    </span>
  );
}

function Card({ item, hidden }: { item: Testimonial; hidden?: boolean }) {
  return (
    <figure className="flex w-72 shrink-0 flex-col justify-between gap-4 rounded-2xl border border-border/70 bg-card p-5 md:w-80">
      <blockquote className="text-[0.9375rem] leading-relaxed text-card-foreground">
        <p lang="id">&ldquo;{item.quote}&rdquo;</p>
      </blockquote>
      <figcaption className="flex items-center justify-between gap-3 text-sm">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={hidden ? -1 : undefined}
            className="min-h-6 truncate font-bold text-foreground underline-offset-4 hover:underline focus-visible:underline"
          >
            @{item.handle}
          </a>
        ) : (
          <span className="truncate font-bold">@{item.handle}</span>
        )}
        <ThreadsMark />
      </figcaption>
    </figure>
  );
}

function Group({ items, hidden }: { items: readonly Testimonial[]; hidden?: boolean }) {
  return (
    <ul className="marquee-group" aria-hidden={hidden ? true : undefined}>
      {items.map((item) => (
        <li key={item.handle + item.quote} className="flex">
          <Card item={item} hidden={hidden} />
        </li>
      ))}
    </ul>
  );
}

export function Testimonials({ items }: { items: readonly Testimonial[] }) {
  if (items.length === 0) return null;
  const isStatic = items.length < MIN_FOR_MARQUEE;
  return (
    <section data-section="testimoni" aria-labelledby="testimoni-judul" className="py-16 md:py-20">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <h2
          id="testimoni-judul"
          className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]"
        >
          Kata mereka di Threads
        </h2>
        <p className="mt-3 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Komentar dan pesan asli dari pengguna, apa adanya.
        </p>
      </div>
      <div
        className="marquee mt-8"
        data-static={isStatic ? "" : undefined}
        style={{ ["--marquee-duration" as string]: `${items.length * 9}s` }}
      >
        <div className="marquee-track">
          <Group items={items} />
          {!isStatic && <Group items={items} hidden />}
        </div>
      </div>
    </section>
  );
}
