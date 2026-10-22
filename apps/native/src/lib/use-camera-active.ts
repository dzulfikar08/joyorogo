import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * True while the screen is the one in front and the app is not in the background. Mount `CameraView` only then: the
 * preview and the sensor keep running under a screen another screen was pushed over, and on Android CameraX only lets
 * go of the camera when the Activity stops, a moment after the app is already in the background. iOS "inactive" (the
 * notification shade, a permission prompt) keeps the camera so the preview does not flash.
 */
export function useCameraActive(): boolean {
  const focused = useIsFocused();
  const [inForeground, setInForeground] = useState(AppState.currentState !== "background");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setInForeground(state !== "background"),
    );
    return () => subscription.remove();
  }, []);
  return focused && inForeground;
}
