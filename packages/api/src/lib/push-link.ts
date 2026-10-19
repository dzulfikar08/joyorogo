// Where a tap on a push notification goes. Pure and shared: the server builds the link, the web service worker gets
// `url`, JoyoRogo native turns the link into an Expo Router href (`nativeHref`), JoyoFit reads `link` itself. Contract:
// docs/push.md.

export type PushApp = "joyorogo" | "joyofit";

export type PushLink =
  | { t: "post"; postId: string; commentId?: string }
  | { t: "profile"; handle: string }
  /** The social notification list (kudos, comments, follows). */
  | { t: "feed" }
  /** The group inbox (pokes and notes). */
  | { t: "inbox" }
  | { t: "group"; groupId: string }
  | { t: "challenge"; groupId: string; challengeId: string }
  | { t: "makan" }
  | { t: "berat" }
  | { t: "rekap" }
  | { t: "beranda" }
  | { t: "rencana" }
  | { t: "settings" };

/** `data` of every push this pipeline sends (Expo `data`, and the web payload next to title/body). */
export type PushData = {
  v: 1;
  kind: string;
  link: PushLink;
  /** Web path; the service worker opens it. */
  url: string;
  /** The app the notification was written for. */
  app: PushApp;
};

const seg = encodeURIComponent;

/** Path on the JoyoRogo web app. */
export function webUrl(link: PushLink): string {
  switch (link.t) {
    case "post":
      return `/p/${seg(link.postId)}`;
    case "profile":
      return `/u/${seg(link.handle)}`;
    case "feed":
      return "/feed";
    case "inbox":
      return "/inbox";
    case "group":
      return `/grup/${seg(link.groupId)}`;
    case "challenge":
      return `/grup/${seg(link.groupId)}/tantangan/${seg(link.challengeId)}`;
    case "makan":
      return "/makan";
    case "berat":
      return "/berat";
    case "rekap":
      return "/rekap";
    case "beranda":
      return "/beranda";
    case "rencana":
      return "/rencana-makan";
    case "settings":
      return "/profil/notifikasi";
  }
}

/** Expo Router href inside JoyoRogo native. */
export function nativeHref(link: PushLink): string {
  switch (link.t) {
    case "post":
      return `/feed/${seg(link.postId)}`;
    case "profile":
      return `/u/${seg(link.handle)}`;
    case "feed":
      return "/feed/notifikasi";
    case "inbox":
      return "/inbox";
    case "group":
      return `/grup/${seg(link.groupId)}`;
    case "challenge":
      return `/grup/${seg(link.groupId)}/tantangan/${seg(link.challengeId)}`;
    case "makan":
      return "/(tabs)/makan";
    case "berat":
      return "/berat";
    case "rekap":
      return "/rekap";
    case "beranda":
      return "/(tabs)";
    case "rencana":
      return "/rencana-makan";
    case "settings":
      return "/profil/notifikasi";
  }
}

export function pushData(kind: string, link: PushLink, app: PushApp): PushData {
  return { v: 1, kind, link, url: webUrl(link), app };
}

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function parseLink(raw: unknown): PushLink | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  switch (v.t) {
    case "post":
      return isString(v.postId)
        ? { t: "post", postId: v.postId, ...(isString(v.commentId) ? { commentId: v.commentId } : {}) }
        : null;
    case "profile":
      return isString(v.handle) ? { t: "profile", handle: v.handle } : null;
    case "group":
      return isString(v.groupId) ? { t: "group", groupId: v.groupId } : null;
    case "challenge":
      return isString(v.groupId) && isString(v.challengeId)
        ? { t: "challenge", groupId: v.groupId, challengeId: v.challengeId }
        : null;
    case "feed":
    case "inbox":
    case "makan":
    case "berat":
    case "rekap":
    case "beranda":
    case "rencana":
    case "settings":
      return { t: v.t };
    default:
      return null;
  }
}

/**
 * A notification's `data` as a validated `PushData`, or null for anything this pipeline did not send (a local
 * reminder, a JoyoFit family alert, a malformed payload). Taps on null do nothing special.
 */
export function parsePushData(raw: unknown): PushData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (v.v !== 1 || !isString(v.kind)) return null;
  const link = parseLink(v.link);
  if (!link) return null;
  return { v: 1, kind: v.kind, link, url: webUrl(link), app: v.app === "joyofit" ? "joyofit" : "joyorogo" };
}
