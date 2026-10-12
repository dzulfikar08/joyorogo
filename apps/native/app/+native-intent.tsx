// The Strava OAuth redirect (joyorogo://joyorogo.com/strava?code=...) is
// consumed by WebBrowser.openAuthSessionAsync in the Strava card; without
// this the router would also try to open it and land on +not-found.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes("joyorogo.com/strava")) return "/profil";
  return path;
}
