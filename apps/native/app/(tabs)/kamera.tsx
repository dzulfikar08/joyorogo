import { Redirect } from "expo-router";

// The center tab is a FAB straight into the camera modal; this screen only
// exists so the tab has a route — it always forwards.
export default function KameraRedirect() {
  return <Redirect href="/makan-ai" />;
}
