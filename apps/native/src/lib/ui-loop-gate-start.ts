import { AppState, Platform } from "react-native";
import { scheduleOnUI } from "react-native-worklets";

import { bindUiLoopToAppState, setUiLoopPaused } from "./ui-loop-gate";

// Imported from index.js ahead of the app's own modules, so a host booted headlessly by a widget refresh (AppState
// "background") holds its UI loop before the bundle has finished evaluating. Android only: iOS drives the loop from a
// CADisplayLink, which stops with the app.
if (Platform.OS === "android") {
  bindUiLoopToAppState(AppState, (paused) => scheduleOnUI(setUiLoopPaused, paused));
}
