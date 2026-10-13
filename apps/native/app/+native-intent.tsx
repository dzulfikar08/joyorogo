// The Strava OAuth redirect (joyorogo://joyorogo.com/strava?code=...) is
// consumed by WebBrowser.openAuthSessionAsync in the Strava card; without
// this the router would also try to open it and land on +not-found.
// Invite links (joyorogo://gabung/<CODE> or the https twin, if the OS ever
// hands it over) must land on the join screen, not +not-found.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const gabung = path.match(/gabung\/([A-Za-z0-9]+)/i);
  if (gabung) return `/gabung/${gabung[1]}`;
  if (path.includes("joyorogo.com/strava")) return "/profil";
  return path;
}
