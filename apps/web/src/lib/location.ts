import { useCallback, useEffect, useState } from "react";

import { roundCoord } from "@joyorogo/api/lib/places";

// Location is opt-in and per device: the switch lives in this browser only
// (the permission itself is per browser too) and defaults to off.
const SAVE_KEY = "jrg-save-location";

export type Coords = { lat: number; lng: number };
export type LocationStatus = "off" | "locating" | "ready" | "denied" | "unavailable";

export function readSaveLocation(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSaveLocation(on: boolean) {
  try {
    if (on) localStorage.setItem(SAVE_KEY, "1");
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // private mode: the switch just does not persist
  }
}

// new Promise, not Promise.withResolvers: Safari < 17.4 (iOS 17.3) lacks it.
/** One position fix, cut to ~100 m right away so the precise fix is never kept. */
export function getPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(Object.assign(new Error("unavailable"), { code: 0 }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({ lat: roundCoord(pos.coords.latitude), lng: roundCoord(pos.coords.longitude) }),
      reject,
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });
}

const PERMISSION_DENIED = 1;

/**
 * State behind the "Simpan lokasi tempat makan" switch: persisted choice,
 * and the current (rounded) coordinates while it is on. The browser's own
 * permission prompt only appears when the user flips the switch on.
 */
export function usePlaceLocation() {
  const [enabled, setEnabledState] = useState(readSaveLocation);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<LocationStatus>(enabled ? "locating" : "off");

  const locate = useCallback(() => {
    setStatus("locating");
    return getPosition().then(
      (fix) => {
        setCoords(fix);
        setStatus("ready");
      },
      (error: { code?: number }) => {
        setCoords(null);
        setStatus(error.code === PERMISSION_DENIED ? "denied" : "unavailable");
      },
    );
  }, []);

  useEffect(() => {
    if (enabled) void locate();
  }, [enabled, locate]);

  const setEnabled = useCallback((on: boolean) => {
    writeSaveLocation(on);
    setEnabledState(on);
    if (!on) {
      setCoords(null);
      setStatus("off");
    }
  }, []);

  return { enabled, setEnabled, coords, status, retry: locate };
}

/**
 * Where the user is right now, for "Terdekat" only: never stored. It stays
 * null (no prompt) unless the user opted in or the browser already granted access.
 */
export function useNearbyOrigin(): Coords | null {
  const [origin, setOrigin] = useState<Coords | null>(null);
  useEffect(() => {
    let cancelled = false;
    const run = () =>
      getPosition().then(
        (fix) => {
          if (!cancelled) setOrigin(fix);
        },
        () => {},
      );
    if (readSaveLocation()) {
      void run();
    } else if (typeof navigator !== "undefined" && navigator.permissions) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((state) => {
          if (state.state === "granted") void run();
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, []);
  return origin;
}
