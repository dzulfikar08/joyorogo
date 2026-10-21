import { Check } from "lucide-react";
import { Fragment, useEffect } from "react";

import { FooterMy, HeaderMy } from "@/components/landing/my-chrome";
import {
  inlineParts,
  LEGAL_DOCS,
  LEGAL_PEERS,
  type LegalBlock,
  type LegalPath,
  type LegalSection,
} from "@/lib/legal-my";

const LINK =
  "rounded-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

/** Text with `[label](href)` links and `**bold**`; absolute links open in a new tab. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, i) => {
        if ("text" in part) return <Fragment key={i}>{part.text}</Fragment>;
        if ("bold" in part) {
          return (
            <span key={i} className="font-semibold">
              {part.bold}
            </span>
          );
        }
        const external = /^https?:/.test(part.href);
        return (
          <a
            key={i}
            href={part.href}
            className={LINK}
            {...(external ? { target: "_blank", rel: "noopener" } : {})}
          >
            {part.label}
          </a>
        );
      })}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") {
    return (
      <p className="mt-3 text-sm leading-relaxed">
        <Inline text={block} />
      </p>
    );
  }
  if ("note" in block) {
    return (
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        <Inline text={block.note} />
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2.5">
      {block.list.map((item) => (
        <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>
            <Inline text={item} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ section }: { section: LegalSection }) {
  return (
    <section id={section.id} lang={section.lang} className="scroll-mt-20 rounded-3xl bg-card p-5">
      <h2 className="text-base font-bold tracking-tight">{section.title}</h2>
      {section.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </section>
  );
}

/**
 * The four Malaysian legal pages (/my/privasi, /my/privacy, /my/syarat, /my/terms), one component over the data in
 * lib/legal-my.ts. The app's i18n sets <html lang> from the browser's language; these pages are in their own
 * language whatever that is, so the effect pins it like /my does.
 */
export function LegalMyPage({ path }: { path: LegalPath }) {
  const doc = LEGAL_DOCS[path];
  const peer = LEGAL_DOCS[LEGAL_PEERS[path]];

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = doc.lang;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [doc.lang]);

  return (
    <div lang={doc.lang} className="marketing min-h-svh">
      <HeaderMy legal={doc.lang} />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-12">
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">{doc.title}</h1>
          <p className="mt-2 text-muted-foreground">{doc.intro}</p>
          <p className="mt-1 text-xs text-muted-foreground">{doc.version}</p>
          <p className="mt-3 text-sm">
            <a href={peer.path} lang={peer.lang} hrefLang={peer.lang} className={LINK}>
              {peer.lang === "en" ? "Read this in English" : "Baca dalam Bahasa Melayu"}
            </a>
          </p>
        </header>
        <div className="mt-8 space-y-3">
          {doc.sections.map((section) => (
            <Section key={section.title} section={section} />
          ))}
        </div>
      </main>
      <FooterMy legal={doc.lang} />
    </div>
  );
}
