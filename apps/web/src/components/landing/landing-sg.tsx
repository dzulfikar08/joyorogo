import { useEffect } from "react";
import { CameraOff, ChevronDown, MegaphoneOff, Trash2 } from "lucide-react";

import { Button } from "@joyorogo/ui/components/button";
import { AppDownload } from "@/components/app-download";
import { AppLink } from "@/components/app-link";
import { Ring } from "@/components/kit/ring";
import { SampleScan, SourceTable } from "@/components/landing/sg-dishes";
import { FooterSg, HeaderSg } from "@/components/landing/sg-chrome";
import { InstallSg } from "@/components/landing/sg-pasang";
import { PricingSg, sgdFaq } from "@/components/landing/sg-pricing";
import { GITHUB_URL, GithubMark } from "@/components/public-header";
import { useAppConfig } from "@/lib/app-config";
import { FAQ_SG, HOW_WE_COUNT, PROMISES, STORY_EXAMPLE, THREE_NUMBERS } from "@/lib/landing-sg";

const PROMISE_ICON = { foto: CameraOff, iklan: MegaphoneOff, padam: Trash2 } as const;

const FOCUS = "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";
const TEXT_LINK = `rounded-sm font-semibold text-primary underline underline-offset-4 ${FOCUS}`;

const HPB_LICENCE_URL = "https://pphtpc.hpb.gov.sg/web/sgfoodid";
const HPB_TERMS_URL = "https://file.go.gov.sg/termsofuse-hpbsgfoodid.pdf";

const INSTALL_LABELS = {
  androidLabel: "Get it on Google Play",
  iphoneLabel: "Download on the App Store",
  webAppLabel: "Or add the web app to your iPhone Home Screen",
} as const;

/**
 * /sg: the landing for Singapore visitors, in English as written in Singapore. Same brand, tokens and mascot as the
 * other landings; the content is rebuilt around what a hawker plate needs (chicken rice, kopitiam units, cited kcal
 * rows from Singapore's own HPB database, S$ pricing from /api/config). Availability wording follows the other
 * landings: Android is on Google Play, iPhone is on the App Store.
 */
