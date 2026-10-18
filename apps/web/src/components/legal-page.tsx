import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";

/** Shell shared by the public legal pages (/syarat, /pengembalian-dana). */
export function LegalPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh">
      <PublicHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-12">
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h1>
          <p className="mt-2 text-muted-foreground">{intro}</p>
          <p className="mt-1 text-xs text-muted-foreground">{updated}</p>
        </header>
        <div className="mt-8 space-y-3">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}

export function LegalSection({
  title,
  id,
  lang,
  children,
}: {
  title: string;
  id?: string;
  lang?: "en";
  children: ReactNode;
}) {
  return (
    <section id={id} lang={lang} className="rounded-3xl bg-card p-5">
      <h2 className="text-base font-bold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
