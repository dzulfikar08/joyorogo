import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { byokAccess, type ByokAccess } from "@joyorogo/api/lib/joyo-ai/settings";
import type { Person } from "@joyorogo/api/lib/joyo-ai/person";

import { orpc } from "@/utils/orpc";

import {
  joyoDestination,
  type AskSeed,
  type HostedState,
  type JoyoDestination,
  type OwnState,
} from "./open";
import { personFromProfile, UNKNOWN_PERSON } from "./person";
import { joyoSettings } from "./stores";
import type { SettingsSnapshot } from "./settings-store";

/** The Joyo AI settings, live. `loaded` is false until the stored record has been read: decide nothing before that. */
export function useJoyoSettings(): SettingsSnapshot {
  useEffect(() => {
    void joyoSettings.load();
  }, []);
  return useSyncExternalStore(
    joyoSettings.subscribe,
    joyoSettings.getSnapshot,
    joyoSettings.getSnapshot,
  );
}

/**
 * Who is asking, from four profile fields only. Null while the profile is being read; unknown (all null) when it cannot be read
 * (offline), which the own-key engine allows after the person's own "I am 18 or older" and the prompt then goes conservative.
 */
export function usePerson(): Person | null {
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const row = profile.data?.profile ?? null;
  const year = new Date().getFullYear();
  return useMemo(() => {
    if (profile.data) return personFromProfile(row, year);
    if (profile.isError || profile.fetchStatus === "paused") return UNKNOWN_PERSON;
    return null;
    // `row` is read through named fields only; the profile object itself is not kept.
  }, [profile.data, profile.isError, profile.fetchStatus, row, year]);
}

export interface HostedStatus {
  state: HostedState;
  used: number | null;
  cap: number | null;
}

/** The hosted engine's state from `joyo.status`. An older server (no such procedure) or any failure is `unavailable`, never a crash. */
export function useHostedStatus(enabled = true): HostedStatus {
  const query = useQuery({
    ...orpc.joyo.status.queryOptions(),
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  return useMemo<HostedStatus>(() => {
    if (!enabled) return { state: "checking", used: null, cap: null };
    if (query.data) {
      const state: HostedState = query.data.ageBlocked
        ? "minor"
        : query.data.unlocked
          ? "ready"
          : "locked";
      return { state, used: query.data.usedToday, cap: query.data.dailyCap };
    }
    if (query.isError) return { state: "unavailable", used: null, cap: null };
    return { state: "checking", used: null, cap: null };
  }, [enabled, query.data, query.isError]);
}

export interface JoyoState {
  settings: SettingsSnapshot["settings"];
  loaded: boolean;
  person: Person | null;
  /** The own-key gate; null until the settings and the age are known. */
  access: ByokAccess | null;
  hosted: HostedStatus;
}

/** Everything a Joyo AI entry point or the chat needs to decide where to go and what to show. */
export function useJoyoState(): JoyoState {
  const { settings, loaded } = useJoyoSettings();
  const person = usePerson();
  const access = loaded && person ? byokAccess(settings, person.ageYears) : null;
  // The hosted state is not needed while the own key is chosen and works.
  const needsHosted = !(loaded && settings.engine === "byok" && access?.ok === true);
  const hosted = useHostedStatus(needsHosted);
  return { settings, loaded, person, access, hosted };
}

/** The `OwnState` the router helper takes. */
export const ownStateOf = (access: ByokAccess | null): OwnState =>
  access === null ? null : access.ok ? { ok: true } : { ok: false, reason: access.reason };

/** Where a Joyo AI shortcut leads right now. */
export function useJoyoDestination(ask?: AskSeed | null): JoyoDestination {
  const { settings, loaded, access, hosted } = useJoyoState();
  // Before the settings are read nothing can be decided: the chat opens and shows its own checking state.
  return joyoDestination(
    { engine: settings.engine, own: loaded ? ownStateOf(access) : null, hosted: hosted.state },
    ask,
  );
}