export function LandingSg() {
  const config = useAppConfig();

  // The app's own i18n sets <html lang> from the browser's language; this page is English (Singapore) whatever that is.
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = "en-SG";
    return () => {
      document.documentElement.lang = previous;
    };
  }, []);

  return (
    <div lang="en-SG" className="marketing min-h-svh">
      <HeaderSg />

      <main>
        {/* Hero: the promise on the left, a scan result built from real dataset rows on the right. */}
        <section
          data-section="hero"
          className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-8 pb-16 md:grid-cols-[1.05fr_1fr] md:gap-10 md:px-6 md:pt-14 md:pb-24"
        >
          <div className="stagger-enter">
            <h1 className="max-w-xl text-[2.5rem] leading-[1.06] font-extrabold tracking-tight text-balance md:text-[3.5rem]">
              Photo your hawker plate. The kcal in seconds.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground md:text-xl">
              From chicken rice to char kway teow to your morning kopi, JoyoRogo estimates the calories of every item
              on your plate. Edit the result before you save. Every morning there are three numbers: how much you can
              still eat, how much to burn, and how many hours to sleep.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <AppDownload location="sg-hero" {...INSTALL_LABELS} />
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span>Photos are not kept.</span>
              <AppLink
                to="/login"
                data-revklik-goal="signup_click"
                data-revklik-goal-location="sg-hero"
                className={`${TEXT_LINK} inline-flex min-h-11 items-center`}
              >
                Or use the web app right away with a Google account
              </AppLink>
            </p>
          </div>
          <SampleScan />
        </section>

        {/* The three numbers: the eat budget gets the large slot, burn and sleep share the second column. */}
        <section
          id="three-numbers"
          data-section="three-numbers"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-20 md:px-6 md:pb-28"
        >
          <div className="max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
              Three numbers every morning
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              You do not need to memorise the calories of rice or count macros. The app's home screen answers three
              questions, and the numbers move every time you log.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-[1.35fr_1fr] md:grid-rows-2">
            {THREE_NUMBERS.map((n, i) => {
              const primary = i === 0;
              return (
                <article
                  key={n.title}
                  className={
                    primary
                      ? "flex flex-col gap-6 rounded-[1.75rem] bg-makan-soft p-6 sm:flex-row sm:items-center md:row-span-2 md:flex-col md:items-start md:justify-between md:p-8"
                      : "flex items-start gap-5 rounded-[1.75rem] bg-card p-5 md:p-6"
                  }
                >
                  <Ring
                    metric={n.metric}
                    value={n.value}
                    max={n.max}
                    size={primary ? 168 : 96}
                    stroke={primary ? 14 : 9}
                    whenVisible
                    className={primary ? "rounded-full bg-card" : undefined}
                    label={`Example ${n.title.toLowerCase()} target: ${n.center} ${n.unit}`}
                  >
                    <div>
                      <p
                        className={`leading-none font-extrabold tracking-tight tabular-nums ${primary ? "text-4xl" : "text-[1.375rem]"}`}
                      >
                        {n.center}
                      </p>
                      <p className="text-[0.6875rem] font-semibold text-muted-foreground">{n.unit}</p>
                    </div>
                  </Ring>
                  <div>
                    <h3
                      className={`flex flex-wrap items-center gap-2 font-extrabold tracking-tight ${primary ? "text-2xl text-makan-ink" : "text-xl"}`}
                    >
                      {n.title}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        Example
                      </span>
                    </h3>
                    <p
                      className={`mt-2 text-[0.9375rem] leading-relaxed ${primary ? "text-makan-ink/90" : "text-muted-foreground"}`}
                    >
                      {n.body}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            The numbers in the rings are examples to show the shape, not user data.
          </p>
        </section>

        {/* How a Singapore plate is counted: a plain list, not cards, because the content is a lookup. */}
        <section id="how" data-section="how" className="scroll-mt-16 bg-card py-20 md:py-28">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 md:grid-cols-[1fr_1.2fr] md:gap-16 md:px-6">
            <div className="md:sticky md:top-24 md:self-start">
              <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
                A hawker plate is counted one item at a time
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                A plate of chicken rice is not five items, and prata is counted per piece. This is what JoyoRogo
                tells the AI when you are in Singapore.
              </p>
              <div className="mt-8 rounded-2xl bg-makan-soft p-5">
                <p className="font-bold text-makan-ink">Forgot to take a photo? Just say it.</p>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-makan-ink/90">
                  Type "{STORY_EXAMPLE}". The AI counts it and puts it in the right meal. With no amount, chicken rice
                  is 1 plate, roti prata 1 piece, satay 5 sticks, and kopi or teh 1 kopitiam cup.
                </p>
              </div>
            </div>
            <dl className="divide-y divide-border/70 border-y border-border/70">
              {HOW_WE_COUNT.map((row) => (
                <div key={row.dish} className="grid gap-1 py-5 sm:grid-cols-[11rem_1fr] sm:gap-6">
                  <dt className="text-lg font-extrabold tracking-tight">{row.dish}</dt>
                  <dd className="text-[0.9375rem] leading-relaxed text-muted-foreground">{row.rule}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Data honesty: the cited rows, then the licence notice HPB requires. */}
        <section
          id="sources"
          data-section="sources"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-20 md:px-6 md:py-28"
        >
          <div className="grid gap-10 md:grid-cols-[1fr_1.25fr] md:gap-14">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
                The kcal has a source
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                Dishes in the reference table use its values: an ordinary serving and the kcal per 100 g. Anything not
                in the table is estimated by the AI.
              </p>
              <ul className="mt-6 space-y-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                <li>
                  A scan result is always an estimate. Before saving, change the portion, delete a wrong item or add
                  one that is missing.
                </li>
                <li>
                  The table is the Health Promotion Board's own Singapore Food Insights Database (SG FoodID), so it
                  measures dishes as sold in Singapore. A stall's portion and recipe can still differ.
                </li>
                <li>
                  Dishes outside the table use TKPI 2019, the Indonesian food composition table from the Ministry of
                  Health of Indonesia.
                </li>
              </ul>
            </div>
            <SourceTable />
          </div>
          <div className="mt-10 rounded-2xl border border-border/70 bg-card p-5 text-sm leading-relaxed text-muted-foreground md:p-6">
            <p>
              Contains information from Singapore Food Insights Database (SG FoodID) accessed on 2026-10-21 from
              Health Promotion Board which is made available under the terms found at{" "}
              <a href={HPB_LICENCE_URL} target="_blank" rel="noopener" className={TEXT_LINK}>
                pphtpc.hpb.gov.sg/web/sgfoodid
              </a>
              . The information contained within this dataset is provided on an "as-is" basis. The data, including
              but not limited to nutritional information, is subject to inherent limitations. No warranty or
              representation is made as to the accuracy or completeness of the data contained herein.
            </p>
            <p className="mt-3">
              HPB does not endorse JoyoRogo and is not involved in any scan result.{" "}
              <a href={HPB_TERMS_URL} target="_blank" rel="noopener" className={TEXT_LINK}>
                SG FoodID terms of use
              </a>
              .
            </p>
          </div>
        </section>

        {/* Privacy promises: the other landings' three. */}
        <section aria-label="Privacy promises" className="border-y border-border/70 bg-card">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3 md:px-6 md:py-12">
            {PROMISES.map((promise) => {
              const Icon = PROMISE_ICON[promise.key];
              return (
                <div key={promise.key} className="flex items-start gap-3.5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-makan-soft text-makan-ink">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div>
                    <p className="font-bold">{promise.title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{promise.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mx-auto -mt-2 w-full max-w-6xl px-4 pb-8 text-sm text-muted-foreground">
            Read the{" "}
            <a
              href="/my/privacy"
              lang="en"
              className={TEXT_LINK}
              data-revklik-goal="privacy_click"
              data-revklik-goal-location="sg"
            >
              privacy notice
            </a>
            . It was written for Malaysia's Personal Data Protection Act; a Singapore-specific notice is not ready yet.
          </p>
        </section>

        {/* Pricing */}
        <section
          id="pricing"
          data-section="pricing"
          className="mx-auto grid w-full max-w-6xl scroll-mt-20 gap-10 px-4 py-20 md:grid-cols-[1fr_1.3fr] md:gap-16 md:px-6 md:py-28"
        >
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
              Free every day. Pro if you want more.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              No ads. Pro helps JoyoRogo stay independent. The prices and daily limits beside this are read straight
              from the JoyoRogo server.
            </p>
          </div>
          <PricingSg />
        </section>

        <InstallSg />

        {/* FAQ: real questions for this market; the Singapore dollar answer follows /api/config. */}
        <section
          id="faq"
          data-section="faq"
          className="mx-auto w-full max-w-3xl scroll-mt-20 px-4 pt-4 pb-20 md:px-6 md:pb-28"
        >
          <h2 className="text-3xl font-extrabold tracking-tight md:text-[2.75rem] md:leading-[1.1]">
            Frequently asked questions
          </h2>
          <div className="mt-8 divide-y divide-border/70 rounded-[1.75rem] bg-card">
            {[...FAQ_SG.slice(0, 4), ...sgdFaq(config.data), ...FAQ_SG.slice(4)].map((item) => (
              <details key={item.q} className="group px-5 md:px-6">
                <summary
                  className={`-mx-2 flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-2 py-4 text-[1.0625rem] font-bold ${FOCUS} [&::-webkit-details-marker]:hidden`}
                >
                  {item.q}
                  <ChevronDown
                    className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                    aria-hidden
                  />
                </summary>
                <p className="pb-5 text-[0.9375rem] leading-relaxed text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Open source and who made it. */}
        <section data-section="open-source" className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
          <div className="flex flex-col gap-5 rounded-[1.75rem] bg-card p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div className="flex gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground">
                <GithubMark className="size-6" />
              </span>
              <div>
                <h2 className="text-xl font-extrabold tracking-tight md:text-2xl">
                  The code is open, check it yourself
                </h2>
                <p className="mt-1 max-w-xl text-[0.9375rem] leading-relaxed text-muted-foreground">
                  All of JoyoRogo's code is on GitHub under AGPL-3.0: how calories are counted, the data used, even
                  what is kept from your photo. Made by Joyo Digitama in Malang, Indonesia. Spotted a mistake? Open an
                  issue or send a fix.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="shrink-0"
              render={
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener"
                  data-revklik-goal="github_click"
                  data-revklik-goal-location="sg-open-source"
                />
              }
            >
              <GithubMark className="size-4" />
              View on GitHub
            </Button>
          </div>
        </section>

        {/* Closing: the mascot on the soft green stage, the one place it appears on this page. */}
        <section data-section="closing" className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
          <div className="grid items-center gap-6 overflow-hidden rounded-[2rem] bg-makan-soft px-6 pt-10 md:grid-cols-[1.4fr_1fr] md:gap-10 md:px-14 md:py-0">
            <div className="md:py-16">
              <h2 className="max-w-xl text-3xl font-extrabold tracking-tight text-balance text-makan-ink md:text-[2.75rem] md:leading-[1.1]">
                Scan your first plate today
              </h2>
              <p className="mt-4 max-w-lg text-lg leading-relaxed text-makan-ink/90">
                Sign in with Google, enter your height, weight and goal. Your first number shows up today.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  size="lg"
                  render={
                    <AppLink
                      to="/login"
                      data-revklik-goal="signup_click"
                      data-revklik-goal-location="sg-closing"
                    />
                  }
                >
                  Sign up with Google
                </Button>
                <AppDownload location="sg-closing" {...INSTALL_LABELS} />
              </div>
            </div>
            <img
              src="/mascot/hero.webp"
              alt="Joyo, JoyoRogo's mascot: a green cat in traditional Javanese armour"
              width={620}
              height={857}
              loading="lazy"
              decoding="async"
              className="mx-auto h-60 w-auto self-end object-contain md:h-96"
            />
          </div>
        </section>
      </main>

      <FooterSg />
    </div>
  );
}
