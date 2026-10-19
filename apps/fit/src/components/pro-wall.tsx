import { Button } from "@joyorogo/ui/components/button";
import { Activity, BedDouble, Crown, LayoutDashboard, LogOut, RotateCw } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { type Session, signOut } from "@/lib/auth-client";

import { BrandMark } from "./brand-mark";

/** Where Pro is sold; the JoyoRogo web app owns pricing and checkout. */
export const PRICING_URL = "https://joyorogo.com/harga";

/** What a signed-in account without Pro sees instead of the app. */
export function ProWall({
  session,
  onRecheck,
  checking,
}: {
  session: Session;
  onRecheck: () => void;
  checking: boolean;
}) {
  const { t } = useTranslation("fitWeb");
  const navigate = useNavigate();
  const features = [
    { Icon: LayoutDashboard, text: t("wall.featureOverview") },
    { Icon: Activity, text: t("wall.featureWorkouts") },
    { Icon: BedDouble, text: t("wall.featureSleep") },
  ];
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-md rounded-3xl bg-card p-6 ring-1 ring-foreground/5 sm:p-8">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-lg font-extrabold tracking-tight">JoyoFit Web</span>
        </div>
        <span className="mt-6 grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <Crown className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl leading-tight font-extrabold tracking-tight">
          {t("wall.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("wall.body", { email: session.user.email })}
        </p>
        <ul className="mt-5 flex flex-col gap-3">
          {features.map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-7 flex flex-col gap-2.5">
          <Button size="lg" nativeButton={false} render={<a href={PRICING_URL} />}>
            {t("wall.cta")}
          </Button>
          <Button variant="secondary" disabled={checking} onClick={onRecheck}>
            <RotateCw className={checking ? "animate-spin" : undefined} aria-hidden />
            {t("wall.recheck")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await signOut();
              await navigate({ to: "/login" });
            }}
          >
            <LogOut aria-hidden />
            {t("wall.switchAccount")}
          </Button>
        </div>
      </div>
    </div>
  );
}
