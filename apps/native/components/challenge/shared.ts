import type { Basis } from "@joyorogo/api/lib/challenge";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import type { InferClientOutputs } from "@orpc/client";
import { useFocusEffect, type Href } from "expo-router";
import { useCallback, useRef } from "react";
import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

type ChallengeOutputs = InferClientOutputs<AppRouterClient>["challenge"];

/** One card of challenge.list. */
export type ChallengeListItem = ChallengeOutputs["list"]["challenges"][number];
/** challenge.detail: header, my state, leaderboard and share payload. */
export type ChallengeDetail = ChallengeOutputs["detail"];
/** One leaderboard row of challenge.detail. */
export type ChallengeMember = ChallengeOutputs["detail"]["leaderboard"][number];

type IconName = ComponentProps<typeof Ionicons>["name"];

const numFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/** "8.000", "10,5": goal values, one decimal at most. */
export function fmtGoalValue(value: number): string {
  return numFmt.format(value);
}

/** "Sen, 20 Okt" for a YYYY-MM-DD date. */
export function fmtShortDay(date: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Detail route of one challenge. Built as a string so it needs no generated route types. */
export function challengeHref(groupId: string, challengeId: string): Href {
  return `/grup/${groupId}/tantangan/${challengeId}` as Href;
}

/** "Mulai 3 hari lagi" / "Hari ke-2 dari 7" / "Selesai". */
export function challengeStatusLabel(c: {
  status: ChallengeListItem["status"];
  startsInDays: number;
  dayNumber: number;
  durationDays: number;
}): string {
  if (c.status === "upcoming") return `Mulai ${c.startsInDays} hari lagi`;
  if (c.status === "active") return `Hari ke-${c.dayNumber} dari ${c.durationDays}`;
  return "Selesai";
}

/** Icon per data backing; only `device` gets a shield. */
export const BASIS_ICON: Record<Basis, IconName> = {
  device: "shield-checkmark",
  photo: "camera",
  manual: "pencil",
};

/** Refetches when the screen regains focus; the first focus is the initial load. */
export function useRefetchOnFocus(refetch: () => unknown): void {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );
}
