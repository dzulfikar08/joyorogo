import "./polyfills";
// worklets 0.10.1 never pauses its UI-thread frame loop on Android (~120 wakeups a second with the app in the
// background, or booted headlessly by a widget refresh). Held while the app is not active; see src/lib/ui-loop-gate.ts.
import "./src/lib/ui-loop-gate-start";
import "./unistyles";
import { registerWidgetTaskHandler } from "react-native-android-widget";

import { widgetTaskHandler } from "./widget-task-handler";
import "expo-router/entry";

// Runs headlessly in this same bundle whenever the launcher adds, updates
// (periodic, see app.json widgets), resizes or deletes a widget.
registerWidgetTaskHandler(widgetTaskHandler);
