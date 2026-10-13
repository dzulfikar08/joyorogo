import "./unistyles";
import { registerWidgetTaskHandler } from "react-native-android-widget";

import { widgetTaskHandler } from "./widget-task-handler";
import "expo-router/entry";

// Runs headlessly in this same bundle whenever the launcher adds, updates
// (periodic, see app.json widgets), resizes or deletes a widget.
registerWidgetTaskHandler(widgetTaskHandler);
