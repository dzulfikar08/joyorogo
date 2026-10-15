import { roundCoord } from "@joyorogo/api/lib/places";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";

// Location is opt-in and per device: the switch lives on this phone only
// (the OS permission is per device too) and defaults to off.
const SAVE_KEY = "joyorogo.places.saveLocation";

export type Coords = { lat: number; lng: number };
export type LocationStatus = "off" | "locating" | "ready" | "denied" | "unavailable";

async function readSaveLocation(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(SAVE_KEY)) === "1";
  } catch {
    return false;
  }
}

async function writeSaveLocation(on: boolean): Promise<void> {
  try {
    if (on) await SecureStore.setItemAsync(SAVE_KEY, "1");
    else await SecureStore.deleteItemAsync(SAVE_KEY);
  } catch {
    // Best-effort: the session keeps the choice either way.
  }
}

/**
 * One position fix, cut to ~100 m right away so the precise fix is never
 * kept. `prompt` false only reads when the OS already granted access.
 */
async function getPosition(prompt: boolean): Promise<Coords | "denied" | null> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    const granted =
      current.granted || (prompt && (await Location.requestForegroundPermissionsAsync()).granted);
    if (!granted) return prompt ? "denied" : null;
    const fix =
      (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { lat: roundCoord(fix.coords.latitude), lng: roundCoord(fix.coords.longitude) };
  } catch {
    return null;
  }
}

/**
 * State behind the "Simpan lokasi tempat makan" switch: the saved choice and
 * the current (rounded) coordinates while it is on. The OS permission prompt
 * only appears when the user flips the switch on.
 */
export function usePlaceLocation() {
  const [enabled, setEnabledState] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<LocationStatus>("off");

  const locate = useCallback(async (prompt: boolean) => {
    setStatus("locating");
    const fix = await getPosition(prompt);
    if (fix === "denied") {
      setCoords(null);
      setStatus("denied");
    } else if (fix) {
      setCoords(fix);
      setStatus("ready");
    } else {
      setCoords(null);
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readSaveLocation().then((on) => {
      if (cancelled || !on) return;
      setEnabledState(true);
      void locate(false);
    });
    return () => {
      cancelled = true;
    };
  }, [locate]);

  const setEnabled = useCallback(
    (on: boolean) => {
      void writeSaveLocation(on);
      setEnabledState(on);
      if (on) {
        void locate(true);
      } else {
        setCoords(null);
        setStatus("off");
      }
    },
    [locate],
  );

  return { enabled, setEnabled, coords, status };
}

/**
 * Where the user is right now, for "Terdekat" only: never stored. It stays
 * null (no prompt) unless the OS already granted location access.
 */
export function useNearbyOrigin(): Coords | null {
  const [origin, setOrigin] = useState<Coords | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getPosition(false).then((fix) => {
      if (!cancelled && fix && fix !== "denied") setOrigin(fix);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return origin;
}
