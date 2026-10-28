import type { Testimonial } from "@/lib/testimonials";

/** Fewer quotes than this and a looping strip would just repeat itself: show a static list. */
const MIN_FOR_MARQUEE = 4;

/** Threads glyph (Simple Icons, CC0), in the text colour. */
function ThreadsMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-foreground" fill="currentColor" role="img" aria-label="Threads">
      <path d="M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z" />
    </svg>
  );
}

function Avatar({ item }: { item: Testimonial }) {
  return item.avatar ? (
    <img
      src={`/testimonials/${item.handle}.webp`}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      className="size-10 shrink-0 rounded-full bg-muted object-cover"
    />
  ) : (
    <span
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-full bg-makan-soft text-sm font-bold uppercase text-makan-ink"
    >
      {item.handle.replace(/[^a-z0-9]/gi, "").charAt(0)}
    </span>
  );
}

function Card({ item, hidden }: { item: Testimonial; hidden?: boolean }) {
  return (
    <figure className="flex w-72 shrink-0 flex-col justify-between gap-4 rounded-2xl border border-border/70 bg-card p-5 md:w-80">
      <blockquote className="text-[0.9375rem] leading-relaxed text-card-foreground">
        <p lang="id">&ldquo;{item.quote}&rdquo;</p>
      </blockquote>
      <figcaption className="flex items-center gap-3 text-sm">
        <Avatar item={item} />
        <span className="flex min-w-0 flex-1 flex-col">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={hidden ? -1 : undefined}
              className="truncate font-bold text-foreground underline-offset-4 hover:underline focus-visible:underline"
            >
              @{item.handle}
            </a>
          ) : (
            <span className="truncate font-bold">@{item.handle}</span>
          )}
          <span className="text-xs text-muted-foreground">tentang {item.app}</span>
        </span>
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
